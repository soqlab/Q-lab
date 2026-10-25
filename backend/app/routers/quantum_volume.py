"""Quantum Volume (QV) estimator from calibration data.

Uses the theoretical QV model from Moll et al. (2018): the effective number
of reliable qubits d is found by maximising d such that the circuit depth
d can be executed with fidelity > 2/3.  QV = 2^d.

Since we work from calibration snapshots (not live heavy-output measurements),
we return a *model-based estimate* — clearly labelled as such.
"""

import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..calibration_utils import per_qubit

router = APIRouter(prefix="/api/v1/runs", tags=["quantum_volume"])


def _layer_fidelity(ge_2q: float, ge_1q: float, ro: float, d: int) -> float:
    """Fidelity of one square layer: d 2Q gates + 2d 1Q gates + d readouts."""
    f_2q = (1.0 - ge_2q) ** d
    f_1q = (1.0 - ge_1q) ** (2 * d)
    f_ro = (1.0 - ro) ** d
    return f_2q * f_1q * f_ro


def _qv_estimate(ge_2q: float, ge_1q: float, ro: float, t1: float | None,
                 t2: float | None, max_d: int = 20) -> dict:
    """Find max d such that layer fidelity > 2/3."""
    THRESHOLD = 2 / 3
    best_d = 0
    sweep = []

    for d in range(1, max_d + 1):
        gate_f = _layer_fidelity(ge_2q, ge_1q, ro, d)

        # Approximate circuit time: d layers × 300 ns per 2Q gate
        t_us = d * 300 / 1000.0
        coherence_f = 1.0
        if t1 and t1 > 0:
            coherence_f *= math.exp(-t_us / t1)
        if t2 and t2 > 0:
            coherence_f *= math.exp(-t_us / t2)

        combined = gate_f * coherence_f
        sweep.append({
            "d": d,
            "gate_fidelity": round(gate_f, 5),
            "coherence_fidelity": round(coherence_f, 5),
            "combined_fidelity": round(combined, 5),
            "above_threshold": combined > THRESHOLD,
        })
        if combined > THRESHOLD:
            best_d = d

    return {
        "best_d": best_d,
        "qv": 2 ** best_d if best_d > 0 else 1,
        "log2_qv": best_d,
        "threshold": THRESHOLD,
        "sweep": sweep,
    }


@router.get("/{run_id}/quantum-volume")
def quantum_volume(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")

    cal = run.calibration or {}
    fp = run.fingerprint or {}
    num_qubits = int(fp.get("num_qubits") or 0)

    t1_vals = [float(v) for v in per_qubit(cal.get("t1_us")).values() if v]
    t2_vals = [float(v) for v in per_qubit(cal.get("t2_us")).values() if v]
    ge_vals = [float(v) for v in per_qubit(cal.get("gate_errors")).values() if v]
    ro_vals = [float(v) for v in per_qubit(cal.get("readout_errors")).values() if v]

    has_cal = bool(t1_vals or ge_vals)

    avg_t1 = sum(t1_vals) / len(t1_vals) if t1_vals else None
    avg_t2 = sum(t2_vals) / len(t2_vals) if t2_vals else None
    avg_ge = sum(ge_vals) / len(ge_vals) if ge_vals else 0.001
    avg_ro = sum(ro_vals) / len(ro_vals) if ro_vals else 0.01

    # Separate 2Q gate errors from 1Q
    cx_keys = [k for k in per_qubit(cal.get("gate_errors")) if any(c in k for c in ["cx", "ecr", "cz", "rzx"])]
    cx_vals = [float(per_qubit(cal.get("gate_errors"))[k]) for k in cx_keys if per_qubit(cal.get("gate_errors")).get(k)]
    ge_2q = sum(cx_vals) / len(cx_vals) if cx_vals else avg_ge * 10
    ge_1q = avg_ge

    result = _qv_estimate(ge_2q, ge_1q, avg_ro, avg_t1, avg_t2)

    # Interpretation
    qv = result["qv"]
    if qv >= 512:
        grade = "excellent"
    elif qv >= 64:
        grade = "good"
    elif qv >= 8:
        grade = "moderate"
    else:
        grade = "limited"

    return {
        "run_id": run_id,
        "has_calibration": has_cal,
        "backend": run.backend,
        "num_qubits": num_qubits,
        "estimated_qv": qv,
        "log2_qv": result["log2_qv"],
        "grade": grade,
        "note": "Model-based estimate from calibration data. Not a measured QV result.",
        "fidelity_threshold": result["threshold"],
        "max_reliable_depth": result["best_d"],
        "sweep": result["sweep"][:12],
        "calibration_used": {
            "avg_gate_1q_error": round(ge_1q, 6),
            "avg_gate_2q_error": round(ge_2q, 6),
            "avg_t1_us": round(avg_t1, 2) if avg_t1 else None,
            "avg_t2_us": round(avg_t2, 2) if avg_t2 else None,
            "avg_readout_error": round(avg_ro, 4),
        },
    }
