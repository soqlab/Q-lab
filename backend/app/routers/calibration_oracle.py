from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/calibration-oracle", tags=["calibration-oracle"])

_rng = random.Random(0)

BACKENDS: dict = {
    "ibm_brisbane": {"n_qubits": 127, "provider": "ibm_quantum", "location": "US-East", "processor": "Eagle r3", "basis_gates": ["ecr","id","rz","sx","x"]},
    "ibm_kyoto": {"n_qubits": 127, "provider": "ibm_quantum", "location": "Japan", "processor": "Eagle r3", "basis_gates": ["ecr","id","rz","sx","x"]},
    "ibm_osaka": {"n_qubits": 127, "provider": "ibm_quantum", "location": "Japan", "processor": "Eagle r3", "basis_gates": ["ecr","id","rz","sx","x"]},
    "ibm_sherbrooke": {"n_qubits": 127, "provider": "ibm_quantum", "location": "US-East", "processor": "Eagle r3", "basis_gates": ["ecr","id","rz","sx","x"]},
    "ionq_aria_1": {"n_qubits": 25, "provider": "ionq", "location": "US-East", "processor": "Aria 1", "basis_gates": ["ms","gpi","gpi2"]},
    "rigetti_ankaa_2": {"n_qubits": 84, "provider": "rigetti", "location": "US-West", "processor": "Ankaa-2", "basis_gates": ["rx","ry","rz","cz"]},
}

NS_CALIBRATIONS = "oracle_calibrations"
NS_WATCHES = "oracle_watches"
NS_ALERTS = "oracle_alerts"


class QubitCalibration(BaseModel):
    qubit_id: int
    t1_us: float
    t2_us: float
    single_q_error: float
    readout_error: float
    frequency_ghz: float

class BackendCalibration(BaseModel):
    cal_id: str
    backend: str
    timestamp: str
    n_qubits: int
    median_t1_us: float
    median_t2_us: float
    median_1q_error: float
    median_2q_error: float
    median_readout_error: float
    min_t1_us: float
    max_t1_us: float
    qv: int
    clops: int
    qubits: list[QubitCalibration]
    health_score: float
    trend: str
    firmware_version: str

class CalibrationAlert(BaseModel):
    alert_id: str
    backend: str
    metric: str
    threshold: float
    current_value: float
    previous_value: float
    direction: str
    severity: str
    triggered_at: str
    watch_id: str

class WatchRequest(BaseModel):
    backend: str
    metric: str = "median_2q_error"
    threshold_pct_change: float = 5.0
    alert_on: str = "degradation"

def _gen_calibration(backend: str, seed_offset: int, history: list[dict]) -> dict:
    rng2 = random.Random(hash(backend) + seed_offset)
    n_q = BACKENDS[backend]["n_qubits"]
    t1_base = {"ibm": 280.0, "ionq": 10000.0, "rigetti": 28.0}.get(backend.split("_")[0], 100.0)
    t2_base = t1_base * 0.7
    q2_base = {"ibm": 0.0015, "ionq": 0.0003, "rigetti": 0.006}.get(backend.split("_")[0], 0.003)
    qubits = []
    for i in range(min(n_q, 20)):
        qubits.append(QubitCalibration(
            qubit_id=i,
            t1_us=round(t1_base * rng2.uniform(0.6, 1.4) * (1 + seed_offset * 0.001), 1),
            t2_us=round(t2_base * rng2.uniform(0.5, 1.3) * (1 + seed_offset * 0.001), 1),
            single_q_error=round(rng2.uniform(0.0001, 0.001), 6),
            readout_error=round(rng2.uniform(0.001, 0.02), 6),
            frequency_ghz=round(rng2.uniform(4.5, 5.5), 6),
        ))
    t1s = [q.t1_us for q in qubits]
    t2s = [q.t2_us for q in qubits]
    readouts = [q.readout_error for q in qubits]
    med_2q = q2_base * rng2.uniform(0.8, 1.2) * (1 + seed_offset * 0.002)
    health = max(0.0, min(100.0, 100.0 - med_2q * 5000 - sum(readouts) / len(readouts) * 1000))
    trend = "stable"
    if history:
        prev_2q = history[-1]["median_2q_error"]
        if med_2q > prev_2q * 1.05:
            trend = "degrading"
        elif med_2q < prev_2q * 0.95:
            trend = "improving"
    cal = BackendCalibration(
        cal_id=str(uuid.uuid4()), backend=backend,
        timestamp=datetime.now(timezone.utc).isoformat(),
        n_qubits=n_q,
        median_t1_us=round(sum(t1s)/len(t1s), 1),
        median_t2_us=round(sum(t2s)/len(t2s), 1),
        median_1q_error=round(sum(q.single_q_error for q in qubits)/len(qubits), 6),
        median_2q_error=round(med_2q, 6),
        median_readout_error=round(sum(readouts)/len(readouts), 6),
        min_t1_us=round(min(t1s), 1), max_t1_us=round(max(t1s), 1),
        qv=2**min(7, int(math.log2(n_q))),
        clops=rng2.randint(1000, 5000),
        qubits=qubits, health_score=round(health, 1),
        trend=trend, firmware_version=f"1.{rng2.randint(3,5)}.{rng2.randint(0,50)}",
    )
    return cal.model_dump()

