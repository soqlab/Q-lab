"""Quantum Volume Benchmark Runner.

Executes QV circuits in pure-Python simulation and stores historical results.
QV = 2^m where m is the largest square circuit (m qubits x m layers) that
achieves heavy output probability > 2/3 with 2-sigma confidence.

Each stored result tracks: backend, qv_achieved, HOP per trial, trend over time.
"""
from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import QuantumVolumeResult

router = APIRouter(prefix="/api/v1/qv-runner", tags=["qv_runner"])


# ─────────────────────────────────────────────────────────────────────────────
# Pure-Python QV simulation
# ─────────────────────────────────────────────────────────────────────────────

def _ideal_heavy_set(m: int, rng: random.Random) -> set[int]:
    """Compute ideal heavy output bitstrings for a random m-qubit QV circuit."""
    dim = 1 << m
    state = [complex(1 / math.sqrt(dim), 0)] * dim

    for _layer in range(m):
        perm = list(range(m))
        rng.shuffle(perm)
        pairs = [(perm[i], perm[i + 1]) for i in range(0, m - 1, 2)]
        for q0, q1 in pairs:
            angle = rng.uniform(0, 2 * math.pi)
            phase = complex(math.cos(angle), math.sin(angle))
            for idx in range(dim):
                b0 = (idx >> q0) & 1
                b1 = (idx >> q1) & 1
                if b0 and b1:
                    state[idx] *= phase
                elif b0 or b1:
                    c, s = math.cos(angle / 2), math.sin(angle / 2)
                    flipped = idx ^ (1 << q0) ^ (1 << q1)
                    new_self = complex(c * state[idx].real - s * state[flipped].imag,
                                       c * state[idx].imag + s * state[flipped].real)
                    state[idx] = new_self

    probs = [abs(a) ** 2 for a in state]
    total = sum(probs) or 1.0
    probs = [p / total for p in probs]
    median = sorted(probs)[dim // 2]
    return {i for i, p in enumerate(probs) if p > median}


def _trial_hop(m: int, shots: int, noise: float, rng: random.Random) -> float:
    """One QV trial: returns heavy output probability under noise model."""
    ideal = _ideal_heavy_set(m, rng)
    dim = 1 << m
    hits = 0
    for _ in range(shots):
        if rng.random() < noise * m:
            outcome = rng.randint(0, dim - 1)
        else:
            outcome = rng.choice(list(ideal))
        if outcome in ideal:
            hits += 1
    return hits / shots


def _run_qv_benchmark(backend: str, max_qubits: int, n_trials: int, shots: int,
                       noise: float, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    threshold = 2 / 3
    qv_achieved = 1
    rows: list[dict] = []

    for m in range(2, max_qubits + 1):
        hops = [_trial_hop(m, shots, noise, rng) for _ in range(n_trials)]
        mean = sum(hops) / len(hops)
        std = math.sqrt(sum((h - mean) ** 2 for h in hops) / max(1, len(hops) - 1))
        ci_low = mean - 2 * std / math.sqrt(len(hops))
        passed = ci_low > threshold
        rows.append({"m": m, "qv": 2 ** m, "mean_hop": round(mean, 4),
                     "ci_low": round(ci_low, 4), "std": round(std, 4), "passed": passed})
        if passed:
            qv_achieved = 2 ** m
        else:
            break

    return {
        "qv_achieved": qv_achieved,
        "heavy_output_prob": rows[-1]["mean_hop"] if rows else 0.0,
        "trial_results": rows,
        "n_qubits_tested": max_qubits,
        "n_trials": n_trials,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic request models
# ─────────────────────────────────────────────────────────────────────────────

class QVRunRequest(BaseModel):
    backend: str
    max_qubits: int = Field(default=5, ge=2, le=8)
    n_trials: int = Field(default=100, ge=10, le=500)
    shots: int = Field(default=1024, ge=128, le=8192)
    noise_level: float = Field(default=0.04, ge=0.0, le=0.5,
        description="Per-gate depolarizing noise (0=ideal). Higher = lower QV.")
    seed: int = Field(default=42)


# ─────────────────────────────────────────────────────────────────────────────
# Serializer
# ─────────────────────────────────────────────────────────────────────────────

def _to_dict(r: QuantumVolumeResult) -> dict:
    return {
        "qv_id": r.qv_id,
        "backend": r.backend,
        "qv_achieved": r.qv_achieved,
        "log2_qv": int(math.log2(max(r.qv_achieved, 1))),
        "n_qubits_tested": r.n_qubits_tested,
        "n_trials": r.n_trials,
        "heavy_output_prob": r.heavy_output_prob,
        "pass_threshold": r.pass_threshold,
        "passed": r.heavy_output_prob > r.pass_threshold,
        "trial_results": r.trial_results,
        "created_at": r.created_at.isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def run_qv(req: QVRunRequest, db: Session = Depends(get_db)):
    """Run a QV benchmark simulation and store the result."""
    data = _run_qv_benchmark(req.backend, req.max_qubits, req.n_trials,
                              req.shots, req.noise_level, req.seed)
    row = QuantumVolumeResult(
        qv_id=f"qv-{uuid.uuid4().hex[:12]}",
        backend=req.backend,
        qv_achieved=data["qv_achieved"],
        n_qubits_tested=data["n_qubits_tested"],
        n_trials=data["n_trials"],
        heavy_output_prob=data["heavy_output_prob"],
        pass_threshold=2 / 3,
        trial_results=data["trial_results"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_dict(row)


@router.get("")
def list_qv_results(
    backend: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = select(QuantumVolumeResult).order_by(QuantumVolumeResult.created_at.desc())
    if backend:
        q = q.where(QuantumVolumeResult.backend == backend)
    return [_to_dict(r) for r in db.scalars(q.limit(limit)).all()]


@router.get("/trend/{backend}")
def qv_trend(backend: str, limit: int = 30, db: Session = Depends(get_db)):
    """Historical QV for a backend, oldest-first."""
    rows = db.scalars(
        select(QuantumVolumeResult)
        .where(QuantumVolumeResult.backend == backend)
        .order_by(QuantumVolumeResult.created_at.asc())
        .limit(limit)
    ).all()
    return {
        "backend": backend,
        "current_qv": rows[-1].qv_achieved if rows else None,
        "peak_qv": max((r.qv_achieved for r in rows), default=None),
        "history": [{"date": r.created_at.isoformat(), "qv": r.qv_achieved,
                     "hop": r.heavy_output_prob, "qv_id": r.qv_id} for r in rows],
    }


@router.get("/{qv_id}")
def get_qv_result(qv_id: str, db: Session = Depends(get_db)):
    r = db.scalar(select(QuantumVolumeResult).where(QuantumVolumeResult.qv_id == qv_id))
    if r is None:
        raise HTTPException(404, "QV result not found")
    return _to_dict(r)
