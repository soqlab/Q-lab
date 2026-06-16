from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math

from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/cost-arbitrage", tags=["cost-arbitrage"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_RECOMMENDATIONS = "cost_recommendations"
NS_SAVINGS = "cost_savings_history"

_BACKEND_PRICING: dict = {
    "ibm_brisbane": {
        "provider": "IBM Quantum",
        "cost_per_shot_usd": 0.000_096,
        "min_shots": 1000,
        "cx_error_base": 0.008,
        "t1_us_base": 185.0,
        "queue_base_min": 35.0,
        "fidelity_base": 0.965,
    },
    "ibm_kyoto": {
        "provider": "IBM Quantum",
        "cost_per_shot_usd": 0.000_096,
        "min_shots": 1000,
        "cx_error_base": 0.006,
        "t1_us_base": 210.0,
        "queue_base_min": 55.0,
        "fidelity_base": 0.974,
    },
    "ionq_aria_1": {
        "provider": "IonQ",
        "cost_per_shot_usd": 0.000_220,
        "min_shots": 100,
        "cx_error_base": 0.003,
        "t1_us_base": 10_000.0,
        "queue_base_min": 12.0,
        "fidelity_base": 0.991,
    },
    "rigetti_ankaa_2": {
        "provider": "Rigetti",
        "cost_per_shot_usd": 0.000_047,
        "min_shots": 500,
        "cx_error_base": 0.018,
        "t1_us_base": 22.0,
        "queue_base_min": 8.0,
        "fidelity_base": 0.942,
    },
    "quantinuum_h2": {
        "provider": "Quantinuum",
        "cost_per_shot_usd": 0.000_650,
        "min_shots": 50,
        "cx_error_base": 0.001,
        "t1_us_base": 3_600.0,
        "queue_base_min": 180.0,
        "fidelity_base": 0.997,
    },
    "oqc_lucy": {
        "provider": "OQC",
        "cost_per_shot_usd": 0.000_032,
        "min_shots": 1000,
        "cx_error_base": 0.022,
        "t1_us_base": 28.0,
        "queue_base_min": 5.0,
        "fidelity_base": 0.931,
    },
}


class BackendQuote(BaseModel):
    backend: str
    provider: str
    cost_per_shot_usd: float
    min_shots: int
    estimated_total_usd: float
    queue_wait_min: float
    cx_error: float
    t1_us: float
    fidelity_score: float
    available: bool


class ArbitrageRecommendation(BaseModel):
    rec_id: str
    circuit_description: str
    n_shots: int
    budget_usd: float
    target_fidelity: float
    winner_backend: str
    winner_quote: BackendQuote
    all_quotes: List[BackendQuote]
    savings_vs_default_usd: float
    savings_pct: float
    reasoning: str
    created_at: str


class MarketSnapshot(BaseModel):
    snapshot_id: str
    taken_at: str
    quotes: List[BackendQuote]


class SavingsRecord(BaseModel):
    rec_id: str
    backend_chosen: str
    savings_usd: float
    date: str


class RecommendRequest(BaseModel):
    circuit_description: str
    n_shots: int
    budget_usd: float
    target_fidelity: float = 0.95
    prefer_speed: bool = False


class QuoteRequest(BaseModel):
    n_shots: int
    circuit_depth: int
    n_qubits: int


def _build_quote(backend: str, n_shots: int) -> BackendQuote:
    cfg = _BACKEND_PRICING[backend]
    shots = max(n_shots, cfg["min_shots"])
    cost_per_shot = cfg["cost_per_shot_usd"] * random.uniform(0.95, 1.05)
    total = round(shots * cost_per_shot, 4)
    cx_error = round(cfg["cx_error_base"] * random.uniform(0.88, 1.12), 6)
    t1_us = round(cfg["t1_us_base"] * random.uniform(0.9, 1.1), 2)
    fidelity = round(min(0.999, cfg["fidelity_base"] * random.uniform(0.98, 1.005)), 4)
    queue_wait = round(cfg["queue_base_min"] * random.uniform(0.7, 1.4), 1)
    available = random.random() > 0.06

    return BackendQuote(
        backend=backend,
        provider=cfg["provider"],
        cost_per_shot_usd=round(cost_per_shot, 8),
        min_shots=cfg["min_shots"],
        estimated_total_usd=total,
        queue_wait_min=queue_wait,
        cx_error=cx_error,
        t1_us=t1_us,
        fidelity_score=fidelity,
        available=available,
    )


