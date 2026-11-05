"""Backend Queue Intelligence — IBM queue depth, wait time estimation, best-time scheduling.

Proxies IBM Quantum's backend status API to surface:
  - Current pending jobs per backend
  - Estimated queue wait time
  - Historical "best time to submit" heuristics from our run data
  - Device availability / operational status

Falls back to mock data if IBM_QUANTUM_TOKEN is not configured.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity
from ..health_score import compute_health_score
from .. import ibm_quantum
from ..models import Run

router = APIRouter(prefix="/api/v1/queue", tags=["queue_intel"])


def _resolve_ibm_token(db, identity: Optional[Identity]) -> str:
    """The signed-in user's own IBM key, or empty. Q-Lab has no IBM account of its own."""
    if identity and identity.user_id:
        from .credentials import get_active_key_for_user
        return get_active_key_for_user(db, "ibm", identity.user_id) or ""
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# IBM API helpers
# ─────────────────────────────────────────────────────────────────────────────

def _fetch_ibm_backends(token: str) -> list[dict]:
    try:
        return ibm_quantum.list_backends(token)
    except Exception:
        return []


def _no_token_error() -> dict:
    """Raise a clear error when the user has not saved an IBM key."""
    from fastapi import HTTPException
    raise HTTPException(
        status_code=503,
        detail={
            "error": "No IBM Quantum key",
            "message": "Live queue data uses your own IBM Quantum account. Add your API key under "
                       "Credentials. You can create one at quantum.cloud.ibm.com.",
            "docs": "https://quantum.cloud.ibm.com/docs",
        },
    )


def _estimate_wait(queue_length: int, avg_job_minutes: float = 2.5) -> int:
    return round(queue_length * avg_job_minutes)


# ─────────────────────────────────────────────────────────────────────────────
# Internal analytics helpers
# ─────────────────────────────────────────────────────────────────────────────

def _backend_run_stats(db: Session, backend: str, days: int = 30) -> dict:
    """Compute run volume by hour-of-day from stored run data."""
    from datetime import timedelta
    since = datetime.now(timezone.utc) - timedelta(days=days)
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend, Run.created_at >= since)
    ).all()
    by_hour: dict[int, int] = {h: 0 for h in range(24)}
    for r in runs:
        if r.created_at:
            by_hour[r.created_at.hour] += 1
    if not runs:
        return {"by_hour": by_hour, "best_hour": 4, "worst_hour": 14, "total_runs": 0}
    best_h = min(by_hour, key=lambda h: by_hour[h])
    worst_h = max(by_hour, key=lambda h: by_hour[h])
    return {
        "by_hour": by_hour,
        "best_hour": best_h,
        "worst_hour": worst_h,
        "total_runs": len(runs),
        "avg_health": round(sum(compute_health_score({"results": r.results, "calibration": r.calibration, "fingerprint": r.fingerprint}) or 0 for r in runs) / max(1, len(runs)), 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/status")
def get_all_queue_status(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Return queue status for all known backends."""
    token = _resolve_ibm_token(db, identity)
    if not token:
        _no_token_error()
    backends = _fetch_ibm_backends(token)

    for b in backends:
        if "estimated_wait_minutes" not in b:
            b["estimated_wait_minutes"] = _estimate_wait(b.get("queue_length", 0))

    backends.sort(key=lambda b: b.get("queue_length", 9999))
    return {
        "backends": backends,
        "source": "ibm_api",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "recommendation": backends[0]["name"] if backends else None,
    }


@router.get("/status/{backend}")
def get_backend_queue(
    backend: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Queue status + our run history analytics for a specific backend."""
    token = _resolve_ibm_token(db, identity)
    if token:
        all_backends = _fetch_ibm_backends(token)
        info = next((b for b in all_backends if b["name"] == backend), None)
    else:
        _no_token_error()
        info = None  # unreachable

    stats = _backend_run_stats(db, backend)
    return {
        "backend": backend,
        "queue_info": info or {"backend": backend, "status": "unknown", "queue_length": None},
        "our_analytics": stats,
        "best_submit_hour_utc": stats.get("best_hour"),
        "worst_submit_hour_utc": stats.get("worst_hour"),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/recommend")
def recommend_backend(
    n_qubits: int = Query(default=2, ge=1, le=127),
    max_queue: int = Query(default=100, description="Max acceptable queue length"),
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Recommend the best backend for an n-qubit job based on queue depth and historical health."""
    token = _resolve_ibm_token(db, identity)
    if not token:
        _no_token_error()
    backends = _fetch_ibm_backends(token)

    candidates = [
        b for b in backends
        if b.get("operational", True)
        and b.get("n_qubits", 0) >= n_qubits
        and b.get("queue_length", 999) <= max_queue
    ]
    if not candidates:
        return {"recommended": None, "reason": "No backends meet the criteria", "candidates": []}

    # Score: lower queue = better
    scored = sorted(candidates, key=lambda b: b.get("queue_length", 999))
    top = scored[0]
    return {
        "recommended": top["name"],
        "queue_length": top.get("queue_length"),
        "estimated_wait_minutes": top.get("estimated_wait_minutes"),
        "n_qubits": top.get("n_qubits"),
        "reason": f"Shortest queue ({top.get('queue_length', 0)} pending jobs) among {n_qubits}+-qubit operational backends",
        "candidates": scored[:5],
    }


@router.get("/analytics/{backend}")
def queue_analytics(backend: str, days: int = 30, db: Session = Depends(get_db)):
    """Historical submission analytics for a backend from our data."""
    stats = _backend_run_stats(db, backend, days)
    hours = list(range(24))
    return {
        "backend": backend,
        "days_analyzed": days,
        **stats,
        "chart": [{"hour": h, "run_count": stats["by_hour"].get(h, 0)} for h in hours],
    }
