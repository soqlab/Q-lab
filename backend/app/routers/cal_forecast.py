from __future__ import annotations
import uuid

import numpy as np
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from sqlalchemy import select

from ..calibration_history import calibration_metric
from ..database import get_db
from ..deps import Identity, require_auth
from ..ownership import mine, owned_by, owner_key, public_view
from ..models import Run
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/cal-forecast", tags=["cal-forecast"])

NS = "cal_forecasts"
MIN_POINTS = 5  # Fewer calibrations than this say nothing about a trend.

class ForecastPoint(BaseModel):
    timestamp: str; hours_ahead: float
    t1_predicted_us: float; t2_predicted_us: float | None
    gate_error_predicted: float | None; confidence_lower: float; confidence_upper: float
    alert_level: str

class CalForecast(BaseModel):
    forecast_id: str; backend: str; created_at: str
    forecast_horizon_hours: int; n_points: int
    current_t1_us: float; current_t2_us: float | None; current_gate_error: float | None
    forecasts: list[ForecastPoint]
    optimal_window_start: str; optimal_window_end: str
    worst_window_start: str; degradation_alert: bool
    recovery_expected: bool; recovery_eta_hours: float | None
    model_r2: float; training_points: int; recommendations: list[str]

class ForecastRequest(BaseModel):
    backend: str = "ibm_brisbane"; horizon_hours: int = 24
    n_historical_points: int = 50; alert_threshold_t1_us: float = 200.0; qubit: int = 0

def _fit(hours: list[float], values: list[float]) -> tuple[float, float, float, float]:
    """Straight-line fit: (slope, intercept, r2, residual standard deviation)."""
    slope, intercept = np.polyfit(hours, values, 1)
    residuals = np.array(values) - (slope * np.array(hours) + intercept)
    total = float(np.sum((np.array(values) - np.mean(values)) ** 2))
    r2 = 1 - float(np.sum(residuals ** 2)) / total if total > 0 else 0.0
    return float(slope), float(intercept), r2, float(np.std(residuals))


@router.post("/forecast", response_model=CalForecast)
def forecast(req: ForecastRequest, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    """Extrapolate from the calibration snapshots recorded with this user's own runs."""
    runs = db.scalars(
        select(Run).where(Run.backend == req.backend, Run.calibration.isnot(None))
        .order_by(Run.created_at.desc()).limit(req.n_historical_points)
    ).all()
    history = []
    for run in reversed(runs):
        t1 = calibration_metric(run.calibration, "avg_t1_us")
        if t1 is not None:
            history.append((run.created_at, t1, calibration_metric(run.calibration, "avg_t2_us"),
                            calibration_metric(run.calibration, "avg_gate_error")))
    if len(history) < MIN_POINTS or history[0][0] == history[-1][0]:
        raise HTTPException(422, f"Forecasting {req.backend} needs calibration from at least {MIN_POINTS} of "
                                 f"your runs at different times. Found {len(history)}.")

    start = history[0][0]
    hours = [(h[0] - start).total_seconds() / 3600 for h in history]
    latest_hour = hours[-1]
    t1_slope, t1_intercept, r2, spread = _fit(hours, [h[1] for h in history])
    t2_known = [(x, h[2]) for x, h in zip(hours, history) if h[2] is not None]
    t2_fit = _fit([x for x, _ in t2_known], [v for _, v in t2_known]) if len({x for x, _ in t2_known}) >= 2 else None
    gate_errors = [h[3] for h in history if h[3] is not None]
    gate_error = gate_errors[-1] if gate_errors else None

    now = datetime.now(timezone.utc)
    points = []
    for h in range(0, req.horizon_hours + 1, max(1, req.horizon_hours // 20)):
        at = latest_hour + h
        t1 = max(0.0, t1_slope * at + t1_intercept)
        t2 = max(0.0, t2_fit[0] * at + t2_fit[1]) if t2_fit else None
        alert = "critical" if t1 < req.alert_threshold_t1_us * 0.7 else "warning" if t1 < req.alert_threshold_t1_us else "ok"
        margin = spread * 2
        points.append(ForecastPoint(
            timestamp=(now + timedelta(hours=h)).isoformat(), hours_ahead=float(h), t1_predicted_us=round(t1, 2),
            t2_predicted_us=round(t2, 2) if t2 is not None else None, gate_error_predicted=gate_error,
            confidence_lower=round(max(0.0, t1 - margin), 2), confidence_upper=round(t1 + margin, 2), alert_level=alert))

    best = max(points, key=lambda p: p.t1_predicted_us)
    worst = min(points, key=lambda p: p.t1_predicted_us)
    degrading = t1_slope < 0 and points[-1].t1_predicted_us < points[0].t1_predicted_us * 0.9
    recs = [f"Trend from {len(history)} of your calibration snapshots: T1 changes {t1_slope:+.2f} us per hour (R² {r2:.2f})."]
    if r2 < 0.5:
        recs.append("The fit is weak: treat this as a rough guide, not a prediction.")
    if degrading:
        recs.append("T1 is falling. A straight-line trend can't foresee the next recalibration.")

    fid = str(uuid.uuid4())
    fc = CalForecast(
        forecast_id=fid, backend=req.backend, created_at=now.isoformat(), forecast_horizon_hours=req.horizon_hours,
        n_points=len(points), current_t1_us=round(history[-1][1], 2),
        current_t2_us=round(history[-1][2], 2) if history[-1][2] is not None else None,
        current_gate_error=gate_error, forecasts=points,
        optimal_window_start=best.timestamp,
        optimal_window_end=(datetime.fromisoformat(best.timestamp) + timedelta(hours=2)).isoformat(),
        worst_window_start=worst.timestamp, degradation_alert=degrading, recovery_expected=False,
        recovery_eta_hours=None, model_r2=round(r2, 4), training_points=len(history), recommendations=recs)
    store_put(db, NS, fid, {**fc.model_dump(), "owner": owner_key(identity)})
    return fc

# Before /{forecast_id}, which would otherwise take "backends" as an id.
@router.get("/backends")
def list_backends(db: Session = Depends(get_db)):
    """Backends this user has runs with calibration on."""
    names = db.scalars(select(Run.backend).where(Run.calibration.isnot(None), Run.backend.isnot(None)).distinct()).all()
    return {"backends": sorted(names)}

@router.get("/{forecast_id}", response_model=CalForecast)
def get_forecast(forecast_id: str, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    data = store_get(db, NS, forecast_id)
    if not owned_by(data, identity):
        raise HTTPException(404, "not found")
    return CalForecast(**data)
