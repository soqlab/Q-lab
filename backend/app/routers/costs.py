"""Compute budget and cost tracking.

Prices come from ``app/provider_prices.json`` (see ``app/pricing.py``): one
table with a source URL and a verified date on every entry.
"""

from __future__ import annotations

import os
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import false, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit, require_auth
from ..models import BudgetAlert, JobSubmission, Run
from .. import pricing

router = APIRouter(prefix="/api/v1/costs", tags=["costs"])

_ID_CHARS = string.ascii_lowercase + string.digits

_TWO_Q = pricing.TWO_Q_GATES

# Q-Lab internal credit unit: 1 credit = $0.10 USD (configurable)
_CREDITS_PER_USD: float = float(os.getenv("QLAB_CREDITS_PER_USD", "10"))


def _resolve_provider(value: str | None) -> str | None:
    """Map a backend name or provider string to a price entry key (None: no price on file)."""
    return pricing.resolve(value or "simulator")


def _usd_for_circuit(
    provider_key: str | None,
    shots: int,
    depth: int,
    qubits: int,
    gate_counts: dict,
) -> float | None:
    """Estimated cost of one task from the price table. None when no price is public."""
    if provider_key is None:
        return None
    one_q = sum(v for k, v in gate_counts.items() if str(k).lower() not in _TWO_Q)
    two_q = sum(v for k, v in gate_counts.items() if str(k).lower() in _TWO_Q)
    amount = pricing.estimate_amount(
        provider_key, shots, one_q_gates=one_q, two_q_gates=two_q, depth=depth, qubits=qubits,
    )
    return None if amount is None else round(amount, 4)


def _run_usd(run: Run) -> float:
    """Return USD cost for a completed run.

    Priority:
    1. Actual cost reported by provider in run.execution (most accurate)
    2. Actual cost in run.results
    3. Estimated from real pricing formula
    """
    execution = run.execution or {}
    results = run.results or {}

    # Check if provider returned a real cost
    for field in ("cost_usd", "cost", "total_cost", "cost_credits"):
        raw = execution.get(field) or results.get(field)
        if raw is not None:
            try:
                val = float(raw)
                # If stored as credits convert to USD
                if field == "cost_credits":
                    val = val / _CREDITS_PER_USD
                return round(val, 4)
            except (TypeError, ValueError):
                pass

    fp = run.fingerprint or {}
    provider = _resolve_provider(run.backend)
    shots = int(results.get("shots") or execution.get("shots") or 1024)
    depth = int(fp.get("depth") or 1)
    qubits = int(fp.get("num_qubits") or 1)
    gate_counts = {str(k): int(v) for k, v in (fp.get("gate_counts") or {}).items()}
    # No public price: counted as 0 in totals (see "unpriced" in the summary).
    return _usd_for_circuit(provider, shots, depth, qubits, gate_counts) or 0.0


def _run_credits(run: Run) -> float:
    return round(_run_usd(run) * _CREDITS_PER_USD, 4)


def _job_usd(job: JobSubmission) -> float:
    """Return USD cost for a job submission."""
    if job.cost_credits is not None:
        return round(float(job.cost_credits) / _CREDITS_PER_USD, 4)
    meta = job.provider_metadata or {}
    provider = _resolve_provider(job.provider)
    shots = job.shots or 1024
    depth = int(meta.get("depth") or 50)
    qubits = int(meta.get("num_qubits") or 1)
    gate_counts = {str(k): int(v) for k, v in (meta.get("gate_counts") or {}).items()}
    return _usd_for_circuit(provider, shots, depth, qubits, gate_counts) or 0.0


def _job_credits(job: JobSubmission) -> float:
    return round(_job_usd(job) * _CREDITS_PER_USD, 4)


