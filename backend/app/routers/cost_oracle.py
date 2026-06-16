from __future__ import annotations
import uuid, math
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/cost-oracle", tags=["cost-oracle"])

NS = "oracle_costs"

PRICING: dict = {
    "ibm_quantum_free": {"name": "IBM Quantum (Free)", "cost_per_shot": 0.0, "min_shots": 1, "max_shots": 100000, "monthly_limit_shots": 10000000, "currency": "USD", "free_tier": True, "note": "Free tier via IBM Quantum Network"},
    "ibm_quantum_premium": {"name": "IBM Quantum (Premium)", "cost_per_shot": 0.0, "cost_per_second": 1.60, "min_shots": 1, "max_shots": 100000, "monthly_limit_shots": None, "currency": "USD", "free_tier": False, "note": "Dedicated access, billed per QPU second"},
    "aws_braket_sv1": {"name": "AWS Braket (SV1 Sim)", "cost_per_shot": 0.0, "cost_per_task": 0.075, "cost_per_sim_minute": 0.075, "min_shots": 1, "max_shots": 100000, "monthly_limit_shots": None, "currency": "USD", "free_tier": False, "note": "SV1 state-vector simulator"},
    "aws_braket_ionq": {"name": "AWS Braket (IonQ)", "cost_per_shot": 0.00097, "cost_per_task": 0.30, "min_shots": 1, "max_shots": 10000, "monthly_limit_shots": None, "currency": "USD", "free_tier": False, "note": "$0.30 per task + $0.00097 per shot"},
    "aws_braket_rigetti": {"name": "AWS Braket (Rigetti)", "cost_per_shot": 0.00035, "cost_per_task": 0.30, "min_shots": 10, "max_shots": 100000, "monthly_limit_shots": None, "currency": "USD", "free_tier": False, "note": "$0.30 per task + $0.00035 per shot"},
    "azure_ionq": {"name": "Azure Quantum (IonQ)", "cost_per_shot": 0.000975, "cost_per_qubit_gate": 0.0000975, "min_shots": 1, "max_shots": 10000, "monthly_limit_shots": None, "currency": "USD", "free_tier": False, "note": "IonQ via Azure, includes free $500 credit for new users"},
    "azure_quantinuum": {"name": "Azure Quantum (Quantinuum)", "cost_per_hqc": 0.00016, "min_shots": 1, "max_shots": 1000, "monthly_limit_shots": None, "currency": "USD", "free_tier": False, "note": "Billed in HQC units (Honeywell Quantum Credits)"},
    "iqm_resonance": {"name": "IQM Resonance", "cost_per_shot": 0.00050, "cost_per_circuit": 0.05, "min_shots": 1, "max_shots": 100000, "monthly_limit_shots": None, "currency": "EUR", "free_tier": False, "note": "Academic pricing available on request"},
}

class CostEstimateRequest(BaseModel):
    n_qubits: int = 5
    circuit_depth: int = 20
    n_shots: int = 8192
    n_circuits: int = 1
    provider_ids: list[str] = list(PRICING.keys())
    experiment_duration_days: int = 1

class ProviderCostEstimate(BaseModel):
    provider_id: str
    provider_name: str
    cost_per_circuit_usd: float
    cost_total_usd: float
    cost_note: str
    estimated_queue_min: int
    shots_available: bool
    monthly_budget_warning: bool
    free_tier: bool
    currency: str

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

class BudgetTrackRequest(BaseModel):
    provider_id: str
    cost_usd: float
    n_shots: int
    circuit_name: str = ""

def _hqc_estimate(n_qubits: int, depth: int, n_shots: int) -> float:
    hqc_per_circuit = n_qubits * depth * 0.5 + n_shots * 0.001
    return hqc_per_circuit * 0.00016

def _ibm_seconds_estimate(n_qubits: int, depth: int, n_shots: int) -> float:
    seconds_per_circuit = (n_qubits * depth * 0.1 + n_shots * 0.000050)
    return seconds_per_circuit * 1.60

@router.post("/estimate", response_model=CostEstimateResult)
def estimate_cost(req: CostEstimateRequest):
    import random; rng = random.Random(42)
    estimates = []
    for pid in req.provider_ids:
        if pid not in PRICING:
            continue
        p = PRICING[pid]
        if pid == "ibm_quantum_free":
            cost_per = 0.0; note = "Free (10M shots/month limit)"
        elif pid == "ibm_quantum_premium":
            cost_per = _ibm_seconds_estimate(req.n_qubits, req.circuit_depth, req.n_shots); note = f"~{_ibm_seconds_estimate(req.n_qubits, req.circuit_depth, req.n_shots)/1.60:.1f}s QPU time × $1.60/s"
        elif pid == "azure_quantinuum":
            cost_per = _hqc_estimate(req.n_qubits, req.circuit_depth, req.n_shots); note = f"~{_hqc_estimate(req.n_qubits, req.circuit_depth, req.n_shots)/0.00016:.0f} HQC × $0.00016/HQC"
        else:
            task_cost = p.get("cost_per_task", 0.0)
            shot_cost = p.get("cost_per_shot", 0.0) * req.n_shots
            cost_per = task_cost + shot_cost
            note = p.get("note", "")
        total = cost_per * req.n_circuits
        estimates.append(ProviderCostEstimate(
            provider_id=pid, provider_name=p["name"],
            cost_per_circuit_usd=round(cost_per, 6),
            cost_total_usd=round(total, 6),
            cost_note=note,
            estimated_queue_min=rng.randint(1, 120),
            shots_available=req.n_shots <= p.get("max_shots", 100000),
            monthly_budget_warning=total > 100.0,
            free_tier=p.get("free_tier", False),
            currency=p.get("currency", "USD"),
        ))
    cheapest = min(estimates, key=lambda e: e.cost_total_usd)
    recs = []
    if cheapest.free_tier:
        recs.append(f"{cheapest.provider_name} offers this at no cost")
    if req.n_shots > 10000:
        recs.append("Consider reducing shots to 8192 — standard error bars achievable with fewer shots")
    if req.n_circuits > 10:
        recs.append("Batch circuits in a single job to minimize per-task overhead costs")
    return CostEstimateResult(
        estimate_id=str(uuid.uuid4()),
        n_qubits=req.n_qubits, n_shots=req.n_shots, n_circuits=req.n_circuits,
        generated_at=datetime.now(timezone.utc).isoformat(),
        providers=sorted(estimates, key=lambda e: e.cost_total_usd),
        cheapest_provider=cheapest.provider_id,
        cheapest_cost_usd=cheapest.cost_total_usd,
        total_if_all_providers_usd=round(sum(e.cost_total_usd for e in estimates), 4),
        recommendations=recs,
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
    return {"providers": [{"id": k, **{x: v[x] for x in ["name","cost_per_shot","free_tier","currency","note"] if x in v}} for k, v in PRICING.items()]}
