"""The receipt model and schema rules (SPEC sections 2, 5 and 6)."""

from __future__ import annotations

import base64
import binascii
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from secrets import randbits
from typing import Any

from .canonical import CanonicalError, canonicalize
from .digest import digest_raw, is_digest

VERSION = "witness/v0.1"
ALGORITHMS = ("ml-dsa-65", "ed25519")
MAX_INT = 2**53 - 1
SIG_LENGTHS = {"ml-dsa-65": 3309, "ed25519": 64}
PUBLIC_KEY_LENGTHS = {"ml-dsa-65": 1952, "ed25519": 32}
MAX_TOKEN_CHARS = 16384

_TIME_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
_KIND_RE = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")
_UUID7_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
_COMMIT_RE = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_B64URL_RE = re.compile(r"[A-Za-z0-9_-]+")

_TOP_LEVEL = {"version", "id", "kind", "issued_at", "issuer", "subject", "chain", "signatures"}


class ReceiptError(ValueError):
    """A receipt or subject breaks the schema."""


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    if not isinstance(text, str) or _B64URL_RE.fullmatch(text) is None:
        raise ValueError("not base64url")
    try:
        decoded = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"not base64url: {exc}") from exc
    if b64url_encode(decoded) != text:
        raise ValueError("non-canonical base64url")
    return decoded


def is_timestamp(value: Any) -> bool:
    if not isinstance(value, str) or _TIME_RE.fullmatch(value) is None:
        return False
    try:
        datetime(
            int(value[:4]),
            int(value[5:7]),
            int(value[8:10]),
            int(value[11:13]),
            int(value[14:16]),
            int(value[17:19]),
        )
    except ValueError:
        return False
    return True


def format_time(moment: datetime | None = None) -> str:
    moment = moment or datetime.now(UTC)
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_int(value: Any, minimum: int = 0) -> bool:
    # JSON has one number type: 1.0 and 1 are the same value, and canonicalize alike.
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= MAX_INT


