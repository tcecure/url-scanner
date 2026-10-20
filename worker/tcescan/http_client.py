"""Bounded, address-pinned HTTP client used by the snapshot checks."""

from __future__ import annotations

import socket
import ssl
import time
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx

from .safety import TargetRejected, ValidatedTarget, validate_url

DEFAULT_TIMEOUT = 8.0
MAX_RESPONSE_BYTES = 512 * 1024
MAX_REDIRECTS = 5
USER_AGENT = "TCecure-ExposureSnapshot/1.0 (+https://scan.tcecure.com/about-this-review)"


@dataclass
class Hop:
    url: str
    ip: str
    status: int
    location: str | None
    headers: dict[str, str]
    elapsed_ms: int = 0
    truncated: bool = False
    body_sample: str = ""


@dataclass
class FetchResult:
    hops: list[Hop] = field(default_factory=list)
    error: str | None = None

    @property
    def final(self) -> Hop | None:
        return self.hops[-1] if self.hops else None


def fetch(
    url: str,
    *,
    method: str = "GET",
    timeout: float = DEFAULT_TIMEOUT,
    max_redirects: int = MAX_REDIRECTS,
    max_bytes: int = MAX_RESPONSE_BYTES,
    allow_http: bool = True,
) -> FetchResult:
    """Fetch a URL, revalidating and pinning the address at every hop.

    Redirects are never delegated to the HTTP library: each Location is
    resolved, revalidated against the SSRF rules and pinned itself, so a
    redirect to an internal address is refused rather than followed.
    """
    result = FetchResult()
    current = url
    for _ in range(max_redirects + 1):
        try:
            target = validate_url(current, allow_http=allow_http)
        except TargetRejected as exc:
            result.error = str(exc)
            return result
        started = time.monotonic()
        try:
            hop = _single_request(target, method=method, timeout=timeout, max_bytes=max_bytes)
        except (httpx.HTTPError, ssl.SSLError, OSError) as exc:
            result.error = f"{type(exc).__name__}: {exc}"
            return result
        hop.elapsed_ms = int((time.monotonic() - started) * 1000)
        result.hops.append(hop)
        if hop.status in (301, 302, 303, 307, 308) and hop.location:
            current = urljoin(current, hop.location)
            if urlsplit(current).scheme not in ("http", "https"):
                result.error = "Redirect target is not an http(s) address."
                return result
            continue
        return result
    result.error = f"More than {max_redirects} redirects."
    return result


def _single_request(target: ValidatedTarget, *, method: str, timeout: float, max_bytes: int) -> Hop:
    """One request to the pinned address, presenting the real hostname.

    The connection is made to the IP that was validated, while Host and SNI
    carry the hostname, so certificate verification still applies to the name
    the requester gave us.
    """
    netloc = f"[{target.ip}]" if target.family == socket.AF_INET6 else target.ip
    pinned_url = f"{target.scheme}://{netloc}:{target.port}{_path_of(target.url)}"
    headers = {
        "Host": target.host,
        "User-Agent": USER_AGENT,
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }
    with httpx.Client(
        timeout=httpx.Timeout(timeout, connect=timeout),
        follow_redirects=False,
        trust_env=False,
        verify=ssl.create_default_context(),
    ) as client:
        with client.stream(
            method,
            pinned_url,
            headers=headers,
            extensions={"sni_hostname": target.host},
        ) as response:
            body = b""
            truncated = False
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) >= max_bytes:
                    truncated = True
                    break
            return Hop(
                url=target.url,
                ip=target.ip,
                status=response.status_code,
                location=response.headers.get("location"),
                headers={k.lower(): v for k, v in response.headers.items()},
                truncated=truncated,
                body_sample=body[:2048].decode("utf-8", "replace"),
            )


def _path_of(url: str) -> str:
    parts = urlsplit(url)
    path = parts.path or "/"
    return path + (f"?{parts.query}" if parts.query else "")
