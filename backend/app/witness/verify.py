"""Receipt verification (SPEC section 9). Works offline and reports every check."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.mldsa import MLDSA65PublicKey

from .anchor import check_imprint
from .canonical import CanonicalError, loads_strict
from .digest import alg_of, digest_json, digest_raw, digest_text, is_digest
from .keys import KeysDocument, PublicKeySet
from .receipt import b64url_decode, receipt_digest, schema_errors, signed_bytes

PASS, FAIL, SKIP = "pass", "fail", "skip"


@dataclass(frozen=True)
class Check:
    name: str
    status: str
    reason: str = ""


@dataclass
class VerifyResult:
    checks: list[Check] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return all(check.status != FAIL for check in self.checks)

    @property
    def failed(self) -> list[str]:
        return [check.name for check in self.checks if check.status == FAIL]

    def add(self, name: str, status: str, reason: str = "") -> None:
        self.checks.append(Check(name, status, reason))

    def to_dict(self) -> dict[str, Any]:
        return {
            "valid": self.valid,
            "checks": [asdict(check) for check in self.checks],
            "warnings": self.warnings,
        }


# How a supplied file is hashed, per field of each known kind.
DATA_RULES: dict[str, dict[str, str]] = {
    "qlab.run": {
        "circuit": "text",
        "compiled_circuit": "text",
        "calibration_snapshot": "json",
        "results": "json",
        "environment": "json",
    },
    "morrow.scan": {"target": "text", "cbom": "json"},
    "morrow.remediation": {
        "finding": "text",
        "before": "json",
        "after": "json",
        "approved_by": "text",
    },
    "witness.anchor": {},
}


def _hash_as(rule: str, data: bytes, alg: str) -> str:
    if rule == "text":
        return digest_text(data, alg)
    if rule == "json":
        return digest_json(loads_strict(data), alg)
    return digest_raw(data, alg)


def _recorded(receipt: dict[str, Any], name: str) -> tuple[str | None, str]:
    """The digest recorded for a data field, and how to hash a file for it."""
    subject, kind = receipt["subject"], receipt["kind"]
    if kind not in DATA_RULES:
        value = subject.get(name)
        return (value if is_digest(value) else None), "raw"
    if kind == "qlab.run" and name.startswith("postprocessing."):
        steps = subject["postprocessing"]
        index = name.split(".", 1)[1]
        if index.isdecimal() and int(index) < len(steps):
            return steps[int(index)], "json"
        return None, "json"
    rule = DATA_RULES[kind].get(name)
    if rule is None:
        return None, "raw"
    value = subject.get(name)
    if name == "calibration_snapshot" and value is not None:
        value = value["digest"]
    return value, rule


def _check_data(result: VerifyResult, receipt: dict[str, Any], data: Mapping[str, bytes]) -> None:
    for name, content in data.items():
        check = f"data.{name}"
        recorded, rule = _recorded(receipt, name)
        if recorded is None:
            result.add(check, FAIL, f"the receipt records no digest for {name}")
            continue
        try:
            actual = _hash_as(rule, content, alg_of(recorded))
        except (CanonicalError, UnicodeDecodeError) as exc:
            result.add(check, FAIL, f"could not read the file as {rule}: {exc}")
            continue
        if actual == recorded:
            result.add(check, PASS)
        else:
            result.add(check, FAIL, f"file hashes to {actual}, receipt records {recorded}")


def _verify_signature(alg: str, public_key: bytes, sig: bytes, message: bytes) -> None:
    if alg == "ml-dsa-65":
        MLDSA65PublicKey.from_public_bytes(public_key).verify(sig, message)
    else:
        Ed25519PublicKey.from_public_bytes(public_key).verify(sig, message)


def _check_key_validity(result: VerifyResult, receipt: dict[str, Any], key: PublicKeySet) -> None:
    issued = receipt["issued_at"]
    if issued < key.valid_from:
        result.add("key_validity", FAIL, f"issued {issued}, key valid from {key.valid_from}")
    elif key.valid_until is not None and issued >= key.valid_until:
        result.add("key_validity", FAIL, f"issued {issued}, key valid until {key.valid_until}")
    elif key.revoked_at is not None and issued >= key.revoked_at:
        result.add("key_validity", FAIL, f"issued {issued}, key revoked at {key.revoked_at}")
    else:
        result.add("key_validity", PASS)
        if key.revoked_at is not None:
            result.warnings.append(
                f"this key set was revoked at {key.revoked_at}; "
                "a key thief could backdate a receipt to before that"
            )


def _check_chain(result: VerifyResult, receipt: dict[str, Any], prev: Any) -> None:
    if prev is None:
        result.add("chain", SKIP, "no previous receipt supplied")
        return
    errors = schema_errors(prev)
    if errors:
        result.add("chain", FAIL, f"previous receipt is invalid: {errors[0]}")
    elif prev["issuer"]["name"] != receipt["issuer"]["name"]:
        result.add("chain", FAIL, "previous receipt has a different issuer")
    elif receipt["chain"].get("id") != prev["chain"].get("id"):
        result.add("chain", FAIL, "previous receipt belongs to a different chain")
    elif receipt["chain"]["seq"] != prev["chain"]["seq"] + 1:
        result.add(
            "chain",
            FAIL,
            f"seq {receipt['chain']['seq']} does not follow {prev['chain']['seq']}",
        )
    elif receipt["chain"]["prev"] != receipt_digest(prev):
        result.add("chain", FAIL, "chain.prev does not match the previous receipt's digest")
    elif receipt["issued_at"] < prev["issued_at"]:
        result.add("chain", FAIL, "issued_at is earlier than the previous receipt's")
    else:
        result.add("chain", PASS)


def verify(
    receipt: Any,
    keys: KeysDocument | None,
    prev: Any = None,
    data: Mapping[str, bytes] | None = None,
) -> VerifyResult:
    """Check a parsed receipt. See SPEC section 9 for what each check means."""
    result = VerifyResult()
    errors = schema_errors(receipt)
    if errors:
        result.add("schema", FAIL, "; ".join(errors))
        return result
    result.add("schema", PASS)

    if keys is None:
        for name in ("issuer", "key", "key_validity", "sig.ml-dsa-65", "sig.ed25519"):
            result.add(name, FAIL, "no key document supplied")
    else:
        _check_keys_and_signatures(result, receipt, keys)
    _check_chain(result, receipt, prev)
    if receipt["kind"] == "witness.anchor":
        _check_anchor(result, receipt)
    if data:
        _check_data(result, receipt, data)
    return result


def _check_anchor(result: VerifyResult, receipt: dict[str, Any]) -> None:
    subject = receipt["subject"]
    if subject["head"]["seq"] >= receipt["chain"]["seq"]:
        result.add("anchor", FAIL, "an anchor must come after the head it covers")
        return
    ok, reason, gen_time = check_imprint(subject)
    if not ok:
        result.add("anchor", FAIL, reason)
        return
    result.add("anchor", PASS, f"timestamped {gen_time} by {subject['authority']}")
    result.warnings.append(
        "the anchor token covers this head, but the authority's signature was not checked; "
        "use soqlab-witness anchor verify with a certificate you trust"
    )


def _check_keys_and_signatures(
    result: VerifyResult, receipt: dict[str, Any], keys: KeysDocument
) -> None:
    if keys.issuer == receipt["issuer"]["name"]:
        result.add("issuer", PASS)
    else:
        result.add(
            "issuer",
            FAIL,
            f"receipt names {receipt['issuer']['name']!r}, key document is for {keys.issuer!r}",
        )

    key = keys.find(receipt["issuer"]["key_id"])
    if key is None:
        result.add("key", FAIL, "the key document does not list this key set")
        result.add("key_validity", SKIP, "key set unknown")
        result.add("sig.ml-dsa-65", SKIP, "key set unknown")
        result.add("sig.ed25519", SKIP, "key set unknown")
        return

    ids = key.component_ids
    mismatched = [s["alg"] for s in receipt["signatures"] if s["key_id"] != ids[s["alg"]]]
    if mismatched:
        result.add("key", FAIL, f"signature key_id does not match key set: {mismatched}")
    else:
        result.add("key", PASS)
    _check_key_validity(result, receipt, key)

    message = signed_bytes(receipt)
    by_alg = {s["alg"]: s for s in receipt["signatures"]}
    for alg in ("ml-dsa-65", "ed25519"):
        try:
            _verify_signature(alg, key.public_keys[alg], b64url_decode(by_alg[alg]["sig"]), message)
        except InvalidSignature:
            result.add(f"sig.{alg}", FAIL, "signature does not match the receipt")
        else:
            result.add(f"sig.{alg}", PASS)
