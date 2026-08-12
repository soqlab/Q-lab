"""Compute budget and cost allocation tracking."""

from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit, require_auth
from ..models import BudgetAlert, JobSubmission, Run

router = APIRouter(prefix="/api/v1/costs", tags=["costs"])

_ID_CHARS = string.ascii_lowercase + string.digits
_PROVIDER_RATE = {
    "ibm": 1.0,
    "ionq": 1.8,
    "braket": 1.4,
    "rigetti": 1.2,
    "quantinuum": 2.4,
    "simulator": 0.05,
}
_CREDITS_PER_USD = 10.0


class BudgetCreate(BaseModel):
    name: str = Field(..., max_length=200)
    budget_type: str = Field("project", pattern="^(monthly|project|campaign|total)$")
    threshold_credits: float = Field(..., gt=0)
    alert_at_pct: float = Field(0.8, gt=0, le=1)
    project_slug: Optional[str] = Field(None, max_length=120)
    provider: Optional[str] = Field(None, max_length=32)


def _new_id() -> str:
    return "bud_" + "".join(secrets.choice(_ID_CHARS) for _ in range(14))


def _provider(value: str | None) -> str:
    name = (value or "simulator").lower()
    if "ionq" in name:
        return "ionq"
    if "braket" in name or "aws" in name:
        return "braket"
    if "quantinuum" in name or "h1" in name or "h2" in name:
        return "quantinuum"
    if "rigetti" in name:
        return "rigetti"
    if "ibm" in name:
        return "ibm"
    if "sim" in name or "aer" in name:
        return "simulator"
    return "ibm"


def _run_credits(run: Run) -> float:
    execution = run.execution or {}
    explicit = execution.get("cost_credits") or execution.get("credits")
    if explicit is not None:
        try:
            return round(float(explicit), 4)
        except (TypeError, ValueError):
            pass
    fp = run.fingerprint or {}
    results = run.results or {}
    provider = _provider(run.backend)
    shots = int(results.get("shots") or execution.get("shots") or 1024)
    depth = int(fp.get("depth") or 1)
    qubits = int(fp.get("num_qubits") or 1)
    two_q = sum(int(v) for k, v in (fp.get("gate_counts") or {}).items() if str(k).lower() in {"cx", "cz", "ecr", "swap", "rzz", "rxx", "ryy", "cp"})
    base = (shots / 1024.0) * (0.02 + depth * 0.0015 + qubits * 0.004 + two_q * 0.006)
    return round(base * _PROVIDER_RATE.get(provider, 1.0), 4)


def _job_credits(job: JobSubmission) -> float:
    if job.cost_credits is not None:
        return round(float(job.cost_credits), 4)
    depth = 50.0
    try:
        depth = float((job.provider_metadata or {}).get("depth") or depth)
    except (TypeError, ValueError):
        pass
    return round((job.shots / 1024.0) * (0.03 + depth * 0.001) * _PROVIDER_RATE.get(_provider(job.provider), 1.0), 4)


def _budget_to_dict(alert: BudgetAlert, used: float = 0.0) -> dict:
    pct = used / alert.threshold_credits if alert.threshold_credits else 0.0
    return {
        "alert_id": alert.alert_id,
        "name": alert.name,
        "budget_type": alert.budget_type,
        "project_slug": alert.project_slug,
        "provider": alert.provider,
        "threshold_credits": alert.threshold_credits,
        "alert_at_pct": alert.alert_at_pct,
        "triggered": pct >= alert.alert_at_pct,
        "used_credits": round(used, 4),
        "pct_used": round(pct, 4),
        "remaining_credits": round(max(0.0, alert.threshold_credits - used), 4),
        "created_at": alert.created_at.isoformat() if alert.created_at else None,
    }


def _runs_for_period(db: Session, days: int) -> list[Run]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    return db.scalars(select(Run).where(Run.created_at >= since).limit(5000)).all()


