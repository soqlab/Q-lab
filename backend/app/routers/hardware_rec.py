"""Hardware Recommendation Engine.

Given a circuit fingerprint, scans recent calibration snapshots stored
across runs and ranks all known backends by their expected circuit fidelity.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["hardware_rec"])

_TWO_QUBIT_GATES = {"cx", "cz", "cy", "ecr", "rzx", "swap", "dcx", "ccx", "crz", "csx"}


class CircuitSpec(BaseModel):
    num_qubits: int = Field(..., ge=1, le=200)
    depth: int = Field(..., ge=1)
    size: int = Field(1, ge=1)
    two_qubit_gate_count: int = Field(0, ge=0)
    circuit_time_us: float = Field(1.0, ge=0.0)
    non_clifford_ratio: float = Field(0.0, ge=0.0, le=1.0)


def _safe(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _extract_cal_summary(cal: dict) -> dict:
    """Summarise a calibration dict into aggregate quality metrics."""
    ge_1q, ge_2q, t1, t2, ro = [], [], [], [], []

    for key, val in cal.items():
        if not isinstance(val, dict):
            continue
        if g := _safe(val.get("gate_error") or val.get("u3_error")):
            ge_1q.append(g)
        if g2 := _safe(val.get("cx_error") or val.get("ecr_error") or val.get("cz_error")):
            ge_2q.append(g2)
        if v := _safe(val.get("T1") or val.get("t1")):
            t1.append(v)
        if v := _safe(val.get("T2") or val.get("t2")):
            t2.append(v)
        if v := _safe(val.get("readout_error") or val.get("prob_meas1_prep0")):
            ro.append(v)

    def _avg(lst): return sum(lst) / len(lst) if lst else None
    def _min(lst): return min(lst) if lst else None

    return {
        "avg_ge_1q":  _avg(ge_1q),
        "avg_ge_2q":  _avg(ge_2q),
        "min_t1_us":  _min(t1),
        "avg_t1_us":  _avg(t1),
        "avg_t2_us":  _avg(t2),
        "avg_ro":     _avg(ro),
        "num_qubits_calibrated": len({k for k in cal if k.startswith("q") and k[1:].isdigit()}),
    }


def _score_backend(spec: CircuitSpec, cal_summary: dict, num_qubits_available: int) -> dict:
    """Compute a 0–100 fit score for a backend given a circuit spec."""
    score = 100.0
    reasons: list[str] = []
    warnings: list[str] = []

    # 1. Qubit count — hard requirement
    if num_qubits_available > 0 and num_qubits_available < spec.num_qubits:
        return {
            "score": 0,
            "grade": "F",
            "ineligible": True,
            "ineligible_reason": f"Only {num_qubits_available} qubits available, circuit needs {spec.num_qubits}",
            "reasons": [],
            "warnings": [],
        }

    # 2. 2Q gate fidelity — dominant error source
    avg_ge_2q = cal_summary.get("avg_ge_2q")
    if avg_ge_2q is not None and spec.two_qubit_gate_count > 0:
        gate_infidelity = 1 - (1 - avg_ge_2q) ** spec.two_qubit_gate_count
        penalty = min(50, gate_infidelity * 200)
        score -= penalty
        if gate_infidelity > 0.3:
            reasons.append(f"2Q gate infidelity {gate_infidelity*100:.1f}% over {spec.two_qubit_gate_count} 2Q gates")
        else:
            reasons.append(f"2Q gate fidelity: {(1-gate_infidelity)*100:.1f}% ({spec.two_qubit_gate_count} gates × {avg_ge_2q*100:.3f}%/gate)")

    # 3. Coherence (T1 check)
    avg_t1 = cal_summary.get("avg_t1_us")
    if avg_t1 is not None and spec.circuit_time_us > 0:
        coherence_frac = spec.circuit_time_us / avg_t1
        if coherence_frac > 0.5:
            penalty = min(30, (coherence_frac - 0.5) * 60)
            score -= penalty
            warnings.append(f"Circuit time {spec.circuit_time_us:.1f}µs is {coherence_frac*100:.0f}% of avg T1={avg_t1:.0f}µs")
        else:
            reasons.append(f"T1 headroom: {avg_t1:.0f}µs (circuit {spec.circuit_time_us:.1f}µs)")

    # 4. Readout error
    avg_ro = cal_summary.get("avg_ro")
    if avg_ro is not None:
        ro_infid = 1 - (1 - avg_ro) ** spec.num_qubits
        penalty = min(15, ro_infid * 60)
        score -= penalty
        if ro_infid > 0.1:
            warnings.append(f"Combined readout infidelity {ro_infid*100:.1f}% ({spec.num_qubits} qubits)")

    # 5. Non-Clifford penalty (T-gate noise model approximation)
    if spec.non_clifford_ratio > 0:
        avg_ge_1q = cal_summary.get("avg_ge_1q")
        if avg_ge_1q is not None:
            nc_gates = int(spec.size * spec.non_clifford_ratio)
            nc_infid = 1 - (1 - avg_ge_1q * 3) ** nc_gates
            penalty = min(10, nc_infid * 40)
            score -= penalty

    score = max(0.0, round(score, 1))
    grade = "A+" if score >= 90 else "A" if score >= 80 else "B+" if score >= 75 else "B" if score >= 65 else "C+" if score >= 55 else "C" if score >= 45 else "D" if score >= 30 else "F"

    return {
        "score": score,
        "grade": grade,
        "ineligible": False,
        "ineligible_reason": None,
        "reasons": reasons,
        "warnings": warnings,
    }


@router.post("/hardware/recommend")
def recommend_hardware(
    spec: CircuitSpec,
    days: int = Query(90, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Rank all backends that have recent calibration data by fit for the given circuit."""
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Get the most recent calibration snapshot per backend
    runs = db.scalars(
        select(Run)
        .where(Run.created_at >= since, Run.backend.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(2000)
    ).all()

    # Group: backend → most recent run with non-empty calibration
    best_cal: dict[str, dict] = {}
    best_cal_time: dict[str, datetime] = {}
    backend_total_runs: dict[str, int] = {}

    for run in runs:
        backend = run.backend
        if not backend:
            continue
        backend_total_runs[backend] = backend_total_runs.get(backend, 0) + 1
        if run.calibration and len(run.calibration) > 1:
            if backend not in best_cal or run.created_at > best_cal_time.get(backend, datetime.min.replace(tzinfo=timezone.utc)):
                best_cal[backend] = run.calibration
                dt = run.created_at
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                best_cal_time[backend] = dt

    if not best_cal:
        # Fall back to backends with any runs even without calibration
        for backend, total in backend_total_runs.items():
            if backend not in best_cal:
                best_cal[backend] = {}

    results = []
    for backend, cal in best_cal.items():
        cal_summary = _extract_cal_summary(cal)
        num_qubits_avail = cal_summary["num_qubits_calibrated"] or 0

        fit = _score_backend(spec, cal_summary, num_qubits_avail)
        cal_age_days = None
        if backend in best_cal_time:
            delta = datetime.now(timezone.utc) - best_cal_time[backend]
            cal_age_days = round(delta.total_seconds() / 86400, 1)

        results.append({
            "backend": backend,
            "score": fit["score"],
            "grade": fit["grade"],
            "ineligible": fit["ineligible"],
            "ineligible_reason": fit["ineligible_reason"],
            "reasons": fit["reasons"],
            "warnings": fit["warnings"],
            "calibration_summary": {k: round(v, 6) if isinstance(v, float) else v for k, v in cal_summary.items() if v is not None},
            "calibration_age_days": cal_age_days,
            "total_runs_on_backend": backend_total_runs.get(backend, 0),
            "has_calibration": bool(cal),
        })

    # Sort: eligible first by score desc, then ineligible
    results.sort(key=lambda r: (r["ineligible"], -r["score"]))

    return {
        "circuit_spec": spec.model_dump(),
        "backend_count": len(results),
        "eligible_count": sum(1 for r in results if not r["ineligible"]),
        "recommendation": results[0]["backend"] if results and not results[0]["ineligible"] else None,
        "backends": results,
    }


@router.get("/hardware/backends")
def list_backends(
    days: int = Query(90, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """List all backends seen in recent runs with calibration freshness."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    runs = db.scalars(
        select(Run).where(Run.created_at >= since, Run.backend.isnot(None)).order_by(Run.created_at.desc()).limit(3000)
    ).all()

    by_backend: dict[str, dict] = {}
    for run in runs:
        b = run.backend
        if not b:
            continue
        if b not in by_backend:
            cal_summary = _extract_cal_summary(run.calibration or {}) if run.calibration else {}
            dt = run.created_at
            if dt and dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            by_backend[b] = {
                "backend": b,
                "run_count": 0,
                "latest_run": dt.isoformat() if dt else None,
                "has_calibration": bool(run.calibration and len(run.calibration) > 1),
                "avg_ge_2q": cal_summary.get("avg_ge_2q"),
                "avg_t1_us": cal_summary.get("avg_t1_us"),
                "avg_ro": cal_summary.get("avg_ro"),
            }
        by_backend[b]["run_count"] += 1

    return {"backends": sorted(by_backend.values(), key=lambda x: -x["run_count"])}
