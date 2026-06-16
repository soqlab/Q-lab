"""Hardware Drift Alerting — mine calibration snapshots for T1/T2/gate-error trends.

For each backend that has run history with calibration JSON, this router:
  • Extracts a time-series per metric (t1_us, t2_us, gate_error_2q, readout_error)
  • Computes linear-regression trend slope
  • Compares baseline (first 30%) vs current (last 20%) values
  • Fires DriftAlert objects at info / warning / critical severity

Router prefix: /api/v1/hardware-drift
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/hardware-drift", tags=["hardware_drift"])

_METRICS = ["t1_us", "t2_us", "gate_error_2q", "readout_error"]

# For T1/T2 a decrease = degradation; for errors an increase = degradation
_HIGHER_IS_BETTER = {"t1_us": True, "t2_us": True, "gate_error_2q": False, "readout_error": False}


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class DriftAlert(BaseModel):
    alert_id: str
    backend: str
    qubit: Optional[int]        # None = whole backend
    metric: str
    baseline_value: float
    current_value: float
    change_pct: float
    direction: str              # "degraded" | "improved"
    severity: str               # "info" | "warning" | "critical"
    detected_at: str
    description: str


class DriftThreshold(BaseModel):
    threshold_id: str
    backend: str
    metric: str
    warning_pct: float
    critical_pct: float
    enabled: bool
    created_at: str


class DriftThresholdCreate(BaseModel):
    backend: str
    metric: str
    warning_pct: float = 15.0
    critical_pct: float = 30.0
    enabled: bool = True


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _extract_calibration_points(db: Session, backend: str, metric: str, limit: int = 100) -> list[dict]:
    """Extract chronological time-series of a calibration metric from run history."""
    rows = db.execute(
        select(Run)
        .where(Run.backend == backend)
        .where(Run.calibration != None)  # noqa: E711
        .order_by(Run.created_at.desc())
        .limit(limit)
    ).scalars().all()

    points = []
    for run in rows:
        cal = run.calibration or {}
        val = None
        if metric == "t1_us":
            val = cal.get("t1_us") or cal.get("t1") or cal.get("avg_t1_us")
        elif metric == "t2_us":
            val = cal.get("t2_us") or cal.get("t2") or cal.get("avg_t2_us")
        elif metric == "gate_error_2q":
            val = cal.get("gate_error_2q") or cal.get("cx_error") or cal.get("ecr_error") or cal.get("avg_gate_error_2q")
        elif metric == "readout_error":
            val = cal.get("readout_error") or cal.get("meas_error") or cal.get("avg_readout_error")

        if val is not None:
            try:
                points.append({"value": float(val), "timestamp": run.created_at.isoformat()})
            except (ValueError, TypeError):
                pass

    return list(reversed(points))  # chronological order


def _linear_regression_slope(points: list[dict]) -> float:
    """Return slope (change per point index) via least-squares."""
    n = len(points)
    if n < 2:
        return 0.0
    xs = list(range(n))
    ys = [p["value"] for p in points]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    num = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    den = sum((x - mean_x) ** 2 for x in xs)
    return num / den if den else 0.0


def _stats(values: list[float]) -> dict:
    if not values:
        return {"mean": 0.0, "std": 0.0, "min": 0.0, "max": 0.0}
    n = len(values)
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n
    return {
        "mean": round(mean, 6),
        "std": round(math.sqrt(variance), 6),
        "min": round(min(values), 6),
        "max": round(max(values), 6),
    }


def _detect_trend(points: list[dict]) -> str:
    if len(points) < 3:
        return "stable"
    slope = _linear_regression_slope(points)
    values = [p["value"] for p in points]
    mean = sum(values) / len(values)
    if mean == 0:
        return "stable"
    normalized = slope / mean
    # threshold: 1% change per point = meaningful trend
    if normalized > 0.01:
        return "degrading"
    if normalized < -0.01:
        return "improving"
    return "stable"


def _run_drift_detection(db: Session, backend: str) -> list[DriftAlert]:
    alerts: list[DriftAlert] = []
    now = datetime.now(timezone.utc).isoformat()

    for metric in _METRICS:
        points = _extract_calibration_points(db, backend, metric)
        if len(points) < 5:
            continue

        baseline_n = max(1, len(points) // 3)          # first 30%
        current_n = max(1, len(points) // 5)           # last 20%

        baseline_vals = [p["value"] for p in points[:baseline_n]]
        current_vals = [p["value"] for p in points[-current_n:]]

        baseline_value = sum(baseline_vals) / len(baseline_vals)
        current_value = sum(current_vals) / len(current_vals)

        if baseline_value == 0:
            continue

        change_pct = (current_value - baseline_value) / baseline_value * 100
        abs_change = abs(change_pct)

        higher_is_better = _HIGHER_IS_BETTER[metric]

        # Determine direction in terms of hardware quality
        if higher_is_better:
            direction = "degraded" if change_pct < 0 else "improved"
        else:
            direction = "degraded" if change_pct > 0 else "improved"

        # Severity thresholds
        if abs_change > 30:
            severity = "critical"
        elif abs_change > 15:
            severity = "warning"
        elif abs_change > 5:
            severity = "info"
        else:
            continue  # below noise floor

        metric_label = {
            "t1_us": "T1 coherence",
            "t2_us": "T2 coherence",
            "gate_error_2q": "2Q gate error",
            "readout_error": "readout error",
        }.get(metric, metric)

        arrow = "decreased" if change_pct < 0 else "increased"
        description = (
            f"{metric_label} has {arrow} by {abs_change:.1f}% "
            f"(baseline {baseline_value:.4f} -> current {current_value:.4f}). "
            f"Hardware quality: {direction}."
        )

        alerts.append(DriftAlert(
            alert_id=str(uuid.uuid4()),
            backend=backend,
            qubit=None,
            metric=metric,
            baseline_value=round(baseline_value, 6),
            current_value=round(current_value, 6),
            change_pct=round(change_pct, 2),
            direction=direction,
            severity=severity,
            detected_at=now,
            description=description,
        ))

    return alerts


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/timeseries/{backend}")
def get_timeseries(
    backend: str,
    metric: str = Query("t1_us", description="t1_us | t2_us | gate_error_2q | readout_error"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Return calibration time-series + stats + trend for a backend/metric pair."""
    if metric not in _METRICS:
        raise HTTPException(status_code=400, detail=f"metric must be one of {_METRICS}")

    points = _extract_calibration_points(db, backend, metric, limit=limit)
    values = [p["value"] for p in points]
    s = _stats(values)
    trend = _detect_trend(points)

    return {
        "backend": backend,
        "metric": metric,
        "points": points,
        "stats": {**s, "trend": trend},
    }


