"""Compute budget and cost tracking using real provider pricing.

Pricing sources (verified August 2024):
  IBM Quantum  — https://quantum.ibm.com/pricing
  IonQ         — https://ionq.com/pricing
  Rigetti/OQC  — https://aws.amazon.com/braket/pricing/
  Quantinuum   — https://azure.microsoft.com/pricing/details/azure-quantum/
"""

from __future__ import annotations

import os
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

# Gates that count as two-qubit for pricing purposes
_TWO_Q = frozenset({
    "cx", "cz", "ecr", "swap", "rzz", "rxx", "ryy", "cp",
    "cnot", "ccx", "cswap", "iswap", "dcx", "ch", "crz", "cu",
})

# ── Real provider pricing (verified August 2024) ──────────────────────────────
#
# IBM:        $1.60/second of QPU time  (Standard / Pay-as-you-go plan)
# IonQ:       $0.30 base + $0.00035/1Q-gate-shot + $0.00097/2Q-gate-shot
# Rigetti:    $0.0135/task + $0.00035/shot  (via AWS Braket)
# Quantinuum: $0.10/HQC, ~5 HQC/shot on H1-1  (via Azure Quantum)
# OQC:        $0.35/task + $0.00035/shot  (via AWS Braket)
# Simulators: free (Aer/local) or $0.075/task + $0.00075/shot (AWS SV1)
#
PROVIDER_PRICING: dict[str, dict] = {
    "ibm": {
        "model": "time_based",
        "usd_per_second": 1.60,
        "source": "https://quantum.ibm.com/pricing",
        "note": "Pay-as-you-go. Open plan: 10 min QPU/month free.",
        "verified": "2024-08",
    },
    "ionq": {
        "model": "gate_shot",
        "task_usd": 0.30,
        "one_q_usd": 0.00035,
        "two_q_usd": 0.00097,
        "source": "https://ionq.com/pricing",
        "verified": "2024-08",
    },
    "rigetti": {
        "model": "task_shot",
        "task_usd": 0.0135,
        "shot_usd": 0.00035,
        "source": "https://aws.amazon.com/braket/pricing/",
        "verified": "2024-08",
    },
    "quantinuum": {
        "model": "hqc",
        "hqc_per_shot": 5.0,
        "usd_per_hqc": 0.10,
        "source": "https://azure.microsoft.com/pricing/details/azure-quantum/",
        "note": "H1-1 (20-qubit system). H2-1 pricing differs.",
        "verified": "2024-08",
    },
    "oqc": {
        "model": "task_shot",
        "task_usd": 0.35,
        "shot_usd": 0.00035,
        "source": "https://aws.amazon.com/braket/pricing/",
        "verified": "2024-08",
    },
    "simulator": {
        "model": "free",
        "source": "Aer / local simulator — no QPU cost",
        "verified": "2024-08",
    },
    "aer": {
        "model": "free",
        "source": "Aer / local simulator — no QPU cost",
        "verified": "2024-08",
    },
    "braket_sv1": {
        "model": "task_shot",
        "task_usd": 0.075,
        "shot_usd": 0.00075,
        "source": "https://aws.amazon.com/braket/pricing/",
        "note": "AWS SV1 managed simulator.",
        "verified": "2024-08",
    },
}

# Q-Lab internal credit unit: 1 credit = $0.10 USD (configurable)
_CREDITS_PER_USD: float = float(os.getenv("QLAB_CREDITS_PER_USD", "10"))


def _resolve_provider(value: str | None) -> str:
    """Map a backend name or provider string to a PROVIDER_PRICING key."""
    name = (value or "simulator").lower()
    if "ionq" in name:
        return "ionq"
    if "quantinuum" in name or "h1" in name or "h2" in name:
        return "quantinuum"
    if "oqc" in name or "oxford" in name:
        return "oqc"
    if "rigetti" in name or "aspen" in name:
        return "rigetti"
    if "ibm" in name:
        return "ibm"
    if "sim" in name or "aer" in name or "sv1" in name or "dm1" in name:
        return "simulator"
    if "braket" in name:
        return "braket_sv1"
    return "ibm"  # default to IBM as the most common real QPU