def _score_quote(q: BackendQuote, budget_usd: float, target_fidelity: float, prefer_speed: bool) -> float:
    if not q.available or q.estimated_total_usd > budget_usd or q.fidelity_score < target_fidelity:
        return -math.inf
    cost_score = 1.0 - (q.estimated_total_usd / max(budget_usd, 1e-9))
    fidelity_score = (q.fidelity_score - target_fidelity) / (1.0 - target_fidelity + 1e-9)
    speed_score = 1.0 / (q.queue_wait_min + 1)
    if prefer_speed:
        return 0.2 * cost_score + 0.3 * fidelity_score + 0.5 * speed_score
    return 0.4 * cost_score + 0.5 * fidelity_score + 0.1 * speed_score


@router.post("/recommend", response_model=ArbitrageRecommendation)
def recommend(req: RecommendRequest, db: Session = Depends(get_db)) -> ArbitrageRecommendation:
    all_quotes = [_build_quote(b, req.n_shots) for b in _BACKEND_PRICING]
    scores = [_score_quote(q, req.budget_usd, req.target_fidelity, req.prefer_speed) for q in all_quotes]

    best_idx = max(range(len(scores)), key=lambda i: scores[i])
    if scores[best_idx] == -math.inf:
        raise HTTPException(status_code=400, detail="No backend meets budget and fidelity constraints")

    winner = all_quotes[best_idx]
    default_quote = next((q for q in all_quotes if "ibm_brisbane" in q.backend), all_quotes[0])
    savings = round(max(0.0, default_quote.estimated_total_usd - winner.estimated_total_usd), 4)
    savings_pct = round(savings / max(default_quote.estimated_total_usd, 1e-9) * 100, 2) if default_quote.estimated_total_usd > 0 else 0.0

    speed_note = " Speed was prioritized in scoring." if req.prefer_speed else ""
    reasoning = (
        f"Selected {winner.backend} ({winner.provider}) as the optimal backend. "
        f"Estimated cost ${winner.estimated_total_usd:.4f} for {req.n_shots} shots "
        f"(within ${req.budget_usd:.2f} budget). "
        f"Process fidelity score {winner.fidelity_score:.4f} meets target {req.target_fidelity:.4f}. "
        f"CX error {winner.cx_error:.5f}, queue wait ~{winner.queue_wait_min} min.{speed_note}"
    )

    rec_id = str(uuid.uuid4())
    rec = ArbitrageRecommendation(
        rec_id=rec_id,
        circuit_description=req.circuit_description,
        n_shots=req.n_shots,
        budget_usd=req.budget_usd,
        target_fidelity=req.target_fidelity,
        winner_backend=winner.backend,
        winner_quote=winner,
        all_quotes=all_quotes,
        savings_vs_default_usd=savings,
        savings_pct=savings_pct,
        reasoning=reasoning,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_RECOMMENDATIONS, rec_id, rec.model_dump())

    savings_rec = SavingsRecord(
        rec_id=rec_id,
        backend_chosen=winner.backend,
        savings_usd=savings,
        date=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_SAVINGS, rec_id, savings_rec.model_dump())
    return rec


@router.post("/quote", response_model=List[BackendQuote])
def quote(req: QuoteRequest) -> List[BackendQuote]:
    depth_factor = 1.0 + (req.circuit_depth / 100) * 0.1
    qubit_factor = 1.0 + (req.n_qubits / 10) * 0.05
    quotes = []
    for backend in _BACKEND_PRICING:
        q = _build_quote(backend, req.n_shots)
        adjusted_total = round(q.estimated_total_usd * depth_factor * qubit_factor, 4)
        quotes.append(q.model_copy(update={"estimated_total_usd": adjusted_total}))
    return quotes


@router.get("/market", response_model=MarketSnapshot)
def get_market() -> MarketSnapshot:
    quotes = [_build_quote(b, 1000) for b in _BACKEND_PRICING]
    return MarketSnapshot(
        snapshot_id=str(uuid.uuid4()),
        taken_at=datetime.now(timezone.utc).isoformat(),
        quotes=quotes,
    )


@router.get("/savings-history", response_model=List[SavingsRecord])
def savings_history(db: Session = Depends(get_db)) -> List[SavingsRecord]:
    return store_list(db, NS_SAVINGS)
