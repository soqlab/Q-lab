"""Check a Q-Lab provenance certificate: its canonical body, its hash, and both signatures.

Standalone on purpose: it imports nothing from Q-Lab, only the standard library and
``cryptography`` (46 or newer, for ML-DSA), so anyone can run it on a certificate they were given:

    pip install "cryptography>=46"
    python verify_certificate.py --file certificate.json              # a certificate you saved
    python verify_certificate.py --token <share token>                # a shared run's, from the hosted Q-Lab
    python verify_certificate.py --file c.json --key qrk-0123...      # and insist on a key id you trust
    python verify_certificate.py --file c.json --qasm circuit.qasm    # and check a circuit file against it

A certificate is ``{"format", "certificate", "body_sha256", "signature"}``. ``certificate`` (the
body) is what is certified; it is signed twice over the same bytes, and is valid only when both
signatures verify:

  * Ed25519 (RFC 8032);
  * ML-DSA-65 (FIPS 204), with the context string ``qlab-provenance-certificate/1``.

The body is hashed as canonical JSON: object keys sorted, no whitespace, strings escaped as
JSON.stringify does (non-ASCII left as UTF-8), and only integers, strings, booleans and null as
values (a decimal is written as a string, so no implementation has to agree on float formatting).
``body_sha256`` is the SHA-256 of those UTF-8 bytes. The signed bytes are plain text::

    qlab-provenance-certificate/1
    key qrk-0123456789abcdef0123456789abcdef
    signed-at 2026-11-14T06:20:00Z
    body-sha256 <64 hex digits>

(each line ending in a newline). The key id is derived from both public keys: ``qrk-`` + the first
32 hex digits of sha256(b"qlab-rewind-key/1\\n" + ml_dsa_65_public + ed25519_public); it is the
same key format as Rewind's manifests, and the context string keeps the two kinds of document apart.

The certificate carries its public key, so a signature alone proves only that the body was not
changed after whoever holds that key signed it. Pin the key id (``--key``) to be sure it is the
server you trust; the hosted key id is published at /api/v1/certificates/public-key.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from typing import Any

CERT_FORMAT = "qlab-provenance-certificate/1"
CONTEXT = CERT_FORMAT.encode("ascii")
ED25519_PUBLIC_BYTES = 32
ML_DSA_65_PUBLIC_BYTES = 1952
DEFAULT_API = "https://qlab.soqlab.com/qlab-api"
MAX_INT = 2 ** 53 - 1

_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_KEY_ID = re.compile(r"^qrk-[0-9a-f]{32}$")
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class CertificateError(ValueError):
    """The certificate is not well formed; the message says what is wrong."""


def key_id(ml_dsa_public: bytes, ed25519_public: bytes) -> str:
    digest = hashlib.sha256(b"qlab-rewind-key/1\n" + bytes(ml_dsa_public) + bytes(ed25519_public)).hexdigest()
    return "qrk-" + digest[:32]


def _check(value: Any, path: str) -> None:
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        if abs(value) > MAX_INT:
            raise CertificateError(f"{path}: integer outside the exactly representable range.")
        return
    if isinstance(value, float):
        raise CertificateError(f"{path}: decimals must be written as strings in a certificate.")
    if isinstance(value, str):
        if any(0xD800 <= ord(c) <= 0xDFFF for c in value):
            raise CertificateError(f"{path}: string holds a lone surrogate.")
        return
    if isinstance(value, list):
        for i, v in enumerate(value):
            _check(v, f"{path}[{i}]")
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str) or not k.isascii():
                raise CertificateError(f"{path}: object keys must be ASCII strings.")
            _check(v, f"{path}.{k}")
        return
    raise CertificateError(f"{path}: {type(value).__name__} is not allowed in a certificate.")


def canonical_bytes(body: Any) -> bytes:
    """The bytes body_sha256 is computed over."""
    _check(body, "certificate")
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def body_sha256(body: Any) -> str:
    return hashlib.sha256(canonical_bytes(body)).hexdigest()


def signed_bytes(key: str, signed_at: str, body_hash: str) -> bytes:
    """The exact bytes both signatures cover."""
    if not isinstance(key, str) or not _KEY_ID.match(key):
        raise CertificateError("signature.key must be a qrk- key id.")
    if not isinstance(signed_at, str) or not _STAMP.match(signed_at):
        raise CertificateError("signature.signed_at must be YYYY-MM-DDTHH:MM:SSZ.")
    if not isinstance(body_hash, str) or not _SHA.match(body_hash):
        raise CertificateError("body_sha256 must be 64 lowercase hex digits.")
    return f"{CERT_FORMAT}\nkey {key}\nsigned-at {signed_at}\nbody-sha256 {body_hash}\n".encode("ascii")


def _b64(value: Any, what: str, length: int | None = None) -> bytes:
    if not isinstance(value, str) or not value:
        raise CertificateError(f"{what} is missing.")
    try:
        raw = base64.b64decode(value.encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError, ValueError):
        raise CertificateError(f"{what} is not valid base64.") from None
    if length is not None and len(raw) != length:
        raise CertificateError(f"{what} must be {length} bytes, not {len(raw)}.")
    return raw


def verify_certificate(doc: Any, expect_key: str | None = None) -> dict[str, Any]:
    """{"valid", "body_hash_ok", "ed25519", "ml_dsa_65", "key_id", "body_sha256", "reason"}.

    Never raises on a bad hash or signature; raises CertificateError only for a malformed document.
    """
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    if not isinstance(doc, dict) or doc.get("format") != CERT_FORMAT:
        raise CertificateError(f"not a {CERT_FORMAT} document.")
    body = doc.get("certificate")
    if not isinstance(body, dict):
        raise CertificateError("the certificate body is missing.")
    if body.get("schema") != CERT_FORMAT:
        raise CertificateError(f"the body's schema is {body.get('schema')!r}, not {CERT_FORMAT}.")
    actual = body_sha256(body)
    out: dict[str, Any] = {"valid": False, "body_hash_ok": actual == doc.get("body_sha256"), "ed25519": False,
                           "ml_dsa_65": False, "key_id": None, "body_sha256": actual, "reason": None}
    if not out["body_hash_ok"]:
        out["reason"] = "The body's hash is not the one stated: the certificate was changed after it was issued."
        return out
    sig = doc.get("signature")
    if not sig:
        out["reason"] = "The certificate is not signed (the server had no signing key)."
        return out
    if not isinstance(sig, dict):
        raise CertificateError("signature must be an object.")
    pub = sig.get("public_key") or {}
    ed_pub = _b64(pub.get("ed25519"), "public_key.ed25519", ED25519_PUBLIC_BYTES)
    ml_pub = _b64(pub.get("ml_dsa_65"), "public_key.ml_dsa_65", ML_DSA_65_PUBLIC_BYTES)
    kid = key_id(ml_pub, ed_pub)
    out["key_id"] = kid
    if sig.get("key") != kid or pub.get("key_id", kid) != kid:
        out["reason"] = "The key id does not match the public keys sent with it."
        return out
    message = signed_bytes(kid, sig.get("signed_at"), actual)
    ed_sig = _b64(sig.get("ed25519"), "signature.ed25519")
    ml_sig = _b64(sig.get("ml_dsa_65"), "signature.ml_dsa_65")
    try:
        Ed25519PublicKey.from_public_bytes(ed_pub).verify(ed_sig, message)
        out["ed25519"] = True
    except (InvalidSignature, ValueError):
        pass
    try:
        from cryptography.hazmat.primitives.asymmetric import mldsa
    except ImportError:  # pragma: no cover - depends on the installed cryptography
        raise CertificateError("This cryptography library has no ML-DSA; install cryptography 46 or newer.")
    try:
        mldsa.MLDSA65PublicKey.from_public_bytes(ml_pub).verify(ml_sig, message, CONTEXT)
        out["ml_dsa_65"] = True
    except (InvalidSignature, ValueError):
        pass
    if not (out["ed25519"] and out["ml_dsa_65"]):
        out["reason"] = "The signature does not match the certificate: it was changed after signing, or signed by another key."
    elif expect_key and expect_key != kid:
        out["reason"] = f"Signed by {kid}, not by the key you trust ({expect_key})."
    out["valid"] = out["reason"] is None
    return out


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "qlab-certificate-verify/1"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 - the user chooses the URL
        return r.read()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Verify a Q-Lab provenance certificate.")
    ap.add_argument("--file", help="a certificate JSON file")
    ap.add_argument("--token", help="a shared run's share token: download its certificate")
    ap.add_argument("--api", default=DEFAULT_API, help=f"Q-Lab API base (default {DEFAULT_API})")
    ap.add_argument("--key", help="the key id you trust (qrk-...)")
    ap.add_argument("--qasm", help="a circuit file: check that its SHA-256 is the certified circuit's")
    args = ap.parse_args(argv)
    if args.file:
        with open(args.file, "rb") as f:
            raw = f.read()
    elif args.token:
        if not _TOKEN.match(args.token):
            ap.error("that is not a share token")
        raw = _get(f"{args.api.rstrip('/')}/api/v1/public/verified/{urllib.parse.quote(args.token)}/certificate")
    else:
        ap.error("give --file or --token")
    try:
        doc = json.loads(raw.decode("utf-8"))
        result = verify_certificate(doc, expect_key=args.key)
    except (CertificateError, ValueError) as exc:
        print(f"MALFORMED: {exc}")
        return 2
    body = doc["certificate"]
    run = body.get("run") or {}
    print(f"Run {run.get('run_id')} on {(body.get('machine') or {}).get('backend')}, issued {body.get('issued_at')}")
    print(f"  body sha256 {result['body_sha256']} {'ok' if result['body_hash_ok'] else 'DIFFERS'}")
    print(f"  key         {result['key_id']}")
    print(f"  Ed25519     {'ok' if result['ed25519'] else 'FAILED'}")
    print(f"  ML-DSA-65   {'ok' if result['ml_dsa_65'] else 'FAILED'}")
    ok = result["valid"]
    if args.qasm:
        with open(args.qasm, "rb") as f:
            got = hashlib.sha256(f.read()).hexdigest()
        circ = body.get("circuit") or {}
        known = {v for part in ("as_run", "logical", "compiled") for v in ((circ.get(part) or {}).values()) if isinstance(v, str)}
        match = got in known
        print(f"  circuit     {got} {'matches the certificate' if match else 'NOT in the certificate'}")
        ok = ok and match
    rep = body.get("reproduction") or {}
    if rep.get("sentence"):
        print(f"  {rep['sentence']}")
    if not result["valid"]:
        print(f"  NOT VALID: {result['reason']}")
    print("VALID" if ok else "NOT VALID")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
