"""Addresses that users type in (AI endpoints, alert and notification webhooks, network peers).

Before Q-Lab calls one, it must resolve only to public internet addresses. Otherwise anyone with an
account on a hosted Q-Lab could make the server call its own internal network, cloud metadata
endpoints or localhost services on their behalf (server-side request forgery).

A Q-Lab installed inside a company network (deploy/internal) needs the opposite: its AI model,
mail and chat servers live on internal addresses. QLAB_ALLOW_PRIVATE_URLS=1 turns the check off
for such an install. It must stay off on any instance shared with people you don't trust.
"""
import ipaddress
import os
import socket
from urllib.parse import urlparse


class UnsafeURL(ValueError):
    pass


def private_urls_allowed() -> bool:
    return os.getenv("QLAB_ALLOW_PRIVATE_URLS", "").strip().lower() in ("1", "true", "yes", "on")


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def require_safe_url(url: str) -> str:
    """Return url unchanged if Q-Lab may call it, else raise UnsafeURL with a readable reason."""
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UnsafeURL("Use an http:// or https:// address.")
    if parsed.username or parsed.password:
        raise UnsafeURL("Put credentials in the key field, not in the address.")
    if private_urls_allowed():
        return url
    try:
        answers = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except (socket.gaierror, UnicodeError):
        raise UnsafeURL(f"{parsed.hostname} could not be resolved.") from None
    if not answers or not all(_is_public(sockaddr[0]) for *_, sockaddr in answers):
        raise UnsafeURL(f"{parsed.hostname} points to a private or internal address, which this server won't call.")
    return url


def is_safe_url(url: str) -> bool:
    try:
        require_safe_url(url)
        return True
    except UnsafeURL:
        return False