def _budget_to_dict(alert: BudgetAlert, used_credits: float = 0.0) -> dict:
    pct = used_credits / alert.threshold_credits if alert.threshold_credits else 0.0
    return {
        "alert_id": alert.alert_id,
        "name": alert.name,
        "budget_type": alert.budget_type,
        "project_slug": alert.project_slug,
        "provider": alert.provider,
        "threshold_credits": alert.threshold_credits,
        "alert_at_pct": alert.alert_at_pct,
        "triggered": pct >= alert.alert_at_pct,
        "used_credits": round(used_credits, 4),
        "pct_used": round(pct, 4),
        "remaining_credits": round(max(0.0, alert.threshold_credits - used_credits), 4),
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


def _new_id() -> str:
    return "bud_" + "".join(secrets.choice(_ID_CHARS) for _ in range(14))


def _runs_for_period(db: Session, days: int) -> list[Run]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return db.scalars(select(Run).where(Run.created_at >= since).limit(5000)).all()


# ── Endpoints ─────────────────────────────────────────────────────────────────

def _jobs_visible_to(identity):
    """The caller's own jobs and their organisation's."""
    from .job_executor import _visible_to

    if identity is None or not identity.user_id:
        return false()
    return _visible_to(identity)


@router.get("/provider-pricing")
def get_provider_pricing():
    """Every price Q-Lab uses, each with its source URL, verified date and stale flag."""
    entries = pricing.table()
    return {
        "credits_per_usd": _CREDITS_PER_USD,
        "usd_per_credit": round(1.0 / _CREDITS_PER_USD, 4),
        "stale_after_days": pricing.STALE_AFTER_DAYS,
        "note": "Copied from each provider's public pricing page. Check the source URL for current rates.",
        "providers": {e["id"]: e for e in entries},
        "stale_entries": [e["id"] for e in entries if e["pricing_stale"]],
    }


@router.get("/summary")
def cost_summary(
    period: str = Query("30d", pattern="^(7d|30d|90d|all|daily|weekly|monthly|all_time)$"),
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    days = {
        "daily": 1, "weekly": 7, "monthly": 30, "all_time": 3650,
        "7d": 7, "30d": 30, "90d": 90, "all": 3650,
    }[period]
    runs = _runs_for_period(db, days)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    jobs = db.scalars(
        select(JobSubmission)
        .where(JobSubmission.submitted_at >= cutoff, _jobs_visible_to(identity))
        .limit(5000)
    ).all() if days > 0 else []
    by_provider: dict[str, dict] = {}
    by_project: dict[str | None, dict] = {}
    total_usd = 0.0

    for run in runs:
        usd = _run_usd(run)
        total_usd += usd
        provider = _resolve_provider(run.backend) or "unpriced"
        by_provider.setdefault(provider, {"provider": provider, "total_usd": 0.0, "job_count": 0})
        by_provider[provider]["total_usd"] += usd
        by_provider[provider]["job_count"] += 1
        project = run.project_slug
        by_project.setdefault(project, {"project_slug": project, "total_usd": 0.0, "job_count": 0})
        by_project[project]["total_usd"] += usd
        by_project[project]["job_count"] += 1

    for job in jobs:
        usd = _job_usd(job)
        total_usd += usd
        provider = _resolve_provider(job.provider) or "unpriced"
        by_provider.setdefault(provider, {"provider": provider, "total_usd": 0.0, "job_count": 0})
        by_provider[provider]["total_usd"] += usd
        by_provider[provider]["job_count"] += 1
        project = job.project_slug
        by_project.setdefault(project, {"project_slug": project, "total_usd": 0.0, "job_count": 0})
        by_project[project]["total_usd"] += usd
        by_project[project]["job_count"] += 1

    total_credits = round(total_usd * _CREDITS_PER_USD, 4)
    for item in by_provider.values():
        item["total_usd"] = round(item["total_usd"], 4)
        item["total_credits"] = round(item["total_usd"] * _CREDITS_PER_USD, 4)
        item["avg_usd_per_job"] = round(item["total_usd"] / item["job_count"], 4) if item["job_count"] else 0.0
    for item in by_project.values():
        item["total_usd"] = round(item["total_usd"], 4)
        item["total_credits"] = round(item["total_usd"] * _CREDITS_PER_USD, 4)

    budgets = db.scalars(select(BudgetAlert)).all()
    monthly = next((b for b in budgets if b.budget_type == "monthly"), None)
    pct = total_credits / monthly.threshold_credits if monthly else None
    return {
        "period": period,
        "total_usd": round(total_usd, 4),
        "total_credits": total_credits,
        "credits_per_usd": _CREDITS_PER_USD,
        "pricing_model": "published_rates",
        "pricing_stale_entries": [e["id"] for e in pricing.table() if e["pricing_stale"]],
        "by_provider": sorted(by_provider.values(), key=lambda x: -x["total_usd"]),
        "by_project": sorted(by_project.values(), key=lambda x: -x["total_usd"]),
        "monthly_budget_credits": monthly.threshold_credits if monthly else None,
        "budget_pct_used": round(pct, 4) if pct is not None else None,
        "budget_status": (
            "no_budget" if monthly is None
            else "over_budget" if pct and pct >= 1
            else "warning" if pct and pct >= monthly.alert_at_pct
            else "ok"
        ),
        "active_alerts": sum(1 for b in budgets if _budget_to_dict(b, total_credits)["triggered"]),
    }


@router.get("/timeline")
def cost_timeline(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    runs = _runs_for_period(db, days)
    entries: dict[str, dict] = {}
    for run in runs:
        if not run.created_at:
            continue
        key = run.created_at.date().isoformat()
        entries.setdefault(key, {"date": key, "usd": 0.0, "credits": 0.0, "jobs": 0})
        usd = _run_usd(run)
        entries[key]["usd"] += usd
        entries[key]["credits"] += usd * _CREDITS_PER_USD
        entries[key]["jobs"] += 1
    out = []
    for i in range(days - 1, -1, -1):
        key = (datetime.now(timezone.utc).date() - timedelta(days=i)).isoformat()
        item = entries.get(key, {"date": key, "usd": 0.0, "credits": 0.0, "jobs": 0})
        item["usd"] = round(item["usd"], 4)
        item["credits"] = round(item["credits"], 4)
        out.append(item)
    total_usd = round(sum(e["usd"] for e in out), 4)
    return {
        "period": f"{days}d",
        "resolution": "day",
        "entries": out,
        "total_usd": total_usd,
        "total_credits": round(total_usd * _CREDITS_PER_USD, 4),
        "total_jobs": sum(e["jobs"] for e in out),
    }


@router.get("/estimate")
def estimate_cost(
    provider: str,
    backend: str,
    shots: int = Query(1024, ge=1),
    depth: int = Query(1, ge=1),
    qubits: int = Query(1, ge=1),
    one_q_gates: int = Query(0, ge=0),
    two_q_gates: int = Query(0, ge=0),
    request: Request = None,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    """Estimate a circuit's cost from the provider's published price, with source and date."""
    p = _resolve_provider(provider or backend)
    if p is None:
        p = _resolve_provider(backend)
    if p is None:
        raise HTTPException(404, f"No published price on file for provider '{provider}' / backend '{backend}'")
    gate_counts = {}
    if one_q_gates > 0:
        gate_counts["sx"] = one_q_gates
    if two_q_gates > 0:
        gate_counts["cx"] = two_q_gates

    usd = _usd_for_circuit(p, shots, depth, qubits, gate_counts)
    credits = round(usd * _CREDITS_PER_USD, 4) if usd is not None else None
    entry = pricing.PRICES[p]
    prov = pricing.provenance(p)

    if identity and identity.user_id:
        log_audit(db, "cost_oracle.queried", "cost", p, identity=identity, request=request,
                  meta={"provider": p, "backend": backend, "shots": shots, "depth": depth, "qubits": qubits})

    return {
        "provider": p,
        "backend": backend,
        "shots": shots,
        "depth": depth,
        "qubits": qubits,
        "estimated_usd": usd,
        "estimated_credits": credits,
        "price_display": pricing.NOT_PUBLIC if usd is None else None,
        "currency": entry.get("currency", "USD"),
        "billing_model": entry["model"],
        **prov,
        "note": entry.get("note"),
        "disclaimer": "Pre-run estimate from the provider's published rates. Actual billed amount may vary.",
    }


@router.get("/budget")
def list_budgets(db: Session = Depends(get_db)):
    alerts = db.scalars(select(BudgetAlert).order_by(BudgetAlert.created_at.desc())).all()
    runs = _runs_for_period(db, 3650)
    total_credits = sum(_run_credits(r) for r in runs)
    by_project: dict[str | None, float] = {}
    for run in runs:
        by_project[run.project_slug] = by_project.get(run.project_slug, 0.0) + _run_credits(run)
    return [
        _budget_to_dict(a, by_project.get(a.project_slug, total_credits) if a.project_slug else total_credits)
        for a in alerts
    ]


class BudgetCreate(BaseModel):
    name: str = Field(..., max_length=200)
    budget_type: str = Field("project", pattern="^(monthly|project|campaign|total)$")
    threshold_credits: float = Field(..., gt=0)
    alert_at_pct: float = Field(0.8, gt=0, le=1)
    project_slug: Optional[str] = Field(None, max_length=120)
    provider: Optional[str] = Field(None, max_length=32)


@router.post("/budget")
def create_budget(body: BudgetCreate, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    alert = BudgetAlert(
        alert_id=_new_id(),
        org_id=identity.org_id,
        name=body.name,
        budget_type=body.budget_type,
        project_slug=body.project_slug,
        provider=body.provider,
        threshold_credits=body.threshold_credits,
        alert_at_pct=body.alert_at_pct,
    )
    db.add(alert)
    db.commit()
    db.refresh(alert)
    return _budget_to_dict(alert)


@router.delete("/budget/{alert_id}")
def delete_budget(alert_id: str, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    alert = db.scalar(select(BudgetAlert).where(BudgetAlert.alert_id == alert_id))
    if alert is None:
        raise HTTPException(404, "Budget not found")
    db.delete(alert)
    db.commit()
    return {"deleted": True}
