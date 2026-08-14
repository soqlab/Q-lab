from __future__ import annotations
import json
import math
import random
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/calibration-oracle", tags=["calibration-oracle"])

IBM_RUNTIME_BASE = "https://api.quantum-computing.ibm.com/runtime"

_rng = random.Random(0)

# Rigetti backend name → QCS processor ID (e.g. rigetti_ankaa_2 → Ankaa-2)
def _rigetti_processor_id(backend: str) -> str:
    tail = backend[len("rigetti_"):]          # e.g. "ankaa_2"
    return "-".join(p.capitalize() for p in tail.split("_"))  # → "Ankaa-2"


# ─────────────────────────────────────────────────────────────────────────────
# Real IBM Quantum calibration fetcher
# ─────────────────────────────────────────────────────────────────────────────

def _ibm_prop(qubit_props: list, name: str) -> Optional[float]:
    for p in qubit_props:
        if p.get("name") == name:
            val = p.get("value")
            return float(val) if val is not None else None
    return None


def _fetch_ibm_calibration(backend: str, token: str) -> Optional[dict]:
    """Call IBM Quantum API for live backend calibration data.

    Returns a dict matching BackendCalibration shape, or None on any failure.
    """
    try:
        req = urllib.request.Request(
            f"{IBM_RUNTIME_BASE}/backends/{backend}/properties",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return None

    qubits_raw = data.get("qubits", [])
    gates_raw = data.get("gates", [])

    qubit_cals: list[dict] = []
    t1s, t2s, readouts, one_q_errors, two_q_errors = [], [], [], [], []

    for i, q_props in enumerate(qubits_raw[:20]):
        t1 = _ibm_prop(q_props, "T1") or 100.0
        t2 = _ibm_prop(q_props, "T2") or 60.0
        freq = _ibm_prop(q_props, "frequency") or 5.0
        ro_err = _ibm_prop(q_props, "readout_error") or 0.01
        t1s.append(t1)
        t2s.append(t2)
        readouts.append(ro_err)
        qubit_cals.append({
            "qubit_id": i,
            "t1_us": round(t1, 1),
            "t2_us": round(t2, 1),
            "single_q_error": 0.001,  # populated from gate data below
            "readout_error": round(ro_err, 6),
            "frequency_ghz": round(freq, 6),
        })

    for g in gates_raw:
        gate_name = g.get("gate", "")
        qubits = g.get("qubits", [])
        params = g.get("parameters", [])
        err_val = next((p.get("value") for p in params if p.get("name") == "gate_error"), None)
        if err_val is None:
            continue
        if gate_name in ("sx", "x", "id") and len(qubits) == 1:
            q_idx = qubits[0]
            if q_idx < len(qubit_cals):
                qubit_cals[q_idx]["single_q_error"] = round(float(err_val), 6)
                one_q_errors.append(float(err_val))
        elif gate_name in ("ecr", "cx", "cz") and len(qubits) == 2:
            two_q_errors.append(float(err_val))

    n_q = len(qubits_raw)
    med_t1 = round(sum(t1s) / len(t1s), 1) if t1s else 100.0
    med_t2 = round(sum(t2s) / len(t2s), 1) if t2s else 60.0
    med_ro = round(sum(readouts) / len(readouts), 6) if readouts else 0.01
    med_1q = round(sum(one_q_errors) / len(one_q_errors), 6) if one_q_errors else 0.001
    med_2q = round(sum(two_q_errors) / len(two_q_errors), 6) if two_q_errors else 0.005
    health = max(0.0, min(100.0, 100.0 - med_2q * 5000 - med_ro * 1000))

    return {
        "cal_id": str(uuid.uuid4()),
        "backend": backend,
        "timestamp": data.get("last_update_date") or datetime.now(timezone.utc).isoformat(),
        "n_qubits": n_q,
        "median_t1_us": med_t1,
        "median_t2_us": med_t2,
        "median_1q_error": med_1q,
        "median_2q_error": med_2q,
        "median_readout_error": med_ro,
        "min_t1_us": round(min(t1s), 1) if t1s else 0.0,
        "max_t1_us": round(max(t1s), 1) if t1s else 0.0,
        "qv": 2 ** min(7, int(math.log2(max(n_q, 1)))),
        "clops": 2000,
        "qubits": qubit_cals,
        "health_score": round(health, 1),
        "trend": "stable",
        "firmware_version": "ibm_api",
        "data_source": "ibm_api",
    }


# ─────────────────────────────────────────────────────────────────────────────
# IonQ calibration fetcher
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_ionq_calibration(backend: str, token: str) -> Optional[dict]:
    """Fetch real calibration data from IonQ Cloud API.

    IonQ uses hyphenated backend names (ionq_aria-1); our DB uses underscores
    (ionq_aria_1). We try a few name variants.
    """
    # Build candidate names: ionq_aria_1 → ionq_aria-1, aria-1, etc.
    tail = backend[len("ionq_"):]  # e.g. "aria_1"
    hyphen_tail = tail.replace("_", "-")  # e.g. "aria-1"
    candidates = [backend, f"ionq_{hyphen_tail}", hyphen_tail, tail]

    data = None
    for name in dict.fromkeys(candidates):  # preserves order, removes dupes
        try:
            req = urllib.request.Request(
                f"https://api.ionq.co/v0.3/backends/{name}",
                headers={"Authorization": f"apiKey {token}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            break
        except Exception:
            continue

    if not data:
        return None

    n_q = int(data.get("qubits") or 25)
    fidelity = data.get("fidelity") or {}
    timing = data.get("timing") or {}

    one_q_fid  = ((fidelity.get("1q") or {}).get("mean")) or 0.999
    two_q_fid  = ((fidelity.get("2q") or {}).get("mean")) or 0.996
    spam_fid   = ((fidelity.get("spam") or {}).get("mean")) or 0.997

    one_q_err  = round(1.0 - float(one_q_fid), 6)
    two_q_err  = round(1.0 - float(two_q_fid), 6)
    readout_err = round(1.0 - float(spam_fid), 6)
    t1 = float(timing.get("t1") or 10000.0)  # already in microseconds
    t2 = float(timing.get("t2") or 1000.0)

    qubit_cals = [
        {
            "qubit_id": i,
            "t1_us": round(t1, 1),
            "t2_us": round(t2, 1),
            "single_q_error": one_q_err,
            "readout_error": readout_err,
            "frequency_ghz": 0.0,  # IonQ trapped-ion: no microwave frequency
        }
        for i in range(min(n_q, 20))
    ]

    health = max(0.0, min(100.0, 100.0 - two_q_err * 5000 - readout_err * 1000))

    return {
        "cal_id": str(uuid.uuid4()),
        "backend": backend,
        "timestamp": data.get("last_updated") or datetime.now(timezone.utc).isoformat(),
        "n_qubits": n_q,
        "median_t1_us": round(t1, 1),
        "median_t2_us": round(t2, 1),
        "median_1q_error": one_q_err,
        "median_2q_error": two_q_err,
        "median_readout_error": readout_err,
        "min_t1_us": round(t1 * 0.9, 1),
        "max_t1_us": round(t1 * 1.1, 1),
        "qv": 0,  # IonQ uses #AQ metric, not QV
        "clops": 500,
        "qubits": qubit_cals,
        "health_score": round(health, 1),
        "trend": "stable",
        "firmware_version": "ionq_api",
        "data_source": "ionq_api",
    }

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

# ─────────────────────────────────────────────────────────────────────────────
# Rigetti QCS calibration fetcher
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_rigetti_calibration(backend: str, token: str) -> Optional[dict]:
    """Fetch real Rigetti calibration from the QCS REST API.

    Endpoint: GET /v1/quantum-processors/{id}/specifications
    Auth: Authorization: Bearer {api_key}
    T1/T2 values are in seconds; we convert to microseconds.
    """
    proc_id = _rigetti_processor_id(backend)

    data = None
    # Try specifications endpoint first, fall back to processor details
    for path in [
        f"/v1/quantum-processors/{proc_id}/specifications",
        f"/v1/quantum-processors/{proc_id.lower()}/specifications",
        f"/v1/quantum-processors/{proc_id}",
    ]:
        try:
            req = urllib.request.Request(
                f"https://api.qcs.rigetti.com{path}",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            break
        except Exception:
            continue

    if not data:
        return None

    # Rigetti response shape varies by version — normalise here
    # Newer QCS: {"qubitSpecs": {"0": {T1, T2, fRO, f1QRB}}, "gateSpecs": {...}}
    # Older QCS: {"specs": {"1Q": {"0": {T1, T2, ...}}, "2Q": {...}}}
    qubit_specs: dict = (
        data.get("qubitSpecs")
        or (data.get("specs") or {}).get("1Q")
        or {}
    )
    gate_specs: dict = (
        data.get("gateSpecs")
        or (data.get("specs") or {}).get("2Q")
        or {}
    )

    qubit_cals: list = []
    t1s, t2s, readouts, one_q_errors, two_q_errors = [], [], [], [], []

    for qubit_str, qspec in qubit_specs.items():
        if not isinstance(qspec, dict):
            continue
        try:
            qubit_idx = int(qubit_str)
        except ValueError:
            continue

        t1 = float(qspec.get("T1") or 50e-6) * 1e6   # s → µs
        t2 = float(qspec.get("T2") or 30e-6) * 1e6
        fro = float(qspec.get("fRO") or qspec.get("fActiveReset") or 0.93)
        f1q = float(qspec.get("f1QRB") or qspec.get("f1Q") or 0.998)

        ro_err = round(1.0 - fro, 6)
        q1_err = round(1.0 - f1q, 6)

        t1s.append(t1); t2s.append(t2)
        readouts.append(ro_err); one_q_errors.append(q1_err)

        if len(qubit_cals) < 20:
            qubit_cals.append({
                "qubit_id": qubit_idx,
                "t1_us": round(t1, 1),
                "t2_us": round(t2, 1),
                "single_q_error": q1_err,
                "readout_error": ro_err,
                "frequency_ghz": 0.0,
            })

    # Parse 2Q gate errors — gate_specs is dict of pair → gate → fidelity
    for pair_val in gate_specs.values():
        if isinstance(pair_val, dict):
            for k, v in pair_val.items():
                if k.lower().startswith("f") and isinstance(v, (int, float)):
                    two_q_errors.append(round(1.0 - float(v), 6))
                    break

    if not qubit_cals:
        return None

    n_q = len(qubit_specs)
    med_t1  = round(sum(t1s) / len(t1s), 1) if t1s else 28.0
    med_t2  = round(sum(t2s) / len(t2s), 1) if t2s else 18.0
    med_ro  = round(sum(readouts) / len(readouts), 6) if readouts else 0.05
    med_1q  = round(sum(one_q_errors) / len(one_q_errors), 6) if one_q_errors else 0.002
    med_2q  = round(sum(two_q_errors) / len(two_q_errors), 6) if two_q_errors else 0.008

    health = max(0.0, min(100.0, 100.0 - med_2q * 5000 - med_ro * 1000))

    return {
        "cal_id": str(uuid.uuid4()),
        "backend": backend,
        "timestamp": data.get("lastUpdated") or datetime.now(timezone.utc).isoformat(),
        "n_qubits": n_q,
        "median_t1_us": med_t1,
        "median_t2_us": med_t2,
        "median_1q_error": med_1q,
        "median_2q_error": med_2q,
        "median_readout_error": med_ro,
        "min_t1_us": round(min(t1s), 1) if t1s else 0.0,
        "max_t1_us": round(max(t1s), 1) if t1s else 0.0,
        "qv": 0,  # Rigetti doesn't use QV
        "clops": 800,
        "qubits": qubit_cals,
        "health_score": round(health, 1),
        "trend": "stable",
        "firmware_version": "rigetti_api",
        "data_source": "rigetti_api",
    }


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


@router.get("/{backend}")
def get_calibration(
    backend: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    if backend not in BACKENDS:
        from fastapi import HTTPException
        raise HTTPException(404, f"Backend {backend} not found")

    # Attempt real data when user has a stored provider token
    if identity and identity.user_id:
        from .credentials import get_active_key_for_user

        if backend.startswith("ibm"):
            token = get_active_key_for_user(db, "ibm", identity.user_id)
            if token:
                cal = _fetch_ibm_calibration(backend, token)
                if cal:
                    _check_alerts(db, backend, cal)
                    return {**BackendCalibration(**{k: v for k, v in cal.items() if k != "data_source"}).model_dump(), "data_source": "ibm_api"}

        elif backend.startswith("ionq"):
            token = get_active_key_for_user(db, "ionq", identity.user_id)
            if token:
                cal = _fetch_ionq_calibration(backend, token)
                if cal:
                    _check_alerts(db, backend, cal)
                    return {**BackendCalibration(**{k: v for k, v in cal.items() if k != "data_source"}).model_dump(), "data_source": "ionq_api"}

        elif backend.startswith("rigetti"):
            token = get_active_key_for_user(db, "rigetti", identity.user_id)
            if token:
                cal = _fetch_rigetti_calibration(backend, token)
                if cal:
                    _check_alerts(db, backend, cal)
                    return {**BackendCalibration(**{k: v for k, v in cal.items() if k != "data_source"}).model_dump(), "data_source": "rigetti_api"}

    # Fall back to simulated data
    _seed_calibrations(db)
    ns = f"{NS_CALIBRATIONS}_{backend}"
    history = store_list(db, ns)
    if len(history) > 100:
        history = history[-100:]
    cal = _gen_calibration(backend, len(history), history)
    store_put(db, ns, cal["cal_id"], cal)
    _check_alerts(db, backend, cal)
    return {**BackendCalibration(**cal).model_dump(), "data_source": "simulated"}

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

@router.get("")
def list_backends():
    return {"backends": [{"backend": b, **{k: v[k] for k in ["n_qubits","provider","location","processor"]}} for b, v in BACKENDS.items()]}