def _usd_for_circuit(
    provider_key: str,
    shots: int,
    depth: int,
    qubits: int,
    gate_counts: dict,
) -> float:
    """Compute estimated USD cost using the provider's real billing model."""
    p = PROVIDER_PRICING.get(provider_key, PROVIDER_PRICING["ibm"])
    model = p["model"]

    if model == "free":
        return 0.0

    if model == "time_based":
        # IBM charges per second of QPU time.
        # Empirical estimate: base overhead (~0.5s) + shots × circuit_time
        # circuit_time ≈ depth × 0.5μs/layer (superconducting gate ~50-500ns each)
        circuit_time_s = depth * 0.0000005  # 0.5 μs per layer
        qpu_s = max(0.5, shots * circuit_time_s + 0.1 * qubits)
        return round(qpu_s * p["usd_per_second"], 4)

    if model == "gate_shot":
        # IonQ: per gate per shot, minimum $0.30/circuit
        one_q = sum(v for k, v in gate_counts.items() if str(k).lower() not in _TWO_Q)
        two_q = sum(v for k, v in gate_counts.items() if str(k).lower() in _TWO_Q)
        gate_cost = (one_q * shots * p["one_q_usd"]) + (two_q * shots * p["two_q_usd"])
        return round(max(p["task_usd"], gate_cost), 4)

    if model == "task_shot":
        # Rigetti / OQC / AWS managed simulators: per-task + per-shot
        return round(p["task_usd"] + shots * p["shot_usd"], 4)

    if model == "hqc":
        # Quantinuum: HQC-based (Hardware Quantum Credits)
        hqc = shots * p["hqc_per_shot"]
        return round(hqc * p["usd_per_hqc"], 4)

    return 0.0


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
    return _usd_for_circuit(provider, shots, depth, qubits, gate_counts)


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
    return _usd_for_circuit(provider, shots, depth, qubits, gate_counts)


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

@router.get("/provider-pricing")
def get_provider_pricing():
    """Return the real documented pricing for each supported provider."""
    return {
        "credits_per_usd": _CREDITS_PER_USD,
        "usd_per_credit": round(1.0 / _CREDITS_PER_USD, 4),
        "note": "Pricing verified from provider documentation. Check source URLs for latest rates.",
        "providers": {
            key: {k: v for k, v in p.items() if k != "note" or "note" in p}
            for key, p in PROVIDER_PRICING.items()
        },
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
    jobs = db.scalars(select(JobSubmission).limit(5000)).all() if days > 0 else []
    by_provider: dict[str, dict] = {}
    by_project: dict[str | None, dict] = {}
    total_usd = 0.0

    for run in runs:
        usd = _run_usd(run)
        total_usd += usd
        provider = _resolve_provider(run.backend)
        by_provider.setdefault(provider, {"provider": provider, "total_usd": 0.0, "job_count": 0})
        by_provider[provider]["total_usd"] += usd
        by_provider[provider]["job_count"] += 1
        project = run.project_slug
        by_project.setdefault(project, {"project_slug": project, "total_usd": 0.0, "job_count": 0})
        by_project[project]["total_usd"] += usd
        by_project[project]["job_count"] += 1

    for job in jobs:
        if job.submitted_at and job.submitted_at < datetime.now(timezone.utc) - timedelta(days=days):
            continue
        usd = _job_usd(job)
        total_usd += usd
        provider = _resolve_provider(job.provider)
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
        "pricing_model": "real_documented_rates",
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
    """Estimate circuit cost using each provider's real documented pricing formula."""
    p = _resolve_provider(provider or backend)
    gate_counts = {}
    if one_q_gates > 0:
        gate_counts["sx"] = one_q_gates
    if two_q_gates > 0:
        gate_counts["cx"] = two_q_gates

    usd = _usd_for_circuit(p, shots, depth, qubits, gate_counts)
    credits = round(usd * _CREDITS_PER_USD, 4)
    pricing = PROVIDER_PRICING.get(p, PROVIDER_PRICING["ibm"])

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
        "billing_model": pricing["model"],
        "pricing_source": pricing["source"],
        "pricing_verified": pricing.get("verified", "unknown"),
        "note": pricing.get("note"),
        "disclaimer": "Pre-run estimate using documented provider rates. Actual billed amount may vary.",
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
