"""Reading calibration data that arrives in more than one shape."""
from __future__ import annotations

from typing import Any


def per_qubit(value: Any) -> dict[str, Any]:
    """A calibration field as a per-qubit map.

    The SDK sends maps such as {"0": 112.4, "1": 98.1}. Runs posted by hand or by other
    integrations may send one number for the whole device, or a list; those become
    {"avg": x} and {"0": a, "1": b, ...}, so callers can always use .values() and .get().
    """
    if isinstance(value, dict):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return {"avg": value}
    if isinstance(value, (list, tuple)):
        return {str(i): v for i, v in enumerate(value)}
    return {}
