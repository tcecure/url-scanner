"""Public DNS posture checks: resolution, mail routing, SPF and DMARC."""

from __future__ import annotations

from datetime import datetime, timezone

import dns.exception
import dns.resolver

from ..models import Finding

TIMEOUT = 5.0


def _resolver(nameservers: list[str] | None) -> dns.resolver.Resolver:
    resolver = dns.resolver.Resolver(configure=not nameservers)
    if nameservers:
        resolver.nameservers = nameservers
    resolver.timeout = TIMEOUT
    resolver.lifetime = TIMEOUT
    return resolver


def _query(resolver: dns.resolver.Resolver, name: str, rdtype: str) -> tuple[list[str], str | None]:
    try:
        answer = resolver.resolve(name, rdtype)
        return [r.to_text() for r in answer], None
    except dns.resolver.NXDOMAIN:
        return [], "NXDOMAIN"
    except dns.resolver.NoAnswer:
        return [], "no record"
    except dns.resolver.NoNameservers:
        return [], "no nameserver answered"
    except dns.exception.Timeout:
        return [], "timed out"
    except dns.exception.DNSException as exc:  # pragma: no cover - defensive
        return [], type(exc).__name__


def run(domain: str, *, nameservers: list[str] | None = None) -> list[Finding]:
    """Observe the domain's public DNS records. Read-only, a handful of queries."""
    resolver = _resolver(nameservers)
    now = datetime.now(timezone.utc)
    findings: list[Finding] = []

    ns_records, ns_err = _query(resolver, domain, "NS")
    a_records, _ = _query(resolver, domain, "A")
    aaaa_records, _ = _query(resolver, domain, "AAAA")
    findings.append(
        Finding(
            check_id="dns.resolution",
            category="DNS",
            title="Domain resolution and delegation",
            outcome="observed" if (a_records or aaaa_records) else "absent",
            severity_hint="informational",
            summary=(
                f"{domain} resolves to {len(a_records)} IPv4 and {len(aaaa_records)} IPv6 address(es), "
                f"delegated to {len(ns_records)} nameserver(s)."
                if (a_records or aaaa_records)
                else f"{domain} published no address record at the time of the review ({ns_err or 'no answer'})."
            ),
            recommendation=None,
            evidence={
                "nameservers": sorted(ns_records),
                "a": sorted(a_records),
                "aaaa": sorted(aaaa_records),
                "resolver": resolver.nameservers,
            },
            observed_at=now,
        )
    )

    mx_records, mx_err = _query(resolver, domain, "MX")
    findings.append(
        Finding(
            check_id="dns.mx",
            category="Email",
            title="Mail routing",
            outcome="observed" if mx_records else "absent",
            severity_hint="informational",
            summary=(
                f"Mail for {domain} is routed to {len(mx_records)} host(s)."
                if mx_records
                else f"No MX record is published for {domain} ({mx_err or 'no answer'})."
            ),
            recommendation=(
                None
                if mx_records
                else "If the domain is not used for email, publishing a null MX record and a reject-all SPF "
                "policy makes that explicit to receiving systems."
            ),
            evidence={"mx": sorted(mx_records)},
            observed_at=now,
        )
    )

    txt_records, txt_err = _query(resolver, domain, "TXT")
    spf = [r for r in txt_records if r.strip('"').lower().startswith("v=spf1")]
    findings.append(_spf_finding(domain, spf, txt_records, txt_err, now))

    dmarc_records, dmarc_err = _query(resolver, f"_dmarc.{domain}", "TXT")
    dmarc = [r for r in dmarc_records if r.strip('"').lower().startswith("v=dmarc1")]
    findings.append(_dmarc_finding(domain, dmarc, dmarc_err, now))

    return findings


def _spf_finding(domain, spf, txt_records, txt_err, now) -> Finding:
    if not spf:
        return Finding(
            check_id="dns.spf",
            category="Email",
            title="SPF policy",
            outcome="absent",
            severity_hint="attention",
            summary=f"No SPF record was published for {domain} at the time of the review ({txt_err or 'none found'}).",
            recommendation="Publish an SPF record naming the services allowed to send as this domain, ending in "
            "a hard or soft fail, so receiving systems can distinguish your mail from forgeries.",
            evidence={"txt_records": sorted(txt_records)},
            observed_at=now,
        )
    record = spf[0].strip('"')
    qualifier = next((t for t in record.split() if t in ("-all", "~all", "?all", "+all")), None)
    weak = qualifier in ("?all", "+all", None)
    return Finding(
        check_id="dns.spf",
        category="Email",
        title="SPF policy",
        outcome="observed",
        severity_hint="consider" if weak else "informational",
        summary=(
            f"SPF is published and ends in {qualifier}."
            if qualifier
            else "SPF is published but names no default policy for unlisted senders."
        ),
        recommendation=(
            "An SPF record that ends in ?all or +all tells receiving systems to accept mail from any source, "
            "which removes most of the benefit. ~all or -all is the usual choice."
            if weak
            else None
        ),
        evidence={"spf": record, "qualifier": qualifier, "records_found": len(spf)},
        observed_at=now,
    )


def _dmarc_finding(domain, dmarc, dmarc_err, now) -> Finding:
    if not dmarc:
        return Finding(
            check_id="dns.dmarc",
            category="Email",
            title="DMARC policy",
            outcome="absent",
            severity_hint="attention",
            summary=f"No DMARC record was published at _dmarc.{domain} ({dmarc_err or 'none found'}).",
            recommendation="Publish a DMARC record, starting at p=none with an aggregate report address, to see "
            "who is sending as your domain before moving to quarantine or reject.",
            evidence={},
            observed_at=now,
        )
    record = dmarc[0].strip('"')
    tags = dict(
        part.strip().split("=", 1)
        for part in record.split(";")
        if "=" in part
    )
    policy = tags.get("p", "none").strip().lower()
    return Finding(
        check_id="dns.dmarc",
        category="Email",
        title="DMARC policy",
        outcome="observed",
        severity_hint="consider" if policy == "none" else "informational",
        summary=f"DMARC is published with p={policy}"
        + (f" and reports to {tags['rua']}." if tags.get("rua") else " and no aggregate report address."),
        recommendation=(
            "p=none monitors but does not ask receiving systems to act on failures; once your legitimate "
            "senders are aligned, quarantine or reject is what stops look-alike mail."
            if policy == "none"
            else None
        ),
        evidence={"dmarc": record, "tags": tags},
        observed_at=now,
    )
