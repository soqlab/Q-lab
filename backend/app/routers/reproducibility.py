"""Reproducibility Engine.

Auto-reruns any stored experiment N times and computes a statistical
reproducibility score using Total Variation Distance (TVD).

TVD = (1/2) * Σ|P_original(x) - P_rerun(x)|
Reproducibility Score = 1 - mean(TVD)
Grade: A ≥ 0.95, B ≥ 0.85, C ≥ 0.70, D ≥ 0.50, F < 0.50
"""
from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ReproducibilityResult, Run

router = APIRouter(prefix="/api/v1/reproducibility", tags=["reproducibility"])


def _tvd(a: dict[str, int], b: dict[str, int]) -> float:
    keys = set(a) | set(b)
    total_a = sum(a.values()) or 1
    total_b = sum(b.values()) or 1
    return 0.5 * sum(abs(a.get(k, 0) / total_a - b.get(k, 0) / total_b) for k in keys)


def _grade(score: float) -> str:
    if score >= 0.95: return "A"
    if score >= 0.85: return "B"
    if score >= 0.70: return "C"
    if score >= 0.50: return "D"
    return "F"


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))


class ReproRequest(BaseModel):
    run_id: str
    n_reruns: int = Field(default=10, ge=2, le=50)
    shots: int | None = None


@router.post("")
def check_reproducibility(req: ReproRequest, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == req.run_id))
    if run is None:
        raise HTTPException(404, f"Run '{req.run_id}' not found")

    qasm = run.circuit_qasm
    if not qasm:
        raise HTTPException(422, "Run has no circuit QASM stored")

    shots = req.shots or run.shots or 1024
    original_counts: dict[str, int] = {}
    if run.result and isinstance(run.result, dict):
        original_counts = run.result.get("counts", {})

    if not original_counts:
        raise HTTPException(422, "Run has no measurement counts to compare against")

    try:
        from .job_executor import _simulate_qasm
    except ImportError:
        raise HTTPException(500, "Simulator unavailable")

    rng = random.Random(hash(req.run_id) % (2 ** 31))
    trial_tvds: list[float] = []

    for _ in range(req.n_reruns):
        seed = rng.randint(0, 2 ** 30)
        new_counts = _simulate_qasm(qasm, shots, seed=seed)
        tvd = _tvd(original_counts, new_counts)
        trial_tvds.append(round(tvd, 4))

    mean_tvd = sum(trial_tvds) / len(trial_tvds)
    std_tvd = _std(trial_tvds)
    repro_score = max(0.0, 1.0 - mean_tvd)
    grade = _grade(repro_score)

    result_id = f"repro-{uuid.uuid4().hex[:12]}"
    record = ReproducibilityResult(
        result_id=result_id,
        original_run_id=req.run_id,
        n_reruns=req.n_reruns,
        mean_tvd=round(mean_tvd, 4),
        std_tvd=round(std_tvd, 4),
        reproducibility_score=round(repro_score, 4),
        grade=grade,
        trial_tvds=trial_tvds,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "result_id": result_id,
        "original_run_id": req.run_id,
        "n_reruns": req.n_reruns,
        "mean_tvd": round(mean_tvd, 4),
        "std_tvd": round(std_tvd, 4),
        "reproducibility_score": round(repro_score, 4),
        "grade": grade,
        "trial_tvds": trial_tvds,
        "interpretation": (
            "Excellent — results are highly stable across reruns" if repro_score >= 0.95
            else "Good — minor shot noise but generally reproducible" if repro_score >= 0.85
            else "Moderate — consider increasing shot count" if repro_score >= 0.70
            else "Poor — results vary significantly; check circuit or backend noise"
        ),
        "backend": run.backend,
        "shots": shots,
        "created_at": record.created_at.isoformat(),
    }


@router.get("")
def list_reproducibility(run_id: str | None = None, db: Session = Depends(get_db)):
    q = select(ReproducibilityResult).order_by(ReproducibilityResult.created_at.desc()).limit(100)
    if run_id:
        q = q.where(ReproducibilityResult.original_run_id == run_id)
    rows = db.scalars(q).all()
    return [
        {
            "result_id": r.result_id,
            "original_run_id": r.original_run_id,
            "reproducibility_score": r.reproducibility_score,
            "grade": r.grade,
            "mean_tvd": r.mean_tvd,
            "n_reruns": r.n_reruns,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.get("/{result_id}")
def get_reproducibility(result_id: str, db: Session = Depends(get_db)):
    r = db.scalar(select(ReproducibilityResult).where(ReproducibilityResult.result_id == result_id))
    if r is None:
        raise HTTPException(404, "Not found")
    return {
        "result_id": r.result_id,
        "original_run_id": r.original_run_id,
        "n_reruns": r.n_reruns,
        "mean_tvd": r.mean_tvd,
        "std_tvd": r.std_tvd,
        "reproducibility_score": r.reproducibility_score,
        "grade": r.grade,
        "trial_tvds": r.trial_tvds,
        "created_at": r.created_at.isoformat(),
    }
