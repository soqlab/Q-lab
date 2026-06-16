"""Decoherence Time Alert Engine.

Monitors T1, T2, gate_error, and readout_error from stored calibration data.
Compares against user-configured thresholds and fires notifications when breached.

Alert conditions:
  metric < threshold (e.g. T1 < 80 µs → alert)
  metric > threshold (e.g. gate_error > 0.01 → alert)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import DecoherenceAlert, Run

router = APIRouter(prefix="/api/v1/decoherence-alerts", tags=["decoherence_alerts"])


# ─────────────────────────────────────────────────────────────────────────────
# Metric extraction from calibration
# ─────────────────────────────────────────────────────────────────────────────

_METRIC_KEYS = {
    "t1": "avg_t1_us",
    "t2": "avg_t2_us",
    "gate_error": "avg_gate_error",
    "readout_error": "avg_readout_error",
}


def _latest_calibration_value(db: Session, backend: str, metric: str) -> Optional[float]:
    """Pull the latest metric value for a backend from stored run calibration."""
    key = _METRIC_KEYS.get(metric)
    if not key:
        return None
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend, Run.calibration.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(1)
    ).all()
    if not runs:
        return None
    cal = runs[0].calibration or {}
    v = cal.get(key)
    return float(v) if v is not None else None


def _check_alert(alert: DecoherenceAlert, value: Optional[float]) -> bool:
    """Returns True if the alert condition is met."""
    if value is None:
        return False
    if alert.condition == "below":
        return value < alert.threshold
    return value > alert.threshold


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class AlertCreate(BaseModel):
    backend: str
    metric: str = Field(..., description="t1 | t2 | gate_error | readout_error")
    threshold: float
    condition: str = Field(default="below", description="below | above")
    qubit: Optional[int] = None
    notification_channel_id: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Serializer
# ─────────────────────────────────────────────────────────────────────────────

def _to_dict(a: DecoherenceAlert) -> dict:
    return {
        "alert_id": a.alert_id,
        "backend": a.backend,
        "metric": a.metric,
        "qubit": a.qubit,
        "threshold": a.threshold,
        "condition": a.condition,
        "triggered": a.triggered,
        "last_value": a.last_value,
        "triggered_at": a.triggered_at.isoformat() if a.triggered_at else None,
        "last_checked_at": a.last_checked_at.isoformat() if a.last_checked_at else None,
        "notification_channel_id": a.notification_channel_id,
        "created_at": a.created_at.isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def create_alert(req: AlertCreate, db: Session = Depends(get_db)):
    if req.metric not in _METRIC_KEYS:
        raise HTTPException(422, f"Unknown metric '{req.metric}'. Use: {list(_METRIC_KEYS)}")
    if req.condition not in {"below", "above"}:
        raise HTTPException(422, "condition must be 'below' or 'above'")

    alert = DecoherenceAlert(
        alert_id=f"da-{uuid.uuid4().hex[:12]}",
        backend=req.backend,
        metric=req.metric,
        qubit=req.qubit,
        threshold=req.threshold,
        condition=req.condition,
        triggered=False,
        notification_channel_id=req.notification_channel_id,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return _to_dict(alert)


@router.get("")
def list_alerts(
    backend: Optional[str] = None,
    triggered: Optional[bool] = None,
    db: Session = Depends(get_db),
):
    q = select(DecoherenceAlert).order_by(DecoherenceAlert.created_at.desc())
    if backend:
        q = q.where(DecoherenceAlert.backend == backend)
    if triggered is not None:
        q = q.where(DecoherenceAlert.triggered == triggered)
    return [_to_dict(a) for a in db.scalars(q).all()]


@router.post("/check")
def check_all_alerts(db: Session = Depends(get_db)):
    """Check every active alert against the latest calibration data. Returns triggered list."""
    now = datetime.now(timezone.utc)
    alerts = db.scalars(select(DecoherenceAlert)).all()
    newly_triggered: list[dict] = []

    for alert in alerts:
        value = _latest_calibration_value(db, alert.backend, alert.metric)
        fired = _check_alert(alert, value)
        alert.last_value = value
        alert.last_checked_at = now
        if fired and not alert.triggered:
            alert.triggered = True
            alert.triggered_at = now
            newly_triggered.append({**_to_dict(alert), "current_value": value})
        elif not fired and alert.triggered:
            alert.triggered = False
            alert.triggered_at = None

    db.commit()
    return {"checked": len(alerts), "newly_triggered": len(newly_triggered), "alerts": newly_triggered}


@router.post("/{alert_id}/check")
def check_one_alert(alert_id: str, db: Session = Depends(get_db)):
    """Check a single alert against latest calibration."""
    alert = db.scalar(select(DecoherenceAlert).where(DecoherenceAlert.alert_id == alert_id))
    if alert is None:
        raise HTTPException(404, "Alert not found")
    value = _latest_calibration_value(db, alert.backend, alert.metric)
    fired = _check_alert(alert, value)
    now = datetime.now(timezone.utc)
    alert.last_value = value
    alert.last_checked_at = now
    if fired:
        alert.triggered = True
        if not alert.triggered_at:
            alert.triggered_at = now
    else:
        alert.triggered = False
    db.commit()
    return {
        **_to_dict(alert),
        "current_value": value,
        "fired": fired,
        "message": (f"{alert.metric} = {value:.4f} is {alert.condition} threshold {alert.threshold}" if value else "No calibration data"),
    }


@router.delete("/{alert_id}", status_code=204)
def delete_alert(alert_id: str, db: Session = Depends(get_db)):
    alert = db.scalar(select(DecoherenceAlert).where(DecoherenceAlert.alert_id == alert_id))
    if alert is None:
        raise HTTPException(404, "Alert not found")
    db.delete(alert)
    db.commit()


@router.get("/{alert_id}")
def get_alert(alert_id: str, db: Session = Depends(get_db)):
    a = db.scalar(select(DecoherenceAlert).where(DecoherenceAlert.alert_id == alert_id))
    if a is None:
        raise HTTPException(404, "Alert not found")
    return _to_dict(a)
