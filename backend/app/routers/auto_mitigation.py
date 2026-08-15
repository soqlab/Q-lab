from __future__ import annotations
import uuid
import random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/auto-mitigation", tags=["auto-mitigation"])

NS = "auto_mitigation_recs"

class SelectRequest(BaseModel):
    n_qubits: int
    circuit_depth: int
    backend: str
    noise_model: Optional[str] = None
    budget_overhead: Optional[float] = 3.0
    target_fidelity: Optional[float] = 0.90

class ApplyRequest(BaseModel):
    recommendation_id: str
    circuit_counts: dict

def _pick_strategy(n_qubits: int, depth: int, backend: str, budget: float, target: float):
    is_ion = "ionq" in backend or "quantinuum" in backend
    is_deep = depth > 50
    is_large = n_qubits > 20

    if is_ion and not is_deep:
        strategy = "light_readout_zne"
        techniques = [
            {"name": "readout_correction", "order": 1, "params": {"method": "M3", "shots": 1024},
             "expected_improvement": 0.03, "overhead": 1.1},
            {"name": "ZNE", "order": 2, "params": {"scale_factors": [1, 2, 3], "extrapolation": "richardson"},
             "expected_improvement": 0.04, "overhead": 3.0},
        ]
        overhead = 3.3
        improvement = sum(t["expected_improvement"] for t in techniques)
        predicted = round(min(target + improvement * (1 - depth / 200), 0.999), 4)
    elif is_large or is_deep:
        strategy = "full_stack_mitigation"
        techniques = [
            {"name": "dynamical_decoupling", "order": 1, "params": {"sequence": "XY4", "spacing": "even"},
             "expected_improvement": 0.05, "overhead": 1.05},
            {"name": "readout_correction", "order": 2, "params": {"method": "M3", "shots": 4096},
             "expected_improvement": 0.04, "overhead": 1.2},
            {"name": "ZNE", "order": 3, "params": {"scale_factors": [1, 1.5, 2], "extrapolation": "linear"},
             "expected_improvement": 0.06, "overhead": 2.5},
            {"name": "symmetry_verification", "order": 4, "params": {"symmetry": "particle_number"},
             "expected_improvement": 0.02, "overhead": 1.0},
        ]
        overhead = min(budget, 3.94)
        improvement = sum(t["expected_improvement"] for t in techniques)
        predicted = round(min(target + improvement * max(0, 1 - depth / 500), 0.97), 4)
    else:
        strategy = "zne_readout"
        techniques = [
            {"name": "readout_correction", "order": 1, "params": {"method": "least_squares", "shots": 2048},
             "expected_improvement": 0.04, "overhead": 1.15},
            {"name": "ZNE", "order": 2, "params": {"scale_factors": [1, 2, 3], "extrapolation": "richardson"},
             "expected_improvement": 0.05, "overhead": 3.0},
        ]
        overhead = 3.45
        improvement = sum(t["expected_improvement"] for t in techniques)
        predicted = round(min(target + improvement * 0.75, 0.96), 4)

    alternatives = [
        {"strategy": "pec_only", "fidelity": round(predicted - 0.03, 4), "overhead": round(overhead * 1.6, 2)},
        {"strategy": "dd_only", "fidelity": round(predicted - 0.06, 4), "overhead": 1.05},
        {"strategy": "clifford_data_regression", "fidelity": round(predicted + 0.01, 4), "overhead": round(overhead * 2.1, 2)},
    ]
    reasoning = (
        f"Selected '{strategy}' for {n_qubits}-qubit depth-{depth} circuit on {backend}. "
        f"Budget overhead {budget:.1f}x allows combining readout correction with ZNE. "
        f"Dynamical decoupling {'included' if is_large or is_deep else 'skipped'} based on circuit depth."
    )
    return strategy, techniques, overhead, predicted, alternatives, reasoning

@router.post("/select")
def select_mitigation(req: SelectRequest, db: Session = Depends(get_db)):
    budget = req.budget_overhead or 3.0
    target = req.target_fidelity or 0.90
    strategy, techniques, overhead, predicted, alternatives, reasoning = _pick_strategy(
        req.n_qubits, req.circuit_depth, req.backend, budget, target
    )
    rec_id = str(uuid.uuid4())
    record = {
        "recommendation_id": rec_id,
        "strategy": strategy,
        "techniques": techniques,
        "combined_overhead": round(overhead, 3),
        "predicted_fidelity": predicted,
        "confidence": round(min(0.95, 0.82 + len(techniques) * 0.025), 3),
        "reasoning": reasoning,
        "alternatives": alternatives,
        "is_simulated": True,
        "simulation_note": "Strategy selection and predicted fidelity are analytically estimated — not measured on real hardware",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "request": req.model_dump(),
    }
    store_put(db, NS, rec_id, record)
    return record

@router.post("/apply")
def apply_mitigation(req: ApplyRequest, db: Session = Depends(get_db)):
    rec = store_get(db, NS, req.recommendation_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    total_shots = sum(req.circuit_counts.values()) if req.circuit_counts else 1024
    predicted = rec["predicted_fidelity"]
    total_improvement = sum(t["expected_improvement"] for t in rec["techniques"])
    raw = round(max(0.50, min(predicted - total_improvement, 0.89)), 4)
    mitigated = round(min(predicted, 0.995), 4)
    improvement_pct = round((mitigated - raw) / max(raw, 0.01) * 100, 2)
    contributions = {t["name"]: round(t["expected_improvement"], 4) for t in rec["techniques"]}
    return {
        "mitigated_value": mitigated,
        "raw_value": raw,
        "improvement_pct": improvement_pct,
        "technique_contributions": contributions,
        "total_overhead": rec["combined_overhead"],
        "shots_used": total_shots,
        "is_simulated": True,
        "simulation_note": "Values are analytically derived from technique parameters — not measured from real circuit execution",
        "applied_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/history")
def get_history(db: Session = Depends(get_db)):
    recs = store_list(db, NS)
    items = [
        {"recommendation_id": r["recommendation_id"], "strategy": r["strategy"], "backend": r["request"]["backend"],
         "predicted_fidelity": r["predicted_fidelity"], "created_at": r["created_at"]}
        for r in recs
    ]
    return {"count": len(items), "recommendations": items}