@router.get("/alerts/all")
def get_all_alerts(db: Session = Depends(get_db)):
    """Run drift detection across every backend that has calibration data."""
    rows = db.execute(
        select(Run.backend)
        .where(Run.calibration != None)  # noqa: E711
        .distinct()
    ).scalars().all()

    backends = [b for b in rows if b]
    by_backend: dict[str, list[dict]] = {}
    total_alerts = 0
    critical_count = 0

    for backend in backends:
        alerts = _run_drift_detection(db, backend)
        by_backend[backend] = [a.model_dump() for a in alerts]
        total_alerts += len(alerts)
        critical_count += sum(1 for a in alerts if a.severity == "critical")

    return {
        "by_backend": by_backend,
        "total_alerts": total_alerts,
        "critical_count": critical_count,
    }


@router.get("/alerts/{backend}")
def get_alerts(backend: str, db: Session = Depends(get_db)):
    """Run drift detection for a specific backend and return alerts."""
    alerts = _run_drift_detection(db, backend)
    return {"backend": backend, "alerts": [a.model_dump() for a in alerts]}


@router.post("/thresholds")
def create_threshold(payload: DriftThresholdCreate, db: Session = Depends(get_db)):
    """Create a custom drift alert threshold."""
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    data: dict = {
        "threshold_id": tid,
        "backend": payload.backend,
        "metric": payload.metric,
        "warning_pct": payload.warning_pct,
        "critical_pct": payload.critical_pct,
        "enabled": payload.enabled,
        "created_at": now,
    }
    store_put(db, "drift_thresholds", tid, data)
    return data


@router.get("/thresholds")
def list_thresholds(db: Session = Depends(get_db)):
    """List all custom drift thresholds."""
    return store_list(db, "drift_thresholds")


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    """One-line health summary per backend."""
    rows = db.execute(
        select(Run.backend)
        .where(Run.calibration != None)  # noqa: E711
        .distinct()
    ).scalars().all()

    backends = [b for b in rows if b]
    summaries = []

    for backend in backends:
        alerts = _run_drift_detection(db, backend)
        if not alerts:
            summaries.append({"backend": backend, "health": "good", "worst_metric": None, "change_pct": 0.0})
            continue

        # Worst = highest absolute change among degraded
        degraded = [a for a in alerts if a.direction == "degraded"]
        all_alerts = degraded if degraded else alerts
        worst = max(all_alerts, key=lambda a: abs(a.change_pct))

        critical_any = any(a.severity == "critical" for a in alerts)
        warning_any = any(a.severity == "warning" for a in alerts)
        health = "critical" if critical_any else "degrading" if warning_any else "good"

        summaries.append({
            "backend": backend,
            "health": health,
            "worst_metric": worst.metric,
            "change_pct": round(worst.change_pct, 2),
        })

    return {"backends": summaries}