def _seed_calibrations(db: Session):
    for b in BACKENDS:
        ns = f"{NS_CALIBRATIONS}_{b}"
        from ..store import store_count
        if store_count(db, ns) == 0:
            history = []
            for i in range(5):
                cal = _gen_calibration(b, i, history)
                store_put(db, ns, cal["cal_id"], cal)
                history.append(cal)


def _check_alerts(db: Session, backend: str, cal: dict):
    watches = store_list(db, NS_WATCHES)
    for w in watches:
        if w["backend"] != backend:
            continue
        metric = w["metric"]
        val = cal.get(metric)
        if val is None:
            continue
        history = store_list(db, f"{NS_CALIBRATIONS}_{backend}")
        if len(history) < 2:
            continue
        prev = history[-2].get(metric, val)
        pct_change = abs(val - prev) / max(abs(prev), 1e-10) * 100
        if pct_change >= w["threshold_pct_change"]:
            direction = "increased" if val > prev else "decreased"
            if (w["alert_on"] == "degradation" and metric.endswith("error") and direction == "increased") or \
               (w["alert_on"] == "degradation" and "t1" in metric and direction == "decreased") or \
               w["alert_on"] == "any":
                severity = "critical" if pct_change > 20 else "warning"
                alert = CalibrationAlert(
                    alert_id=str(uuid.uuid4()), backend=backend,
                    metric=metric, threshold=w["threshold_pct_change"],
                    current_value=val, previous_value=prev,
                    direction=direction, severity=severity,
                    triggered_at=datetime.now(timezone.utc).isoformat(),
                    watch_id=w["watch_id"],
                ).model_dump()
                store_put(db, NS_ALERTS, alert["alert_id"], alert)


@router.get("/{backend}", response_model=BackendCalibration)
def get_calibration(backend: str, db: Session = Depends(get_db)):
    if backend not in BACKENDS:
        from fastapi import HTTPException
        raise HTTPException(404, f"Backend {backend} not found")
    _seed_calibrations(db)
    ns = f"{NS_CALIBRATIONS}_{backend}"
    history = store_list(db, ns)
    if len(history) > 100:
        history = history[-100:]
    cal = _gen_calibration(backend, len(history), history)
    store_put(db, ns, cal["cal_id"], cal)
    _check_alerts(db, backend, cal)
    return BackendCalibration(**cal)

@router.get("/{backend}/history")
def get_history(backend: str, n: int = 20, db: Session = Depends(get_db)):
    _seed_calibrations(db)
    history = store_list(db, f"{NS_CALIBRATIONS}_{backend}")[-n:]
    return {"backend": backend, "history": history,
            "metrics": {
                "t1_trend": [h["median_t1_us"] for h in history],
                "t2_trend": [h["median_t2_us"] for h in history],
                "two_q_trend": [h["median_2q_error"] for h in history],
                "health_trend": [h["health_score"] for h in history],
            }}

@router.post("/watch")
def create_watch(req: WatchRequest, db: Session = Depends(get_db)):
    wid = str(uuid.uuid4())
    watch_data = {"watch_id": wid, **req.model_dump()}
    store_put(db, NS_WATCHES, wid, watch_data)
    return watch_data

@router.get("/alerts/all")
def get_alerts(n: int = 50, db: Session = Depends(get_db)):
    alerts = store_list(db, NS_ALERTS)[-n:]
    return {"alerts": alerts, "total": len(store_list(db, NS_ALERTS))}

@router.get("/")
def list_backends():
    return {"backends": [{"backend": b, **{k: v[k] for k in ["n_qubits","provider","location","processor"]}} for b, v in BACKENDS.items()]}
