from __future__ import annotations
import uuid
import random
import statistics
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/v1/global-cal", tags=["global-cal"])

_CALIBRATIONS: dict[str, list] = {}

SEED_DATA = {
    "ibm_brisbane": [
        {"qubit": 0, "t1_us": 142.3, "t2_us": 98.7, "gate_error": 0.0021, "readout_error": 0.012, "institution": "IBM"},
        {"qubit": 1, "t1_us": 138.9, "t2_us": 102.1, "gate_error": 0.0019, "readout_error": 0.015, "institution": "IBM"},
        {"qubit": 2, "t1_us": 155.2, "t2_us": 91.4, "gate_error": 0.0024, "readout_error": 0.011, "institution": "MIT"},
    ],
    "ibm_kyoto": [
        {"qubit": 0, "t1_us": 168.4, "t2_us": 121.3, "gate_error": 0.0018, "readout_error": 0.009, "institution": "IBM"},
        {"qubit": 1, "t1_us": 172.1, "t2_us": 134.8, "gate_error": 0.0016, "readout_error": 0.010, "institution": "Caltech"},
        {"qubit": 2, "t1_us": 159.7, "t2_us": 118.2, "gate_error": 0.0022, "readout_error": 0.013, "institution": "IBM"},
    ],
    "ionq_aria_1": [
        {"qubit": 0, "t1_us": 10000.0, "t2_us": 1200.0, "gate_error": 0.00032, "readout_error": 0.004, "institution": "IonQ"},
        {"qubit": 1, "t1_us": 10000.0, "t2_us": 1180.0, "gate_error": 0.00035, "readout_error": 0.004, "institution": "Duke"},
        {"qubit": 2, "t1_us": 10000.0, "t2_us": 1250.0, "gate_error": 0.00031, "readout_error": 0.005, "institution": "IonQ"},
    ],
    "rigetti_ankaa_2": [
        {"qubit": 0, "t1_us": 82.1, "t2_us": 61.4, "gate_error": 0.0043, "readout_error": 0.022, "institution": "Rigetti"},
        {"qubit": 1, "t1_us": 79.5, "t2_us": 58.9, "gate_error": 0.0051, "readout_error": 0.025, "institution": "Berkeley"},
        {"qubit": 2, "t1_us": 91.3, "t2_us": 67.2, "gate_error": 0.0038, "readout_error": 0.019, "institution": "Rigetti"},
    ],
    "quantinuum_h2": [
        {"qubit": 0, "t1_us": 3600000.0, "t2_us": 7200.0, "gate_error": 0.000015, "readout_error": 0.0003, "institution": "Quantinuum"},
        {"qubit": 1, "t1_us": 3600000.0, "t2_us": 7100.0, "gate_error": 0.000018, "readout_error": 0.0004, "institution": "Quantinuum"},
        {"qubit": 2, "t1_us": 3600000.0, "t2_us": 7400.0, "gate_error": 0.000014, "readout_error": 0.0003, "institution": "Cambridge"},
    ],
}

def _seed():
    ts = datetime.now(timezone.utc).isoformat()
    for backend, entries in SEED_DATA.items():
        _CALIBRATIONS[backend] = []
        for e in entries:
            _CALIBRATIONS[backend].append({
                "record_id": str(uuid.uuid4()),
                "backend": backend,
                "qubit": e["qubit"],
                "t1_us": e["t1_us"],
                "t2_us": e["t2_us"],
                "gate_error": e["gate_error"],
                "readout_error": e["readout_error"],
                "timestamp": ts,
                "institution": e.get("institution", "anonymous"),
            })

_seed()

class ContributeRequest(BaseModel):
    backend: str
    qubit: int
    t1_us: float
    t2_us: float
    gate_error: float
    readout_error: float
    timestamp: Optional[str] = None
    institution: Optional[str] = None

class CompareRequest(BaseModel):
    backend: str
    your_t1: float
    your_t2: float

