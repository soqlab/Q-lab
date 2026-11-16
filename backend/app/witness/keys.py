"""Key sets, private key storage, rotation, revocation and the key document."""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from dataclasses import dataclass, field, replace
from datetime import datetime
from pathlib import Path
from secrets import token_bytes
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.mldsa import MLDSA65PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from .canonical import loads_strict
from .digest import digest_json, digest_raw, is_digest
from .receipt import (
    ALGORITHMS,
    PUBLIC_KEY_LENGTHS,
    b64url_decode,
    b64url_encode,
    format_time,
    is_timestamp,
)

KEYS_VERSION = "witness-keys/v0.1"
PRIVATE_VERSION = "witness-private-key/v0.1"
DOCUMENT_NAME = "witness-keys.json"
_SCRYPT = {"n": 2**15, "r": 8, "p": 1}


class KeyError_(ValueError):
    """A key file or key document is invalid."""


class PassphraseRequired(KeyError_):
    """The private key is encrypted and no passphrase, or the wrong one, was given."""


def key_set_id(component_ids: dict[str, str]) -> str:
    return digest_json({alg: component_ids[alg] for alg in ALGORITHMS})


@dataclass(frozen=True)
class PublicKeySet:
    key_id: str
    public_keys: dict[str, bytes]
    valid_from: str
    valid_until: str | None = None
    status: str = "active"
    revoked_at: str | None = None

    @property
    def component_ids(self) -> dict[str, str]:
        return {alg: digest_raw(raw) for alg, raw in self.public_keys.items()}

    def to_dict(self) -> dict[str, Any]:
        ids = self.component_ids
        return {
            "key_id": self.key_id,
            "public_keys": [
                {
                    "alg": alg,
                    "key_id": ids[alg],
                    "public_key": b64url_encode(self.public_keys[alg]),
                }
                for alg in ALGORITHMS
            ],
            "valid_from": self.valid_from,
            "valid_until": self.valid_until,
            "status": self.status,
            "revoked_at": self.revoked_at,
        }


@dataclass(frozen=True)
class KeysDocument:
    issuer: str
    keys: tuple[PublicKeySet, ...] = field(default_factory=tuple)

    def find(self, key_id: str) -> PublicKeySet | None:
        return next((k for k in self.keys if k.key_id == key_id), None)

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": KEYS_VERSION,
            "issuer": self.issuer,
            "keys": [k.to_dict() for k in self.keys],
        }

    def dumps(self) -> str:
        return json.dumps(self.to_dict(), indent=2) + "\n"

    @classmethod
    def from_dict(cls, data: Any) -> KeysDocument:
        if not isinstance(data, dict) or data.get("version") != KEYS_VERSION:
            raise KeyError_(f"key document version must be {KEYS_VERSION}")
        issuer, entries = data.get("issuer"), data.get("keys")
        if not isinstance(issuer, str) or not isinstance(entries, list):
            raise KeyError_("key document needs issuer and keys")
        return cls(issuer=issuer, keys=tuple(_parse_key_set(entry) for entry in entries))

    @classmethod
    def load(cls, path: str | Path) -> KeysDocument:
        return cls.from_dict(loads_strict(Path(path).read_bytes()))


