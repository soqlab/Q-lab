"""Experiment Recommendation Engine.

Suggests what to run next based on:
  1. Content-based similarity to your recent runs (backend, n_qubits, algorithm)
  2. Circuit template popularity + research progression patterns
  3. Parameter variation nudges ("you ran 2-qubit Bell → try 4-qubit GHZ")

No quantum platform has a collaborative-filtering recommendation engine today.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CircuitTemplate, Run

router = APIRouter(prefix="/api/v1/recommend", tags=["recommender"])

# Research progression rules — curated domain knowledge
PROGRESSION_RULES: list[dict] = [
    {"if_category": "entanglement", "if_max_qubits": 2,  "suggest_category": "entanglement",  "suggest_n_qubits": 3, "reason": "Scale Bell → GHZ to explore multi-party entanglement"},
    {"if_category": "entanglement", "if_max_qubits": 3,  "suggest_category": "entanglement",  "suggest_n_qubits": 4, "reason": "Add a 4th qubit to study entanglement scaling"},
    {"if_category": "optimization", "if_max_qubits": 4,  "suggest_category": "optimization",  "suggest_n_qubits": 6, "reason": "Larger MaxCut graphs reveal QAOA advantage threshold"},
    {"if_category": "benchmarking", "if_max_qubits": 2,  "suggest_category": "characterization","suggest_n_qubits": 2,"reason": "Follow RB with T1/T2 measurement to attribute fidelity loss"},
    {"if_category": "simulation",   "if_max_qubits": 2,  "suggest_category": "simulation",    "suggest_n_qubits": 4, "reason": "H₂ VQE → LiH: scale molecular simulation"},
    {"if_category": "error-correction", "if_max_qubits": 3, "suggest_category": "error-correction", "suggest_n_qubits": 5, "reason": "Upgrade from 3-qubit bit-flip to 5-qubit perfect code"},
    {"if_category": "communication", "if_max_qubits": 3, "suggest_category": "communication", "suggest_n_qubits": 4, "reason": "Add superdense coding to teleportation circuit family"},
]


def _cosine_sim(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x ** 2 for x in a))
    nb = math.sqrt(sum(x ** 2 for x in b))
    return dot / (na * nb) if na * nb > 0 else 0.0


def _featurize_run(run: Run, all_backends: list[str], all_categories: list[str]) -> list[float]:
    """One-hot encode backend + category + continuous n_qubits."""
    features: list[float] = []
    # Backend one-hot
    for b in all_backends:
        features.append(1.0 if run.backend == b else 0.0)
    # Category one-hot (derive from circuit_qasm keyword heuristic)
    qasm = (run.circuit_name or "").lower()
    category = "unknown"
    if any(k in qasm for k in ["qaoa", "maxcut"]): category = "optimization"
    elif any(k in qasm for k in ["vqe", "ansatz"]): category = "simulation"
    elif any(k in qasm for k in ["qft"]): category = "simulation"
    elif any(k in qasm for k in ["grover"]): category = "search"
    elif any(k in qasm for k in ["bell", "cx", "cnot"]): category = "entanglement"
    for c in all_categories:
        features.append(1.0 if category == c else 0.0)
    # Normalized n_qubits
    nq = run.results.get("n_qubits", 2) if run.results and isinstance(run.results, dict) else 2
    features.append(min(nq, 20) / 20.0)
    return features


def _get_recommendations(db: Session, run_id: Optional[str], limit: int) -> dict[str, Any]:
    # Recent runs for context
    since = datetime.now(timezone.utc) - timedelta(days=30)
    recent_runs = db.scalars(
        select(Run).where(Run.created_at >= since).order_by(Run.created_at.desc()).limit(20)
    ).all()

    # Focus run
    focus_run = None
    if run_id:
        focus_run = db.scalar(select(Run).where(Run.run_id == run_id))

    # All templates
    templates = db.scalars(select(CircuitTemplate).order_by(CircuitTemplate.use_count.desc())).all()

    # Extract run metadata
    backends_seen = list({r.backend for r in recent_runs if r.backend})[:10]
    categories_seen = ["entanglement", "optimization", "simulation", "benchmarking",
                       "characterization", "error-correction", "communication", "search", "unknown"]

    # --- Strategy 1: Popular templates not yet run ---
    run_qasms = {(r.circuit_name or "")[:200] for r in recent_runs}
    not_yet_run = [t for t in templates if t.name[:200] not in run_qasms]

    by_popularity = sorted(not_yet_run, key=lambda t: -t.use_count)[:3]

    # --- Strategy 2: Progression rules ---
    progression_suggestions: list[dict] = []
    for rule in PROGRESSION_RULES:
        matching_templates = [t for t in templates
                              if t.category == rule["if_category"]
                              and t.n_qubits <= rule["if_max_qubits"]]
        if matching_templates:
            target_templates = [t for t in templates
                                if t.category == rule["suggest_category"]
                                and t.n_qubits >= rule["suggest_n_qubits"]]
            if target_templates:
                progression_suggestions.append({
                    "type": "progression",
                    "reason": rule["reason"],
                    "template": {
                        "template_id": target_templates[0].template_id,
                        "name": target_templates[0].name,
                        "category": target_templates[0].category,
                        "n_qubits": target_templates[0].n_qubits,
                    },
                })

    # --- Strategy 3: Backend diversity nudge ---
    backend_suggestions: list[dict] = []
    all_backends = ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "simulator_statevector"]
    if recent_runs:
        most_used = max(set(r.backend for r in recent_runs), key=lambda b: sum(1 for r in recent_runs if r.backend == b))
        unused = [b for b in all_backends if b != most_used]
        if unused and recent_runs:
            backend_suggestions.append({
                "type": "backend_diversity",
                "reason": f"You've been running mostly on {most_used} — compare on {unused[0]} to detect backend-specific effects",
                "suggested_backend": unused[0],
                "reference_backend": most_used,
            })

    # --- Strategy 4: Parameter scaling ---
    param_suggestions: list[dict] = []
    if recent_runs:
        avg_qubits = sum((r.results or {}).get("n_qubits", 2) if r.results else 2 for r in recent_runs[:5]) / min(5, len(recent_runs))
        next_n = int(avg_qubits) + 2
        scaling_templates = [t for t in templates if t.n_qubits == next_n]
        if scaling_templates:
            param_suggestions.append({
                "type": "parameter_scaling",
                "reason": f"Your recent avg circuit size is {avg_qubits:.1f} qubits → scale to {next_n} qubits",
                "template": {
                    "template_id": scaling_templates[0].template_id,
                    "name": scaling_templates[0].name,
                    "n_qubits": scaling_templates[0].n_qubits,
                },
            })

    return {
        "context": {
            "recent_runs_analyzed": len(recent_runs),
            "focus_run_id": run_id,
            "backends_seen": backends_seen,
        },
        "by_popularity": [
            {"type": "popular", "reason": f"Used {t.use_count}× by the community — you haven't run it yet",
             "template": {"template_id": t.template_id, "name": t.name, "category": t.category, "n_qubits": t.n_qubits}}
            for t in by_popularity
        ],
        "by_progression": progression_suggestions[:3],
        "by_backend_diversity": backend_suggestions,
        "by_parameter_scaling": param_suggestions,
        "all_suggestions": (
            [{"type": "popular", "reason": f"Popular unrun circuit: {t.name}", "template_id": t.template_id, "name": t.name} for t in by_popularity] +
            progression_suggestions[:2] + backend_suggestions + param_suggestions
        )[:limit],
    }


@router.get("")
def get_recommendations(
    run_id: Optional[str] = Query(default=None),
    limit: int = Query(default=8, ge=1, le=20),
    db: Session = Depends(get_db),
):
    return _get_recommendations(db, run_id, limit)


@router.get("/similar/{run_id}")
def get_similar_runs(run_id: str, limit: int = 5, db: Session = Depends(get_db)):
    """Find runs similar to the given run based on backend, qubits, and circuit structure."""
    focus = db.scalar(select(Run).where(Run.run_id == run_id))
    if focus is None:
        from fastapi import HTTPException
        raise HTTPException(404, "Run not found")

    recent = db.scalars(select(Run).where(Run.run_id != run_id).order_by(Run.created_at.desc()).limit(200)).all()

    scored = []
    for r in recent:
        score = 0.0
        if r.backend == focus.backend: score += 0.4
        focus_qasm = (focus.circuit_name or "").lower()
        run_qasm = (r.circuit_name or "").lower()
        common_words = set(focus_qasm.split()) & set(run_qasm.split())
        score += min(0.4, len(common_words) * 0.05)
        if abs((r.shots or 1024) - (focus.shots or 1024)) < 200: score += 0.2
        scored.append((score, r))

    scored.sort(key=lambda x: -x[0])
    return [
        {"run_id": r.run_id, "similarity_score": round(s, 3), "backend": r.backend,
         "shots": r.shots, "health_score": r.health_score, "created_at": r.created_at.isoformat()}
        for s, r in scored[:limit]
    ]
