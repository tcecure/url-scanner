"""HTTPS availability, redirect behaviour and selected response headers.

These checks request the site's home page only. Nothing is crawled, no other
path is requested and no input is submitted to the site.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlsplit

from ..http_client import fetch
from ..models import Finding

# Headers the briefing comments on, with why they matter in business terms.
HEADER_GUIDANCE: dict[str, tuple[str, str]] = {
    "strict-transport-security": (
        "HTTP Strict Transport Security",
        "Tells browsers to only ever use the encrypted version of the site, which closes the gap "
        "between a visitor typing the address and the redirect taking effect.",
    ),
    "content-security-policy": (
        "Content Security Policy",
        "Limits where a page may load scripts from, which is the main defence against injected or "
        "third-party script running on your site.",
    ),
    "x-content-type-options": (
        "X-Content-Type-Options",
        "Stops browsers guessing a file's type, a common route for turning an uploaded file into "
        "executable script.",
    ),
    "x-frame-options": (
        "Framing protection",
        "Prevents the site being embedded invisibly in another page to capture clicks.",
    ),
    "referrer-policy": (
        "Referrer Policy",
        "Controls how much of your URLs is handed to other sites your visitors click through to.",
    ),
    "permissions-policy": (
        "Permissions Policy",
        "Declares which browser capabilities (camera, microphone, geolocation) the site may use.",
    ),
}

DISCLOSING_HEADERS = ("server", "x-powered-by", "x-aspnet-version", "x-generator")


def run(domain: str) -> list[Finding]:
    now = datetime.now(timezone.utc)
    findings: list[Finding] = []

    https = fetch(f"https://{domain}/")
    http = fetch(f"http://{domain}/")

    findings.append(_https_finding(domain, https, now))
    findings.append(_redirect_finding(domain, http, https, now))

    final = https.final or http.final
    if final is None:
        findings.append(
            Finding(
                check_id="web.headers",
                category="Website",
                title="Response headers",
                outcome="not_applicable",
                severity_hint="informational",
                summary="No response was received over either http or https, so response headers could not be reviewed.",
                recommendation=None,
                evidence={"https_error": https.error, "http_error": http.error},
                observed_at=now,
            )
        )
        return findings

    findings.extend(_header_findings(final, now))
    findings.append(_disclosure_finding(final, now))
    return findings


def _https_finding(domain, https, now) -> Finding:
    if https.error or not https.final:
        return Finding(
            check_id="web.https",
            category="Website",
            title="HTTPS availability",
            outcome="absent",
            severity_hint="attention",
            summary=f"The site did not answer over HTTPS at the time of the review ({https.error or 'no response'}).",
            recommendation="Visitors cannot reach an encrypted version of the site, so anything they type can be "
            "read in transit. A certificate from a public authority is free and can be renewed automatically.",
            evidence={"error": https.error, "attempted": f"https://{domain}/"},
            observed_at=now,
        )
    final = https.final
    return Finding(
        check_id="web.https",
        category="Website",
        title="HTTPS availability",
        outcome="observed",
        severity_hint="informational",
        summary=f"The site answered over HTTPS with status {final.status} in {final.elapsed_ms} ms.",
        recommendation=None,
        evidence={
            "chain": [{"url": h.url, "status": h.status, "ip": h.ip} for h in https.hops],
            "final_status": final.status,
            "final_url": final.url,
        },
        observed_at=now,
    )


def _redirect_finding(domain, http, https, now) -> Finding:
    if http.error or not http.hops:
        return Finding(
            check_id="web.http_redirect",
            category="Website",
            title="Plain HTTP handling",
            outcome="observed" if https.final else "error",
            severity_hint="informational",
            summary=f"Plain HTTP did not answer ({http.error or 'no response'})"
            + (", so visitors are only served over HTTPS." if https.final else "."),
            recommendation=None,
            evidence={"error": http.error},
            observed_at=now,
        )
    first = http.hops[0]
    final = http.final
    redirected_to_https = final is not None and urlsplit(final.url).scheme == "https"
    if redirected_to_https:
        return Finding(
            check_id="web.http_redirect",
            category="Website",
            title="Plain HTTP handling",
            outcome="observed",
            severity_hint="informational",
            summary=f"A plain HTTP request was redirected to HTTPS ({first.status} to {final.url}).",
            recommendation=None,
            evidence={"chain": [{"url": h.url, "status": h.status, "location": h.location} for h in http.hops]},
            observed_at=now,
        )
    return Finding(
        check_id="web.http_redirect",
        category="Website",
        title="Plain HTTP handling",
        outcome="observed",
        severity_hint="attention",
        summary=f"Plain HTTP served content directly (status {first.status}) rather than redirecting to HTTPS.",
        recommendation="Redirecting every plain HTTP request to HTTPS means a visitor who types the address "
        "without https is not served an unencrypted copy of the site.",
        evidence={"chain": [{"url": h.url, "status": h.status, "location": h.location} for h in http.hops]},
        observed_at=now,
    )


def _header_findings(final, now) -> list[Finding]:
    findings = []
    for header, (title, why) in HEADER_GUIDANCE.items():
        value = final.headers.get(header)
        if value is not None:
            findings.append(
                Finding(
                    check_id=f"web.header.{header}",
                    category="Website",
                    title=title,
                    outcome="observed",
                    severity_hint="informational",
                    summary=f"{title} was present on the home page response.",
                    recommendation=None,
                    evidence={"header": header, "value": value[:512], "url": final.url},
                    observed_at=now,
                )
            )
        else:
            findings.append(
                Finding(
                    check_id=f"web.header.{header}",
                    category="Website",
                    title=title,
                    outcome="absent",
                    severity_hint="consider",
                    summary=f"{title} was not present on the home page response. This is an absent hardening "
                    "measure rather than a confirmed weakness.",
                    recommendation=why,
                    evidence={"header": header, "url": final.url, "headers_seen": sorted(final.headers)},
                    observed_at=now,
                )
            )
    return findings


def _disclosure_finding(final, now) -> Finding:
    disclosed = {h: final.headers[h] for h in DISCLOSING_HEADERS if h in final.headers}
    detailed = {h: v for h, v in disclosed.items() if any(ch.isdigit() for ch in v)}
    return Finding(
        check_id="web.version_disclosure",
        category="Website",
        title="Software version disclosure",
        outcome="observed" if disclosed else "absent",
        severity_hint="consider" if detailed else "informational",
        summary=(
            f"The response named the software behind the site: {', '.join(f'{h}: {v}' for h, v in disclosed.items())}."
            if disclosed
            else "The response did not name the software or version behind the site."
        ),
        recommendation=(
            "Version numbers in response headers let someone match your site against published advisories "
            "without touching it. Suppressing the version does not fix an out-of-date component, but it "
            "removes the easiest way to find one."
            if detailed
            else None
        ),
        evidence={"headers": disclosed, "url": final.url},
        observed_at=now,
    )
