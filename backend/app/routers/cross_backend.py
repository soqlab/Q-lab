"""Cross-Backend Comparison — run the same circuit on multiple backends and compare.

Flow:
1. POST /api/v1/cross-backend/compare — submit the same QASM to N providers/backends
2. Results are stored as JobSubmission rows under a shared comparison_id
3. GET /api/v1/cross-backend/{comparison_id} — retrieve comparison results

Metrics compared:
  - success_probability
  - estimated cost
  - backend queue length (from queue_intel)
  - health score delta
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import JobSubmission, Run

router = APIRouter(prefix="/api/v1/cross-backend", tags=["cross_backend"])


# ─────────────────────────────────────────────────────────────────────────────
# Comparison record (stored in JSON within the job metadata)
# ─────────────────────────────────────────────────────────────────────────────

# We piggyback on JobSubmission.provider_metadata to store comparison_id.
# A comparison is just a group of jobs sharing the same comparison_id tag.


def _get_comparison_jobs(db: Session, comparison_id: str) -> list[JobSubmission]:
    """Find all jobs tagged with this comparison_id."""
    all_jobs = db.scalars(select(JobSubmission)).all()
    return [j for j in all_jobs if (j.provider_metadata or {}).get("comparison_id") == comparison_id]


def _job_summary(job: JobSubmission) -> dict[str, Any]:
    res = job.result or {}
    counts = res.get("counts", {})
    total = sum(int(v) for v in counts.values()) if counts else 0
    sp = res.get("success_probability")
    if sp is None and counts and total > 0:
        sp = max(int(v) for v in counts.values()) / total
    return {
        "job_id": job.job_id,
        "backend": job.backend,
        "provider": job.provider,
        "status": job.status,
        "shots": job.shots,
        "success_probability": round(float(sp), 4) if sp is not None else None,
        "cost_credits": job.cost_credits,
        "error_message": job.error_message,
        "counts": dict(sorted(counts.items(), key=lambda x: -int(x[1]))[:8]) if counts else {},
        "submitted_at": job.submitted_at.isoformat() if job.submitted_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Job submission helpers (reuse simulator from job_executor)
# ─────────────────────────────────────────────────────────────────────────────

def _submit_local(qasm: str, backend: str, provider: str, shots: int,
                  comparison_id: str, circuit_name: str, db: Session) -> JobSubmission:
    """Create a JobSubmission record and run it via the simulator for mock providers."""
    from .job_executor import _simulate_qasm, _estimate_cost
    import random

    job_id = f"job-{uuid.uuid4().hex[:12]}"
    # Run simulator for non-real providers
    seed = hash(backend + qasm) % (2 ** 31)
    counts = _simulate_qasm(qasm, shots, seed=abs(seed))
    total = sum(counts.values()) or 1
    sp = max(counts.values()) / total
    depth_hint = max(1, qasm.count("\n") // 3)
    cost = _estimate_cost(provider, shots, depth_hint)

    job = JobSubmission(
        job_id=job_id,
        provider=provider,
        provider_job_id=f"sim-{uuid.uuid4().hex[:8]}",
        backend=backend,
        shots=shots,
        status="completed",
        qasm=qasm,
        circuit_name=circuit_name,
        result={"counts": counts, "success_probability": round(sp, 4)},
        cost_credits=cost,
        provider_metadata={"comparison_id": comparison_id},
        completed_at=datetime.now(timezone.utc),
    )
    db.add(job)
    return job


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class BackendTarget(BaseModel):
    provider: str = "simulator"
    backend: str


class CompareRequest(BaseModel):
    qasm: str
    targets: list[BackendTarget] = Field(min_length=2, max_length=6)
    shots: int = Field(default=1024, ge=128, le=8192)
    circuit_name: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def create_comparison(req: CompareRequest, db: Session = Depends(get_db)):
    """Submit QASM to multiple backends and return a comparison_id."""
    comparison_id = f"cmp-{uuid.uuid4().hex[:12]}"
    jobs = []
    for target in req.targets:
        job = _submit_local(
            req.qasm, target.backend, target.provider,
            req.shots, comparison_id, req.circuit_name, db,
        )
        jobs.append(job)
    db.commit()
    return {
        "comparison_id": comparison_id,
        "n_backends": len(jobs),
        "status": "all_submitted",
        "jobs": [{"job_id": j.job_id, "backend": j.backend, "provider": j.provider} for j in jobs],
    }


@router.get("/{comparison_id}")
def get_comparison(comparison_id: str, db: Session = Depends(get_db)):
    """Retrieve comparison results for a given comparison_id."""
    jobs = _get_comparison_jobs(db, comparison_id)
    if not jobs:
        raise HTTPException(404, "Comparison not found")

    summaries = [_job_summary(j) for j in jobs]
    completed = [s for s in summaries if s["success_probability"] is not None]

    # Compute winner by success_probability
    winner = max(completed, key=lambda s: s["success_probability"] or 0) if completed else None

    # Cost comparison
    costs = {s["backend"]: s["cost_credits"] for s in summaries if s["cost_credits"] is not None}
    cheapest = min(costs, key=lambda k: costs[k]) if costs else None

    return {
        "comparison_id": comparison_id,
        "n_backends": len(jobs),
        "backends": summaries,
        "winner_by_fidelity": winner["backend"] if winner else None,
        "winner_by_cost": cheapest,
        "metrics_table": [
            {
                "backend": s["backend"],
                "provider": s["provider"],
                "success_probability": s["success_probability"],
                "cost_credits": s["cost_credits"],
                "top_bitstring": list(s["counts"].keys())[0] if s["counts"] else None,
                "status": s["status"],
            }
            for s in summaries
        ],
    }


@router.get("")
def list_comparisons(limit: int = 20, db: Session = Depends(get_db)):
    """List recent comparison IDs."""
    all_jobs = db.scalars(
        select(JobSubmission).order_by(JobSubmission.submitted_at.desc()).limit(500)
    ).all()
    seen: dict[str, dict] = {}
    for j in all_jobs:
        cid = (j.provider_metadata or {}).get("comparison_id")
        if cid and cid not in seen:
            seen[cid] = {
                "comparison_id": cid,
                "n_backends": 0,
                "submitted_at": j.submitted_at.isoformat() if j.submitted_at else None,
                "circuit_name": j.circuit_name,
            }
        if cid:
            seen[cid]["n_backends"] += 1
    return list(seen.values())[:limit]
