"""Cost Oracle: compare what one experiment would cost on each provider.

Every number comes from the shared price table (``app/provider_prices.json``),
and every row carries that price's source URL, verified date and, when the
entry is older than 30 days, a stale warning.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from .. import pricing
from ..store import store_put, store_list

router = APIRouter(prefix="/api/v1/cost-oracle", tags=["cost-oracle"])

NS = "oracle_costs"

# Kept for callers that read the table by this name; it is the shared table.
PRICING: dict = pricing.PRICES


class CostEstimateRequest(BaseModel):
    n_qubits: int = Field(5, ge=1)
    circuit_depth: int = Field(20, ge=1)
    n_shots: int = Field(8192, ge=1)
    n_circuits: int = Field(1, ge=1)
    # Gate counts per circuit, for gate-shot pricing (IonQ on Azure). When left
    # out we assume each layer has n_qubits 1-qubit gates and n_qubits//2 2-qubit gates.
    one_q_gates: Optional[int] = Field(None, ge=0)
    two_q_gates: Optional[int] = Field(None, ge=0)
    provider_ids: list[str] = Field(default_factory=lambda: list(pricing.PRICES.keys()))
    experiment_duration_days: int = 1

class ProviderCostEstimate(BaseModel):
    provider_id: str
    provider_name: str
    cost_per_circuit_usd: Optional[float]  # None: the provider publishes no price
    cost_total_usd: Optional[float]
    price_display: Optional[str] = None    # "not public" when there is no number
    cost_note: str
    estimated_queue_min: Optional[int] = None  # unknown: live queues need the user's provider key
    shots_available: bool
    monthly_budget_warning: bool
    free_tier: bool
    currency: str
    pricing_key: str
    pricing_name: str
    pricing_source: str
    pricing_verified: str
    pricing_age_days: int
    pricing_stale: bool
    stale_warning: Optional[str] = None

class CostEstimateResult(BaseModel):
    estimate_id: str
    n_qubits: int
    n_shots: int
    n_circuits: int
    generated_at: str
    providers: list[ProviderCostEstimate]
    cheapest_provider: str
    cheapest_cost_usd: float
    total_if_all_providers_usd: float
    recommendations: list[str]
    stale_warnings: list[str] = []

class BudgetTrackRequest(BaseModel):
    provider_id: str
    cost_usd: float
    n_shots: int
    circuit_name: str = ""

def _gate_counts(req: CostEstimateRequest) -> tuple[int, int]:
    one_q = req.one_q_gates if req.one_q_gates is not None else req.n_qubits * req.circuit_depth
    two_q = req.two_q_gates if req.two_q_gates is not None else (req.n_qubits // 2) * req.circuit_depth
    return one_q, two_q


def _describe(key: str, req: CostEstimateRequest, one_q: int, two_q: int) -> str:
    p = pricing.PRICES[key]
    m = p["model"]
    if m in ("time_based", "per_minute"):
        secs = pricing.estimate_qpu_seconds(req.n_shots, req.circuit_depth, req.n_qubits)
        return f"~{secs:.1f}s per circuit (Q-Lab time estimate). {p.get('note', '')}".strip()
    if m == "gate_shot":
        assumed = "" if req.one_q_gates is not None and req.two_q_gates is not None else " (gate counts assumed)"
        return f"{one_q} 1q + {two_q} 2q gates x {req.n_shots} shots{assumed}. {p.get('note', '')}".strip()
    return p.get("note", "")


def estimate_rows(req: CostEstimateRequest) -> list[ProviderCostEstimate]:
    one_q, two_q = _gate_counts(req)
    rows = []
    for pid in req.provider_ids:
        if pid not in pricing.PRICES:
            continue
        p = pricing.PRICES[pid]
        per = pricing.estimate_amount(
            pid, req.n_shots, one_q_gates=one_q, two_q_gates=two_q,
            depth=req.circuit_depth, qubits=req.n_qubits,
        )
        total = None if per is None else round(per * req.n_circuits, 6)
        rows.append(ProviderCostEstimate(
            provider_id=pid, provider_name=p["name"],
            cost_per_circuit_usd=None if per is None else round(per, 6),
            cost_total_usd=total,
            price_display=pricing.NOT_PUBLIC if per is None else None,
            cost_note=_describe(pid, req, one_q, two_q),
            shots_available=True,
            monthly_budget_warning=bool(total and total > 100.0),
            free_tier=p.get("free_tier", False),
            currency=p.get("currency", "USD"),
            **pricing.provenance(pid),
        ))
    return rows


@router.post("/estimate", response_model=CostEstimateResult)
def estimate_cost(req: CostEstimateRequest):
    estimates = estimate_rows(req)
    # Cheapest and totals only over USD prices that are public.
    comparable = [e for e in estimates if e.cost_total_usd is not None and e.currency == "USD"]
    cheapest = min(comparable, key=lambda e: e.cost_total_usd) if comparable else None
    recs = []
    if cheapest is not None and cheapest.free_tier:
        recs.append(f"{cheapest.provider_name} offers this at no cost")
    if req.n_shots > 10000:
        recs.append("Consider reducing shots to 8192 — standard error bars achievable with fewer shots")
    if req.n_circuits > 10:
        recs.append("Batch circuits in a single job to minimize per-task overhead costs")
    hidden = [e.provider_name for e in estimates if e.cost_total_usd is None]
    if hidden:
        recs.append("No public price, contact the provider: " + ", ".join(hidden))
    priced_sort = sorted(estimates, key=lambda e: (e.cost_total_usd is None, e.currency != "USD", e.cost_total_usd or 0.0))
    return CostEstimateResult(
        estimate_id=str(uuid.uuid4()),
        n_qubits=req.n_qubits, n_shots=req.n_shots, n_circuits=req.n_circuits,
        generated_at=datetime.now(timezone.utc).isoformat(),
        providers=priced_sort,
        cheapest_provider=cheapest.provider_id if cheapest else "",
        cheapest_cost_usd=cheapest.cost_total_usd if cheapest else 0.0,
        total_if_all_providers_usd=round(sum(e.cost_total_usd for e in comparable), 4),
        recommendations=recs,
        stale_warnings=sorted({e.stale_warning for e in estimates if e.stale_warning}),
    )

@router.post("/track")
def track_cost(req: BudgetTrackRequest, db: Session = Depends(get_db)):
    entry = {"id": str(uuid.uuid4()), "recorded_at": datetime.now(timezone.utc).isoformat(), **req.model_dump()}
    store_put(db, NS, entry["id"], entry)
    history = store_list(db, NS)
    return {"tracked": True, "running_total_usd": round(sum(h["cost_usd"] for h in history), 4)}

@router.get("/history")
def get_history(db: Session = Depends(get_db)):
    history = store_list(db, NS)
    total = sum(h["cost_usd"] for h in history)
    by_provider: dict = {}
    for h in history:
        by_provider[h["provider_id"]] = by_provider.get(h["provider_id"], 0.0) + h["cost_usd"]
    return {"history": history, "total_usd": round(total, 4), "by_provider": {k: round(v, 4) for k, v in by_provider.items()}}

@router.get("/providers")
def get_providers():
    return {"providers": pricing.table(), "stale_after_days": pricing.STALE_AFTER_DAYS}
