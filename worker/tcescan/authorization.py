"""Website-control verification.

A requester proves control of the domain in one of two ways, both of which only
require reading something they publish:

  * a DNS TXT record on the domain:   tcecure-site-verification=<secret>
  * a file on the website:            /.well-known/tcecure-site-verification.txt

A TCecure staff member can also record authorization established through sales,
which is handled in the review interface rather than here.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import datetime, timezone

import dns.exception
import dns.resolver

from .http_client import fetch

TXT_PREFIX = "tcecure-site-verification="
WELL_KNOWN_PATH = "/.well-known/tcecure-site-verification.txt"


@dataclass
class AuthorizationCheck:
    verified: bool
    method: str | None
    evidence: dict[str, object]
    checked_at: datetime


def verify(domain: str, secret: str, *, nameservers: list[str] | None = None) -> AuthorizationCheck:
    now = datetime.now(timezone.utc)
    txt_values, txt_error = _txt(domain, nameservers)
    expected = TXT_PREFIX + secret
    for value in txt_values:
        if hmac.compare_digest(value.strip(), expected):
            return AuthorizationCheck(
                True,
                "dns_txt",
                {"record": "TXT", "name": domain, "matched": True, "records_seen": len(txt_values)},
                now,
            )

    url = f"https://{domain}{WELL_KNOWN_PATH}"
    result = fetch(url, max_bytes=4096, max_redirects=2)
    final = result.final
    body = (final.body_sample.strip() if final else "")
    if final is not None and final.status == 200 and hmac.compare_digest(body[:200], secret):
        return AuthorizationCheck(
            True,
            "well_known",
            {"url": final.url, "status": final.status, "matched": True},
            now,
        )

    return AuthorizationCheck(
        False,
        None,
        {
            "dns_txt": {"records_seen": len(txt_values), "error": txt_error},
            "well_known": {
                "url": url,
                "status": final.status if final else None,
                "error": result.error,
                "matched": False,
            },
        },
        now,
    )


def _txt(domain: str, nameservers: list[str] | None) -> tuple[list[str], str | None]:
    resolver = dns.resolver.Resolver(configure=not nameservers)
    if nameservers:
        resolver.nameservers = nameservers
    resolver.timeout = resolver.lifetime = 5.0
    try:
        answer = resolver.resolve(domain, "TXT")
    except dns.exception.DNSException as exc:
        return [], type(exc).__name__
    values: list[str] = []
    for record in answer:
        joined = "".join(part.decode() if isinstance(part, bytes) else str(part) for part in record.strings)
        if joined.startswith(TXT_PREFIX):
            values.append(joined)
    return values, None
