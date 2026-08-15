from __future__ import annotations

import uuid
import math
import random
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/benchmark-leaderboard", tags=["benchmark-leaderboard"])

# ---------------------------------------------------------------------------
# Seed data (read-only constants)
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

_LAST_RUN = _NOW.isoformat()


def _ensure_seeded(db: Session) -> None:
    """Populate bench_leaderboard and bench_history with seed data if empty."""
    existing = store_list(db, "bench_leaderboard")
    if any("rank" in e for e in existing):
        return

    random.seed(42)
    for _b in _BACKENDS:
        name = _b["name"]
        scores = []
        for bm_type, bm_key in zip(_BM_TYPES, _BM_KEYS):
            base = _b[bm_key]
            hist = _build_history(base)
            store_put(db, "bench_history", f"{name}::{bm_type}", {
                "backend": name,
                "bm_type": bm_type,
                "data": hist,
            })
            scores.append(base)

        overall = round(sum(scores) / len(scores), 4)
        store_put(db, "bench_leaderboard", name, {
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
        })

    _rerank(db)


def _rerank(db: Session) -> None:
    all_records = store_list(db, "bench_leaderboard")
    lb_entries = [e for e in all_records if "rank" in e and "submission_id" not in e]
    sorted_backends = sorted(lb_entries, key=lambda x: x["overall_score"], reverse=True)
    for i, entry in enumerate(sorted_backends):
        entry["rank"] = i + 1
        store_put(db, "bench_leaderboard", entry["backend"], entry)


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
def get_leaderboard(db: Session = Depends(get_db)):
    _ensure_seeded(db)
    all_records = store_list(db, "bench_leaderboard")
    lb_entries = [e for e in all_records if "rank" in e and "submission_id" not in e]
    entries = sorted(lb_entries, key=lambda x: x["rank"])
    return {
        "benchmarks":     entries,
        "last_run":       _LAST_RUN,
        "total_backends": len(entries),
    }


@router.get("/records")
def get_records(db: Session = Depends(get_db)):
    _ensure_seeded(db)
    records: Dict[str, Dict] = {}
    all_history = store_list(db, "bench_history")
    for bm_type in _BM_TYPES:
        best_val = -1.0
        best_backend = None
        best_ts = None
        for hist_record in all_history:
            if hist_record.get("bm_type") != bm_type:
                continue
            backend = hist_record.get("backend")
            for entry in hist_record.get("data", []):
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
def get_benchmark_history(benchmark_type: str, db: Session = Depends(get_db)):
    if benchmark_type not in _BM_TYPES:
        raise HTTPException(status_code=404, detail=f"Unknown benchmark type '{benchmark_type}'. Valid: {_BM_TYPES}")
    _ensure_seeded(db)
    all_history = store_list(db, "bench_history")
    series = []
    for hist_record in all_history:
        if hist_record.get("bm_type") == benchmark_type:
            series.append({
                "backend": hist_record["backend"],
                "data":    hist_record.get("data", []),
            })
    return {"benchmark_type": benchmark_type, "series": series, "n_backends": len(series)}


@router.get("/backend/{backend}")
def get_backend_detail(backend: str, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    entry = store_get(db, "bench_leaderboard", backend)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Backend '{backend}' not found.")
    entry = entry.copy()
    entry["history"] = {}
    for bm_type in _BM_TYPES:
        hist_record = store_get(db, "bench_history", f"{backend}::{bm_type}")
        entry["history"][bm_type] = hist_record.get("data", []) if hist_record else []
    all_records = store_list(db, "bench_leaderboard")
    recent_subs = [e for e in all_records if e.get("submission_id") and e.get("backend") == backend]
    entry["recent_submissions"] = recent_subs[-10:]
    return entry


@router.post("/submit")
def submit_result(payload: SubmitPayload, db: Session = Depends(get_db)):
    if payload.benchmark_type not in _BM_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown benchmark_type. Valid: {_BM_TYPES}")
    if not (0.0 <= payload.value <= 1.0):
        raise HTTPException(status_code=400, detail="Value must be between 0.0 and 1.0")

    _ensure_seeded(db)
    ts = datetime.now(timezone.utc).isoformat()

    lb_entry = store_get(db, "bench_leaderboard", payload.backend)
    if lb_entry is None:
        lb_entry = {
            "backend":       payload.backend,
            **{bt: 0.5 for bt in _BM_TYPES},
            "overall_score": 0.5,
            "rank":          0,
            "last_updated":  ts,
            "trend":         "new",
        }
        for bm_type in _BM_TYPES:
            store_put(db, "bench_history", f"{payload.backend}::{bm_type}", {
                "backend": payload.backend,
                "bm_type": bm_type,
                "data": [],
            })

    bm_key = payload.benchmark_type
    old_val = lb_entry.get(bm_key, 0.5)
    lb_entry[bm_key] = payload.value
    lb_entry["last_updated"] = ts

    trend = "up" if payload.value > old_val + 0.005 else ("down" if payload.value < old_val - 0.005 else "stable")
    lb_entry["trend"] = trend

    all_vals = [lb_entry.get(bt, 0.5) for bt in _BM_TYPES]
    lb_entry["overall_score"] = round(sum(all_vals) / len(all_vals), 4)

    store_put(db, "bench_leaderboard", payload.backend, lb_entry)

    hist_key = f"{payload.backend}::{payload.benchmark_type}"
    hist_record = store_get(db, "bench_history", hist_key) or {
        "backend": payload.backend,
        "bm_type": payload.benchmark_type,
        "data": [],
    }
    hist_record["data"].append({"timestamp": ts, "value": payload.value})
    store_put(db, "bench_history", hist_key, hist_record)

    sub_id = str(uuid.uuid4())
    sub = {
        "submission_id":  sub_id,
        "backend":        payload.backend,
        "benchmark_type": payload.benchmark_type,
        "value":          payload.value,
        "n_qubits":       payload.n_qubits,
        "circuit_depth":  payload.circuit_depth,
        "submitted_at":   ts,
    }
    store_put(db, "bench_leaderboard", sub_id, sub)

    _rerank(db)

    updated_entry = store_get(db, "bench_leaderboard", payload.backend)

    return {
        "submission":           sub,
        "leaderboard_position": updated_entry["rank"] if updated_entry else 0,
        "overall_score":        lb_entry["overall_score"],
        "trend":                trend,
    }
