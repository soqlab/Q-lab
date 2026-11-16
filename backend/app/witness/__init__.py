"""SOQLAB Witness: signed, hash-chained receipts for runs (receipt format witness/v0.1).

A copy of the core of the soqlab-witness library (canonical JSON, digests, keys, sealing,
verifying, RFC 3161 anchoring), kept inside Q-Lab so the server needs nothing beyond PyPI.
Bundles and the command line are left out. Q-Lab keeps its chain in its own database
(app/witness_service.py); chain.verify_chain checks a list of receipts.
"""

from .chain import ChainIssue, ChainReport, Head, verify_chain
from .canonical import CanonicalError, canonicalize, loads_strict
from .digest import digest_counts, digest_json, digest_raw, digest_text, is_digest
from .keys import KeyDirectory, KeysDocument, PublicKeySet, SigningKey
from .receipt import (
    VERSION,
    Receipt,
    ReceiptError,
    qlab_run_subject,
    receipt_digest,
    schema_errors,
    signed_bytes,
)
from .sign import next_link, seal
from .verify import Check, VerifyResult, verify

__all__ = [
    "VERSION",
    "CanonicalError",
    "ChainIssue",
    "ChainReport",
    "Check",
    "Head",
    "KeyDirectory",
    "KeysDocument",
    "PublicKeySet",
    "Receipt",
    "ReceiptError",
    "SigningKey",
    "VerifyResult",
    "canonicalize",
    "digest_counts",
    "digest_json",
    "digest_raw",
    "digest_text",
    "is_digest",
    "loads_strict",
    "next_link",
    "qlab_run_subject",
    "receipt_digest",
    "schema_errors",
    "seal",
    "signed_bytes",
    "verify",
    "verify_chain",
]
