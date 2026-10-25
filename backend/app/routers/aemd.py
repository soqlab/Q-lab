"""Automated Error-Mechanism Deconvolution.

AEMD separates observed loss into physical hardware mechanisms and residual
algorithmic/model mismatch using calibration, circuit structure, transpiler
metadata, and result statistics.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..calibration_utils import per_qubit

router = APIRouter(prefix="/api/v1/runs", tags=["aemd"])

_TWO_Q = {"cx", "cz", "cy", "ecr", "rzx", "swap", "dcx", "ccx", "cswap", "iswap", "cs", "csx", "cp", "cu", "cu1", "cu3"}


def _safe(value: Any, fallback: float | None = None) -> float | None:
    try:
        f = float(value)
        return f if math.isfinite(f) else fallback
    except (TypeError, ValueError):
        return fallback


def _avg(values: list[float | None]) -> float | None:
    clean = [v for v in values if v is not None]
    return sum(clean) / len(clean) if clean else None


def _counts(results: dict[str, Any]) -> dict[str, int] | None:
    raw = results.get("counts") if isinstance(results.get("counts"), dict) else results
    if not isinstance(raw, dict):
        return None
    out: dict[str, int] = {}
    for key, value in raw.items():
        if isinstance(key, str) and all(ch in "01 " for ch in key) and isinstance(value, (int, float)):
            out[key.replace(" ", "")] = int(value)
    return out or None


def _observed_success(results: dict[str, Any]) -> tuple[float | None, str]:
    explicit = _safe(results.get("success_probability"))
    if explicit is not None:
        return max(0.0, min(1.0, explicit)), "success_probability"
    c = _counts(results)
    if not c:
        return None, "unavailable"
    total = sum(c.values())
    if total <= 0:
        return None, "unavailable"
    dominant = max(c.values()) / total
    return dominant, "dominant_outcome_probability"


def _component(label: str, source: str, error: float, detail: str) -> dict[str, Any]:
    return {
        "source": source,
        "label": label,
        "error": round(max(0.0, min(1.0, error)), 6),
        "detail": detail,
    }


@router.get("/{run_id}/aemd")
def aemd(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp = run.fingerprint or {}
    cal = run.calibration or {}
    transpiler = run.transpiler or {}
    results = run.results or {}

    n = int(fp.get("num_qubits") or 0)
    size = int(fp.get("size") or 0)
    depth = int(fp.get("depth") or 0)
    gate_counts = {str(k).lower(): int(v) for k, v in (fp.get("gate_counts") or {}).items()}
    two_q = sum(v for k, v in gate_counts.items() if k in _TWO_Q)
    measures = int(gate_counts.get("measure", 0))
    single_q = max(0, size - two_q - measures)

    t1 = _avg([_safe(v) for v in per_qubit(cal.get("t1_us")).values()])
    t2 = _avg([_safe(v) for v in per_qubit(cal.get("t2_us")).values()])
    ge = _avg([_safe(v) for v in per_qubit(cal.get("gate_errors")).values()])
    ro = _avg([_safe(v) for v in per_qubit(cal.get("readout_errors")).values()])

    ge_1q = ge or 0.001
    ge_2q = max((ge or 0.001) * 8, 0.006)
    ro_rate = ro or 0.02
    t1_us = t1 or 180.0
    t2_us = t2 or 140.0

    swap_count = int(transpiler.get("swap_count") or transpiler.get("num_swaps") or gate_counts.get("swap", 0) or 0)
    depth_before = int(transpiler.get("depth_before") or transpiler.get("original_depth") or depth or 0)
    depth_after = int(transpiler.get("depth_after") or transpiler.get("transpiled_depth") or depth or 0)
    routing_overhead = max(0, depth_after - depth_before)
    cnot_decomp_penalty = max(0, two_q - n) * ge_2q * 0.18

    circuit_time_us = single_q * 0.05 + two_q * 0.3 + measures * 3.0 + routing_overhead * 0.08
    components = [
        _component("Single-qubit gate noise", "single_qubit_gates", 1 - (1 - ge_1q) ** single_q, f"{single_q} gates at ~{ge_1q:.3%}"),
        _component("Two-qubit gate noise", "two_qubit_gates", 1 - (1 - ge_2q) ** two_q, f"{two_q} gates at ~{ge_2q:.3%}"),
        _component("T1 relaxation", "t1_decay", 1 - math.exp(-circuit_time_us / t1_us), f"{circuit_time_us:.2f} us / T1 {t1_us:.1f} us"),
        _component("T2 dephasing", "t2_dephasing", 1 - math.exp(-circuit_time_us / t2_us), f"{circuit_time_us:.2f} us / T2 {t2_us:.1f} us"),
        _component("Readout noise", "readout", 1 - (1 - ro_rate) ** n if n else 0.0, f"{n} qubits at ~{ro_rate:.2%}"),
        _component("Routing and decomposition", "routing_decomposition", cnot_decomp_penalty + swap_count * ge_2q, f"{swap_count} swaps, {routing_overhead} depth overhead"),
    ]

    physical_raw = sum(c["error"] for c in components)
    physical_error = max(0.0, min(0.98, physical_raw / (1.0 + physical_raw)))
    predicted_success = 1.0 - physical_error
    observed_success, observed_source = _observed_success(results)
    if observed_success is None:
        observed_success = predicted_success
    observed_loss = 1.0 - observed_success

    residual_algorithmic = max(0.0, observed_loss - physical_error)
    unexplained_goodness = max(0.0, physical_error - observed_loss)
    logical_signals = []
    if float(fp.get("non_clifford_ratio") or 0) > 0.5:
        logical_signals.append("High non-Clifford/parametric ratio increases decomposition sensitivity.")
    if depth > 150:
        logical_signals.append("High circuit depth can hide ansatz or objective-scaling errors.")
    if not results:
        logical_signals.append("No result distribution available; attribution is calibration-only.")
    if run.status == "failed":
        residual_algorithmic = max(residual_algorithmic, 0.25)
        logical_signals.append("Execution failed; provider/runtime or logical compatibility issue likely.")

    attribution_base = physical_error + residual_algorithmic
    if attribution_base <= 0:
        attribution_base = 1.0
    hardware_pct = round(physical_error / attribution_base * 100.0, 1)
    algorithm_pct = round(residual_algorithmic / attribution_base * 100.0, 1)

    for comp in components:
        comp["pct_of_physical"] = round(comp["error"] / max(physical_raw, 1e-9) * 100.0, 1)
    components.sort(key=lambda c: c["error"], reverse=True)

    verdict = "hardware_limited" if hardware_pct >= 65 else "algorithm_limited" if algorithm_pct >= 55 else "mixed"
    return {
        "run_id": run_id,
        "verdict": verdict,
        "observed_success": round(observed_success, 6),
        "observed_success_source": observed_source,
        "predicted_success_from_hardware": round(predicted_success, 6),
        "hardware_error": round(physical_error, 6),
        "algorithmic_residual_error": round(residual_algorithmic, 6),
        "hardware_attribution_pct": hardware_pct,
        "algorithmic_attribution_pct": algorithm_pct,
        "unexplained_hardware_margin": round(unexplained_goodness, 6),
        "dominant_hardware_source": components[0]["source"] if components else None,
        "components": components,
        "logical_signals": logical_signals,
        "calibration_used": {
            "avg_t1_us": round(t1, 3) if t1 is not None else None,
            "avg_t2_us": round(t2, 3) if t2 is not None else None,
            "avg_gate_error": round(ge, 6) if ge is not None else None,
            "avg_readout_error": round(ro, 6) if ro is not None else None,
        },
        "note": "AEMD is a model-based attribution. Exact causal separation requires controlled reruns or calibration probes.",
    }
