"""QPU Cost Tracker — per-run cost estimation, project summaries, and budget checking.

Cost models (approximate, 2025):
  IBM Quantum:  $1.60 / second QPU time
  IonQ:         $0.01 / circuit credit  (credits = n_qubits * depth * shots / 1000)
  Rigetti:      $0.0035 / task
  Simulator:    free

Router prefix: /api/v1/costs
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..store import store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/cost-tracker", tags=["cost_tracker"])


# ─────────────────────────────────────────────────────────────────────────────
# Pricing defaults
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_PRICING: dict[str, dict] = {
    "ibm": {
        "unit": "seconds",
        "rate_usd_per_unit": 1.60,
        "free_tier_units": 10,
    },
    "ionq": {
        "unit": "circuit_credits",
        "rate_usd_per_unit": 0.01,
        "credit_formula": "n_qubits * circuit_depth * n_shots / 1000",
    },
    "rigetti": {
        "unit": "task",
        "rate_usd_per_unit": 0.0035,
        "min_shots": 100,
    },
    "simulator": {
        "unit": "shot",
        "rate_usd_per_unit": 0.0,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class PricingUpdate(BaseModel):
    provider: str
    unit: str
    rate_usd_per_unit: float
    notes: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Cost estimation
# ─────────────────────────────────────────────────────────────────────────────

def _estimate_cost(run_data: dict) -> dict:
    backend = (run_data.get("backend") or "").lower()
    execution = run_data.get("execution") or {}
    n_shots = execution.get("shots") or run_data.get("n_shots") or 1000
    n_qubits = run_data.get("n_qubits") or run_data.get("num_qubits") or 5

    timing = run_data.get("timing") or {}
    qpu_time_s = timing.get("execution_time_s") or timing.get("qpu_time") or 0.1

    # Fingerprint may carry depth
    fp = run_data.get("fingerprint") or {}
    circuit_depth = fp.get("depth") or 10

    if "ibm" in backend and "fake" not in backend:
        cost_usd = qpu_time_s * 1.60
        unit = "seconds"
        quantity = qpu_time_s
        provider = "ibm"
    elif "ionq" in backend:
        n_2q = max(n_qubits - 1, 1)
        credits = n_2q * circuit_depth * n_shots / 1000
        cost_usd = credits * 0.01
        unit = "credits"
        quantity = credits
        provider = "ionq"
    elif "rigetti" in backend or "ankaa" in backend:
        tasks = max(n_shots / 100, 1)
        cost_usd = 0.0035 * tasks
        unit = "tasks"
        quantity = tasks
        provider = "rigetti"
    elif "simulator" in backend or "aer" in backend or "fake" in backend or "statevector" in backend:
        cost_usd = 0.0
        unit = "free"
        quantity = 0.0
        provider = "simulator"
    else:
        cost_usd = 0.001 * n_shots  # fallback estimate
        unit = "estimated"
        quantity = float(n_shots)
        provider = backend.split("_")[0] if "_" in backend else backend

    return {
        "cost_usd": round(cost_usd, 6),
        "unit": unit,
        "quantity": round(quantity, 4),
        "provider": provider,
    }


def _run_to_dict(run: Run) -> dict:
    return {
        "run_id": run.run_id,
        "backend": run.backend or "",
        "project_slug": run.project_slug,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "circuit_name": run.circuit_name,
        "execution": run.execution or {},
        "timing": (run.context or {}).get("timing") or {},
        "fingerprint": run.fingerprint or {},
        "n_qubits": (run.fingerprint or {}).get("num_qubits") or (run.fingerprint or {}).get("n_qubits"),
        "n_shots": (run.execution or {}).get("shots"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/run/{run_id}")
def cost_for_run(run_id: str, db: Session = Depends(get_db)):
    """Cost estimate for a single run."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    data = _run_to_dict(run)
    cost = _estimate_cost(data)
    return {
        "run_id": run_id,
        "circuit_name": run.circuit_name,
        "backend": run.backend,
        "project_slug": run.project_slug,
        "created_at": data["created_at"],
        **cost,
    }


