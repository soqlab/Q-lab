"""Noise Robustness Sweep — models circuit fidelity across a range of noise multipliers."""

import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Any

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["robustness"])

_TWO_QUBIT_GATES = {
    "cx", "cz", "cy", "ecr", "rzx", "swap", "dcx", "ccx",
    "cswap", "iswap", "cs", "csx", "cp", "cu", "cu1", "cu3",
}
_GATE_NS = {"single": 50, "two": 300, "measure": 3000}
_SWEEP_MULTIPLIERS = [0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0]


def _fidelity_at(multiplier: float, ge_1q: float, ge_2q: float,
                 single_q: int, two_q: int, t1: float | None,
                 t2: float | None, circuit_time_us: float,
                 ro: float, num_qubits: int) -> dict[str, Any]:
    eff_1q = min(1.0, ge_1q * multiplier)
    eff_2q = min(1.0, ge_2q * multiplier)
    eff_ro = min(1.0, ro * multiplier)

    f_1q = (1.0 - eff_1q) ** single_q if single_q else 1.0
    f_2q = (1.0 - eff_2q) ** two_q if two_q else 1.0

    if t1 and t1 > 0 and circuit_time_us > 0:
        eff_t = circuit_time_us / (t1 / multiplier) if multiplier > 0 else 0.0
        f_t1 = math.exp(-eff_t)
    else:
        f_t1 = 1.0

    if t2 and t2 > 0 and circuit_time_us > 0:
        eff_t2 = circuit_time_us / (t2 / multiplier) if multiplier > 0 else 0.0
        f_t2 = math.exp(-eff_t2)
    else:
        f_t2 = 1.0

    f_ro = (1.0 - eff_ro) ** num_qubits if num_qubits else 1.0

    combined = f_1q * f_2q * f_t1 * f_t2 * f_ro
    return {
        "error_multiplier": multiplier,
        "fidelity": round(combined, 5),
        "gate_fidelity": round(f_1q * f_2q, 5),
        "coherence_fidelity": round(f_t1 * f_t2, 5),
        "readout_fidelity": round(f_ro, 5),
        "effective_1q_error": round(eff_1q, 6),
        "effective_2q_error": round(eff_2q, 6),
    }


@router.get("/{run_id}/robustness")
def noise_robustness(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")

    fp = run.fingerprint or {}
    cal = run.calibration or {}

    num_qubits = int(fp.get("num_qubits") or 0)
    size = int(fp.get("size") or 0)
    gate_counts: dict = fp.get("gate_counts") or {}

    two_q = sum(int(v) for k, v in gate_counts.items() if k.lower() in _TWO_QUBIT_GATES)
    measures = int(gate_counts.get("measure", 0))
    single_q = max(0, size - two_q - measures)

    circuit_time_us = (
        single_q * _GATE_NS["single"] + two_q * _GATE_NS["two"] + measures * _GATE_NS["measure"]
    ) / 1000.0

    t1_vals = [float(v) for v in (cal.get("t1_us") or {}).values() if v]
    t2_vals = [float(v) for v in (cal.get("t2_us") or {}).values() if v]
    ge_vals = [float(v) for v in (cal.get("gate_errors") or {}).values() if v]
    ro_vals = [float(v) for v in (cal.get("readout_errors") or {}).values() if v]

    avg_t1 = sum(t1_vals) / len(t1_vals) if t1_vals else None
    avg_t2 = sum(t2_vals) / len(t2_vals) if t2_vals else None
    avg_ge = sum(ge_vals) / len(ge_vals) if ge_vals else 0.001
    avg_ro = sum(ro_vals) / len(ro_vals) if ro_vals else 0.02
    ge_2q = avg_ge * 10

    has_cal = bool(t1_vals or ge_vals)

    sweep = [
        _fidelity_at(m, avg_ge, ge_2q, single_q, two_q, avg_t1, avg_t2, circuit_time_us, avg_ro, num_qubits)
        for m in _SWEEP_MULTIPLIERS
    ]

    # Baseline fidelity (multiplier = 1.0)
    baseline = next(s for s in sweep if s["error_multiplier"] == 1.0)
    baseline_f = baseline["fidelity"]

    # Fidelity at 2× and 0.5× noise
    f_half = next(s["fidelity"] for s in sweep if s["error_multiplier"] == 0.5)
    f_double = next(s["fidelity"] for s in sweep if s["error_multiplier"] == 2.0)

    # Robustness score: fraction of baseline fidelity retained at 2× noise
    robustness_score = round(f_double / baseline_f, 3) if baseline_f > 0 else 0.0

    # Noise tolerance: error multiplier at which fidelity first drops below 50%
    tolerance_2x: float | None = None
    for pt in sweep:
        if pt["fidelity"] < 0.50:
            tolerance_2x = pt["error_multiplier"]
            break

    # Sensitivity: slope of fidelity vs multiplier around baseline (linear approx)
    sensitivity = round((f_half - f_double) / (2.0 - 0.5), 4)  # df/d(multiplier)

    return {
        "run_id": run_id,
        "has_calibration": has_cal,
        "baseline_fidelity": round(baseline_f, 4),
        "robustness_score": robustness_score,
        "robustness_label": (
            "robust" if robustness_score >= 0.8 else
            "moderate" if robustness_score >= 0.5 else
            "fragile"
        ),
        "fidelity_at_half_noise": round(f_half, 4),
        "fidelity_at_double_noise": round(f_double, 4),
        "noise_tolerance_multiplier": tolerance_2x,
        "sensitivity_per_unit_noise": sensitivity,
        "sweep": sweep,
        "circuit": {
            "single_qubit_gates": single_q,
            "two_qubit_gates": two_q,
            "num_qubits": num_qubits,
            "circuit_time_us": round(circuit_time_us, 2),
        },
        "calibration_used": {
            "avg_gate_error": round(avg_ge, 6),
            "avg_2q_error": round(ge_2q, 6),
            "avg_t1_us": round(avg_t1, 2) if avg_t1 else None,
            "avg_t2_us": round(avg_t2, 2) if avg_t2 else None,
            "avg_readout_error": round(avg_ro, 4),
        },
    }
