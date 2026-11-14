"""The server's Rewind signing key: Ed25519 + ML-DSA-65, both over the same manifest bytes.

The key comes from QLAB_REWIND_SIGNING_KEY and is never stored anywhere else. Its form is
``qrk1:`` + base64 of 64 bytes: the Ed25519 private key (32 bytes, RFC 8032 seed) followed by the
ML-DSA-65 seed (32 bytes, FIPS 204 xi). Make one with ``python -m app.rewind keygen``.

Without the variable (or with a value that can't be read) manifests are stored unsigned and the
API says why. The byte format and the checks are in verify.py, which runs on its own.
"""
from __future__ import annotations

import base64
import binascii
import logging
import os
import secrets
from dataclasses import dataclass
from typing import Any, Optional

from . import verify

log = logging.getLogger("qlab.rewind")

KEY_ENV = "QLAB_REWIND_SIGNING_KEY"
_PREFIX = "qrk1:"


def generate_key() -> str:
    """A new private key in QLAB_REWIND_SIGNING_KEY form."""
    return _PREFIX + base64.b64encode(secrets.token_bytes(64)).decode("ascii")


@dataclass(frozen=True)
class Signer:
    ed25519: Any
    ml_dsa_65: Any

    @property
    def ed25519_public(self) -> bytes:
        from cryptography.hazmat.primitives import serialization
        return self.ed25519.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    @property
    def ml_dsa_65_public(self) -> bytes:
        return self.ml_dsa_65.public_key().public_bytes_raw()

    @property
    def key_id(self) -> str:
        return verify.key_id(self.ml_dsa_65_public, self.ed25519_public)

    def public_key(self) -> dict[str, str]:
        return {
            "format": verify.PUBLIC_KEY_FORMAT,
            "key_id": self.key_id,
            "ed25519": base64.b64encode(self.ed25519_public).decode("ascii"),
            "ml_dsa_65": base64.b64encode(self.ml_dsa_65_public).decode("ascii"),
        }

    def sign(self, message: bytes) -> dict[str, str]:
        return {
            "ed25519": base64.b64encode(self.ed25519.sign(message)).decode("ascii"),
            "ml_dsa_65": base64.b64encode(self.ml_dsa_65.sign(message, verify.CONTEXT)).decode("ascii"),
        }


class SigningKeyError(ValueError):
    """QLAB_REWIND_SIGNING_KEY is set but is not a key."""


def parse_key(raw: str) -> Signer:
    from cryptography.hazmat.primitives.asymmetric import mldsa
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    raw = (raw or "").strip()
    if not raw.startswith(_PREFIX):
        raise SigningKeyError(f"{KEY_ENV} must start with {_PREFIX} (make one with: python -m app.rewind keygen)")
    try:
        material = base64.b64decode(raw[len(_PREFIX):].encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError, ValueError):
        raise SigningKeyError(f"{KEY_ENV} is not valid base64 after {_PREFIX}") from None
    if len(material) != 64:
        raise SigningKeyError(f"{KEY_ENV} must hold 64 bytes, not {len(material)}")
    return Signer(Ed25519PrivateKey.from_private_bytes(material[:32]),
                  mldsa.MLDSA65PrivateKey.from_seed_bytes(material[32:]))


def status() -> dict[str, Any]:
    """{"enabled", "key_id", "reason"} without ever exposing the private key."""
    raw = os.getenv(KEY_ENV, "").strip()
    if not raw:
        return {"enabled": False, "key_id": None,
                "reason": f"This server has no signing key ({KEY_ENV}), so its manifests are stored unsigned."}
    try:
        s = parse_key(raw)
    except Exception as exc:
        return {"enabled": False, "key_id": None, "reason": f"The signing key can't be used: {exc}"}
    return {"enabled": True, "key_id": s.key_id, "reason": None}


def signer() -> Optional[Signer]:
    raw = os.getenv(KEY_ENV, "").strip()
    if not raw:
        return None
    try:
        return parse_key(raw)
    except Exception as exc:
        log.error("rewind: %s", exc)
        return None
