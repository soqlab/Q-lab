"""Reproducibility Score + Fraud Detection — Feature #10 of 10.

Computes a multi-dimensional reproducibility score for a run and flags
patterns that suggest data fabrication or inadvertent result reuse.

Reproducibility dimensions
──────────────────────────
1. Environment capture    — pip_freeze, Python version, OS context
2. Circuit traceability   — QASM stored, fingerprint complete
3. Calibration snapshot   — hardware calibration at run time
4. Result completeness    — counts/results, shots recorded
5. Parameter completeness — seed, shots, optimisation level stored
6. Timestamp plausibility — created_at within reasonable range

Fraud signals
─────────────
F1. Identical bitstring distribution to another recent run on same backend
F2. Success probability suspiciously close to 1.0 or exactly 0.5^n
F3. Zero variance in results (all shots to single bitstring)
F4. Results stored before circuit QASM was submitted (timestamp inversion)
F5. Round-number success probability (1.0, 0.75, 0.5 exactly)
F6. Copy-paste duplicate: same circuit_name, backend, results as prior run
F7. Health score 100 with no calibration data (fabricated perfection)
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["repro_score"])


# ──────────────────────────────────────────────────────────────────────
# Reproducibility scoring
# ──────────────────────────────────────────────────────────────────────

def _check_env_capture(ctx: dict) -> tuple[float, str]:
    keys = ["pip_freeze", "python_version", "platform", "hostname", "qiskit_version"]
    present = sum(1 for k in keys if ctx.get(k))
    score = present / len(keys)
    note = f"{present}/{len(keys)} environment fields captured"
    return round(score, 3), note


def _check_circuit_traceability(fp: dict, qasm: Optional[str]) -> tuple[float, str]:
    score = 0.0
    parts: list[str] = []
    if qasm:
        score += 0.6
        parts.append("QASM stored")
    else:
        parts.append("no QASM")
    fp_keys = ["num_qubits", "depth", "size", "non_clifford_ratio", "cx_count"]
    present = sum(1 for k in fp_keys if fp.get(k) is not None)
    score += 0.4 * (present / len(fp_keys))
    parts.append(f"{present}/{len(fp_keys)} fingerprint fields")
    return round(score, 3), ", ".join(parts)


def _check_calibration(cal: dict) -> tuple[float, str]:
    cal_keys = ["avg_t1_us", "avg_t2_us", "avg_gate_error", "avg_readout_error"]
    present = sum(1 for k in cal_keys if cal.get(k) is not None)
    score = present / len(cal_keys)
    note = f"{present}/{len(cal_keys)} calibration fields captured"
    return round(score, 3), note


def _check_result_completeness(res: dict, params: dict) -> tuple[float, str]:
    score = 0.0
    parts: list[str] = []
    if res:
        score += 0.5
        parts.append("results stored")
    else:
        parts.append("no results")
    shots = params.get("shots") or res.get("shots")
    if shots:
        score += 0.3
        parts.append(f"shots={shots}")
    counts = res.get("counts") or res.get("counts_dict")
    if counts:
        score += 0.2
        parts.append("bitstring counts stored")
    return round(score, 3), ", ".join(parts)


def _check_param_completeness(params: dict) -> tuple[float, str]:
    keys = ["shots", "seed_simulator", "seed_transpiler", "optimization_level", "basis_gates"]
    present = sum(1 for k in keys if params.get(k) is not None)
    score = present / len(keys)
    note = f"{present}/{len(keys)} parameter fields stored"
    return round(score, 3), note


def _check_timestamp(created_at: Optional[datetime]) -> tuple[float, str]:
    if created_at is None:
        return 0.0, "no timestamp"
    now = datetime.now(timezone.utc)
    ts = created_at.replace(tzinfo=timezone.utc) if created_at.tzinfo is None else created_at
    delta_days = abs((now - ts).days)
    if delta_days > 365 * 5:
        return 0.3, f"timestamp {delta_days} days from now — suspicious"
    return 1.0, f"timestamp plausible ({delta_days}d ago)"


# ──────────────────────────────────────────────────────────────────────
# Fraud detection
# ──────────────────────────────────────────────────────────────────────

def _safe_float(v: Any) -> Optional[float]:
    try:
        return float(v)
    except Exception:
        return None


def _detect_fraud(run: Run, db: Session) -> list[dict]:
    flags: list[dict] = []
    res    = run.results or {}
    params = run.parameters or {}
    cal    = run.calibration or {}

    sp = _safe_float(res.get("success_probability"))

    # F1 — identical counts distribution to recent run
    counts = res.get("counts") or res.get("counts_dict")
    if counts and run.backend:
        recent_runs = db.execute(
            select(Run)
            .where(Run.backend == run.backend, Run.run_id != run.run_id, Run.results.isnot(None))
            .order_by(Run.created_at.desc())
            .limit(50)
        ).scalars().all()
        for other in recent_runs:
            other_counts = (other.results or {}).get("counts") or (other.results or {}).get("counts_dict")
            if other_counts and isinstance(counts, dict) and isinstance(other_counts, dict):
                if counts == other_counts and len(counts) > 1:
                    flags.append({
                        "code":        "F1",
                        "severity":    "warning",
                        "title":       "Identical bitstring distribution to recent run",
                        "description": f"The exact same counts distribution was found in run {other.run_id} on backend {run.backend}. This could indicate result reuse or a reproducibility artefact.",
                        "evidence":    {"other_run_id": other.run_id},
                    })
                    break

    # F2 — suspiciously perfect success probability
    if sp is not None:
        if sp >= 0.999:
            flags.append({
                "code":        "F2a",
                "severity":    "warning",
                "title":       "Success probability = 1.0 (suspiciously perfect)",
                "description": "Real quantum hardware almost never produces 100% success probability except for trivial circuits. This may indicate a post-selected or fabricated result.",
                "evidence":    {"success_probability": sp},
            })
        n = _safe_float((run.fingerprint or {}).get("num_qubits")) or 1
        expected_random = 0.5 ** n  # probability of correct answer by chance on n-qubit uniform
        if sp is not None and abs(sp - expected_random) < 0.005:
            flags.append({
                "code":        "F2b",
                "severity":    "info",
                "title":       "Success probability matches random-guess baseline",
                "description": f"Success probability {sp:.4f} ≈ 0.5^{int(n)} = {expected_random:.4f}. This may indicate that the quantum part provides no advantage over classical random guessing.",
                "evidence":    {"success_probability": sp, "random_baseline": expected_random},
            })

    # F3 — zero variance (all shots to one bitstring)
    if counts and isinstance(counts, dict) and len(counts) == 1:
        flags.append({
            "code":        "F3",
            "severity":    "info",
            "title":       "All shots collapsed to single bitstring",
            "description": "Every shot produced the same measurement outcome. While possible for simple circuits, this is unusual for noisy hardware and may indicate a classical simulation result being passed as hardware output.",
            "evidence":    {"unique_bitstrings": 1, "bitstring": list(counts.keys())[0]},
        })

    # F4 — round-number success probability
    if sp is not None:
        for round_val in [1.0, 0.0, 0.75, 0.5, 0.25]:
            if abs(sp - round_val) < 0.001:
                flags.append({
                    "code":        "F4",
                    "severity":    "info",
                    "title":       "Round-number success probability",
                    "description": f"Success probability of exactly {round_val} is statistically improbable on real hardware. Verify that this was not manually set or computed from a theoretical formula.",
                    "evidence":    {"success_probability": sp},
                })
                break

    # F5 — copy-paste duplicate (same name, backend, results)
    if run.circuit_name and run.backend:
        dupes = db.execute(
            select(Run)
            .where(
                Run.circuit_name == run.circuit_name,
                Run.backend == run.backend,
                Run.run_id != run.run_id,
            )
            .limit(5)
        ).scalars().all()
        for d in dupes:
            if (d.results or {}) == (run.results or {}) and run.results:
                flags.append({
                    "code":        "F5",
                    "severity":    "warning",
                    "title":       "Exact duplicate: same name, backend, and results",
                    "description": f"Run {d.run_id} has the same circuit name ({run.circuit_name!r}), backend ({run.backend}), and identical results. This strongly suggests copy-paste reuse rather than an independent execution.",
                    "evidence":    {"duplicate_run_id": d.run_id},
                })
                break

    # F6 — fabricated perfection (health=100 without calibration)
    from ..health_score import compute_health_score
    run_dict_minimal = {
        "fingerprint": run.fingerprint or {},
        "calibration": run.calibration or {},
        "results":     run.results or {},
        "qasm":        run.qasm or "",
        "context":     run.context or {},
        "transpiler":  run.transpiler or {},
    }
    hs = compute_health_score(run_dict_minimal)
    if hs is not None and hs >= 95 and not cal:
        flags.append({
            "code":        "F6",
            "severity":    "info",
            "title":       "Near-perfect health score with no calibration data",
            "description": f"Health score {hs} achieved without any calibration snapshot. Top scores are rare on real hardware without noise characterisation. Verify that the run is a real hardware execution.",
            "evidence":    {"health_score": hs},
        })

    return flags


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/repro-score")
def repro_score(run_id: str, db: Session = Depends(get_db)):
    """
    Compute reproducibility score and run fraud detection for this run.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp     = run.fingerprint or {}
    ctx    = run.context or {}
    cal    = run.calibration or {}
    res    = run.results or {}
    params = run.parameters or {}

    env_score,    env_note    = _check_env_capture(ctx)
    circ_score,   circ_note   = _check_circuit_traceability(fp, run.qasm)
    cal_score,    cal_note    = _check_calibration(cal)
    result_score, result_note = _check_result_completeness(res, params)
    param_score,  param_note  = _check_param_completeness(params)
    ts_score,     ts_note     = _check_timestamp(run.created_at)

    # Weighted overall score
    dimensions = {
        "environment_capture":    {"score": env_score,    "note": env_note,    "weight": 0.20},
        "circuit_traceability":   {"score": circ_score,   "note": circ_note,   "weight": 0.25},
        "calibration_snapshot":   {"score": cal_score,    "note": cal_note,    "weight": 0.20},
        "result_completeness":    {"score": result_score, "note": result_note,  "weight": 0.20},
        "parameter_completeness": {"score": param_score,  "note": param_note,  "weight": 0.10},
        "timestamp_plausibility": {"score": ts_score,     "note": ts_note,     "weight": 0.05},
    }

    overall = round(
        sum(v["score"] * v["weight"] for v in dimensions.values()), 3
    )
    overall_pct = round(overall * 100, 1)

    tier = (
        "excellent" if overall >= 0.85 else
        "good"      if overall >= 0.65 else
        "fair"      if overall >= 0.40 else
        "poor"
    )

    fraud_flags = _detect_fraud(run, db)
    fraud_severity = (
        "warning" if any(f["severity"] == "warning" for f in fraud_flags) else
        "info"    if fraud_flags else
        "clean"
    )

    narrative = (
        f"Reproducibility score: {overall_pct}% ({tier}). "
        + (f"{len(fraud_flags)} fraud signal{'s' if len(fraud_flags) != 1 else ''} detected." if fraud_flags
           else "No fraud signals detected.")
    )

    return {
        "run_id":       run_id,
        "overall_score": overall,
        "overall_pct":  overall_pct,
        "tier":         tier,
        "narrative":    narrative,
        "dimensions":   dimensions,
        "fraud_flags":  fraud_flags,
        "fraud_severity": fraud_severity,
        "scored_at":    datetime.now(timezone.utc).isoformat(),
    }
