"""Canonical JSON (RFC 8785) and strict JSON parsing."""

from __future__ import annotations

import json
from typing import Any

import rfc8785

_MAX_SAFE = 2**53 - 1


class CanonicalError(ValueError):
    """The value has no canonical JSON form."""


def canonicalize(value: Any) -> bytes:
    try:
        return rfc8785.dumps(value)
    except (rfc8785.CanonicalizationError, TypeError, ValueError, RecursionError) as exc:
        raise CanonicalError(str(exc)) from exc


def _reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise CanonicalError(f"duplicate object key: {key!r}")
        out[key] = value
    return out


def _reject_constant(name: str) -> Any:
    raise CanonicalError(f"{name} is not valid JSON")


def _parse_int(text: str) -> int | float:
    # RFC 8785 numbers are doubles, so a big integer reads as JavaScript's JSON.parse reads it.
    value = int(text)
    return value if -_MAX_SAFE <= value <= _MAX_SAFE else float(value)


def loads_strict(data: bytes | str) -> Any:
    """Parse JSON, refusing duplicate keys and NaN/Infinity."""
    if isinstance(data, bytes):
        try:
            data = data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise CanonicalError(f"not UTF-8: {exc}") from exc
    try:
        return json.loads(
            data,
            object_pairs_hook=_reject_duplicates,
            parse_constant=_reject_constant,
            parse_int=_parse_int,
        )
    except (ValueError, RecursionError, OverflowError) as exc:
        if isinstance(exc, CanonicalError):
            raise
        raise CanonicalError(f"not valid JSON: {exc}") from exc
