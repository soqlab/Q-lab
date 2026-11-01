"""Addresses users type in (AI endpoints, webhooks, peers) must not reach the server's own network."""
import socket

import pytest

from app import outbound


def _resolves_to(monkeypatch, address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    monkeypatch.setattr(outbound.socket, "getaddrinfo",
                        lambda host, port, *a, **k: [(family, socket.SOCK_STREAM, 6, "", (address, port))])


@pytest.mark.parametrize("address", ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254",
                                     "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:10.0.0.1"])
def test_internal_addresses_are_refused(monkeypatch, address):
    monkeypatch.delenv("QLAB_ALLOW_PRIVATE_URLS", raising=False)
    _resolves_to(monkeypatch, address)
    with pytest.raises(outbound.UnsafeURL):
        outbound.require_safe_url("https://llm.example.com/v1")
    assert not outbound.is_safe_url("http://hooks.example.com/x")


def test_public_address_is_allowed(monkeypatch):
    monkeypatch.delenv("QLAB_ALLOW_PRIVATE_URLS", raising=False)
    _resolves_to(monkeypatch, "93.184.215.14")
    assert outbound.require_safe_url("https://hooks.example.com/x") == "https://hooks.example.com/x"


@pytest.mark.parametrize("url", ["ftp://example.com", "file:///etc/passwd", "https://user:pw@example.com", "not a url"])
def test_malformed_or_credentialed_urls_are_refused(monkeypatch, url):
    monkeypatch.setenv("QLAB_ALLOW_PRIVATE_URLS", "1")
    assert not outbound.is_safe_url(url)


def test_company_install_may_call_internal_servers(monkeypatch):
    monkeypatch.setenv("QLAB_ALLOW_PRIVATE_URLS", "1")
    _resolves_to(monkeypatch, "10.0.0.5")
    assert outbound.is_safe_url("http://ollama.corp.example:11434/v1")


def test_custom_ai_endpoint_on_internal_address_is_refused(monkeypatch):
    from app import ai_provider

    monkeypatch.delenv("QLAB_ALLOW_PRIVATE_URLS", raising=False)
    _resolves_to(monkeypatch, "169.254.169.254")
    monkeypatch.setattr(ai_provider, "_get_raw_credential",
                        lambda db, uid, p: "http://metadata.internal/v1|||key" if p == "custom" else None)
    monkeypatch.setattr("app.store.store_get", lambda *a, **k: {"provider": "custom"})
    with pytest.raises(ai_provider.NoAIProviderError) as err:
        ai_provider.resolve_ai_provider(None, 1)
    assert "private or internal" in str(err.value)
