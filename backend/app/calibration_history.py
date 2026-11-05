"""Reads the calibration snapshot stored with a run.

The SDK records per-qubit and per-gate maps ({"t1_us": {"0": 120.5, ...}}), while the forecasts work
on one number per snapshot. Older or manually ingested runs may carry the average directly.
"""
from __future__ import annotations

from typing import Any, Optional

_MAPS = {
    "avg_t1_us": "t1_us",
    "avg_t2_us": "t2_us",
    "avg_gate_error": "gate_errors",
    "avg_readout_error": "readout_errors",
}


def calibration_metric(calibration: Optional[dict[str, Any]], metric: str) -> Optional[float]:
    """The snapshot's value for an avg_* metric, or None if it wasn't recorded."""
    calibration = calibration or {}
    value = calibration.get(metric)
    if isinstance(value, (int, float)):
        return float(value)
    per_item = calibration.get(_MAPS.get(metric, ""))
    if isinstance(per_item, dict):
        numbers = [float(v) for v in per_item.values() if isinstance(v, (int, float))]
        if numbers:
            return sum(numbers) / len(numbers)
    return None
