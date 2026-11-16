"""Building and signing receipts."""

from __future__ import annotations

from typing import Any

from .keys import SigningKey
from .receipt import (
    VERSION,
    ReceiptError,
    b64url_encode,
    format_time,
    new_id,
    receipt_digest,
    schema_errors,
    signed_bytes,
    subject_errors,
)


def seal(
    kind: str,
    subject: dict[str, Any],
    key: SigningKey,
    *,
    seq: int = 1,
    prev: str | None = None,
    issued_at: str | None = None,
    receipt_id: str | None = None,
    chain_id: str | None = None,
) -> dict[str, Any]:
    """Build and sign a receipt. The caller supplies the chain position."""
    errors = subject_errors(kind, subject)
    if errors:
        raise ReceiptError("; ".join(errors))
    chain: dict[str, Any] = {"seq": seq, "prev": prev}
    if chain_id is not None:
        chain["id"] = chain_id
    body: dict[str, Any] = {
        "version": VERSION,
        "id": receipt_id or new_id(),
        "kind": kind,
        "issued_at": issued_at or format_time(),
        "issuer": {"name": key.issuer, "key_id": key.key_id},
        "subject": subject,
        "chain": chain,
    }
    message = signed_bytes(body)
    receipt = {
        **body,
        "signatures": [
            {
                "alg": "ml-dsa-65",
                "key_id": key.component_id("ml-dsa-65"),
                "sig": b64url_encode(key.ml_dsa.sign(message)),
            },
            {
                "alg": "ed25519",
                "key_id": key.component_id("ed25519"),
                "sig": b64url_encode(key.ed25519.sign(message)),
            },
        ],
    }
    errors = schema_errors(receipt)
    if errors:
        raise ReceiptError("; ".join(errors))
    return receipt


def next_link(previous: dict[str, Any] | None) -> tuple[int, str | None]:
    """The seq and prev for the receipt after this one, or for the first receipt."""
    if previous is None:
        return 1, None
    return int(previous["chain"]["seq"]) + 1, receipt_digest(previous)
