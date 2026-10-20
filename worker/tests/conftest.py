"""Local fixtures.

Tests never touch a real third-party site: the HTTP-facing tests run against a
loopback fixture server and the pinning layer is stubbed for them, while the
pinning layer itself is tested directly in test_safety.py.
"""

from __future__ import annotations

import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FixtureSite:
    """A tiny HTTP server standing in for a customer website."""

    def __init__(self, routes: dict[str, tuple[int, dict[str, str], bytes]]):
        self.routes = routes
        site = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args):
                pass

            def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler API
                status, headers, body = site.routes.get(self.path, (404, {}, b"not found"))
                # send_response_only, so the fixture controls every header: the
                # stock handler would add its own Server header and skew the
                # version-disclosure observations under test.
                self.send_response_only(status)
                self.send_header("Date", self.date_time_string())
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_exc):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def fixture_site():
    return FixtureSite


@pytest.fixture
def allow_loopback(monkeypatch):
    """Let the client reach the loopback fixture server.

    Only the public-address rule is relaxed, and only for these tests; the
    resolution, pinning and redirect-revalidation path is still exercised.
    """
    from tcescan import safety

    monkeypatch.setattr(safety, "is_public_address", lambda ip: True)
    monkeypatch.setattr(safety, "ALLOWED_PORTS", tuple(range(1, 65536)))
    monkeypatch.setattr(
        safety,
        "_is_ip_literal",
        lambda host: False,
    )
    original = safety.resolve_public_addresses

    def resolve(host, port):
        if host in ("localhost", "127.0.0.1"):
            return [(socket.AF_INET, "127.0.0.1")]
        return original(host, port)

    monkeypatch.setattr(safety, "resolve_public_addresses", resolve)
    yield
