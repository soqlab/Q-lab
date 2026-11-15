"""The only way "Reproduce a paper" reaches the internet.

Q-Lab never fetches an address the user typed. It reads an arXiv id out of what was pasted and
builds its own addresses from it; a GitHub repository is only fetched when the paper's arXiv
abstract or comments link it. Every request, and every redirect it follows, must:

* use https on the default port, with no credentials in the address;
* go to one of ALLOWED_HOSTS (arXiv and GitHub, nothing else);
* resolve only to public addresses (app/outbound.py, the same check as webhooks and AI endpoints);
* stay under a byte limit (the declared length is checked first, then every byte read, after any
  transfer decompression) and an overall time limit.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urljoin, urlparse

from ..outbound import UnsafeURL, require_safe_url

ALLOWED_HOSTS = frozenset({"export.arxiv.org", "arxiv.org", "github.com", "codeload.github.com",
                           "raw.githubusercontent.com"})
USER_AGENT = "Q-Lab paper reproducer (+https://qlab.soqlab.com/papers)"
MAX_REDIRECTS = 4
CHUNK = 64 * 1024
_transport = None  # tests put an httpx.MockTransport here


class FetchError(Exception):
    """A fetch that failed, with an HTTP-like status and a sentence for the user."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Fetched:
    url: str
    content_type: str
    body: bytes
    filename: Optional[str] = None


def check_url(url: str) -> str:
    """url unchanged if it may be fetched, else FetchError(400)."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.port not in (None, 443):
        raise FetchError(400, f"Refused {host or 'an address'}: only https on the usual port is fetched.")
    if parsed.username or parsed.password:
        raise FetchError(400, "Refused an address with credentials in it.")
    if host not in ALLOWED_HOSTS:
        raise FetchError(400, f"Refused {host or 'an address'}: Q-Lab only fetches papers from arXiv and GitHub.")
    try:
        require_safe_url(url)
    except UnsafeURL as exc:
        raise FetchError(400, str(exc)) from None
    return url


def _filename(disposition: Optional[str]) -> Optional[str]:
    if not disposition or "filename=" not in disposition:
        return None
    name = disposition.split("filename=", 1)[1].strip().strip('"').strip("'")
    return name[:200] or None


def get(url: str, max_bytes: int, timeout_s: float = 25.0) -> Fetched:
    """GET url (following up to MAX_REDIRECTS redirects, each checked) within max_bytes and timeout_s."""
    import httpx

    deadline = time.monotonic() + timeout_s
    timeout = httpx.Timeout(connect=8.0, read=min(30.0, timeout_s), write=8.0, pool=8.0)
    with httpx.Client(follow_redirects=False, timeout=timeout, headers={"User-Agent": USER_AGENT},
                      transport=_transport) as client:
        for _ in range(MAX_REDIRECTS + 1):
            check_url(url)
            try:
                with client.stream("GET", url) as r:
                    if r.status_code in (301, 302, 303, 307, 308):
                        loc = r.headers.get("location")
                        if not loc:
                            raise FetchError(502, f"{urlparse(url).hostname} redirected without saying where.")
                        url = urljoin(url, loc)
                        continue
                    if r.status_code == 404:
                        raise FetchError(404, f"{urlparse(url).hostname} has nothing at that address.")
                    if r.status_code == 429 or r.status_code == 503:
                        raise FetchError(503, f"{urlparse(url).hostname} asked Q-Lab to slow down; try again in a few minutes.")
                    if r.status_code != 200:
                        raise FetchError(502, f"{urlparse(url).hostname} answered {r.status_code}.")
                    declared = r.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > max_bytes:
                        raise FetchError(413, f"The file at {urlparse(url).hostname} is {int(declared) // 1_000_000} MB; "
                                              f"Q-Lab reads up to {max_bytes // 1_000_000} MB.")
                    buf = bytearray()
                    for chunk in r.iter_bytes(CHUNK):
                        buf += chunk
                        if len(buf) > max_bytes:
                            raise FetchError(413, f"The file at {urlparse(url).hostname} is over "
                                                  f"{max_bytes // 1_000_000} MB; Q-Lab reads up to that.")
                        if time.monotonic() > deadline:
                            raise FetchError(504, f"{urlparse(url).hostname} took too long to send the file.")
                    return Fetched(url=url, content_type=(r.headers.get("content-type") or "").split(";")[0].strip().lower(),
                                   body=bytes(buf), filename=_filename(r.headers.get("content-disposition")))
            except httpx.TimeoutException:
                raise FetchError(504, f"{urlparse(url).hostname} took too long to answer.") from None
            except httpx.HTTPError as exc:
                raise FetchError(502, f"{urlparse(url).hostname} couldn't be reached ({type(exc).__name__}).") from None
        raise FetchError(502, "Too many redirects.")
