"""Certificate validity, expiry and name coverage.

One TLS handshake to the site's own HTTPS port. No cipher enumeration, no
protocol downgrade attempts, no other port.
"""

from __future__ import annotations

import socket
import ssl
from datetime import datetime, timezone

from ..models import Finding
from ..safety import TargetRejected, resolve_public_addresses

HANDSHAKE_TIMEOUT = 8.0
EXPIRY_WARN_DAYS = 30


def run(domain: str) -> list[Finding]:
    now = datetime.now(timezone.utc)
    try:
        family, ip = resolve_public_addresses(domain, 443)[0]
    except TargetRejected as exc:
        return [
            Finding(
                check_id="tls.certificate",
                category="Encryption",
                title="Certificate",
                outcome="error",
                severity_hint="informational",
                summary=f"The certificate could not be reviewed: {exc}",
                recommendation=None,
                evidence={"error": str(exc)},
                observed_at=now,
            )
        ]

    verified, verify_error, cert, peer = _handshake(domain, ip, family, verify=True)
    if not verified:
        # Re-handshake without verification purely to describe the certificate
        # that is being served; the trust failure above is the finding.
        _ok, _err, cert, peer = _handshake(domain, ip, family, verify=False)

    if cert is None:
        return [
            Finding(
                check_id="tls.certificate",
                category="Encryption",
                title="Certificate",
                outcome="absent",
                severity_hint="attention",
                summary=f"No TLS certificate could be retrieved from {domain} on port 443 "
                f"({verify_error or 'no handshake'}).",
                recommendation="Without a working certificate, browsers cannot establish an encrypted session "
                "and will warn visitors before they reach the site.",
                evidence={"ip": ip, "error": verify_error},
                observed_at=now,
            )
        ]

    not_after = _parse_time(cert.get("notAfter"))
    not_before = _parse_time(cert.get("notBefore"))
    names = _names(cert)
    issuer = _issuer(cert)
    days_left = int((not_after - now).total_seconds() // 86400) if not_after else None

    findings = [
        Finding(
            check_id="tls.certificate",
            category="Encryption",
            title="Certificate trust",
            outcome="observed" if verified else "absent",
            severity_hint="informational" if verified else "attention",
            summary=(
                f"The certificate served for {domain} is trusted by the public certificate authorities "
                f"and was issued by {issuer}."
                if verified
                else f"The certificate served for {domain} was not accepted as trusted ({verify_error})."
            ),
            recommendation=(
                None
                if verified
                else "Browsers will interrupt visitors with a warning before the site loads. A certificate from "
                "a public authority that matches the hostname resolves this."
            ),
            evidence={
                "ip": ip,
                "issuer": issuer,
                "subject_names": names,
                "not_before": not_before.isoformat() if not_before else None,
                "not_after": not_after.isoformat() if not_after else None,
                "tls_version": peer.get("version") if peer else None,
                "cipher": peer.get("cipher") if peer else None,
                "verify_error": verify_error,
            },
            observed_at=now,
        )
    ]

    if not_after is not None:
        if days_left is not None and days_left < 0:
            outcome, hint = "absent", "attention"
            summary = f"The certificate expired {abs(days_left)} day(s) ago, on {not_after.date().isoformat()}."
            recommendation = "An expired certificate makes every browser warn visitors away. Automated renewal "
            "prevents a repeat."
        elif days_left is not None and days_left <= EXPIRY_WARN_DAYS:
            outcome, hint = "observed", "consider"
            summary = f"The certificate expires in {days_left} day(s), on {not_after.date().isoformat()}."
            recommendation = (
                "Renewal within the next month is needed; automated renewal avoids the deadline entirely."
            )
        else:
            outcome, hint = "observed", "informational"
            summary = f"The certificate is valid until {not_after.date().isoformat()} ({days_left} days)."
            recommendation = None
        findings.append(
            Finding(
                check_id="tls.expiry",
                category="Encryption",
                title="Certificate expiry",
                outcome=outcome,
                severity_hint=hint,
                summary=summary,
                recommendation=recommendation,
                evidence={"not_after": not_after.isoformat(), "days_remaining": days_left},
                observed_at=now,
            )
        )

    if names:
        covered = _covers(domain, names)
        findings.append(
            Finding(
                check_id="tls.name_match",
                category="Encryption",
                title="Certificate name coverage",
                outcome="observed" if covered else "absent",
                severity_hint="informational" if covered else "attention",
                summary=(
                    f"The certificate covers {domain}."
                    if covered
                    else f"The certificate does not list {domain} among the names it covers."
                ),
                recommendation=(
                    None
                    if covered
                    else "A certificate that does not name the address visitors use produces a browser warning "
                    "even though encryption is configured."
                ),
                evidence={"names": names, "requested": domain},
                observed_at=now,
            )
        )
    return findings


def _handshake(domain: str, ip: str, family: int, *, verify: bool):
    ctx = ssl.create_default_context()
    if not verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.settimeout(HANDSHAKE_TIMEOUT)
    try:
        sock.connect((ip, 443))
        with ctx.wrap_socket(sock, server_hostname=domain) as tls:
            cert = tls.getpeercert() if verify else _peercert_unverified(tls)
            peer = {"version": tls.version(), "cipher": (tls.cipher() or [None])[0]}
            return True, None, cert, peer
    except ssl.SSLCertVerificationError as exc:
        return False, exc.verify_message or str(exc), None, None
    except (ssl.SSLError, OSError) as exc:
        return False, f"{type(exc).__name__}: {exc}", None, None
    finally:
        try:
            sock.close()
        except OSError:
            pass


def _peercert_unverified(tls) -> dict:
    """Describe an untrusted certificate without asking Python to validate it."""
    der = tls.getpeercert(binary_form=True)
    if not der:
        return {}
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes  # noqa: F401

        cert = x509.load_der_x509_certificate(der)
        san: list[str] = []
        try:
            ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
            san = [f"DNS:{n}" for n in ext.value.get_values_for_type(x509.DNSName)]
        except x509.ExtensionNotFound:
            pass
        return {
            "notBefore": cert.not_valid_before_utc.strftime("%b %d %H:%M:%S %Y GMT"),
            "notAfter": cert.not_valid_after_utc.strftime("%b %d %H:%M:%S %Y GMT"),
            "issuer": tuple(((a.oid._name, a.value),) for a in cert.issuer),
            "subjectAltName": tuple(tuple(n.split(":", 1)) for n in san),
        }
    except Exception:  # pragma: no cover - parsing fallback
        return {}


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%b %d %H:%M:%S %Y %Z", "%b %d %H:%M:%S %Y GMT"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _names(cert: dict) -> list[str]:
    names = [v for k, v in cert.get("subjectAltName", ()) if k.lower() == "dns"]
    for rdn in cert.get("subject", ()):
        for key, value in rdn:
            if key == "commonName" and value not in names:
                names.append(value)
    return names


def _issuer(cert: dict) -> str:
    parts = {k: v for rdn in cert.get("issuer", ()) for k, v in rdn}
    return parts.get("organizationName") or parts.get("commonName") or "an unnamed issuer"


def _covers(domain: str, names: list[str]) -> bool:
    for name in names:
        name = name.lower().strip(".")
        if name == domain:
            return True
        if name.startswith("*.") and domain.endswith(name[1:]) and domain.count(".") == name.count("."):
            return True
    return False
