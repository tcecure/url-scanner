"""DNS/email policy observations and briefing rendering, with no live lookups."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from tcescan import report
from tcescan.checks import dns_checks


class FakeAnswer(list):
    pass


@pytest.fixture
def fake_dns(monkeypatch):
    """Answer DNS from a dict instead of the network."""
    zone: dict[tuple[str, str], list[str]] = {}

    def fake_query(_resolver, name, rdtype):
        key = (name, rdtype)
        if key in zone:
            return zone[key], None
        return [], "no record"

    monkeypatch.setattr(dns_checks, "_query", fake_query)
    return zone


def _by_id(findings):
    return {f.check_id: f for f in findings}


def test_a_well_configured_domain_reads_as_observed(fake_dns):
    fake_dns.update(
        {
            ("example.test", "NS"): ["ns1.example.test."],
            ("example.test", "A"): ["93.184.216.34"],
            ("example.test", "MX"): ["10 mx.example.test."],
            ("example.test", "TXT"): ['"v=spf1 include:_spf.google.com -all"'],
            ("_dmarc.example.test", "TXT"): ['"v=DMARC1; p=reject; rua=mailto:dmarc@example.test"'],
        }
    )
    findings = _by_id(dns_checks.run("example.test", nameservers=["1.1.1.1"]))
    assert findings["dns.spf"].outcome == "observed"
    assert findings["dns.spf"].severity_hint == "informational"
    assert findings["dns.dmarc"].severity_hint == "informational"
    assert "p=reject" in findings["dns.dmarc"].summary


def test_missing_email_policy_is_recorded_with_advice(fake_dns):
    fake_dns.update({("example.test", "A"): ["93.184.216.34"], ("example.test", "MX"): ["10 mx.example.test."]})
    findings = _by_id(dns_checks.run("example.test"))
    assert findings["dns.spf"].outcome == "absent"
    assert findings["dns.spf"].severity_hint == "attention"
    assert findings["dns.spf"].recommendation
    assert findings["dns.dmarc"].outcome == "absent"


def test_a_permissive_spf_qualifier_is_called_out(fake_dns):
    fake_dns.update({("example.test", "TXT"): ['"v=spf1 include:_spf.google.com +all"']})
    spf = _by_id(dns_checks.run("example.test"))["dns.spf"]
    assert spf.outcome == "observed"
    assert spf.severity_hint == "consider"
    assert "+all" in spf.summary


def test_monitor_only_dmarc_is_called_out(fake_dns):
    fake_dns.update({("_dmarc.example.test", "TXT"): ['"v=DMARC1; p=none"']})
    dmarc = _by_id(dns_checks.run("example.test"))["dns.dmarc"]
    assert dmarc.severity_hint == "consider"
    assert "p=none" in dmarc.summary


def _finding_row(**overrides):
    row = {
        "check_id": "web.header.strict-transport-security",
        "category": "Website",
        "title": "HTTP Strict Transport Security",
        "outcome": "absent",
        "severity_hint": "consider",
        "summary": "Not present on the home page response.",
        "recommendation": "Tell browsers to only use the encrypted site.",
        "evidence": {"header": "strict-transport-security"},
        "observed_at": datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc),
    }
    row.update(overrides)
    return row


REQUEST = {
    "business_name": "Example Manufacturing LLC",
    "target_domain": "example.test",
    "contact_name": "Dana Reyes",
    "contact_email": "dana@example.test",
    "authorized_method": "dns_txt",
    "authorized_at": datetime(2026, 10, 1, 11, 0, tzinfo=timezone.utc),
    "reply_to": "",
}


def test_the_briefing_keeps_observation_and_recommendation_apart():
    html = report.render_html(request=REQUEST, findings=[_finding_row()])
    assert "Example Manufacturing LLC" in html
    assert "Not present on the home page response." in html
    assert "Recommendation." in html
    assert "not a penetration test or a comprehensive vulnerability assessment" in html
    assert "Not observed" in html


def test_the_briefing_never_calls_an_absence_a_vulnerability():
    html = report.render_html(
        request=REQUEST,
        findings=[_finding_row(), _finding_row(check_id="dns.spf", category="Email", outcome="absent",
                                               severity_hint="attention", title="SPF policy")],
    )
    lowered = html.lower()
    assert "vulnerable" not in lowered
    assert "vulnerability was tested" not in lowered.replace("no vulnerability was tested", "")
    # The only mention of exploitation is the footer stating there was none.
    assert lowered.count("exploit") == 1
    assert "no exploitation of any kind" in lowered
    assert "recorded as an absence, not as a proven weakness" in lowered


def test_the_briefing_carries_the_paid_assessment_invitation():
    html = report.render_html(request=REQUEST, findings=[_finding_row()])
    assert "paid TCecure engagement" in html
    assert "CMMC" in html


def test_counts_describe_the_findings():
    rows = [
        _finding_row(outcome="observed", severity_hint="informational"),
        _finding_row(outcome="absent", severity_hint="attention"),
        _finding_row(outcome="error", severity_hint="informational"),
    ]
    assert report.summarize(rows) == {
        "observed": 1, "absent": 1, "attention": 1, "consider": 0, "errors": 1, "total": 3,
    }
