"""Outcome Predictor — ML-powered health score prediction before running.

Uses k-Nearest Neighbors regression trained on historical Q-Lab run data.
No external ML dependencies — pure Python stdlib + math.

Router prefix: /api/v1/predict
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/predict", tags=["outcome_predictor"])


# ---------------------------------------------------------------------------
# Pure-Python k-NN helpers
# ---------------------------------------------------------------------------

def _euclidean_distance(a: list, b: list) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def _normalize(features: list, min_vals: list, max_vals: list) -> list:
    result = []
    for v, lo, hi in zip(features, min_vals, max_vals):
        rng = hi - lo
        result.append((v - lo) / rng if rng > 0 else 0.0)
    return result


def _knn_predict(query_features: list, training_data: list, k: int = 5) -> float:
    """training_data: list of (feature_vector, target_value)"""
    if not training_data:
        return 50.0

    all_features = [x[0] for x in training_data]
    n_features = len(all_features[0])
    min_vals = [min(f[i] for f in all_features) for i in range(n_features)]
    max_vals = [max(f[i] for f in all_features) for i in range(n_features)]

    q_norm = _normalize(query_features, min_vals, max_vals)

    distances = []
    for features, target in training_data:
        f_norm = _normalize(features, min_vals, max_vals)
        d = _euclidean_distance(q_norm, f_norm)
        distances.append((d, target))

    distances.sort(key=lambda x: x[0])
    k_nearest = distances[:min(k, len(distances))]

    total_weight = 0.0
    weighted_sum = 0.0
    for d, target in k_nearest:
        w = 1.0 / (d + 1e-6)
        weighted_sum += w * target
        total_weight += w

    return weighted_sum / total_weight if total_weight > 0 else 50.0


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

def _extract_features(n_qubits: int, circuit_depth: int, n_shots: int,
                       t1_us: float, t2_us: float,
                       gate_error_2q: float, readout_error: float,
                       opt_level: int) -> list:
    """8-dimensional feature vector."""
    return [
        float(n_qubits),
        float(circuit_depth),
        math.log10(max(n_shots, 1)),
        float(t1_us or 100.0),
        float(t2_us or 80.0),
        float(gate_error_2q or 0.01),
        float(readout_error or 0.02),
        float(opt_level),
    ]


def _extract_run_features(run: Run):
    """Extract feature vector + health score from a historical Run.
    Returns (features, health_score) or None.
    """
    try:
        cal = run.calibration or {}
        exe = run.execution or {}
        trans = run.transpiler or {}
        results = run.results or {}

        n_qubits = run.n_qubits if hasattr(run, "n_qubits") and run.n_qubits else 0
        if not n_qubits:
            fp = run.fingerprint or {}
            n_qubits = fp.get("num_qubits") or fp.get("n_qubits") or 5

        circuit_depth = (
            (run.circuit_depth if hasattr(run, "circuit_depth") and run.circuit_depth else None)
            or trans.get("depth")
            or 10
        )
        n_shots = exe.get("shots") or 1024
        t1 = cal.get("t1_us") or cal.get("t1") or 100.0
        t2 = cal.get("t2_us") or cal.get("t2") or 80.0
        gate_err = cal.get("gate_error_2q") or cal.get("cx_error") or 0.01
        readout_err = cal.get("readout_error") or cal.get("meas_error") or 0.02
        opt_level = trans.get("optimization_level") or 2

        health = results.get("health_score")
        if health is None:
            health = getattr(run, "health_score", None)
        if health is None:
            return None

        features = _extract_features(
            n_qubits, circuit_depth, n_shots, t1, t2, gate_err, readout_err, opt_level
        )
        return features, float(health)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class PredictRequest(BaseModel):
    backend: str
    n_qubits: int = Field(..., ge=1, le=127)
    circuit_depth: int = Field(..., ge=1)
    n_shots: int = Field(1024, ge=1)
    t1_us: Optional[float] = None
    t2_us: Optional[float] = None
    gate_error_2q: Optional[float] = None
    readout_error: Optional[float] = None
    optimization_level: int = Field(2, ge=0, le=3)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/health-score")
def predict_health_score(req: PredictRequest, db: Session = Depends(get_db)):
    """Predict health score for a run before execution using k-NN on history."""
    # Fetch last 200 runs for this backend that have calibration data
    runs = db.scalars(
        select(Run)
        .where(Run.backend == req.backend)
        .order_by(Run.created_at.desc())
        .limit(200)
    ).all()

    # Build training data
    training_data = []
    run_lookup = []  # for similar_runs
    for run in runs:
        extracted = _extract_run_features(run)
        if extracted is not None:
            features, health = extracted
            training_data.append((features, health))
            run_lookup.append((run, features, health))

    n = len(training_data)

    if n < 5:
        return {
            "predicted_health": 50.0,
            "confidence": "low",
            "n_training_runs": n,
            "message": "Not enough history on this backend",
        }

    # Build query features with defaults for missing calibration params
    t1 = req.t1_us if req.t1_us is not None else 100.0
    t2 = req.t2_us if req.t2_us is not None else 80.0
    gate_err = req.gate_error_2q if req.gate_error_2q is not None else 0.01
    readout_err = req.readout_error if req.readout_error is not None else 0.02

    query_features = _extract_features(
        req.n_qubits, req.circuit_depth, req.n_shots,
        t1, t2, gate_err, readout_err, req.optimization_level
    )

    # Choose k
    k = 5 if n <= 25 else max(5, int(math.sqrt(n)))

    # Predict
    predicted = _knn_predict(query_features, training_data, k=k)
    predicted = max(0.0, min(100.0, predicted))

    # Confidence
    if n > 50:
        confidence = "high"
    elif n > 15:
        confidence = "medium"
    else:
        confidence = "low"

    # Find k nearest for std dev and similar_runs
    all_features = [x[0] for x in training_data]
    n_features = len(all_features[0])
    min_vals = [min(f[i] for f in all_features) for i in range(n_features)]
    max_vals = [max(f[i] for f in all_features) for i in range(n_features)]
    q_norm = _normalize(query_features, min_vals, max_vals)

    dist_with_run = []
    for run, feat, health in run_lookup:
        f_norm = _normalize(feat, min_vals, max_vals)
        d = _euclidean_distance(q_norm, f_norm)
        dist_with_run.append((d, run, health))

    dist_with_run.sort(key=lambda x: x[0])
    top_k = dist_with_run[:k]

    # Confidence interval from std dev of k-nearest health scores
    k_health = [h for _, _, h in top_k]
    mean_k = sum(k_health) / len(k_health)
    variance = sum((h - mean_k) ** 2 for h in k_health) / len(k_health)
    std_k = math.sqrt(variance)
    ci_low = max(0.0, round(predicted - std_k, 1))
    ci_high = min(100.0, round(predicted + std_k, 1))

    # Similar runs (top 3)
    similar_runs = []
    for d, run, health in dist_with_run[:3]:
        max_possible_d = math.sqrt(n_features)  # all features differ by 1 in normalized space
        similarity = round(max(0.0, 1.0 - d / (max_possible_d + 1e-6)), 3)
        similar_runs.append({
            "run_id": run.run_id,
            "circuit_name": run.circuit_name or "unknown",
            "health_score": round(health, 1),
            "similarity": similarity,
        })

    # Recommendation text
    p = predicted
    if p >= 80:
        recommendation = "Excellent conditions. Proceed with confidence."
    elif p >= 60:
        recommendation = "Good conditions. Proceed."
    elif p >= 40:
        recommendation = "Moderate conditions. Consider error mitigation strategies."
    else:
        recommendation = "Poor conditions. Consider waiting for better calibration or applying error mitigation."

    # Risk factors: compare input params vs backend average
    risk_factors = []
    if len(run_lookup) >= 3:
        cal_vals = [_extract_run_features(r) for r in runs[:20]]
        cal_vals = [x for x in cal_vals if x is not None]
        if cal_vals:
            # Average t1, t2, gate_err, readout_err from history
            # features are: [n_qubits, depth, log_shots, t1, t2, gate_err, readout_err, opt_level]
            avg_t1 = sum(f[0][3] for f in cal_vals) / len(cal_vals)
            avg_t2 = sum(f[0][4] for f in cal_vals) / len(cal_vals)
            avg_gate = sum(f[0][5] for f in cal_vals) / len(cal_vals)
            avg_ro = sum(f[0][6] for f in cal_vals) / len(cal_vals)

            if t1 < avg_t1 * 0.5 and avg_t1 > 0:
                risk_factors.append(f"Low T1 ({t1:.1f}µs) vs typical ({avg_t1:.1f}µs)")
            if t2 < avg_t2 * 0.5 and avg_t2 > 0:
                risk_factors.append(f"Low T2 ({t2:.1f}µs) vs typical ({avg_t2:.1f}µs)")
            if gate_err > avg_gate * 1.5 and avg_gate > 0:
                risk_factors.append(
                    f"High gate error ({gate_err:.4f}) vs typical ({avg_gate:.4f})"
                )
            if readout_err > avg_ro * 1.5 and avg_ro > 0:
                risk_factors.append(
                    f"High readout error ({readout_err:.4f}) vs typical ({avg_ro:.4f})"
                )

    return {
        "predicted_health": round(predicted, 1),
        "confidence": confidence,
        "confidence_interval": [ci_low, ci_high],
        "n_training_runs": n,
        "similar_runs": similar_runs,
        "recommendation": recommendation,
        "risk_factors": risk_factors,
    }


@router.get("/backends/readiness")
def backends_readiness(db: Session = Depends(get_db)):
    """Compute predicted health readiness score for all backends with enough history."""
    # Fetch last 500 runs grouped by backend
    runs = db.scalars(
        select(Run)
        .where(Run.backend.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(500)
    ).all()

    # Group by backend
    by_backend: dict[str, list] = {}
    for run in runs:
        if run.backend:
            by_backend.setdefault(run.backend, []).append(run)

    results = []
    for backend, backend_runs in by_backend.items():
        # Build training data
        training_data = []
        for run in backend_runs:
            ex = _extract_run_features(run)
            if ex is not None:
                training_data.append(ex)

        if len(training_data) < 5:
            continue

        # Use average calibration from last 3 runs as the query
        recent = backend_runs[:3]
        avg_t1 = 100.0
        avg_t2 = 80.0
        avg_gate = 0.01
        avg_ro = 0.02
        avg_qubits = 5
        avg_depth = 10

        vals_used = 0
        for r in recent:
            ex = _extract_run_features(r)
            if ex:
                f = ex[0]
                avg_qubits = f[0]
                avg_depth = f[1]
                avg_t1 += f[3]
                avg_t2 += f[4]
                avg_gate += f[5]
                avg_ro += f[6]
                vals_used += 1

        if vals_used > 0:
            avg_t1 /= vals_used
            avg_t2 /= vals_used
            avg_gate /= vals_used
            avg_ro /= vals_used

        query = _extract_features(
            int(avg_qubits), int(avg_depth), 1024,
            avg_t1, avg_t2, avg_gate, avg_ro, 2
        )

        n = len(training_data)
        k = 5 if n <= 25 else max(5, int(math.sqrt(n)))
        predicted = _knn_predict(query, training_data, k=k)
        predicted = max(0.0, min(100.0, predicted))

        confidence = "high" if n > 50 else "medium" if n > 15 else "low"

        # Compute trend (compare first half vs second half health)
        health_vals = [td[1] for td in training_data]
        mid = len(health_vals) // 2
        if mid > 0:
            recent_avg = sum(health_vals[:mid]) / mid
            older_avg = sum(health_vals[mid:]) / (len(health_vals) - mid)
            if recent_avg > older_avg + 3:
                trend = "improving"
            elif recent_avg < older_avg - 3:
                trend = "degrading"
            else:
                trend = "stable"
        else:
            trend = "stable"

        results.append({
            "backend": backend,
            "predicted_health": round(predicted, 1),
            "confidence": confidence,
            "trend": trend,
            "n_training_runs": n,
        })

    results.sort(key=lambda x: -x["predicted_health"])

    return {"backends": results}
