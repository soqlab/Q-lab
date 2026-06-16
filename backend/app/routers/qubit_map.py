"""Logical-to-physical qubit mapping and routing overhead analysis.

Extracts mapping data from the transpiler dict stored on a run.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["qubit_map"])


def _parse_layout(transpiler: dict) -> dict | None:
    """Try to extract initial_layout / final_layout from common transpiler formats."""
    if not transpiler:
        return None

    # Accept either {"initial_layout": {0: 5, 1: 3, ...}} or {"layout": {...}}
    layout = transpiler.get("initial_layout") or transpiler.get("layout")
    if not layout:
        return None

    if isinstance(layout, dict):
        # Could be {logical: physical} or {physical: logical} — use as-is
        # Filter out non-int keys/values
        parsed = {}
        for k, v in layout.items():
            try:
                parsed[int(k)] = int(v)
            except (TypeError, ValueError):
                pass
        return parsed if parsed else None

    if isinstance(layout, list):
        # List format: [physical_qubit_index, ...] where index = logical qubit
        return {i: int(v) for i, v in enumerate(layout) if v is not None}

    return None


def _coupling_map(calibration: dict) -> list[tuple[int, int]]:
    """Extract coupling pairs from calibration data."""
    edges: list[tuple[int, int]] = []

    # Format 1: {"coupling_map": [[0, 1], [1, 2], ...]}
    coupling = calibration.get("coupling_map")
    if coupling and isinstance(coupling, list):
        for pair in coupling:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                try:
                    edges.append((int(pair[0]), int(pair[1])))
                except (TypeError, ValueError):
                    pass
        return edges

    # Format 2: per-gate calibration "cx0_1", "cx1_2" etc.
    for key in calibration:
        if key.startswith("cx") and "_" in key:
            parts = key[2:].split("_")
            if len(parts) == 2:
                try:
                    edges.append((int(parts[0]), int(parts[1])))
                except ValueError:
                    pass

    return edges


def _routing_overhead(transpiler: dict, fingerprint: dict) -> dict:
    """Estimate routing overhead from transpiler metadata."""
    depth_before = transpiler.get("depth_before") or transpiler.get("original_depth")
    depth_after = transpiler.get("depth_after") or transpiler.get("transpiled_depth") or fingerprint.get("depth")
    size_before = transpiler.get("size_before") or transpiler.get("original_size")
    size_after = transpiler.get("size_after") or transpiler.get("transpiled_size") or fingerprint.get("size")
    swap_count = transpiler.get("swap_count") or transpiler.get("num_swaps") or 0

    return {
        "depth_before": depth_before,
        "depth_after": depth_after,
        "depth_overhead_pct": (
            round((int(depth_after) - int(depth_before)) / int(depth_before) * 100, 1)
            if depth_before and depth_after and int(depth_before) > 0
            else None
        ),
        "size_before": size_before,
        "size_after": size_after,
        "swap_count": int(swap_count) if swap_count else 0,
    }


@router.get("/{run_id}/qubit-map")
def qubit_map(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    transpiler = run.transpiler or {}
    calibration = run.calibration or {}
    fingerprint = run.fingerprint or {}

    layout = _parse_layout(transpiler)
    coupling = _coupling_map(calibration)
    overhead = _routing_overhead(transpiler, fingerprint)
    num_qubits = fingerprint.get("num_qubits") or 0

    # Build qubit quality map from calibration
    qubit_quality: dict[int, dict] = {}
    for i in range(num_qubits):
        q_key = f"q{i}"
        alt_key = str(i)
        q_data = calibration.get(q_key) or calibration.get(alt_key) or {}
        if q_data and isinstance(q_data, dict):
            qubit_quality[i] = {
                "T1_us": q_data.get("T1") or q_data.get("t1"),
                "T2_us": q_data.get("T2") or q_data.get("t2"),
                "readout_error": q_data.get("readout_error") or q_data.get("prob_meas1_prep0"),
            }

    # Build layout edges — pairs of (logical, physical) for mapped qubits
    mapped_pairs = []
    if layout:
        for logical, physical in layout.items():
            quality = qubit_quality.get(physical)
            mapped_pairs.append({
                "logical": logical,
                "physical": physical,
                "T1_us": quality["T1_us"] if quality else None,
                "readout_error": quality["readout_error"] if quality else None,
            })
        mapped_pairs.sort(key=lambda x: x["logical"])

    has_layout = layout is not None and len(layout) > 0

    return {
        "run_id": run_id,
        "num_qubits": num_qubits,
        "has_layout": has_layout,
        "layout": layout or {},
        "mapped_pairs": mapped_pairs,
        "coupling_edges": coupling[:100],  # cap for frontend
        "routing_overhead": overhead,
        "transpiler_duration_ms": transpiler.get("duration_ms"),
        "transpiler_version": transpiler.get("version") or transpiler.get("qiskit_version"),
    }
