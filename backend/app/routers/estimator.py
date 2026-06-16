"""Pre-flight resource estimator for a quantum circuit.

Given a run's fingerprint + calibration data, computes:
  - Predicted gate/readout fidelity
  - Shot count recommendations
  - Estimated QPU wall-clock time
  - Warnings (low fidelity, missing calibration, high two-qubit count)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Optional

from ..database import get_db
from ..models import Run

router = APIRouter(tags=["estimator"])

# Gate names that contribute to decoherence more than Clifford gates
_ROTATION_GATES = {
    "rx", "ry", "rz", "u", "u1", "u2", "u3", "t", "tdg", "p", "r",
    "crx", "cry", "crz", "cu", "cu1", "cu3",
}
_TWO_QUBIT_GATES = {
    "cx", "cz", "cy", "ecr", "rzx", "swap", "dcx", "ccx",
    "cswap", "iswap", "cs", "csx", "cp",
}

# Rough typical gate times in nanoseconds (varies hugely by backend)
_GATE_TIME_NS = {
    "single": 50,   # single-qubit gates ~50 ns
    "two": 300,     # two-qubit gates ~300 ns
    "measure": 3000,  # measurement ~3 µs per qubit
}


def _find_run(db: Session, run_id: str) -> Run:
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


@router.get("/api/v1/runs/{run_id}/estimate")
def estimate_run(run_id: str, db: Session = Depends(get_db)):
    run = _find_run(db, run_id)
    fp = run.fingerprint or {}
    cal = run.calibration or {}
    gate_counts: dict = fp.get("gate_counts") or {}

    num_qubits: int = int(fp.get("num_qubits") or 0)
    depth: int = int(fp.get("depth") or 0)
    gate_count: int = int(fp.get("size") or 0)
    nc_ratio: Optional[float] = fp.get("non_clifford_ratio")

    # Count gate categories
    t_gate_count = sum(v for k, v in gate_counts.items() if k.lower() in _ROTATION_GATES)
    two_qubit_count = sum(v for k, v in gate_counts.items() if k.lower() in _TWO_QUBIT_GATES)
    single_qubit_count = gate_count - two_qubit_count

    # ---------------------------------------------------------------
    # Fidelity estimate
    # ---------------------------------------------------------------
    gate_errors: dict = cal.get("gate_errors") or {}
    readout_errors: dict = cal.get("readout_errors") or {}

    gate_fidelity: Optional[float] = None
    readout_fidelity: Optional[float] = None
    bottleneck_gate: Optional[str] = None

    if gate_errors:
        avg_ge = sum(gate_errors.values()) / len(gate_errors)
        # Approximate: F_gate = (1 - avg_err)^N_gates  (assuming independent errors)
        gate_fidelity = max(0.0, (1.0 - avg_ge) ** gate_count) if gate_count > 0 else 1.0
        bottleneck_gate = max(gate_errors, key=lambda k: gate_errors[k])

    if readout_errors:
        avg_re = sum(readout_errors.values()) / len(readout_errors)
        readout_fidelity = max(0.0, (1.0 - avg_re) ** num_qubits) if num_qubits > 0 else 1.0

    combined_fidelity: Optional[float] = None
    dominant_error: Optional[str] = None

    if gate_fidelity is not None and readout_fidelity is not None:
        combined_fidelity = gate_fidelity * readout_fidelity
        ge_contribution = 1.0 - gate_fidelity
        re_contribution = 1.0 - readout_fidelity
        dominant_error = "gate_errors" if ge_contribution >= re_contribution else "readout_errors"
    elif gate_fidelity is not None:
        combined_fidelity = gate_fidelity
        dominant_error = "gate_errors"
    elif readout_fidelity is not None:
        combined_fidelity = readout_fidelity
        dominant_error = "readout_errors"

    fidelity_section = None
    if gate_fidelity is not None or readout_fidelity is not None:
        fidelity_section = {
            "gate_fidelity": round(gate_fidelity, 5) if gate_fidelity is not None else None,
            "readout_fidelity": round(readout_fidelity, 5) if readout_fidelity is not None else None,
            "combined_fidelity": round(combined_fidelity, 5) if combined_fidelity is not None else None,
            "dominant_error_source": dominant_error,
            "bottleneck_gate": bottleneck_gate,
        }

    # ---------------------------------------------------------------
    # Shot recommendations
    # For estimating a probability p with absolute precision ε at 68% CI:
    #   N = p(1-p) / ε²
    # We use p = combined_fidelity (or 0.5 pessimistically)
    # ---------------------------------------------------------------
    shots_section = None
    if combined_fidelity is not None:
        p = max(0.01, min(0.99, combined_fidelity))
        variance = p * (1.0 - p)
        shots_section = {
            "for_1pct_precision": max(100, int(variance / 0.0001)),
            "for_0_5pct_precision": max(100, int(variance / 0.000025)),
            "for_0_1pct_precision": max(100, int(variance / 0.000001)),
            "note": "Shots needed to estimate success probability within stated absolute precision (68% confidence)",
        }

    # ---------------------------------------------------------------
    # Timing estimate
    # ---------------------------------------------------------------
    timing_section = None
    if gate_count > 0 or num_qubits > 0:
        est_ns = (
            single_qubit_count * _GATE_TIME_NS["single"]
            + two_qubit_count * _GATE_TIME_NS["two"]
            + num_qubits * _GATE_TIME_NS["measure"]
        )
        timing_section = {
            "estimated_circuit_time_us": round(est_ns / 1000, 1),
            "two_qubit_gate_count": two_qubit_count,
            "single_qubit_gate_count": single_qubit_count,
            "note": "Rough estimate. Actual QPU time depends on scheduling, queue, and hardware-specific gate times.",
        }

    # ---------------------------------------------------------------
    # Warnings
    # ---------------------------------------------------------------
    warnings: list[str] = []
    if num_qubits > 0 and len(readout_errors) > 0 and len(readout_errors) < num_qubits:
        warnings.append(f"Partial readout calibration: {len(readout_errors)}/{num_qubits} qubits covered")
    if gate_count > 0 and not gate_errors:
        warnings.append("No gate calibration data — gate fidelity estimate unavailable")
    if combined_fidelity is not None and combined_fidelity < 0.5:
        warnings.append("Predicted fidelity < 50% — consider reducing circuit depth or applying error mitigation")
    if two_qubit_count > 20:
        warnings.append(f"High two-qubit gate count ({two_qubit_count}) — significant decoherence risk on NISQ hardware")
    if depth > 100:
        warnings.append(f"Deep circuit (depth {depth}) — T1/T2 decoherence may dominate over gate errors")
    if t_gate_count > 0 and gate_count > 0:
        t_pct = round(t_gate_count / gate_count * 100, 1)
        if t_pct > 40:
            warnings.append(f"High rotation gate fraction ({t_pct}%) — consider gate synthesis optimisation")

    return {
        "run_id": run_id,
        "backend": run.backend,
        "has_calibration": bool(cal),
        "circuit": {
            "num_qubits": num_qubits,
            "depth": depth,
            "gate_count": gate_count,
            "two_qubit_gate_count": two_qubit_count,
            "single_qubit_gate_count": single_qubit_count,
            "rotation_gate_count": t_gate_count,
            "non_clifford_ratio": round(nc_ratio, 4) if nc_ratio is not None else None,
        },
        "fidelity_estimate": fidelity_section,
        "shots_recommendation": shots_section,
        "timing_estimate": timing_section,
        "warnings": warnings,
    }


@router.get("/api/v1/backends/{backend_name}/drift")
def backend_calibration_drift(backend_name: str, db: Session = Depends(get_db)):
    """Return time-series of calibration metrics for a backend across all runs."""
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend_name)
        .order_by(Run.created_at.asc())
        .limit(500)
    ).all()

    runs_with_cal = [r for r in runs if r.calibration and (
        r.calibration.get("t1_us") or r.calibration.get("t2_us")
        or r.calibration.get("gate_errors") or r.calibration.get("readout_errors")
    )]

    series: dict[str, list] = {
        "avg_t1_us": [],
        "avg_t2_us": [],
        "avg_gate_error": [],
        "avg_readout_error": [],
    }

    for run in runs_with_cal:
        cal = run.calibration
        ts = run.created_at.isoformat()
        rid = run.run_id

        t1 = cal.get("t1_us") or {}
        if t1:
            vals = [v for v in t1.values() if isinstance(v, (int, float))]
            if vals:
                series["avg_t1_us"].append({"t": ts, "v": round(sum(vals) / len(vals), 2), "run_id": rid})

        t2 = cal.get("t2_us") or {}
        if t2:
            vals = [v for v in t2.values() if isinstance(v, (int, float))]
            if vals:
                series["avg_t2_us"].append({"t": ts, "v": round(sum(vals) / len(vals), 2), "run_id": rid})

        ge = cal.get("gate_errors") or {}
        if ge:
            vals = [v for v in ge.values() if isinstance(v, (int, float))]
            if vals:
                series["avg_gate_error"].append({"t": ts, "v": round(sum(vals) / len(vals), 6), "run_id": rid})

        re = cal.get("readout_errors") or {}
        if re:
            vals = [v for v in re.values() if isinstance(v, (int, float))]
            if vals:
                series["avg_readout_error"].append({"t": ts, "v": round(sum(vals) / len(vals), 6), "run_id": rid})

    # Compute trend (linear regression slope per series)
    def _slope(pts: list) -> Optional[float]:
        if len(pts) < 3:
            return None
        n = len(pts)
        xs = list(range(n))
        ys = [p["v"] for p in pts]
        mx = sum(xs) / n
        my = sum(ys) / n
        num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
        den = sum((x - mx) ** 2 for x in xs)
        if den == 0:
            return None
        return num / den

    trends = {k: _slope(v) for k, v in series.items()}

    # Warnings from drift trends
    warnings: list[str] = []
    if trends.get("avg_t1_us") is not None and trends["avg_t1_us"] < -0.5:
        warnings.append("T1 coherence time declining — hardware may be approaching re-calibration")
    if trends.get("avg_t2_us") is not None and trends["avg_t2_us"] < -0.5:
        warnings.append("T2 coherence time declining — potential environmental interference")
    if trends.get("avg_gate_error") is not None and trends["avg_gate_error"] > 0.0001:
        warnings.append("Gate error rate increasing — hardware degradation detected")
    if trends.get("avg_readout_error") is not None and trends["avg_readout_error"] > 0.0001:
        warnings.append("Readout error rate increasing — consider recalibration")

    # Latest snapshot values
    latest: dict[str, Optional[float]] = {}
    for k, pts in series.items():
        latest[k] = pts[-1]["v"] if pts else None

    return {
        "backend": backend_name,
        "total_runs": len(runs),
        "runs_with_calibration": len(runs_with_cal),
        "series": {k: v for k, v in series.items() if v},
        "trends": {k: round(v, 8) for k, v in trends.items() if v is not None},
        "latest": latest,
        "warnings": warnings,
    }
