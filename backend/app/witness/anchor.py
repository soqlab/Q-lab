"""RFC 3161 anchors: an outside authority's timestamp over a chain head (SPEC section 10).

Requesting a token and checking its message imprint need nothing beyond the standard library.
Checking the authority's signature needs the optional extra: pip install rfc3161-client
"""

from __future__ import annotations

import hashlib
import urllib.request
from dataclasses import dataclass
from secrets import randbits
from typing import Any

from .receipt import b64url_decode, b64url_encode

_SHA256_OID = bytes.fromhex("0609608648016503040201")
_CONTENT_TYPE = "application/timestamp-query"
_MAX_RESPONSE_BYTES = 64 * 1024
_TIMEOUT_SECONDS = 30


class AnchorError(ValueError):
    """A timestamp token or authority response is unusable."""


@dataclass(frozen=True)
class TokenInfo:
    hash_oid: bytes
    imprint: bytes
    gen_time: str


def imprint_for(head_digest: str) -> bytes:
    """What the authority timestamps: SHA-256 over the ASCII text of the head's receipt digest."""
    return hashlib.sha256(head_digest.encode("ascii")).digest()


def _read(der: bytes, pos: int) -> tuple[int, bytes, int]:
    """One DER element at pos: its tag, its contents, and the position after it."""
    if pos + 2 > len(der):
        raise AnchorError("truncated DER")
    tag, first = der[pos], der[pos + 1]
    pos += 2
    if first < 0x80:
        length = first
    else:
        count = first & 0x7F
        if count == 0 or count > 4 or pos + count > len(der):
            raise AnchorError("unsupported DER length")
        length = int.from_bytes(der[pos : pos + count], "big")
        pos += count
    if pos + length > len(der):
        raise AnchorError("truncated DER")
    return tag, der[pos : pos + length], pos + length


def _children(der: bytes) -> list[tuple[int, bytes, bytes]]:
    """Each child element as (tag, contents, whole element)."""
    out: list[tuple[int, bytes, bytes]] = []
    pos = 0
    while pos < len(der):
        tag, content, end = _read(der, pos)
        out.append((tag, content, der[pos:end]))
        pos = end
    return out


def _generalized_time(raw: bytes) -> str:
    text = raw.decode("ascii", "replace")
    if len(text) < 15 or not text[:14].isdigit() or not text.endswith("Z"):
        raise AnchorError("unsupported genTime")
    return f"{text[:4]}-{text[4:6]}-{text[6:8]}T{text[8:10]}:{text[10:12]}:{text[12:14]}Z"


def parse_token(token: bytes) -> TokenInfo:
    """Read the message imprint and time from a TimeStampToken. Does not check its signature."""
    try:
        tag, content_info, _ = _read(token, 0)
        if tag != 0x30:
            raise AnchorError("not a TimeStampToken")
        children = _children(content_info)
        signed_data = _children(children[1][1])[0][1]
        encap = _children(signed_data)[2][1]
        e_content = _children(_children(encap)[1][1])[0][1]
        tst_info = _children(_children(e_content)[0][1])
        imprint = _children(tst_info[2][1])
        hash_oid = _children(imprint[0][1])[0][2]
        return TokenInfo(hash_oid, imprint[1][1], _generalized_time(tst_info[4][1]))
    except (IndexError, TypeError) as exc:
        raise AnchorError("not a TimeStampToken") from exc


def check_imprint(subject: dict[str, Any]) -> tuple[bool, str, str | None]:
    """Whether an anchor's token covers its head: (ok, reason, the authority's time)."""
    try:
        info = parse_token(b64url_decode(subject["token"]))
    except (AnchorError, ValueError) as exc:
        return False, f"unreadable token: {exc}", None
    if info.hash_oid != _SHA256_OID:
        return False, "token imprint is not SHA-256", info.gen_time
    if info.imprint != imprint_for(subject["head"]["digest"]):
        return False, "token does not cover this head", info.gen_time
    return True, "", info.gen_time


def _der(tag: int, content: bytes) -> bytes:
    length = len(content)
    if length < 0x80:
        return bytes([tag, length]) + content
    raw = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([tag, 0x80 | len(raw)]) + raw + content


def build_request(head_digest: str) -> bytes:
    """A TimeStampReq (RFC 3161 section 2.4.1) asking for the authority's certificate too."""
    algorithm = _der(0x30, _SHA256_OID + _der(0x05, b""))
    message_imprint = _der(0x30, algorithm + _der(0x04, imprint_for(head_digest)))
    nonce = randbits(63) | 1 << 62
    nonce_der = _der(0x02, nonce.to_bytes(8, "big"))
    return _der(0x30, _der(0x02, b"\x01") + message_imprint + nonce_der + _der(0x01, b"\xff"))


def token_from_response(response: bytes) -> bytes:
    """The TimeStampToken inside a TimeStampResp, after checking the authority granted it."""
    try:
        tag, content, _ = _read(response, 0)
        children = _children(content)
        status = _children(children[0][1])[0][1]
    except (AnchorError, IndexError) as exc:
        raise AnchorError("not a timestamp response") from exc
    if tag != 0x30 or int.from_bytes(status, "big") not in (0, 1):
        raise AnchorError(f"the authority refused the request (status {status.hex()})")
    if len(children) < 2:
        raise AnchorError("the authority returned no token")
    return children[1][2]


def request_token(head_digest: str, authority_url: str, *, timeout: int = _TIMEOUT_SECONDS) -> str:
    """Ask an authority to timestamp a head. Returns the token as base64url.

    Sends only a hash of the head's digest, which reveals nothing about any receipt.
    """
    if not authority_url.startswith(("https://", "http://")):
        raise AnchorError("the authority URL must be http or https")
    request = urllib.request.Request(  # noqa: S310 (scheme checked above)
        authority_url,
        data=build_request(head_digest),
        headers={"Content-Type": _CONTENT_TYPE},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        body = response.read(_MAX_RESPONSE_BYTES + 1)
    if len(body) > _MAX_RESPONSE_BYTES:
        raise AnchorError("the authority's response is too large")
    token = token_from_response(body)
    encoded = b64url_encode(token)
    ok, reason, _ = check_imprint({"token": encoded, "head": {"digest": head_digest}})
    if not ok:
        raise AnchorError(reason)
    return encoded


def anchor_subject(head: dict[str, Any], digest: str, authority: str, token: str) -> dict[str, Any]:
    return {
        "head": {"seq": int(head["chain"]["seq"]), "digest": digest},
        "method": "rfc3161",
        "authority": authority,
        "token": token,
    }


def verify_token_signature(subject: dict[str, Any], tsa_cert_pem: bytes) -> tuple[bool, str]:
    """Check the authority's signature against a certificate you trust. Needs the anchor extra."""
    try:
        from cryptography import x509
        from rfc3161_client import decode_timestamp_response
        from rfc3161_client.verify import VerifierBuilder
    except ImportError as exc:
        raise AnchorError("checking a timestamp token needs: pip install rfc3161-client") from exc

    token = b64url_decode(subject["token"])
    response = _der(0x30, _der(0x30, _der(0x02, b"\x00")) + token)
    certificates = x509.load_pem_x509_certificates(tsa_cert_pem)
    builder = VerifierBuilder()
    for certificate in certificates:
        builder = builder.add_root_certificate(certificate)
    try:
        builder.build().verify_message(
            decode_timestamp_response(response), subject["head"]["digest"].encode("ascii")
        )
    except Exception as exc:  # noqa: BLE001 (the library raises several types for a bad token)
        return False, str(exc)
    return True, ""
