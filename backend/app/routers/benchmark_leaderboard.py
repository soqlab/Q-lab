from __future__ import annotations

import uuid
import math
import random
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/benchmark-leaderboard", tags=["benchmark-leaderboard"])

# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

_BACKENDS = [
    {"name": "ibm_torino",       "qaoa": 0.871, "vqe": 0.856, "qft": 0.883, "ghz": 0.891, "mirror": 0.862},
    {"name": "ibm_brisbane",     "qaoa": 0.883, "vqe": 0.869, "qft": 0.897, "ghz": 0.902, "mirror": 0.874},
    {"name": "ibm_kyoto",        "qaoa": 0.859, "vqe": 0.841, "qft": 0.872, "ghz": 0.878, "mirror": 0.851},
    {"name": "ionq_aria",        "qaoa": 0.951, "vqe": 0.943, "qft": 0.957, "ghz": 0.961, "mirror": 0.948},
    {"name": "ionq_forte",       "qaoa": 0.963, "vqe": 0.958, "qft": 0.971, "ghz": 0.974, "mirror": 0.961},
    {"name": "quantinuum_h2",    "qaoa": 0.974, "vqe": 0.969, "qft": 0.981, "ghz": 0.983, "mirror": 0.976},
]

_BM_TYPES = ["qaoa_ratio", "vqe_fidelity", "qft_fidelity", "ghz_fidelity", "mirror_fidelity"]
_BM_KEYS  = ["qaoa",       "vqe",          "qft",          "ghz",          "mirror"]

_NOW = datetime.now(timezone.utc)

def _build_history(base: float, days: int = 30) -> List[Dict]:
    history = []
    for d in range(days, -1, -1):
        ts = _NOW - timedelta(days=d)
        noise = (random.random() - 0.5) * 0.012
        val = round(max(0.0, min(1.0, base + noise)), 4)
        history.append({"timestamp": ts.isoformat(), "value": val})
    return history


# in-memory stores
_leaderboard: Dict[str, Dict] = {}
_history: Dict[str, Dict[str, List[Dict]]] = {}   # backend -> bm_type -> list
_submissions: List[Dict] = []

random.seed(42)

for _b in _BACKENDS:
    name = _b["name"]
    _history[name] = {}
    scores = []
    for bm_type, bm_key in zip(_BM_TYPES, _BM_KEYS):
        base = _b[bm_key]
        hist = _build_history(base)
        _history[name][bm_type] = hist
        scores.append(base)

    overall = round(sum(scores) / len(scores), 4)
    _leaderboard[name] = {
        "backend":         name,
        "qaoa_ratio":      _b["qaoa"],
        "vqe_fidelity":    _b["vqe"],
        "qft_fidelity":    _b["qft"],
        "ghz_fidelity":    _b["ghz"],
        "mirror_fidelity": _b["mirror"],
        "overall_score":   overall,
        "rank":            0,
        "last_updated":    _NOW.isoformat(),
        "trend":           "stable",
    }

def _rerank() -> None:
    sorted_backends = sorted(_leaderboard.values(), key=lambda x: x["overall_score"], reverse=True)
    for i, entry in enumerate(sorted_backends):
        _leaderboard[entry["backend"]]["rank"] = i + 1

_rerank()

_LAST_RUN = _NOW.isoformat()

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SubmitPayload(BaseModel):
    backend: str
    benchmark_type: str
    value: float
    n_qubits: int
    circuit_depth: Optional[int] = None

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
def get_leaderboard():
    entries = sorted(_leaderboard.values(), key=lambda x: x["rank"])
    return {
        "benchmarks":    entries,
        "last_run":      _LAST_RUN,
        "total_backends": len(entries),
    }


@router.get("/records")
def get_records():
    records: Dict[str, Dict] = {}
    for bm_type in _BM_TYPES:
        best_val = -1.0
        best_backend = None
        best_ts = None
        for backend, hist_map in _history.items():
            for entry in hist_map.get(bm_type, []):
                if entry["value"] > best_val:
                    best_val = entry["value"]
                    best_backend = backend
                    best_ts = entry["timestamp"]
        records[bm_type] = {
            "benchmark_type": bm_type,
            "record_value":   round(best_val, 4),
            "backend":        best_backend,
            "set_at":         best_ts,
        }
    return {"records": list(records.values())}


@router.get("/history/{benchmark_type}")
def get_benchmark_history(benchmark_type: str):
    if benchmark_type not in _BM_TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown benchmark type '{benchmark_type}'. Valid: {_BM_TYPES}")
    series = []
    for backend, hist_map in _history.items():
        series.append({
            "backend": backend,
            "data":    hist_map.get(benchmark_type, []),
        })
    return {"benchmark_type": benchmark_type, "series": series, "n_backends": len(series)}


@router.get("/backend/{backend}")
def get_backend_detail(backend: str):
    if backend not in _leaderboard:
        raise HTTPException(status_code=404, detail=f"Backend '{backend}' not found.")
    entry = _leaderboard[backend].copy()
    entry["history"] = {}
    for bm_type in _BM_TYPES:
        entry["history"][bm_type] = _history[backend].get(bm_type, [])
    recent_subs = [s for s in _submissions if s["backend"] == backend]
    entry["recent_submissions"] = recent_subs[-10:]
    return entry


@router.post("/submit")
def submit_result(payload: SubmitPayload):
    if payload.benchmark_type not in _BM_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown benchmark_type. Valid: {_BM_TYPES}")
    if not (0.0 <= payload.value <= 1.0):
        raise HTTPException(status_code=400, detail="Value must be between 0.0 and 1.0")

    ts = datetime.now(timezone.utc).isoformat()

    if payload.backend not in _leaderboard:
        scores = [payload.value] + [0.5] * (len(_BM_TYPES) - 1)
        _leaderboard[payload.backend] = {
            "backend":         payload.backend,
            **{bt: 0.5 for bt in _BM_TYPES},
            "overall_score":   round(sum(scores) / len(scores), 4),
            "rank":            0,
            "last_updated":    ts,
            "trend":           "new",
        }
        _history[payload.backend] = {bt: [] for bt in _BM_TYPES}

    key_map = dict(zip(_BM_TYPES, _BM_KEYS))
    bm_key = payload.benchmark_type
    old_val = _leaderboard[payload.backend].get(bm_key, 0.5)
    _leaderboard[payload.backend][bm_key] = payload.value
    _leaderboard[payload.backend]["last_updated"] = ts

    trend = "up" if payload.value > old_val + 0.005 else ("down" if payload.value < old_val - 0.005 else "stable")
    _leaderboard[payload.backend]["trend"] = trend

    all_vals = [_leaderboard[payload.backend].get(bt, 0.5) for bt in _BM_TYPES]
    _leaderboard[payload.backend]["overall_score"] = round(sum(all_vals) / len(all_vals), 4)

    _history[payload.backend][payload.benchmark_type].append({"timestamp": ts, "value": payload.value})

    sub = {
        "submission_id":  str(uuid.uuid4()),
        "backend":        payload.backend,
        "benchmark_type": payload.benchmark_type,
        "value":          payload.value,
        "n_qubits":       payload.n_qubits,
        "circuit_depth":  payload.circuit_depth,
        "submitted_at":   ts,
    }
    _submissions.append(sub)

    _rerank()

    return {
        "submission": sub,
        "leaderboard_position": _leaderboard[payload.backend]["rank"],
        "overall_score":        _leaderboard[payload.backend]["overall_score"],
        "trend":                trend,
    }

