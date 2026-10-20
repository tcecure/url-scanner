"""The fixed set of public-observation checks performed for a snapshot.

Deliberately limited: public DNS records, email policy records, HTTPS
availability and redirect behaviour, certificate validity, and selected
response headers on the home page. No port scanning, no crawling, no active
testing of any kind.
"""

from __future__ import annotations

from datetime import datetime, timezone

from ..models import Finding, SnapshotResult
from . import dns_checks, tls_checks, web_checks

CHECK_CATALOG: tuple[tuple[str, str], ...] = (
    ("dns.resolution", "Domain resolution and delegation"),
    ("dns.mx", "Mail routing"),
    ("dns.spf", "SPF policy"),
    ("dns.dmarc", "DMARC policy"),
    ("web.https", "HTTPS availability"),
    ("web.http_redirect", "Plain HTTP handling"),
    ("web.header.*", "Selected response headers"),
    ("web.version_disclosure", "Software version disclosure"),
    ("tls.certificate", "Certificate trust"),
    ("tls.expiry", "Certificate expiry"),
    ("tls.name_match", "Certificate name coverage"),
)


def run_all(domain: str, *, nameservers: list[str] | None = None) -> SnapshotResult:
    result = SnapshotResult(domain=domain)
    for name, runner in (
        ("dns", lambda: dns_checks.run(domain, nameservers=nameservers)),
        ("tls", lambda: tls_checks.run(domain)),
        ("web", lambda: web_checks.run(domain)),
    ):
        try:
            result.findings.extend(runner())
        except Exception as exc:  # one failing group must not lose the others
            result.errors.append(f"{name}: {type(exc).__name__}: {exc}")
            result.findings.append(
                Finding(
                    check_id=f"{name}.error",
                    category="Review",
                    title=f"{name.upper()} checks could not complete",
                    outcome="error",
                    severity_hint="informational",
                    summary=f"These checks did not complete during the review: {type(exc).__name__}.",
                    recommendation=None,
                    evidence={"error": str(exc)},
                    observed_at=datetime.now(timezone.utc),
                )
            )
    return result