@router.get("/project/{project_slug}")
def cost_for_project(project_slug: str, db: Session = Depends(get_db)):
    """Cost summary for all runs in a project."""
    runs = db.scalars(
        select(Run).where(Run.project_slug == project_slug).order_by(Run.created_at.desc())
    ).all()

    if not runs:
        raise HTTPException(status_code=404, detail="No runs found for this project")

    total_cost = 0.0
    by_backend: dict[str, float] = defaultdict(float)
    by_month: dict[str, float] = defaultdict(float)
    most_expensive: dict | None = None

    run_costs = []
    for run in runs:
        data = _run_to_dict(run)
        cost = _estimate_cost(data)
        run_cost = cost["cost_usd"]
        total_cost += run_cost
        by_backend[run.backend or "unknown"] += run_cost
        if run.created_at:
            month_key = run.created_at.strftime("%Y-%m")
            by_month[month_key] += run_cost
        run_costs.append({"run_id": run.run_id, "cost_usd": run_cost, **cost})
        if most_expensive is None or run_cost > most_expensive["cost_usd"]:
            most_expensive = {"run_id": run.run_id, "cost_usd": run_cost, "backend": run.backend}

    avg = total_cost / len(runs) if runs else 0.0

    return {
        "project_slug": project_slug,
        "total_cost_usd": round(total_cost, 6),
        "by_backend": {k: round(v, 6) for k, v in by_backend.items()},
        "by_month": {k: round(v, 6) for k, v in sorted(by_month.items())},
        "run_count": len(runs),
        "avg_cost_per_run": round(avg, 6),
        "most_expensive_run": most_expensive,
    }


@router.get("/summary")
def cost_summary(db: Session = Depends(get_db)):
    """Overall cost summary across all runs."""
    runs = db.scalars(select(Run).order_by(Run.created_at.desc())).all()

    total_cost = 0.0
    by_provider: dict[str, float] = defaultdict(float)
    monthly_trend: dict[str, float] = defaultdict(float)
    run_details = []
    free_count = 0

    for run in runs:
        data = _run_to_dict(run)
        cost = _estimate_cost(data)
        run_cost = cost["cost_usd"]
        total_cost += run_cost
        by_provider[cost["provider"]] += run_cost
        if run.created_at:
            month_key = run.created_at.strftime("%Y-%m")
            monthly_trend[month_key] += run_cost
        if run_cost == 0.0:
            free_count += 1
        run_details.append({
            "run_id": run.run_id,
            "circuit_name": run.circuit_name,
            "backend": run.backend,
            "created_at": data["created_at"],
            "cost_usd": run_cost,
            "provider": cost["provider"],
        })

    run_details.sort(key=lambda x: x["cost_usd"], reverse=True)
    total_runs = len(runs)
    free_pct = (free_count / total_runs * 100) if total_runs else 0

    return {
        "total_cost_usd": round(total_cost, 6),
        "total_runs": total_runs,
        "by_provider": {k: round(v, 6) for k, v in sorted(by_provider.items(), key=lambda x: -x[1])},
        "monthly_trend": {k: round(v, 6) for k, v in sorted(monthly_trend.items())},
        "top_10_most_expensive": run_details[:10],
        "free_vs_paid_pct": {"free": round(free_pct, 1), "paid": round(100 - free_pct, 1)},
    }


@router.get("/budget-check")
def budget_check(
    monthly_budget_usd: float = Query(100.0, ge=0),
    db: Session = Depends(get_db),
):
    """Compare current month's spending against a monthly budget."""
    now = datetime.now(timezone.utc)
    month_prefix = now.strftime("%Y-%m")
    days_in_month = 30  # approximation
    day_of_month = now.day

    runs = db.scalars(select(Run).order_by(Run.created_at.asc())).all()

    current_month_spend = 0.0
    for run in runs:
        if run.created_at and run.created_at.strftime("%Y-%m") == month_prefix:
            cost = _estimate_cost(_run_to_dict(run))
            current_month_spend += cost["cost_usd"]

    # Project: daily rate * days remaining
    daily_rate = current_month_spend / max(day_of_month, 1)
    projected_monthly = daily_rate * days_in_month
    remaining = max(monthly_budget_usd - current_month_spend, 0)
    overage = max(current_month_spend - monthly_budget_usd, 0)
    is_over = current_month_spend > monthly_budget_usd

    return {
        "current_month_spend": round(current_month_spend, 6),
        "budget": monthly_budget_usd,
        "remaining": round(remaining, 6),
        "overage": round(overage, 6),
        "is_over_budget": is_over,
        "projected_monthly": round(projected_monthly, 6),
        "day_of_month": day_of_month,
    }


@router.post("/pricing")
def update_pricing(payload: PricingUpdate, db: Session = Depends(get_db)):
    """Store a custom pricing config for a provider."""
    key = payload.provider.lower()
    data = {
        "provider": key,
        "unit": payload.unit,
        "rate_usd_per_unit": payload.rate_usd_per_unit,
        "notes": payload.notes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, "cost_pricing", key, data)
    return {"ok": True, "pricing": data}


@router.get("/pricing")
def list_pricing(db: Session = Depends(get_db)):
    """Return all custom pricing overrides + default pricing."""
    custom = {r["provider"]: r for r in store_list(db, "cost_pricing")}
    merged = {**DEFAULT_PRICING}
    for provider, override in custom.items():
        merged[provider] = override
    return {"pricing": merged, "custom_overrides": list(custom.keys())}