def _parse_key_set(entry: Any) -> PublicKeySet:
    if not isinstance(entry, dict):
        raise KeyError_("key entry must be an object")
    key_id = entry.get("key_id")
    if not is_digest(key_id):
        raise KeyError_("key entry needs a digest key_id")
    listed = entry.get("public_keys")
    if not isinstance(listed, list) or len(listed) != len(ALGORITHMS):
        raise KeyError_(f"{key_id}: needs one public key per algorithm")
    public: dict[str, bytes] = {}
    for item in listed:
        alg = item.get("alg") if isinstance(item, dict) else None
        if alg not in ALGORITHMS or alg in public:
            raise KeyError_(f"{key_id}: bad or repeated algorithm {alg!r}")
        try:
            raw = b64url_decode(item.get("public_key"))
        except ValueError as exc:
            raise KeyError_(f"{key_id}: {alg}: {exc}") from exc
        if len(raw) != PUBLIC_KEY_LENGTHS[alg]:
            raise KeyError_(f"{key_id}: {alg} public key has the wrong length")
        if item.get("key_id") != digest_raw(raw):
            raise KeyError_(f"{key_id}: {alg} component key_id does not match its key")
        public[alg] = raw
    if key_id != key_set_id({alg: digest_raw(raw) for alg, raw in public.items()}):
        raise KeyError_(f"{key_id}: key_id does not match its public keys")

    valid_from, valid_until = entry.get("valid_from"), entry.get("valid_until")
    status, revoked_at = entry.get("status"), entry.get("revoked_at")
    if not is_timestamp(valid_from):
        raise KeyError_(f"{key_id}: valid_from must be a timestamp")
    if valid_until is not None and not is_timestamp(valid_until):
        raise KeyError_(f"{key_id}: valid_until must be a timestamp or null")
    if status not in ("active", "retired", "revoked"):
        raise KeyError_(f"{key_id}: unknown status {status!r}")
    if (status == "revoked") != is_timestamp(revoked_at):
        raise KeyError_(f"{key_id}: revoked_at must be set only when status is revoked")
    return PublicKeySet(key_id, public, str(valid_from), valid_until, status, revoked_at)


