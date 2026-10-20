"""The rules that stop this service being used to reach anything but a public website."""

from __future__ import annotations

import socket

import pytest

from tcescan import safety
from tcescan.safety import TargetRejected, is_public_address, normalize_domain, validate_url

REJECTED_INPUTS = [
    "127.0.0.1",
    "http://127.0.0.1/",
    "https://localhost/",
    "localhost",
    "http://169.254.169.254/latest/meta-data/",
    "https://192.168.1.9:8006/",
    "10.0.0.5",
    "172.16.4.4",
    "http://[::1]/",
    "http://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/",
    "http://2130706433/",          # decimal form of 127.0.0.1
    "http://0x7f000001/",          # hex form of 127.0.0.1
    "http://0177.0.0.1/",          # octal-ish form
    "https://user:pass@example.com/",
    "https://example.com:8006/",
    "https://example.com:22/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "gopher://example.com/",
    "https://dc01.acs-p01.local/",
    "https://pod07-srv.internal/",
    "https://server/",            # no public suffix
    "",
    "   ",
]


@pytest.mark.parametrize("value", REJECTED_INPUTS)
def test_unacceptable_targets_are_rejected(value):
    with pytest.raises(TargetRejected):
        normalize_domain(value)


@pytest.mark.parametrize(
    "value,expected",
    [
        ("tcecure.com", "tcecure.com"),
        ("https://tcecure.com", "tcecure.com"),
        ("http://www.tcecure.com/contact?x=1", "www.tcecure.com"),
        ("  TCecure.COM  ", "tcecure.com"),
        ("tcecure.com.", "tcecure.com"),
        ("https://tcecure.com:443/", "tcecure.com"),
        ("http://tcecure.com:80/", "tcecure.com"),
    ],
)
def test_ordinary_website_input_is_accepted(value, expected):
    assert normalize_domain(value) == expected


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.50.1", "169.254.169.254",
        "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.5",
        "::1", "fe80::1", "fc00::1", "ff02::1", "::ffff:10.0.0.1", "2001:db8::1",
    ],
)
def test_non_public_addresses_are_not_public(ip):
    assert is_public_address(ip) is False


@pytest.mark.parametrize("ip", ["1.1.1.1", "3.23.249.52", "108.31.169.90", "2606:4700:4700::1111"])
def test_public_addresses_are_public(ip):
    assert is_public_address(ip) is True


def test_a_name_that_resolves_to_a_private_address_is_refused(monkeypatch):
    """The classic DNS rebinding target: a public name pointing inside the lab."""

    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.9", port))]

    monkeypatch.setattr(safety.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(TargetRejected, match="non-public"):
        validate_url("https://rebind.example.com/")


def test_a_name_with_mixed_addresses_uses_only_the_public_one(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.9", port)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
        ]

    monkeypatch.setattr(safety.socket, "getaddrinfo", fake_getaddrinfo)
    target = validate_url("https://example.com/")
    assert target.ip == "93.184.216.34"


def test_validation_pins_the_address_it_resolved(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(safety.socket, "getaddrinfo", fake_getaddrinfo)
    target = validate_url("https://example.com/path")
    assert (target.host, target.port, target.ip) == ("example.com", 443, "93.184.216.34")


def test_unresolvable_names_are_rejected(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr(safety.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(TargetRejected, match="does not resolve"):
        validate_url("https://nx.example.com/")
