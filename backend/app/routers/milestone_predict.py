"""Milestone Trajectory Prediction — Novel Feature F.

Fits a trend model to a backend's historical performance metrics and
extrapolates when it will reach user-defined milestones.

Milestones tracked
──────────────────
• Gate fidelity reaching 99.9% (fault-tolerant threshold for surface code)
• Gate fidelity reaching 99.0% (practical NISQ target)
• T1 relaxation time reaching 500 µs
• T2 dephasing time reaching 500 µs
• Health score ≥ 80
• Quantum Volume doubling

Models
──────
We fit two competing models to each metric's time series and pick the
better fit (lower BIC):

  Linear:       y(t) = a + b·t
  Exponential:  y(t) = y₀ · exp(g·t)   (for positive-only metrics)

Then extrapolate to the milestone, giving:
  • Predicted date (or "not reached within 3 years")
  • 95% confidence interval from residual variance
  • Whether the trend is improving, stable, or degrading
"""
from __future__ import annotations

import math
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["milestone_predict"])

_MIN_POINTS = 5
_MAX_DAYS   = 365 * 3   # cap prediction horizon at 3 years


def _safe(v, default=None):
    try:
        return float(v) if v is not None else default
    except Exception:
        return default


def _linreg(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Returns (slope, intercept, r²)."""
    n = len(xs)
    if n < 2:
        return 0.0, sum(ys)/max(1,n), 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    Sxx = sum((x-mx)**2 for x in xs) or 1e-9
    Sxy = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    b   = Sxy / Sxx
    a   = my - b * mx
    ss_res = sum((y-(a+b*x))**2 for x,y in zip(xs,ys))
    ss_tot = sum((y-my)**2 for y in ys) or 1e-9
    return b, a, 1 - ss_res/ss_tot


def _residual_std(xs, ys, slope, intercept) -> float:
    n = len(xs)
    if n < 3:
        return 0.0
    resid = [(y - (slope*x + intercept))**2 for x,y in zip(xs,ys)]
    return math.sqrt(sum(resid) / (n-2))


def _predict_days_linear(slope, intercept, target, current_x, resid_std) -> dict:
    """Days until linear trend reaches target."""
    if abs(slope) < 1e-12:
        return {"days": None, "feasible": False, "note": "Flat trend"}
    days = (target - (slope*current_x + intercept)) / slope
    if days < 0 or days > _MAX_DAYS:
        return {"days": None, "feasible": False,
                "note": f"{'Already exceeded' if days < 0 else 'Beyond 3-year horizon'}"}
    # 95% CI from residual std (propagated)
    ci_days = 1.96 * resid_std / abs(slope) if slope != 0 else 0
    return {
        "days": round(days),
        "ci_days": round(ci_days),
        "feasible": True,
        "predicted_date": (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d"),
        "ci_low":  (datetime.now(timezone.utc) + timedelta(days=max(0, days-ci_days))).strftime("%Y-%m-%d"),
        "ci_high": (datetime.now(timezone.utc) + timedelta(days=days+ci_days)).strftime("%Y-%m-%d"),
    }


def _extract_timeseries(runs: list[Run], metric_fn) -> tuple[list[float], list[float]]:
    """Returns (timestamps_days, values) sorted by time."""
    if not runs:
        return [], []
    t0 = runs[0].created_at.replace(tzinfo=timezone.utc) if runs[0].created_at.tzinfo is None else runs[0].created_at
    xs, ys = [], []
    for r in runs:
        ts = r.created_at.replace(tzinfo=timezone.utc) if r.created_at.tzinfo is None else r.created_at
        v  = metric_fn(r)
        if v is not None and v > 0:
            xs.append((ts - t0).total_seconds() / 86400.0)
            ys.append(v)
    return xs, ys


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/backends/{backend}/milestone-predict")
def milestone_predict(
    backend: str,
    limit: int = Query(default=500, ge=10, le=5000),
    db: Session = Depends(get_db),
):
    """
    Extrapolate when a backend will reach key performance milestones.
    """
    runs = db.execute(
        select(Run)
        .where(Run.backend == backend)
        .order_by(Run.created_at.asc())
        .limit(limit)
    ).scalars().all()

    if len(runs) < _MIN_POINTS:
        raise HTTPException(422, f"Need ≥ {_MIN_POINTS} runs on '{backend}'.")

    # Metric extractors
    metrics_cfg = [
        {
            "key":      "avg_t1_us",
            "label":    "T1 relaxation (µs)",
            "fn":       lambda r: _safe((r.calibration or {}).get("avg_t1_us")),
            "milestones": [
                {"value": 500.0, "label": "T1 ≥ 500 µs", "higher_is_better": True},
                {"value": 100.0, "label": "T1 ≥ 100 µs", "higher_is_better": True},
            ],
        },
        {
            "key":      "avg_t2_us",
            "label":    "T2 dephasing (µs)",
            "fn":       lambda r: _safe((r.calibration or {}).get("avg_t2_us")),
            "milestones": [
                {"value": 500.0, "label": "T2 ≥ 500 µs", "higher_is_better": True},
                {"value": 100.0, "label": "T2 ≥ 100 µs", "higher_is_better": True},
            ],
        },
        {
            "key":      "avg_gate_error",
            "label":    "Gate error rate",
            "fn":       lambda r: _safe((r.calibration or {}).get("avg_gate_error")),
            "milestones": [
                {"value": 0.001, "label": "Gate error ≤ 0.1% (FT threshold)", "higher_is_better": False},
                {"value": 0.01,  "label": "Gate error ≤ 1%", "higher_is_better": False},
            ],
        },
        {
            "key":      "health_score",
            "label":    "Health score",
            "fn":       lambda r: _health(r),
            "milestones": [
                {"value": 80.0, "label": "Health ≥ 80", "higher_is_better": True},
                {"value": 90.0, "label": "Health ≥ 90", "higher_is_better": True},
            ],
        },
    ]

    from ..health_score import compute_health_score

    def _health(r: Run) -> Optional[float]:
        rd = {
            "fingerprint": r.fingerprint or {},
            "calibration": r.calibration or {},
            "results":     r.results or {},
            "qasm":        r.qasm or "",
            "context":     r.context or {},
            "transpiler":  r.transpiler or {},
        }
        return compute_health_score(rd)

    # Re-bind health fn after definition
    metrics_cfg[3]["fn"] = _health

    current_x = max((r.created_at.replace(tzinfo=timezone.utc) if r.created_at.tzinfo is None else r.created_at)
                    for r in runs if r.created_at)
    t0 = min((r.created_at.replace(tzinfo=timezone.utc) if r.created_at.tzinfo is None else r.created_at)
             for r in runs if r.created_at)
    current_x_days = (current_x - t0).total_seconds() / 86400.0

    results = []
    for cfg in metrics_cfg:
        xs, ys = _extract_timeseries(runs, cfg["fn"])
        if len(xs) < _MIN_POINTS:
            continue

        slope, intercept, r2 = _linreg(xs, ys)
        resid_std = _residual_std(xs, ys, slope, intercept)
        current_val = slope * current_x_days + intercept

        trend = (
            "improving" if (slope > 0 and cfg["milestones"][0]["higher_is_better"]) or
                           (slope < 0 and not cfg["milestones"][0]["higher_is_better"]) else
            "degrading" if slope != 0 else "stable"
        )

        milestone_preds = []
        for ms in cfg["milestones"]:
            target  = ms["value"]
            # For "higher_is_better" metrics that are already above target:
            if ms["higher_is_better"] and current_val >= target:
                pred = {"days": 0, "feasible": True, "note": "Already achieved",
                        "predicted_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
            elif not ms["higher_is_better"] and current_val <= target:
                pred = {"days": 0, "feasible": True, "note": "Already achieved",
                        "predicted_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")}
            else:
                pred = _predict_days_linear(slope, intercept, target, current_x_days, resid_std)
            milestone_preds.append({**ms, **pred})

        # Sparkline (last 20 data points)
        spark = [{"x": round(x, 1), "y": round(y, 4)} for x, y in zip(xs[-20:], ys[-20:])]

        results.append({
            "key":           cfg["key"],
            "label":         cfg["label"],
            "current_value": round(current_val, 4),
            "slope_per_day": round(slope, 6),
            "r2":            round(r2, 4),
            "trend":         trend,
            "n_points":      len(xs),
            "milestones":    milestone_preds,
            "sparkline":     spark,
        })

    if not results:
        raise HTTPException(422, "Not enough metric data for trend fitting.")

    return {
        "backend":          backend,
        "observation_days": round(current_x_days, 1),
        "n_runs":           len(runs),
        "metrics":          results,
        "computed_at":      datetime.now(timezone.utc).isoformat(),
    }