@dataclass(frozen=True)
class SigningKey:
    """A private key set. repr() never shows the seeds."""

    issuer: str
    ml_dsa_seed: bytes = field(repr=False)
    ed25519_seed: bytes = field(repr=False)
    valid_from: str

    @classmethod
    def generate(cls, issuer: str, valid_from: str | None = None) -> SigningKey:
        return cls(issuer, token_bytes(32), token_bytes(32), valid_from or format_time())

    @property
    def ml_dsa(self) -> MLDSA65PrivateKey:
        return MLDSA65PrivateKey.from_seed_bytes(self.ml_dsa_seed)

    @property
    def ed25519(self) -> Ed25519PrivateKey:
        return Ed25519PrivateKey.from_private_bytes(self.ed25519_seed)

    def public(self) -> PublicKeySet:
        public_keys = {
            "ml-dsa-65": self.ml_dsa.public_key().public_bytes_raw(),
            "ed25519": self.ed25519.public_key().public_bytes_raw(),
        }
        ids = {alg: digest_raw(raw) for alg, raw in public_keys.items()}
        return PublicKeySet(key_set_id(ids), public_keys, self.valid_from)

    @property
    def key_id(self) -> str:
        return self.public().key_id

    def component_id(self, alg: str) -> str:
        return self.public().component_ids[alg]

    def to_private_json(self, passphrase: str | None = None) -> str:
        secret = {
            "ml_dsa_65_seed": b64url_encode(self.ml_dsa_seed),
            "ed25519_seed": b64url_encode(self.ed25519_seed),
        }
        document: dict[str, Any] = {
            "version": PRIVATE_VERSION,
            "issuer": self.issuer,
            "valid_from": self.valid_from,
            "key_id": self.key_id,
        }
        if passphrase is None:
            document["secret"] = secret
        else:
            document["encrypted"] = _encrypt(json.dumps(secret).encode(), passphrase)
        return json.dumps(document, indent=2) + "\n"

    @classmethod
    def from_private_json(cls, text: bytes | str, passphrase: str | None = None) -> SigningKey:
        data = loads_strict(text)
        if not isinstance(data, dict) or data.get("version") != PRIVATE_VERSION:
            raise KeyError_(f"private key version must be {PRIVATE_VERSION}")
        if "encrypted" in data:
            if passphrase is None:
                raise PassphraseRequired("this private key is encrypted; a passphrase is required")
            secret = loads_strict(_decrypt(data["encrypted"], passphrase))
        else:
            secret = data.get("secret")
        try:
            key = cls(
                issuer=data["issuer"],
                ml_dsa_seed=b64url_decode(secret["ml_dsa_65_seed"]),
                ed25519_seed=b64url_decode(secret["ed25519_seed"]),
                valid_from=data["valid_from"],
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise KeyError_("private key file is malformed") from exc
        if key.key_id != data.get("key_id"):
            raise KeyError_("private key does not match its recorded key_id")
        return key


def _kek(passphrase: str, salt: bytes) -> bytes:
    return Scrypt(salt=salt, length=32, **_SCRYPT).derive(passphrase.encode())


def _encrypt(plain: bytes, passphrase: str) -> dict[str, Any]:
    salt, nonce = token_bytes(16), token_bytes(12)
    return {
        "kdf": "scrypt",
        "params": _SCRYPT,
        "cipher": "aes-256-gcm",
        "salt": b64url_encode(salt),
        "nonce": b64url_encode(nonce),
        "ciphertext": b64url_encode(AESGCM(_kek(passphrase, salt)).encrypt(nonce, plain, None)),
    }


def _decrypt(box: dict[str, Any], passphrase: str) -> bytes:
    try:
        salt = b64url_decode(box["salt"])
        nonce = b64url_decode(box["nonce"])
        return AESGCM(_kek(passphrase, salt)).decrypt(nonce, b64url_decode(box["ciphertext"]), None)
    except InvalidTag:
        raise PassphraseRequired("wrong passphrase for this private key") from None
    except (KeyError, TypeError, ValueError) as exc:
        raise KeyError_("encrypted private key is malformed") from exc


def _write_private(path: Path, text: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)


def _private_name(key_id: str) -> str:
    return key_id.split(":", 1)[1][:32] + ".key"


class KeyDirectory:
    """A directory holding private key files and the public key document."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    @property
    def document_path(self) -> Path:
        return self.path / DOCUMENT_NAME

    def exists(self) -> bool:
        return self.document_path.exists()

    def document(self) -> KeysDocument:
        return KeysDocument.load(self.document_path)

    def _write_document(self, document: KeysDocument) -> None:
        temporary = self.document_path.with_suffix(".tmp")
        temporary.write_text(document.dumps(), encoding="utf-8")
        temporary.replace(self.document_path)

    def init(
        self, issuer: str, passphrase: str | None = None, valid_from: str | None = None
    ) -> SigningKey:
        if self.exists():
            raise KeyError_(f"keys already exist in {self.path}")
        self.path.mkdir(parents=True, exist_ok=True)
        try:
            self.path.chmod(0o700)
        except OSError:  # pragma: no cover
            pass
        key = SigningKey.generate(issuer, valid_from)
        _write_private(self.path / _private_name(key.key_id), key.to_private_json(passphrase))
        self._write_document(KeysDocument(issuer, (key.public(),)))
        return key

    def _active_entry(self, document: KeysDocument) -> PublicKeySet:
        active = [k for k in document.keys if k.status == "active"]
        if len(active) != 1:
            raise KeyError_(f"expected one active key set, found {len(active)}")
        return active[0]

    def load_active(self, passphrase: str | None = None) -> SigningKey:
        entry = self._active_entry(self.document())
        path = self.path / _private_name(entry.key_id)
        if not path.exists():
            raise KeyError_(f"private key for the active key set is missing: {path.name}")
        return SigningKey.from_private_json(path.read_bytes(), passphrase)

    def rotate(
        self,
        passphrase: str | None = None,
        at: datetime | None = None,
        keep_old_private: bool = False,
    ) -> SigningKey:
        """Retire the active key set and start a new one. Old receipts stay checkable."""
        document = self.document()
        old = self._active_entry(document)
        now = format_time(at)
        new = SigningKey.generate(document.issuer, now)
        _write_private(self.path / _private_name(new.key_id), new.to_private_json(passphrase))
        updated = _replace_entry(document.keys, replace(old, status="retired", valid_until=now))
        self._write_document(KeysDocument(document.issuer, (*updated, new.public())))
        if not keep_old_private:
            (self.path / _private_name(old.key_id)).unlink(missing_ok=True)
        return new

    def revoke(self, key_id: str, at: datetime | None = None) -> KeysDocument:
        """Mark a key set revoked. Receipts issued from this moment on fail verification."""
        document = self.document()
        entry = document.find(key_id)
        if entry is None:
            raise KeyError_(f"unknown key set: {key_id}")
        updated = KeysDocument(
            document.issuer,
            _replace_entry(
                document.keys, replace(entry, status="revoked", revoked_at=format_time(at))
            ),
        )
        self._write_document(updated)
        (self.path / _private_name(key_id)).unlink(missing_ok=True)
        return updated


def _replace_entry(entries: Iterable[PublicKeySet], new: PublicKeySet) -> tuple[PublicKeySet, ...]:
    return tuple(new if k.key_id == new.key_id else k for k in entries)
