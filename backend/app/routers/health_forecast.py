"""Predictive Hardware Health Oracle.

Uses linear regression on historical T1/T2/gate_error calibration data
to forecast hardware degradation 24/48/72 hours into the future.

No quantum platform today predicts hardware failure before it happens.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import HealthForecast, Run

router = APIRouter(prefix="/api/v1/health-forecast", tags=["health_forecast"])

_METRIC_KEYS = {
    "t1": "avg_t1_us",
    "t2": "avg_t2_us",
    "gate_error": "avg_gate_error",
    "readout_error": "avg_readout_error",
}

_RISK_THRESHOLDS = {
    "t1":           {"critical": 40, "high": 60, "medium": 80},
    "t2":           {"critical": 30, "high": 50, "medium": 70},
    "gate_error":   {"critical": 0.05, "high": 0.02, "medium": 0.01},
    "readout_error":{"critical": 0.10, "high": 0.05, "medium": 0.03},
}


def _linear_regression(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Returns (slope, intercept, r2)."""
    n = len(xs)
    if n < 2:
        return 0.0, ys[0] if ys else 0.0, 0.0
    xm = sum(xs) / n
    ym = sum(ys) / n
    ss_xy = sum((x - xm) * (y - ym) for x, y in zip(xs, ys))
    ss_xx = sum((x - xm) ** 2 for x in xs)
    if ss_xx == 0:
        return 0.0, ym, 0.0
    slope = ss_xy / ss_xx
    intercept = ym - slope * xm
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - ym) ** 2 for y in ys)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 1.0
    return slope, intercept, r2


def _risk_level(metric: str, forecast_value: Optional[float]) -> str:
    if forecast_value is None:
        return "unknown"
    thresholds = _RISK_THRESHOLDS.get(metric, {})
    low_is_bad = metric in ("t1", "t2")
    if low_is_bad:
        if forecast_value < thresholds.get("critical", 0):
            return "critical"
        if forecast_value < thresholds.get("high", 0):
            return "high"
        if forecast_value < thresholds.get("medium", 0):
            return "medium"
        return "low"
    else:
        if forecast_value > thresholds.get("critical", 999):
            return "critical"
        if forecast_value > thresholds.get("high", 999):
            return "high"
        if forecast_value > thresholds.get("medium", 999):
            return "medium"
        return "low"


def _build_forecast(db: Session, backend: str, metric: str, days: int) -> dict[str, Any]:
    cal_key = _METRIC_KEYS.get(metric)
    if not cal_key:
        raise HTTPException(422, f"Unknown metric '{metric}'")

    since = datetime.now(timezone.utc) - timedelta(days=days)
    runs = db.scalars(
        select(Run).where(Run.backend == backend, Run.calibration.isnot(None),
                          Run.created_at >= since).order_by(Run.created_at.asc())
    ).all()

    series = []
    ref_time = None
    for r in runs:
        val = (r.calibration or {}).get(cal_key)
        if val is None:
            continue
        if ref_time is None:
            ref_time = r.created_at
        hours = (r.created_at - ref_time).total_seconds() / 3600
        series.append({"hours_offset": round(hours, 2), "value": float(val),
                        "timestamp": r.created_at.isoformat()})

    if not series:
        return {"backend": backend, "metric": metric, "data_points": 0,
                "current_value": None, "forecast_24h": None, "forecast_48h": None,
                "forecast_72h": None, "trend_slope": None, "risk_level": "unknown",
                "series": [], "r2": None}

    xs = [s["hours_offset"] for s in series]
    ys = [s["value"] for s in series]
    slope, intercept, r2 = _linear_regression(xs, ys)
    current_x = xs[-1]
    current_val = ys[-1]

    def forecast(delta_h: float) -> float:
        return round(slope * (current_x + delta_h) + intercept, 4)

    f24 = forecast(24)
    f48 = forecast(48)
    f72 = forecast(72)
    risk = _risk_level(metric, f72)

    return {
        "backend": backend, "metric": metric, "data_points": len(series),
        "current_value": round(current_val, 4),
        "forecast_24h": f24, "forecast_48h": f48, "forecast_72h": f72,
        "trend_slope": round(slope, 6),
        "trend_direction": "improving" if (slope > 0 and metric in ("t1", "t2")) or (slope < 0 and metric not in ("t1", "t2")) else "degrading",
        "risk_level": risk, "r2": round(r2, 4), "series": series,
    }


class ForecastRequest(BaseModel):
    backend: str
    metrics: list[str] = Field(default=["t1", "t2", "gate_error"])
    days: int = Field(default=30, ge=1, le=365)


@router.post("")
def create_forecast(req: ForecastRequest, db: Session = Depends(get_db)):
    forecasts = []
    for metric in req.metrics:
        data = _build_forecast(db, req.backend, metric, req.days)
        forecast_id = f"hf-{uuid.uuid4().hex[:12]}"
        record = HealthForecast(
            forecast_id=forecast_id, backend=req.backend, metric=metric,
            current_value=data.get("current_value"),
            forecast_24h=data.get("forecast_24h"), forecast_48h=data.get("forecast_48h"),
            forecast_72h=data.get("forecast_72h"), trend_slope=data.get("trend_slope"),
            risk_level=data.get("risk_level", "unknown"),
            data_points=data.get("data_points", 0), series=data.get("series", []),
        )
        db.add(record)
        forecasts.append({"forecast_id": forecast_id, **data})
    db.commit()
    overall_risk = max((f["risk_level"] for f in forecasts if f["data_points"] > 0),
                       key=lambda r: ["unknown", "low", "medium", "high", "critical"].index(r) if r in ["unknown", "low", "medium", "high", "critical"] else 0,
                       default="unknown")
    return {"backend": req.backend, "overall_risk": overall_risk, "forecasts": forecasts}


@router.get("/{backend}")
def get_forecast(backend: str, metric: str = "t1", days: int = 30, db: Session = Depends(get_db)):
    return _build_forecast(db, backend, metric, days)


@router.get("")
def list_forecasts(limit: int = 30, db: Session = Depends(get_db)):
    rows = db.scalars(select(HealthForecast).order_by(HealthForecast.created_at.desc()).limit(limit)).all()
    return [{"forecast_id": r.forecast_id, "backend": r.backend, "metric": r.metric,
             "current_value": r.current_value, "forecast_72h": r.forecast_72h,
             "risk_level": r.risk_level, "data_points": r.data_points,
             "trend_slope": r.trend_slope, "created_at": r.created_at.isoformat()} for r in rows]
