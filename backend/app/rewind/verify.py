"""Check a Rewind daily manifest: the bytes that are signed, and both signatures.

Standalone on purpose: it imports nothing from Q-Lab, only the standard library and
``cryptography`` (46 or newer, for ML-DSA), so anyone can run it against the public API:

    pip install "cryptography>=46"
    python verify.py --date 2026-11-14                      # the hosted Q-Lab
    python verify.py --date 2026-11-14 --key qrk-0123...    # and insist on a key id you trust
    python verify.py --manifest saved.json                  # a manifest saved earlier

A manifest lists the calibration snapshots the server stored on one UTC day. It is signed twice
over the same bytes, and is valid only when both signatures verify:

  * Ed25519 (RFC 8032);
  * ML-DSA-65 (FIPS 204), with the context string ``qlab-rewind-manifest/1``.

The signed bytes are plain UTF-8 text, one field per line, so any implementation can rebuild them
from the manifest's JSON without a JSON canonicaliser::

    qlab-rewind-manifest/1
    date 2026-11-14
    key qrk-0123456789abcdef0123456789abcdef
    signed-at 2026-11-14T06:20:00Z
    <sha256> <path>
    <sha256> <path>
    ...

Entries are sorted by path. ``sha256`` is of the snapshot's uncompressed canonical JSON (the file
at ``path`` is that JSON, gzip-compressed), so a file's hash does not depend on the compressor.
The snapshot files themselves are not published (they are IBM's calibration data); the manifest
lets the server show later that a replay used exactly the calibration it stored on that day.
The key id is derived from both public keys: ``qrk-`` + the first 32 hex digits of
sha256(b"qlab-rewind-key/1\\n" + ml_dsa_65_public + ed25519_public).

The server sends its public key with every manifest, so a signature alone proves only that the
manifest was not changed after whoever holds that key signed it. Pin the key id (``--key``) to be
sure it is Q-Lab's key; the hosted key id is published at /api/v1/rewind/public-key.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import gzip
import hashlib
import json
import re
import sys
import urllib.request
from typing import Any, Iterable

MANIFEST_FORMAT = "qlab-rewind-manifest/1"
PUBLIC_KEY_FORMAT = "qlab-rewind-public-key/1"
CONTEXT = MANIFEST_FORMAT.encode("ascii")
ED25519_PUBLIC_BYTES = 32
ML_DSA_65_PUBLIC_BYTES = 1952
DEFAULT_API = "https://qlab.soqlab.com/qlab-api"

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_PATH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./-]{0,499}$")
_KEY_ID = re.compile(r"^qrk-[0-9a-f]{32}$")


class ManifestError(ValueError):
    """The manifest is not well formed; the message says what is wrong."""


def key_id(ml_dsa_public: bytes, ed25519_public: bytes) -> str:
    digest = hashlib.sha256(b"qlab-rewind-key/1\n" + bytes(ml_dsa_public) + bytes(ed25519_public)).hexdigest()
    return "qrk-" + digest[:32]


def manifest_bytes(date: str, key: str, signed_at: str, entries: Iterable[dict[str, Any]]) -> bytes:
    """The exact bytes both signatures cover."""
    if not isinstance(date, str) or not _DATE.match(date):
        raise ManifestError("date must be YYYY-MM-DD.")
    if not isinstance(key, str) or not _KEY_ID.match(key):
        raise ManifestError("key must be a qrk- key id.")
    if not isinstance(signed_at, str) or not _STAMP.match(signed_at):
        raise ManifestError("signed_at must be YYYY-MM-DDTHH:MM:SSZ.")
    lines = [MANIFEST_FORMAT, f"date {date}", f"key {key}", f"signed-at {signed_at}"]
    rows = []
    for e in entries:
        sha, path = e.get("sha256"), e.get("path")
        if not isinstance(sha, str) or not _SHA.match(sha):
            raise ManifestError(f"entry {path!r}: sha256 must be 64 lowercase hex digits.")
        if not isinstance(path, str) or not _PATH.match(path) or ".." in path.split("/"):
            raise ManifestError(f"entry path {path!r} is not a plain relative path.")
        rows.append((path, sha))
    if len({p for p, _ in rows}) != len(rows):
        raise ManifestError("an entry path appears twice.")
    lines += [f"{sha} {path}" for path, sha in sorted(rows)]
    return ("\n".join(lines) + "\n").encode("utf-8")


def _b64(value: Any, what: str, length: int | None = None) -> bytes:
    if not isinstance(value, str) or not value:
        raise ManifestError(f"{what} is missing.")
    try:
        raw = base64.b64decode(value.encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError, ValueError):
        raise ManifestError(f"{what} is not valid base64.") from None
    if length is not None and len(raw) != length:
        raise ManifestError(f"{what} must be {length} bytes, not {len(raw)}.")
    return raw


def verify_manifest(doc: dict[str, Any], expect_key: str | None = None) -> dict[str, Any]:
    """{"valid": bool, "ed25519": bool, "ml_dsa_65": bool, "key_id": str, "reason": str|None}.

    Never raises on a bad signature; raises ManifestError only for a malformed document.
    """
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    if not isinstance(doc, dict) or doc.get("format") != MANIFEST_FORMAT:
        raise ManifestError(f"not a {MANIFEST_FORMAT} document.")
    sig = doc.get("signature")
    if not sig:
        return {"valid": False, "ed25519": False, "ml_dsa_65": False, "key_id": None,
                "reason": "The manifest is not signed (the server had no signing key)."}
    pub = sig.get("public_key") or {}
    ed_pub = _b64(pub.get("ed25519"), "public_key.ed25519", ED25519_PUBLIC_BYTES)
    ml_pub = _b64(pub.get("ml_dsa_65"), "public_key.ml_dsa_65", ML_DSA_65_PUBLIC_BYTES)
    kid = key_id(ml_pub, ed_pub)
    if sig.get("key") != kid or pub.get("key_id", kid) != kid:
        return {"valid": False, "ed25519": False, "ml_dsa_65": False, "key_id": kid,
                "reason": "The key id does not match the public keys sent with it."}
    message = manifest_bytes(doc.get("date"), kid, sig.get("signed_at"), doc.get("entries") or [])
    ed_sig = _b64(sig.get("ed25519"), "signature.ed25519")
    ml_sig = _b64(sig.get("ml_dsa_65"), "signature.ml_dsa_65")
    try:
        Ed25519PublicKey.from_public_bytes(ed_pub).verify(ed_sig, message)
        ed_ok = True
    except (InvalidSignature, ValueError):
        ed_ok = False
    try:
        from cryptography.hazmat.primitives.asymmetric import mldsa
    except ImportError:  # pragma: no cover - depends on the installed cryptography
        raise ManifestError("This cryptography library has no ML-DSA; install cryptography 46 or newer.")
    try:
        mldsa.MLDSA65PublicKey.from_public_bytes(ml_pub).verify(ml_sig, message, CONTEXT)
        ml_ok = True
    except (InvalidSignature, ValueError):
        ml_ok = False
    reason = None
    if not (ed_ok and ml_ok):
        reason = "The signature does not match the manifest: it was changed after signing, or signed by another key."
    elif expect_key and expect_key != kid:
        reason = f"Signed by {kid}, not by the key you trust ({expect_key})."
    return {"valid": reason is None, "ed25519": ed_ok, "ml_dsa_65": ml_ok, "key_id": kid, "reason": reason}


def content_sha256(gz_bytes: bytes) -> str:
    """The hash a manifest lists for a snapshot file (of the uncompressed JSON), for whoever holds it."""
    return hashlib.sha256(gzip.decompress(gz_bytes)).hexdigest()


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "qlab-rewind-verify/1"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 - the user chooses the URL
        return r.read()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Verify a Q-Lab Rewind daily manifest.")
    ap.add_argument("--date", help="UTC day, YYYY-MM-DD")
    ap.add_argument("--api", default=DEFAULT_API, help=f"Q-Lab API base (default {DEFAULT_API})")
    ap.add_argument("--manifest", help="a manifest JSON file instead of downloading one")
    ap.add_argument("--key", help="the key id you trust (qrk-...)")
    args = ap.parse_args(argv)
    if args.manifest:
        with open(args.manifest, "rb") as f:
            doc = json.loads(f.read().decode("utf-8"))
    elif args.date:
        doc = json.loads(_get(f"{args.api.rstrip('/')}/api/v1/rewind/manifests/{args.date}").decode("utf-8"))
    else:
        ap.error("give --date or --manifest")
    try:
        result = verify_manifest(doc, expect_key=args.key)
    except ManifestError as exc:
        print(f"MALFORMED: {exc}")
        return 2
    entries = doc.get("entries") or []
    print(f"{doc.get('date')}: {len(entries)} file(s), key {result['key_id']}")
    print(f"  Ed25519   {'ok' if result['ed25519'] else 'FAILED'}")
    print(f"  ML-DSA-65 {'ok' if result['ml_dsa_65'] else 'FAILED'}")
    ok = result["valid"]
    if not ok:
        print(f"  NOT VALID: {result['reason']}")
    print("VALID" if ok else "NOT VALID")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
