"""Target validation and SSRF defence for the External Exposure Snapshot worker.

Every outbound HTTP request is made against an address that has already been
resolved and validated here, and the socket is pinned to that address, so a
hostname cannot resolve to a public address for the check and a private one for
the connection. Redirects are revalidated the same way.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

ALLOWED_SCHEMES = ("http", "https")
ALLOWED_PORTS = (80, 443)

# A hostname label that is really a number: decimal, hexadecimal or octal.
_NUMERIC_LABEL = re.compile(r"(0[xX][0-9a-fA-F]+|[0-9]+)")

# Everything that must never be a snapshot target. Loopback, link-local,
# RFC1918, CGNAT, multicast, reserved and the IPv6 equivalents including
# IPv4-mapped and 6to4/Teredo ranges that can smuggle a private IPv4 address.
BLOCKED_V4 = [
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.88.99.0/24",
        "192.168.0.0/16",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "255.255.255.255/32",
    )
]

BLOCKED_V6 = [
    ipaddress.ip_network(n)
    for n in (
        "::/128",
        "::1/128",
        "::ffff:0:0/96",
        "64:ff9b::/96",
        "100::/64",
        "2001::/32",
        "2001:db8::/32",
        "2002::/16",
        "fc00::/7",
        "fe80::/10",
        "ff00::/8",
    )
]


class TargetRejected(ValueError):
    """The requested target is not an acceptable snapshot target."""


@dataclass(frozen=True)
class ValidatedTarget:
    """A URL whose host has been resolved to a specific public address."""

    url: str
    scheme: str
    host: str
    port: int
    ip: str
    family: int

    @property
    def sni_host(self) -> str:
        return self.host


def normalize_domain(value: str) -> str:
    """Reduce user input to a bare registrable hostname, or reject it."""
    candidate = (value or "").strip()
    if not candidate:
        raise TargetRejected("No website was provided.")
    if "://" not in candidate:
        candidate = "https://" + candidate
    parts = urlsplit(candidate)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise TargetRejected("Only http and https websites can be reviewed.")
    if parts.username or parts.password or "@" in (parts.netloc.split("]")[-1]):
        raise TargetRejected("Credentials in the address are not accepted.")
    host = parts.hostname
    if not host:
        raise TargetRejected("That address has no hostname.")
    if parts.port is not None and parts.port not in ALLOWED_PORTS:
        raise TargetRejected("Only the standard web ports 80 and 443 are reviewed.")
    host = host.strip(".").lower()
    if _is_ip_literal(host):
        raise TargetRejected("An IP address is not an acceptable target; use a domain name.")
    if "." not in host:
        raise TargetRejected("That is not a public domain name.")
    if host.endswith((".local", ".internal", ".localdomain", ".lan", ".home.arpa")):
        raise TargetRejected("Internal domain names are not acceptable targets.")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:  # pragma: no cover - idna edge cases
        raise TargetRejected("That domain name cannot be interpreted.") from exc
    if len(host) > 253 or any(len(label) > 63 or not label for label in host.split(".")):
        raise TargetRejected("That domain name is not valid.")
    return host


def _is_ip_literal(host: str) -> bool:
    """True for anything that addresses a host numerically rather than by name.

    Covers the alternate IPv4 spellings that bypass a naive dotted-quad test:
    a bare integer (2130706433), hex (0x7f000001), dotted octal (0177.0.0.1)
    and short forms (127.1), as well as IPv6 literals.
    """
    bare = host.strip("[]")
    try:
        ipaddress.ip_address(bare)
        return True
    except ValueError:
        pass
    labels = bare.split(".")
    if all(_NUMERIC_LABEL.fullmatch(label) for label in labels if label):
        return True
    return False


def is_public_address(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if addr.version == 4:
        if any(addr in net for net in BLOCKED_V4):
            return False
    else:
        if any(addr in net for net in BLOCKED_V6):
            return False
        mapped = getattr(addr, "ipv4_mapped", None)
        if mapped is not None and not is_public_address(str(mapped)):
            return False
    return addr.is_global and not (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_reserved)


def resolve_public_addresses(host: str, port: int) -> list[tuple[int, str]]:
    """Resolve a host to the public addresses it may legitimately be reached on."""
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise TargetRejected(f"{host} does not resolve.") from exc
    seen: list[tuple[int, str]] = []
    rejected: list[str] = []
    for family, _type, _proto, _canon, sockaddr in infos:
        ip = sockaddr[0]
        if not is_public_address(ip):
            rejected.append(ip)
            continue
        if (family, ip) not in seen:
            seen.append((family, ip))
    if not seen:
        detail = ", ".join(sorted(set(rejected))) or "no addresses"
        raise TargetRejected(f"{host} resolves only to non-public addresses ({detail}).")
    return seen


def validate_url(url: str, *, allow_http: bool = True) -> ValidatedTarget:
    """Validate a URL and pin it to one resolved public address."""
    parts = urlsplit(url)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise TargetRejected(f"Scheme {parts.scheme or 'none'} is not followed.")
    if parts.scheme == "http" and not allow_http:
        raise TargetRejected("Plain http is not followed for this check.")
    if parts.username or parts.password:
        raise TargetRejected("Credentials in the address are not accepted.")
    host = parts.hostname
    if not host:
        raise TargetRejected("That address has no hostname.")
    if _is_ip_literal(host):
        raise TargetRejected("Addresses that point straight at an IP are not followed.")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if port not in ALLOWED_PORTS:
        raise TargetRejected(f"Port {port} is not reviewed.")
    family, ip = resolve_public_addresses(host.lower(), port)[0]
    return ValidatedTarget(url=url, scheme=parts.scheme, host=host.lower(), port=port, ip=ip, family=family)
