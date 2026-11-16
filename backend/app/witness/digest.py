"""Digest format and the hashing rules from SPEC section 3."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from typing import Any

from .canonical import canonicalize

DEFAULT_ALG = "sha3-256"
_HASHES = {"sha3-256": hashlib.sha3_256, "sha256": hashlib.sha256}
_DIGEST_RE = re.compile(r"(sha3-256|sha256):[0-9a-f]{64}")


def is_digest(value: Any) -> bool:
    return isinstance(value, str) and _DIGEST_RE.fullmatch(value) is not None


def alg_of(digest: str) -> str:
    if not is_digest(digest):
        raise ValueError(f"not a digest: {digest!r}")
    return digest.split(":", 1)[0]


def digest_raw(data: bytes, alg: str = DEFAULT_ALG) -> str:
    try:
        hasher = _HASHES[alg]
    except KeyError:
        raise ValueError(f"unsupported digest algorithm: {alg}") from None
    return f"{alg}:{hasher(data).hexdigest()}"


def normalize_text(data: bytes | str) -> bytes:
    if isinstance(data, bytes):
        text = data.decode("utf-8")
    else:
        text = data
    text = text.removeprefix("﻿").replace("\r\n", "\n").replace("\r", "\n")
    return text.rstrip(" \t\n").encode("utf-8")


def digest_text(data: bytes | str, alg: str = DEFAULT_ALG) -> str:
    return digest_raw(normalize_text(data), alg)


def digest_json(value: Any, alg: str = DEFAULT_ALG) -> str:
    return digest_raw(canonicalize(value), alg)


def digest_counts(counts: Mapping[str, int], alg: str = DEFAULT_ALG) -> str:
    """Digest of a results counts object. Outcome strings are hashed exactly as recorded."""
    for outcome, count in counts.items():
        if not isinstance(outcome, str):
            raise ValueError(f"outcome must be a string: {outcome!r}")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError(f"count must be a non-negative integer: {outcome}={count!r}")
    return digest_json(dict(counts), alg)
