"""Observer-effect telemetry for run-level quantum debugging.

This is an honest, hardware-compatible version of QOET: it consumes
intermediate measurement snapshots when the SDK/user logs them, and otherwise
falls back to the final count distribution. It does not claim non-destructive
state access on real QPUs.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["qoe_telemetry"])

_SNAPSHOT_KEYS = ("qoe_snapshots", "telemetry_snapshots", "intermediate_counts", "snapshots")


def _is_bitstring(value: str) -> bool:
    compact = value.replace(" ", "")
    return bool(compact) and all(ch in "01" for ch in compact)


def _normalise_counts(raw: Any) -> dict[str, int] | None:
    if not isinstance(raw, dict):
        return None
    counts_source = raw.get("counts") if isinstance(raw.get("counts"), dict) else raw
    counts: dict[str, int] = {}
    for key, value in counts_source.items():
        if isinstance(key, str) and _is_bitstring(key) and isinstance(value, (int, float)):
            counts[key.replace(" ", "")] = int(value)
    return counts or None


def _find_snapshots(results: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    for key in _SNAPSHOT_KEYS:
        raw = results.get(key)
        if isinstance(raw, list) and raw:
            snapshots = [item for item in raw if isinstance(item, dict)]
            if snapshots:
                return snapshots, key

    counts = _normalise_counts(results)
    if counts:
        return [{"depth": None, "label": "final", "counts": counts}], "final_counts"

    return [], "none"


def _bit(value: str, index: int) -> int:
    return int(value[index]) if index < len(value) else 0


def _snapshot_from_counts(snapshot: dict[str, Any], index: int) -> dict[str, Any] | None:
    counts = _normalise_counts(snapshot.get("counts") if "counts" in snapshot else snapshot)
    if not counts:
        return None

    shots = sum(counts.values())
    if shots <= 0:
        return None

    n_qubits = max(len(key) for key in counts)
    probs = [count / shots for count in counts.values()]
    purity = sum(p * p for p in probs)
    entropy = -sum(p * math.log2(p) for p in probs if p > 0)
    max_entropy = math.log2(max(2, min(2**n_qubits, len(counts))))
    concentration = 1.0 - (entropy / max_entropy if max_entropy else 0.0)

    z_expectations: list[float] = []
    for q in range(n_qubits):
        p0 = 0.0
        p1 = 0.0
        for bitstring, count in counts.items():
            if _bit(bitstring, q) == 0:
                p0 += count / shots
            else:
                p1 += count / shots
        z_expectations.append(round(p0 - p1, 6))

    corr = 0.0
    pairs = 0
    for i in range(min(n_qubits, 6)):
        for j in range(i + 1, min(n_qubits, 6)):
            zizj = 0.0
            for bitstring, count in counts.items():
                sign = 1 if _bit(bitstring, i) == _bit(bitstring, j) else -1
                zizj += sign * (count / shots)
            corr += abs(zizj - z_expectations[i] * z_expectations[j])
            pairs += 1
    correlation_signal = corr / pairs if pairs else 0.0

    dominant_state, dominant_count = max(counts.items(), key=lambda item: item[1])
    depth = snapshot.get("depth")
    try:
        depth_value = int(depth) if depth is not None else index
    except (TypeError, ValueError):
        depth_value = index

    return {
        "index": index,
        "label": str(snapshot.get("label") or f"snapshot-{index}"),
        "depth": depth_value,
        "shots": shots,
        "n_qubits": n_qubits,
        "purity": round(purity, 6),
        "entropy": round(entropy, 6),
        "coherence_proxy": round(max(0.0, min(1.0, concentration)), 6),
        "correlation_signal": round(correlation_signal, 6),
        "dominant_state": dominant_state,
        "dominant_probability": round(dominant_count / shots, 6),
        "z_expectations": z_expectations,
    }


def _trend(values: list[float]) -> str:
    if len(values) < 2:
        return "single_snapshot"
    delta = values[-1] - values[0]
    if delta < -0.08:
        return "decaying"
    if delta > 0.08:
        return "recovering"
    return "stable"


@router.get("/{run_id}/qoe-telemetry")
def qoe_telemetry(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    results = run.results or {}
    snapshots, source = _find_snapshots(results)
    points = [
        point
        for idx, snapshot in enumerate(snapshots)
        if (point := _snapshot_from_counts(snapshot, idx)) is not None
    ]

    if not points:
        raise HTTPException(
            422,
            "No QOET telemetry found. Log results.qoe_snapshots as a list of "
            "{depth, label, counts} objects, or provide final counts.",
        )

    coherence_values = [float(point["coherence_proxy"]) for point in points]
    purity_values = [float(point["purity"]) for point in points]
    correlation_values = [float(point["correlation_signal"]) for point in points]

    confidence = "medium" if source != "final_counts" and len(points) > 1 else "low"
    return {
        "run_id": run_id,
        "source": source,
        "confidence": confidence,
        "snapshot_count": len(points),
        "coherence_trend": _trend(coherence_values),
        "purity_trend": _trend(purity_values),
        "correlation_trend": _trend(correlation_values),
        "initial_coherence": coherence_values[0],
        "final_coherence": coherence_values[-1],
        "coherence_drop": round(coherence_values[0] - coherence_values[-1], 6),
        "points": points,
        "note": (
            "Computed from logged measurement snapshots. This is a coherence "
            "proxy from probability distributions, not non-destructive access "
            "to a live wavefunction."
        ),
    }
