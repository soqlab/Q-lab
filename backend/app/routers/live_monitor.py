from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import uuid, random, math

from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/live-monitor", tags=["live-monitor"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_SUBSCRIPTIONS = "monitor_subscriptions"

_BACKEND_PROFILES: dict = {
    "ibm_brisbane": {
        "t1_base": 185.0, "t2_base": 120.0,
        "readout_error_base": 0.012, "cx_error_base": 0.008,
        "queue_base": 42, "provider": "ibm",
    },
    "ibm_kyoto": {
        "t1_base": 210.0, "t2_base": 145.0,
        "readout_error_base": 0.009, "cx_error_base": 0.006,
        "queue_base": 71, "provider": "ibm",
    },
    "ionq_aria_1": {
        "t1_base": 10_000.0, "t2_base": 1_000.0,
        "readout_error_base": 0.004, "cx_error_base": 0.003,
        "queue_base": 8, "provider": "ionq",
    },
    "rigetti_ankaa_2": {
        "t1_base": 22.0, "t2_base": 18.0,
        "readout_error_base": 0.028, "cx_error_base": 0.018,
        "queue_base": 15, "provider": "rigetti",
    },
    "quantinuum_h2": {
        "t1_base": 3_600.0, "t2_base": 2_400.0,
        "readout_error_base": 0.002, "cx_error_base": 0.001,
        "queue_base": 6, "provider": "quantinuum",
    },
}


_SIM_NOTE = "Live values are simulated — connect provider credentials in Settings for real data"


class BackendStatus(BaseModel):
    backend: str
    operational: bool
    queue_depth: int
    avg_wait_min: float
    t1_us: float
    t2_us: float
    readout_error: float
    cx_error: float
    last_calibrated: str
    alert_level: str
    data_source: str = "simulated"
    note: str = _SIM_NOTE


class QueueSnapshot(BaseModel):
    backend: str
    snapshot_id: str
    queue_depth: int
    estimated_wait_min: float
    jobs_running: int
    jobs_pending: int
    peak_today: int
    taken_at: str
    data_source: str = "simulated"
    note: str = _SIM_NOTE


class CalibrationDrift(BaseModel):
    backend: str
    qubit: int
    metric: str
    value: float
    baseline: float
    drift_pct: float
    timestamp: str
    alert: bool
    data_source: str = "simulated"


class AlertSubscription(BaseModel):
    sub_id: str
    backend: str
    threshold_t1_us: Optional[float] = None
    threshold_cx_error: Optional[float] = None
    email: Optional[str] = None
    created_at: str


class WatchRequest(BaseModel):
    backend: str
    threshold_t1_us: Optional[float] = None
    threshold_cx_error: Optional[float] = None
    email: Optional[str] = None


def _jitter(base: float, pct: float = 0.08) -> float:
    return base * (1 + random.uniform(-pct, pct))


def _alert_level(profile: dict, t1: float, cx_error: float) -> str:
    t1_ratio = t1 / profile["t1_base"]
    cx_ratio = cx_error / profile["cx_error_base"]
    if t1_ratio < 0.7 or cx_ratio > 2.0:
        return "critical"
    if t1_ratio < 0.85 or cx_ratio > 1.4:
        return "warning"
    return "ok"


@router.get("/status", response_model=List[BackendStatus])
def get_status() -> List[BackendStatus]:
    results = []
    now = datetime.now(timezone.utc)
    for backend, profile in _BACKEND_PROFILES.items():
        t1 = round(_jitter(profile["t1_base"], 0.1), 2)
        t2 = round(_jitter(profile["t2_base"], 0.12), 2)
        readout_error = round(_jitter(profile["readout_error_base"], 0.15), 6)
        cx_error = round(_jitter(profile["cx_error_base"], 0.15), 6)
        queue_depth = max(0, int(_jitter(profile["queue_base"], 0.3)))
        avg_wait = round(queue_depth * random.uniform(0.8, 2.5), 1)
        calibrated_ago = timedelta(hours=random.uniform(0.5, 6))
        last_cal = (now - calibrated_ago).isoformat()
        operational = random.random() > 0.04
        alert = _alert_level(profile, t1, cx_error)

        results.append(BackendStatus(
            backend=backend,
            operational=operational,
            queue_depth=queue_depth,
            avg_wait_min=avg_wait,
            t1_us=t1,
            t2_us=t2,
            readout_error=readout_error,
            cx_error=cx_error,
            last_calibrated=last_cal,
            alert_level=alert,
        ))
    return results


@router.get("/queue/{backend}", response_model=QueueSnapshot)
def get_queue(backend: str) -> QueueSnapshot:
    if backend not in _BACKEND_PROFILES:
        raise HTTPException(status_code=404, detail=f"Unknown backend: {backend}")
    profile = _BACKEND_PROFILES[backend]
    queue_depth = max(0, int(_jitter(profile["queue_base"], 0.35)))
    jobs_running = min(queue_depth, random.randint(1, 5))
    jobs_pending = queue_depth - jobs_running
    estimated_wait = round(queue_depth * random.uniform(1.0, 3.0), 1)
    peak_today = queue_depth + random.randint(10, 60)

    return QueueSnapshot(
        backend=backend,
        snapshot_id=str(uuid.uuid4()),
        queue_depth=queue_depth,
        estimated_wait_min=estimated_wait,
        jobs_running=jobs_running,
        jobs_pending=jobs_pending,
        peak_today=peak_today,
        taken_at=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/history/{backend}", response_model=List[CalibrationDrift])
def get_history(backend: str) -> List[CalibrationDrift]:
    if backend not in _BACKEND_PROFILES:
        raise HTTPException(status_code=404, detail=f"Unknown backend: {backend}")
    profile = _BACKEND_PROFILES[backend]
    metrics_cfg = {
        "t1": profile["t1_base"],
        "t2": profile["t2_base"],
        "readout_error": profile["readout_error_base"],
        "cx_error": profile["cx_error_base"],
    }
    now = datetime.now(timezone.utc)
    events: List[CalibrationDrift] = []
    n_qubits_sim = 27 if "ibm" in backend else (11 if "rigetti" in backend else 32)
    n_events = random.randint(18, 40)

    for _ in range(n_events):
        metric = random.choice(list(metrics_cfg.keys()))
        baseline = metrics_cfg[metric]
        drift_factor = random.uniform(-0.25, 0.35)
        value = round(baseline * (1 + drift_factor), 6)
        drift_pct = round(drift_factor * 100, 2)
        hours_ago = random.uniform(0, 48)
        ts = (now - timedelta(hours=hours_ago)).isoformat()
        qubit = random.randint(0, n_qubits_sim - 1)
        alert = abs(drift_pct) > 15

        events.append(CalibrationDrift(
            backend=backend,
            qubit=qubit,
            metric=metric,
            value=value,
            baseline=round(baseline, 6),
            drift_pct=drift_pct,
            timestamp=ts,
            alert=alert,
        ))

    events.sort(key=lambda e: e.timestamp, reverse=True)
    return events


@router.post("/watch", response_model=AlertSubscription)
def watch(req: WatchRequest, db: Session = Depends(get_db)) -> AlertSubscription:
    if req.backend not in _BACKEND_PROFILES:
        raise HTTPException(status_code=404, detail=f"Unknown backend: {req.backend}")
    sub_id = str(uuid.uuid4())
    sub = AlertSubscription(
        sub_id=sub_id,
        backend=req.backend,
        threshold_t1_us=req.threshold_t1_us,
        threshold_cx_error=req.threshold_cx_error,
        email=req.email,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_SUBSCRIPTIONS, sub_id, sub.model_dump())
    return sub
