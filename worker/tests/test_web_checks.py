"""Header and redirect observations, against a local fixture site."""

from __future__ import annotations

from tcescan.checks import web_checks
from tcescan.http_client import fetch

HARDENED = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": "default-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=()",
}


def _by_id(findings):
    return {f.check_id: f for f in findings}


def test_present_headers_are_recorded_as_observed(fixture_site, allow_loopback):
    with fixture_site({"/": (200, HARDENED, b"<html></html>")}) as site:
        result = fetch(f"http://localhost:{site.port}/")
        findings = _by_id(web_checks._header_findings(result.final, _now()))
    for header in HARDENED:
        finding = findings[f"web.header.{header.lower()}"]
        assert finding.outcome == "observed"
        assert finding.recommendation is None


def test_absent_headers_are_recorded_as_absences_not_vulnerabilities(fixture_site, allow_loopback):
    with fixture_site({"/": (200, {}, b"<html></html>")}) as site:
        result = fetch(f"http://localhost:{site.port}/")
        findings = _by_id(web_checks._header_findings(result.final, _now()))
    hsts = findings["web.header.strict-transport-security"]
    assert hsts.outcome == "absent"
    assert hsts.severity_hint == "consider"
    assert "absent hardening measure rather than a confirmed weakness" in hsts.summary
    assert hsts.recommendation


def test_version_disclosure_is_flagged_only_when_a_version_is_named(fixture_site, allow_loopback):
    with fixture_site({"/": (200, {"Server": "nginx/1.18.0", "X-Powered-By": "PHP/7.4.3"}, b"ok")}) as site:
        result = fetch(f"http://localhost:{site.port}/")
        finding = web_checks._disclosure_finding(result.final, _now())
    assert finding.outcome == "observed"
    assert finding.severity_hint == "consider"
    assert "nginx/1.18.0" in finding.summary

    with fixture_site({"/": (200, {"Server": "nginx"}, b"ok")}) as site:
        result = fetch(f"http://localhost:{site.port}/")
        finding = web_checks._disclosure_finding(result.final, _now())
    assert finding.severity_hint == "informational"
    assert finding.recommendation is None


def test_redirects_are_followed_hop_by_hop_and_recorded(fixture_site, allow_loopback):
    with fixture_site(
        {
            "/": (301, {"Location": "/moved"}, b""),
            "/moved": (200, {}, b"here"),
        }
    ) as site:
        result = fetch(f"http://localhost:{site.port}/")
    assert [h.status for h in result.hops] == [301, 200]
    assert result.final.url.endswith("/moved")


def test_a_redirect_to_an_internal_address_is_refused(fixture_site, monkeypatch):
    """The fixture redirects into the lab; the client must stop, not follow."""
    with fixture_site({"/": (302, {"Location": "http://192.168.1.9:8006/"}, b"")}) as site:
        from tcescan import safety

        original = safety.resolve_public_addresses
        monkeypatch.setattr(safety, "ALLOWED_PORTS", tuple(range(1, 65536)))
        monkeypatch.setattr(
            safety,
            "resolve_public_addresses",
            lambda host, port: [(2, "127.0.0.1")] if host == "localhost" else original(host, port),
        )
        result = fetch(f"http://localhost:{site.port}/")
    assert len(result.hops) == 1
    assert result.error
    assert "IP" in result.error or "non-public" in result.error


def test_the_response_body_is_capped(fixture_site, allow_loopback):
    with fixture_site({"/": (200, {}, b"A" * 200_000)}) as site:
        result = fetch(f"http://localhost:{site.port}/", max_bytes=4096)
    assert result.final.truncated is True


def _now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)