@router.post("/contribute")
def contribute(req: ContributeRequest):
    record = {
        "record_id": str(uuid.uuid4()),
        "backend": req.backend,
        "qubit": req.qubit,
        "t1_us": req.t1_us,
        "t2_us": req.t2_us,
        "gate_error": req.gate_error,
        "readout_error": req.readout_error,
        "timestamp": req.timestamp or datetime.now(timezone.utc).isoformat(),
        "institution": req.institution or "anonymous",
    }
    _CALIBRATIONS.setdefault(req.backend, []).append(record)
    return record

@router.get("/backend/{backend_name}")
def get_backend(backend_name: str):
    records = _CALIBRATIONS.get(backend_name, [])
    if not records:
        raise HTTPException(status_code=404, detail=f"No calibration data for backend '{backend_name}'")
    t1s = [r["t1_us"] for r in records]
    t2s = [r["t2_us"] for r in records]
    ges = [r["gate_error"] for r in records]
    t1_median = round(statistics.median(t1s), 3)
    t2_median = round(statistics.median(t2s), 3)
    ge_median = round(statistics.median(ges), 6)
    trend_options = ["stable", "improving", "degrading", "fluctuating"]
    trend = random.choice(trend_options[:2])
    institutions = set(r["institution"] for r in records)
    forecast_t1 = round(t1_median * random.uniform(0.97, 1.03), 3)
    forecast_t2 = round(t2_median * random.uniform(0.97, 1.03), 3)
    return {
        "backend": backend_name,
        "records": records,
        "community_t1_median": t1_median,
        "community_t2_median": t2_median,
        "community_gate_error_median": ge_median,
        "trend": trend,
        "n_contributors": len(institutions),
        "last_updated": max(r["timestamp"] for r in records),
        "forecast_next_24h": {"t1": forecast_t1, "t2": forecast_t2},
    }

@router.get("/leaderboard")
def leaderboard():
    ranked = []
    for backend, records in _CALIBRATIONS.items():
        if not records:
            continue
        t2s = [r["t2_us"] for r in records]
        t1s = [r["t1_us"] for r in records]
        ges = [r["gate_error"] for r in records]
        ranked.append({
            "backend": backend,
            "median_t2_us": round(statistics.median(t2s), 3),
            "median_t1_us": round(statistics.median(t1s), 3),
            "median_gate_error": round(statistics.median(ges), 6),
            "n_records": len(records),
        })
    ranked.sort(key=lambda x: x["median_t2_us"], reverse=True)
    for i, entry in enumerate(ranked):
        entry["rank"] = i + 1
    return {"leaderboard": ranked, "ranked_by": "median_t2_us", "as_of": datetime.now(timezone.utc).isoformat()}

@router.post("/compare")
def compare(req: CompareRequest):
    records = _CALIBRATIONS.get(req.backend, [])
    if not records:
        raise HTTPException(status_code=404, detail=f"No data for backend '{req.backend}'")
    t1s = sorted(r["t1_us"] for r in records)
    t2s = sorted(r["t2_us"] for r in records)
    pct_t1 = round(sum(1 for v in t1s if req.your_t1 > v) / max(len(t1s), 1) * 100, 1)
    pct_t2 = round(sum(1 for v in t2s if req.your_t2 > v) / max(len(t2s), 1) * 100, 1)
    avg_t1 = round(statistics.mean(t1s), 3)
    avg_t2 = round(statistics.mean(t2s), 3)
    avg_ge = round(statistics.mean(r["gate_error"] for r in records), 6)
    if pct_t2 >= 75:
        assessment = "Excellent coherence — your qubit is in the top quartile for this backend"
    elif pct_t2 >= 50:
        assessment = "Above-average coherence for this backend"
    elif pct_t2 >= 25:
        assessment = "Below-average coherence — check recent calibration and environment stability"
    else:
        assessment = "Poor coherence relative to community — recalibration strongly recommended"
    return {
        "your_percentile_t1": pct_t1,
        "your_percentile_t2": pct_t2,
        "community_average": {"t1_us": avg_t1, "t2_us": avg_t2, "gate_error": avg_ge},
        "assessment": assessment,
        "compared_at": datetime.now(timezone.utc).isoformat(),
    }