@router.get("/summary")
def cost_summary(
    period: str = Query("30d", pattern="^(7d|30d|90d|all|daily|weekly|monthly|all_time)$"),
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    days = {
        "daily": 1,
        "weekly": 7,
        "monthly": 30,
        "all_time": 3650,
        "7d": 7,
        "30d": 30,
        "90d": 90,
        "all": 3650,
    }[period]
    runs = _runs_for_period(db, days)
    jobs = db.scalars(select(JobSubmission).limit(5000)).all() if days > 0 else []
    by_provider: dict[str, dict] = {}
    by_project: dict[str | None, dict] = {}
    total = 0.0

    for run in runs:
        credits = _run_credits(run)
        total += credits
        provider = _provider(run.backend)
        by_provider.setdefault(provider, {"provider": provider, "total_credits": 0.0, "job_count": 0})
        by_provider[provider]["total_credits"] += credits
        by_provider[provider]["job_count"] += 1
        project = run.project_slug
        by_project.setdefault(project, {"project_slug": project, "total_credits": 0.0, "job_count": 0})
        by_project[project]["total_credits"] += credits
        by_project[project]["job_count"] += 1

    for job in jobs:
        if job.submitted_at and job.submitted_at < datetime.now(timezone.utc) - timedelta(days=days):
            continue
        credits = _job_credits(job)
        total += credits
        provider = _provider(job.provider)
        by_provider.setdefault(provider, {"provider": provider, "total_credits": 0.0, "job_count": 0})
        by_provider[provider]["total_credits"] += credits
        by_provider[provider]["job_count"] += 1
        project = job.project_slug
        by_project.setdefault(project, {"project_slug": project, "total_credits": 0.0, "job_count": 0})
        by_project[project]["total_credits"] += credits
        by_project[project]["job_count"] += 1

    for item in by_provider.values():
        item["total_credits"] = round(item["total_credits"], 4)
        item["avg_per_job"] = round(item["total_credits"] / item["job_count"], 4) if item["job_count"] else 0.0
    for item in by_project.values():
        item["total_credits"] = round(item["total_credits"], 4)

    budgets = db.scalars(select(BudgetAlert)).all()
    monthly = next((b for b in budgets if b.budget_type == "monthly"), None)
    pct = total / monthly.threshold_credits if monthly else None
    return {
        "period": period,
        "total_credits": round(total, 4),
        "total_usd_estimate": round(total / _CREDITS_PER_USD, 2),
        "credits_per_usd": _CREDITS_PER_USD,
        "by_provider": sorted(by_provider.values(), key=lambda x: -x["total_credits"]),
        "by_project": sorted(by_project.values(), key=lambda x: -x["total_credits"]),
        "monthly_budget_credits": monthly.threshold_credits if monthly else None,
        "budget_pct_used": round(pct, 4) if pct is not None else None,
        "budget_status": "no_budget" if monthly is None else "over_budget" if pct and pct >= 1 else "warning" if pct and pct >= monthly.alert_at_pct else "ok",
        "active_alerts": sum(1 for b in budgets if _budget_to_dict(b, total)["triggered"]),
    }


@router.get("/timeline")
def cost_timeline(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    runs = _runs_for_period(db, days)
    entries: dict[str, dict] = {}
    for run in runs:
        key = run.created_at.date().isoformat()
        entries.setdefault(key, {"date": key, "credits": 0.0, "jobs": 0})
        entries[key]["credits"] += _run_credits(run)
        entries[key]["jobs"] += 1
    out = []
    for i in range(days - 1, -1, -1):
        key = (datetime.now(timezone.utc).date() - timedelta(days=i)).isoformat()
        item = entries.get(key, {"date": key, "credits": 0.0, "jobs": 0})
        item["credits"] = round(item["credits"], 4)
        out.append(item)
    return {"period": f"{days}d", "resolution": "day", "entries": out, "total_credits": round(sum(e["credits"] for e in out), 4), "total_jobs": sum(e["jobs"] for e in out)}


@router.get("/estimate")
def estimate_cost(
    provider: str, backend: str,
    shots: int = Query(1024, ge=1), depth: int = Query(1, ge=1), qubits: int = Query(1, ge=1),
    request: Request = None,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    p = _provider(provider or backend)
    estimated = round((shots / 1024.0) * (0.03 + depth * 0.0015 + qubits * 0.004) * _PROVIDER_RATE.get(p, 1.0), 4)
    if identity and identity.user_id:
        log_audit(db, "cost_oracle.queried", "cost", p, identity=identity, request=request,
                  meta={"provider": p, "backend": backend, "shots": shots, "depth": depth, "qubits": qubits})
    return {
        "provider": p,
        "backend": backend,
        "shots": shots,
        "depth": depth,
        "estimated_credits": estimated,
        "estimated_usd": round(estimated / _CREDITS_PER_USD, 2),
        "breakdown": {"provider_rate": _PROVIDER_RATE.get(p, 1.0), "credits_per_usd": _CREDITS_PER_USD},
    }


@router.get("/budget")
def list_budgets(db: Session = Depends(get_db)):
    alerts = db.scalars(select(BudgetAlert).order_by(BudgetAlert.created_at.desc())).all()
    runs = _runs_for_period(db, 3650)
    total = sum(_run_credits(r) for r in runs)
    by_project: dict[str | None, float] = {}
    for run in runs:
        by_project[run.project_slug] = by_project.get(run.project_slug, 0.0) + _run_credits(run)
    return [_budget_to_dict(a, by_project.get(a.project_slug, total) if a.project_slug else total) for a in alerts]


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