def new_id(now_ms: int | None = None) -> str:
    """A lowercase UUIDv7 (RFC 9562)."""
    if now_ms is None:
        now_ms = int(datetime.now(UTC).timestamp() * 1000)
    value = (now_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= randbits(12) << 64
    value |= 0b10 << 62
    value |= randbits(62)
    return str(uuid.UUID(int=value))


def _check_members(obj: Any, required: set[str], where: str) -> list[str]:
    if not isinstance(obj, dict):
        return [f"{where} must be an object"]
    errors = [f"{where} is missing {name}" for name in sorted(required - obj.keys())]
    errors += [f"{where} has unknown member {name}" for name in sorted(obj.keys() - required)]
    return errors


def _optional_digest(value: Any, where: str) -> list[str]:
    return [] if value is None or is_digest(value) else [f"{where} must be a digest or null"]


def _required_digest(value: Any, where: str) -> list[str]:
    return [] if is_digest(value) else [f"{where} must be a digest"]


def _check_qlab_run(subject: dict[str, Any]) -> list[str]:
    fields = {
        "circuit",
        "compiled_circuit",
        "backend",
        "calibration_snapshot",
        "results",
        "postprocessing",
        "code",
        "environment",
        "shots",
    }
    errors = _check_members(subject, fields, "subject")
    if errors:
        return errors
    for name in ("circuit", "compiled_circuit", "results", "environment"):
        errors += _optional_digest(subject[name], f"subject.{name}")

    backend = subject["backend"]
    member_errors = _check_members(backend, {"name", "provider"}, "subject.backend")
    errors += member_errors
    if not member_errors:
        if not isinstance(backend["name"], str):
            errors.append("subject.backend.name must be a string")
        if backend["provider"] is not None and not isinstance(backend["provider"], str):
            errors.append("subject.backend.provider must be a string or null")

    calibration = subject["calibration_snapshot"]
    if calibration is not None:
        member_errors = _check_members(
            calibration, {"digest", "captured_at"}, "subject.calibration_snapshot"
        )
        errors += member_errors
        if not member_errors:
            errors += _required_digest(calibration["digest"], "subject.calibration_snapshot.digest")
            captured = calibration["captured_at"]
            if captured is not None and not is_timestamp(captured):
                errors.append("subject.calibration_snapshot.captured_at must be a timestamp")

    steps = subject["postprocessing"]
    if not isinstance(steps, list):
        errors.append("subject.postprocessing must be an array")
    else:
        for index, step in enumerate(steps):
            errors += _required_digest(step, f"subject.postprocessing[{index}]")

    code = subject["code"]
    if code is not None:
        member_errors = _check_members(code, {"commit", "dirty"}, "subject.code")
        errors += member_errors
        if not member_errors:
            commit = code["commit"]
            if commit is not None and (
                not isinstance(commit, str) or _COMMIT_RE.fullmatch(commit) is None
            ):
                errors.append("subject.code.commit must be 40 or 64 lowercase hex characters")
            if code["dirty"] is not None and not isinstance(code["dirty"], bool):
                errors.append("subject.code.dirty must be a boolean or null")

    if subject["shots"] is not None and not is_int(subject["shots"]):
        errors.append("subject.shots must be a non-negative integer or null")
    return errors


def _check_morrow_scan(subject: dict[str, Any]) -> list[str]:
    errors = _check_members(subject, {"target", "cbom"}, "subject")
    if errors:
        return errors
    return _required_digest(subject["target"], "subject.target") + _required_digest(
        subject["cbom"], "subject.cbom"
    )


def _check_morrow_remediation(subject: dict[str, Any]) -> list[str]:
    errors = _check_members(
        subject, {"finding", "before", "after", "approved_by", "status"}, "subject"
    )
    if errors:
        return errors
    errors += _required_digest(subject["finding"], "subject.finding")
    for name in ("before", "after", "approved_by"):
        errors += _optional_digest(subject[name], f"subject.{name}")
    status = subject["status"]
    if not isinstance(status, str) or not 1 <= len(status) <= 64:
        errors.append("subject.status must be 1 to 64 characters")
    return errors


def _check_anchor(subject: dict[str, Any]) -> list[str]:
    errors = _check_members(subject, {"head", "method", "authority", "token"}, "subject")
    if errors:
        return errors
    head = subject["head"]
    member_errors = _check_members(head, {"seq", "digest"}, "subject.head")
    errors += member_errors
    if not member_errors:
        if not is_int(head["seq"], 1):
            errors.append("subject.head.seq must be a positive integer")
        errors += _required_digest(head["digest"], "subject.head.digest")
    if subject["method"] != "rfc3161":
        errors.append("subject.method must be rfc3161")
    authority = subject["authority"]
    if not isinstance(authority, str) or not authority:
        errors.append("subject.authority must be a non-empty string")
    token = subject["token"]
    try:
        if not isinstance(token, str) or len(token) > MAX_TOKEN_CHARS:
            raise ValueError
        b64url_decode(token)
    except ValueError:
        errors.append(f"subject.token must be base64url, at most {MAX_TOKEN_CHARS} characters")
    return errors


SUBJECT_CHECKS = {
    "qlab.run": _check_qlab_run,
    "morrow.scan": _check_morrow_scan,
    "morrow.remediation": _check_morrow_remediation,
    "witness.anchor": _check_anchor,
}


def subject_errors(kind: str, subject: Any) -> list[str]:
    if not isinstance(subject, dict):
        return ["subject must be an object"]
    check = SUBJECT_CHECKS.get(kind)
    return check(subject) if check else []


def _chain_errors(chain: Any) -> list[str]:
    required = {"seq", "prev"}
    if isinstance(chain, dict) and "id" in chain:
        required.add("id")
    errors = _check_members(chain, required, "chain")
    if errors:
        return errors
    if "id" in chain and (
        not isinstance(chain["id"], str) or _KIND_RE.fullmatch(chain["id"]) is None
    ):
        errors.append("chain.id has an invalid format")
    seq, prev = chain["seq"], chain["prev"]
    if not is_int(seq, 1):
        return ["chain.seq must be a positive integer"]
    if seq == 1 and prev is not None:
        errors.append("chain.prev must be null when seq is 1")
    if seq != 1 and not (is_digest(prev) and prev.startswith("sha3-256:")):
        errors.append("chain.prev must be a sha3-256 digest when seq is above 1")
    return errors


def _signature_errors(signatures: Any) -> list[str]:
    if not isinstance(signatures, list):
        return ["signatures must be an array"]
    errors: list[str] = []
    seen: list[str] = []
    for index, entry in enumerate(signatures):
        where = f"signatures[{index}]"
        member_errors = _check_members(entry, {"alg", "key_id", "sig"}, where)
        errors += member_errors
        if member_errors:
            continue
        alg = entry["alg"]
        if alg not in ALGORITHMS:
            errors.append(f"{where}.alg is not supported: {alg!r}")
            continue
        seen.append(alg)
        if not is_digest(entry["key_id"]) or not entry["key_id"].startswith("sha3-256:"):
            errors.append(f"{where}.key_id must be a sha3-256 digest")
        try:
            if len(b64url_decode(entry["sig"])) != SIG_LENGTHS[alg]:
                errors.append(f"{where}.sig must be {SIG_LENGTHS[alg]} bytes for {alg}")
        except ValueError as exc:
            errors.append(f"{where}.sig: {exc}")
    if sorted(seen) != sorted(ALGORITHMS):
        errors.append("signatures must have exactly one ml-dsa-65 and one ed25519 entry")
    return errors


def schema_errors(receipt: Any) -> list[str]:
    """Every way this object breaks the schema. An empty list means it conforms."""
    errors = _check_members(receipt, _TOP_LEVEL, "receipt")
    if errors:
        return errors
    if receipt["version"] != VERSION:
        errors.append(f"unsupported version: {receipt['version']!r}")
    rid = receipt["id"]
    if not isinstance(rid, str) or _UUID7_RE.fullmatch(rid) is None:
        errors.append("id must be a lowercase UUIDv7")
    kind = receipt["kind"]
    if not isinstance(kind, str) or _KIND_RE.fullmatch(kind) is None:
        errors.append("kind has an invalid format")
    elif isinstance(receipt["subject"], dict):
        errors += subject_errors(kind, receipt["subject"])
    if not isinstance(receipt["subject"], dict):
        errors.append("subject must be an object")
    if not is_timestamp(receipt["issued_at"]):
        errors.append("issued_at must be YYYY-MM-DDTHH:MM:SSZ")

    issuer = receipt["issuer"]
    member_errors = _check_members(issuer, {"name", "key_id"}, "issuer")
    errors += member_errors
    if not member_errors:
        name = issuer["name"]
        if not isinstance(name, str) or not 1 <= len(name) <= 255:
            errors.append("issuer.name must be 1 to 255 characters")
        if not is_digest(issuer["key_id"]) or not issuer["key_id"].startswith("sha3-256:"):
            errors.append("issuer.key_id must be a sha3-256 digest")

    errors += _chain_errors(receipt["chain"])
    errors += _signature_errors(receipt["signatures"])
    if not errors:
        try:
            canonicalize(receipt)
        except CanonicalError as exc:
            errors.append(f"not canonicalizable: {exc}")
    return errors


def signed_bytes(receipt: dict[str, Any]) -> bytes:
    """The bytes both algorithms sign: the canonical receipt without its signatures."""
    return canonicalize({k: v for k, v in receipt.items() if k != "signatures"})


def receipt_digest(receipt: dict[str, Any]) -> str:
    return digest_raw(signed_bytes(receipt))


@dataclass(frozen=True)
class Receipt:
    """Typed read-only view over a schema-valid receipt."""

    version: str
    id: str
    kind: str
    issued_at: str
    issuer_name: str
    issuer_key_id: str
    subject: dict[str, Any]
    seq: int
    prev: str | None
    signatures: tuple[dict[str, str], ...]
    chain_id: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Receipt:
        errors = schema_errors(data)
        if errors:
            raise ReceiptError("; ".join(errors))
        return cls(
            version=data["version"],
            id=data["id"],
            kind=data["kind"],
            issued_at=data["issued_at"],
            issuer_name=data["issuer"]["name"],
            issuer_key_id=data["issuer"]["key_id"],
            subject=data["subject"],
            seq=int(data["chain"]["seq"]),
            prev=data["chain"]["prev"],
            signatures=tuple(data["signatures"]),
            chain_id=data["chain"].get("id"),
        )

    def to_dict(self) -> dict[str, Any]:
        chain: dict[str, Any] = {"seq": self.seq, "prev": self.prev}
        if self.chain_id is not None:
            chain["id"] = self.chain_id
        return {
            "version": self.version,
            "id": self.id,
            "kind": self.kind,
            "issued_at": self.issued_at,
            "issuer": {"name": self.issuer_name, "key_id": self.issuer_key_id},
            "subject": self.subject,
            "chain": chain,
            "signatures": list(self.signatures),
        }


def qlab_run_subject(
    *,
    backend: str,
    provider: str | None = None,
    circuit: str | None = None,
    compiled_circuit: str | None = None,
    calibration_digest: str | None = None,
    calibration_captured_at: str | None = None,
    results: str | None = None,
    postprocessing: list[str] | None = None,
    commit: str | None = None,
    dirty: bool | None = None,
    environment: str | None = None,
    shots: int | None = None,
) -> dict[str, Any]:
    """Build a qlab.run subject from digests that have already been computed."""
    calibration = None
    if calibration_digest is not None:
        calibration = {"digest": calibration_digest, "captured_at": calibration_captured_at}
    code = None if commit is None and dirty is None else {"commit": commit, "dirty": dirty}
    return {
        "circuit": circuit,
        "compiled_circuit": compiled_circuit,
        "backend": {"name": backend, "provider": provider},
        "calibration_snapshot": calibration,
        "results": results,
        "postprocessing": postprocessing or [],
        "code": code,
        "environment": environment,
        "shots": shots,
    }
