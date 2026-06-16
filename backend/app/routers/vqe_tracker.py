"""VQE / QAOA Convergence Tracker.

Tracks variational quantum algorithm runs iteration-by-iteration and
computes convergence analytics without requiring the actual quantum hardware
data in real time — the user pushes iteration data as they run.

Convergence analytics
──────────────────────
• Energy trend: linear regression slope over last 20 iterations
• Gradient norm estimation: std-dev of energy differences (proxy)
• Barren plateau detector: gradient variance < 1e-6 across 10+ iterations
• Convergence status: converging | converged | stalled | diverging
• Optimal energy and parameters tracking
• Energy landscape: 1D slice around current optimal parameter

Supported algorithms
────────────────────
• vqe         — Variational Quantum Eigensolver
• qaoa        — Quantum Approximate Optimisation Algorithm
• adapt_vqe   — ADAPT-VQE (adaptive ansatz)
• other       — generic iterative variational algorithm
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import VariationalRun

router = APIRouter(prefix="/api/v1/variational", tags=["vqe_tracker"])


# ─────────────────────────────────────────────────────────────────────────────
# Analytics helpers
# ─────────────────────────────────────────────────────────────────────────────

def _linreg(xs: list[float], ys: list[float]) -> tuple[float, float]:
    """(slope, intercept)"""
    n = len(xs)
    if n < 2:
        return 0.0, ys[-1] if ys else 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    Sxx = sum((x-mx)**2 for x in xs) or 1e-9
    Sxy = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    b = Sxy/Sxx
    return b, my - b*mx


def _gradient_norm_proxy(energies: list[float]) -> float:
    """Estimate gradient norm as RMS of successive differences."""
    if len(energies) < 2:
        return 0.0
    diffs = [abs(energies[i] - energies[i-1]) for i in range(1, len(energies))]
    return round(math.sqrt(sum(d**2 for d in diffs) / len(diffs)), 6)


def _barren_plateau(energies: list[float]) -> bool:
    """True if gradient variance is extremely small (≤ 1e-6) over last 10 iterations."""
    if len(energies) < 10:
        return False
    recent = energies[-10:]
    diffs = [abs(recent[i] - recent[i-1]) for i in range(1, len(recent))]
    variance = sum(d**2 for d in diffs) / len(diffs)
    return variance <= 1e-6


def _convergence_status(energies: list[float], slope: float) -> str:
    if len(energies) < 5:
        return "running"
    recent_var = max(abs(energies[-1] - energies[-2]) if len(energies) >= 2 else 1.0, 1e-12)
    if recent_var < 1e-5:
        return "converged"
    if slope < -1e-5:
        return "converging"
    if slope > 1e-4:
        return "diverging"
    return "stalled"


def _analyse(vrun: VariationalRun) -> dict[str, Any]:
    iters = vrun.iterations or []
    if not iters:
        return {
            "n_iterations": 0, "current_energy": None, "optimal_energy": None,
            "energy_slope": 0.0, "gradient_norm": 0.0, "barren_plateau": False,
            "convergence_status": vrun.convergence_status, "energy_history": [],
            "param_convergence": [], "estimated_minimum": None,
        }

    energies = [it.get("energy") for it in iters if it.get("energy") is not None]
    steps = list(range(len(energies)))
    slope, intercept = _linreg(steps, energies)
    grad = _gradient_norm_proxy(energies)
    plateau = _barren_plateau(energies)
    status = _convergence_status(energies, slope)

    # Estimate minimum via linear extrapolation (capped at 200 more steps)
    est_min = None
    if status == "converging" and slope < 0:
        est_steps = min(200, abs(energies[-1] / slope))
        est_min = round(energies[-1] + slope * est_steps, 6)

    # Parameter convergence: track std-dev of each param across last 10 iters
    param_std: list[float] = []
    if len(iters) >= 2 and iters[-1].get("params"):
        n_params = len(iters[-1]["params"])
        for p_idx in range(n_params):
            vals = [it["params"][p_idx] for it in iters[-10:] if it.get("params") and p_idx < len(it["params"])]
            if len(vals) >= 2:
                mean = sum(vals) / len(vals)
                std = math.sqrt(sum((v - mean)**2 for v in vals) / len(vals))
                param_std.append(round(std, 6))
            else:
                param_std.append(0.0)

    return {
        "n_iterations": len(iters),
        "current_energy": round(energies[-1], 6) if energies else None,
        "optimal_energy": round(min(energies), 6) if energies else None,
        "energy_slope": round(slope, 8),
        "gradient_norm": grad,
        "barren_plateau": plateau,
        "convergence_status": status,
        "energy_history": [round(e, 6) for e in energies[-50:]],
        "param_convergence": param_std,
        "estimated_minimum": est_min,
        "r2_fit": round(1 - sum((e - (intercept + slope*s))**2 for s,e in zip(steps,energies))
                        / (sum((e - sum(energies)/len(energies))**2 for e in energies) or 1e-9), 4)
                  if len(energies) > 2 else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class VRunCreate(BaseModel):
    algorithm: str = Field(default="vqe", description="vqe | qaoa | adapt_vqe | other")
    run_id: Optional[str] = None
    project_slug: Optional[str] = None
    ansatz_type: Optional[str] = None
    n_parameters: int = Field(default=0, ge=0)
    n_qubits: int = Field(default=1, ge=1, le=50)
    hamiltonian_type: Optional[str] = None


class IterationAdd(BaseModel):
    energy: float
    params: Optional[list[float]] = None
    gradient_norm: Optional[float] = None
    step: Optional[int] = None
    metadata: Optional[dict[str, Any]] = None


class VRunComplete(BaseModel):
    optimal_energy: Optional[float] = None
    optimal_params: Optional[list[float]] = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def create_vrun(req: VRunCreate, db: Session = Depends(get_db)):
    """Start tracking a new variational algorithm run."""
    allowed = {"vqe", "qaoa", "adapt_vqe", "other"}
    if req.algorithm not in allowed:
        raise HTTPException(422, f"algorithm must be one of {allowed}")
    vrun = VariationalRun(
        vrun_id=f"vrun-{uuid.uuid4().hex[:12]}",
        algorithm=req.algorithm,
        run_id=req.run_id,
        project_slug=req.project_slug,
        ansatz_type=req.ansatz_type,
        n_parameters=req.n_parameters,
        n_qubits=req.n_qubits,
        hamiltonian_type=req.hamiltonian_type,
        iterations=[],
        convergence_status="running",
    )
    db.add(vrun)
    db.commit()
    db.refresh(vrun)
    return _vrun_to_dict(vrun)


@router.post("/{vrun_id}/iterations")
def add_iteration(vrun_id: str, req: IterationAdd, db: Session = Depends(get_db)):
    """Push a new iteration's energy + parameters."""
    vrun = _get_vrun(db, vrun_id)
    step = req.step if req.step is not None else len(vrun.iterations or [])
    entry: dict[str, Any] = {
        "step": step,
        "energy": req.energy,
        "params": req.params,
        "gradient_norm": req.gradient_norm,
        "metadata": req.metadata or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    iters = list(vrun.iterations or [])
    iters.append(entry)
    vrun.iterations = iters

    # Update optimal
    energies = [it["energy"] for it in iters if it.get("energy") is not None]
    if energies:
        opt_e = min(energies)
        if vrun.optimal_energy is None or opt_e < vrun.optimal_energy:
            vrun.optimal_energy = opt_e
            opt_iter = next((it for it in iters if it["energy"] == opt_e), None)
            if opt_iter and opt_iter.get("params"):
                vrun.optimal_params = opt_iter["params"]

    analysis = _analyse(vrun)
    vrun.convergence_status = analysis["convergence_status"]
    db.commit()
    return {"step": step, "energy": req.energy, "convergence_status": vrun.convergence_status,
            "n_iterations": len(iters), "gradient_norm": analysis["gradient_norm"]}


@router.post("/{vrun_id}/complete")
def complete_vrun(vrun_id: str, req: VRunComplete, db: Session = Depends(get_db)):
    """Mark a variational run as complete."""
    vrun = _get_vrun(db, vrun_id)
    if req.optimal_energy is not None:
        vrun.optimal_energy = req.optimal_energy
    if req.optimal_params is not None:
        vrun.optimal_params = req.optimal_params
    energies = [it["energy"] for it in (vrun.iterations or []) if it.get("energy") is not None]
    slope, _ = _linreg(list(range(len(energies))), energies)
    vrun.convergence_status = _convergence_status(energies, slope)
    vrun.completed_at = datetime.now(timezone.utc)
    db.commit()
    return _vrun_to_dict(vrun)


@router.get("/{vrun_id}")
def get_vrun_detail(vrun_id: str, db: Session = Depends(get_db)):
    """Get full convergence analysis for a variational run."""
    vrun = _get_vrun(db, vrun_id)
    d = _vrun_to_dict(vrun)
    d["analysis"] = _analyse(vrun)
    return d


@router.get("")
def list_vruns(
    algorithm: Optional[str] = None,
    project: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = select(VariationalRun).order_by(VariationalRun.created_at.desc())
    if algorithm:
        q = q.where(VariationalRun.algorithm == algorithm)
    if project:
        q = q.where(VariationalRun.project_slug == project)
    return [_vrun_to_dict(v) for v in db.scalars(q.limit(limit)).all()]


def _get_vrun(db: Session, vrun_id: str) -> VariationalRun:
    v = db.scalar(select(VariationalRun).where(VariationalRun.vrun_id == vrun_id))
    if v is None:
        raise HTTPException(404, f"Variational run '{vrun_id}' not found")
    return v


def _vrun_to_dict(vrun: VariationalRun) -> dict:
    return {
        "vrun_id": vrun.vrun_id,
        "algorithm": vrun.algorithm,
        "run_id": vrun.run_id,
        "project_slug": vrun.project_slug,
        "ansatz_type": vrun.ansatz_type,
        "n_parameters": vrun.n_parameters,
        "n_qubits": vrun.n_qubits,
        "hamiltonian_type": vrun.hamiltonian_type,
        "n_iterations": len(vrun.iterations or []),
        "optimal_energy": vrun.optimal_energy,
        "optimal_params": vrun.optimal_params,
        "convergence_status": vrun.convergence_status,
        "created_at": vrun.created_at.isoformat(),
        "completed_at": vrun.completed_at.isoformat() if vrun.completed_at else None,
    }
