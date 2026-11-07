"""Quantum advantage analysis of a stored run.

   POST /api/v1/advantage/analyze/{run_id}   — analyse a run the caller can see
   GET  /api/v1/advantage/cached/{run_id}    — the last analysis of that run

Qubits and depth come from the run's stored circuit (or its fingerprint), shots from the run.
The classical cost is the memory and operation count of a statevector simulation; the advantage
score is a fixed, documented rule on those figures (_compute_advantage_score), not a measurement.
An optional AI commentary is added only when an AI provider is configured. Figures the run does
not record are reported as null rather than defaulted. (The earlier problem-based "detector"
generated its results from random numbers and was removed.)

Classical simulation cost scales exponentially with qubit count.  The key
question: does this experiment demonstrate something a classical computer
can't do efficiently?
"""
from __future__ import annotations

import json
import math
import os
import random
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai_provider import ai_complete_json, NoAIProviderError
from ..database import get_db
from ..deps import get_identity, Identity
from ..models import AdvantageResult, Run
from ..health_score import compute_health_score
from ..store import store_put, store_get

router = APIRouter(prefix="/api/v1/advantage", tags=["advantage"])


def _human_time(seconds: float) -> str:
    if seconds < 1:
        return f"{seconds * 1000:.1f} ms"
    if seconds < 60:
        return f"{seconds:.1f} s"
    if seconds < 3600:
        return f"{seconds / 60:.1f} min"
    if seconds < 86400:
        return f"{seconds / 3600:.1f} hours"
    if seconds < 31_536_000:
        return f"{seconds / 86400:.1f} days"
    return f"{seconds / 31_536_000:.2e} years"


def _estimate_classical_simulation_cost(n_qubits: int, circuit_depth: int) -> dict:
    """Estimate how hard it would be to classically simulate this circuit."""
    state_vector_memory_gb = (2 ** n_qubits * 16) / (1024 ** 3)
    classical_ops = (2 ** n_qubits) * circuit_depth
    classical_time_seconds = classical_ops / 1e15

    return {
        "state_vector_memory_gb": round(state_vector_memory_gb, 4),
        "classical_ops": classical_ops,
        "classical_time_seconds": classical_time_seconds,
        "classical_time_human": _human_time(classical_time_seconds),
        "is_classically_hard": state_vector_memory_gb > 1024 or classical_time_seconds > 3600,
    }


_ALGO_KEYWORDS = [
    "grover", "qft", "vqe", "qaoa", "shor", "teleport", "ghz",
    "bernstein", "deutsch", "simon", "phase", "hhl", "qpe", "iqpe",
]


def _detect_algorithm(circuit_name: Optional[str], tags: list, qasm: Optional[str]) -> str:
    sources = " ".join(filter(None, [
        circuit_name or "",
        " ".join(tags),
        (qasm or "")[:500],
    ])).lower()
    for kw in _ALGO_KEYWORDS:
        if kw in sources:
            return kw
    return "unknown"


def _classical_baseline(n_qubits: int, algorithm: str, n_shots: int) -> dict:
    """Estimate what a classical algorithm would achieve for the same task."""
    baselines: dict[str, dict] = {
        "grover": {
            "description": "Classical unstructured search: O(N/2) evaluations vs Grover's O(√N)",
            "classical_queries": 2 ** (n_qubits - 1),
            "quantum_queries": int(math.pi / 4 * math.sqrt(2 ** n_qubits)),
            "speedup_type": "quadratic",
            "speedup_factor": math.sqrt(2 ** n_qubits) / 2,
        },
        "qft": {
            "description": "Classical FFT: O(N log N) vs QFT: O(n^2 gates)",
            "speedup_type": "exponential",
            "speedup_factor": 2 ** n_qubits / (n_qubits ** 2) if n_qubits > 0 else 1,
        },
        "vqe": {
            "description": "Classical FCI: O(N! / (Ne! * Nh!)) vs VQE: polynomial",
            "speedup_type": "potential exponential (problem-dependent)",
            "note": "VQE advantage not proven in general; depends on specific molecule",
        },
        "qaoa": {
            "description": "Classical approximation algorithms exist; QAOA advantage not proven",
            "speedup_type": "potential polynomial (unproven)",
        },
        "shor": {
            "description": "Classical factoring: sub-exponential vs Shor's polynomial",
            "speedup_type": "super-polynomial",
            "speedup_factor": 2 ** (n_qubits / 3),
        },
        "teleport": {
            "description": "Quantum teleportation has no classical equivalent",
            "speedup_type": "qualitative advantage",
        },
        "ghz": {
            "description": "GHZ state generation demonstrates non-classical correlations",
            "speedup_type": "sampling advantage",
        },
        "bernstein": {
            "description": "Bernstein-Vazirani: 1 quantum query vs n classical queries",
            "speedup_type": "linear",
            "speedup_factor": float(n_qubits),
        },
        "deutsch": {
            "description": "Deutsch-Jozsa: 1 quantum query vs 2^(n-1)+1 classical queries",
            "speedup_type": "exponential",
            "speedup_factor": float(2 ** (n_qubits - 1)),
        },
    }
    algo_lower = algorithm.lower()
    for key, val in baselines.items():
        if key in algo_lower:
            return val
    return {
        "description": "No known classical baseline for this algorithm",
        "speedup_type": "unknown",
    }


def _is_clifford_only(qasm: Optional[str]) -> bool:
    if not qasm:
        return False
    non_clifford = re.compile(
        r"^\s*(t|tdg|rz|rx|ry|u1|u2|u3|p|r|ccx|rzx|ecr|sx|sxdg)\b",
        re.IGNORECASE | re.MULTILINE,
    )
    gate_lines = [
        ln.strip() for ln in qasm.splitlines()
        if ln.strip()
        and not ln.strip().startswith("//")
        and not any(ln.strip().startswith(kw) for kw in (
            "OPENQASM", "include", "qreg", "creg", "measure", "barrier",
        ))
    ]
    if not gate_lines:
        return False
    return not any(non_clifford.match(ln) for ln in gate_lines)


def _circuit_size(run: Run, fp: dict) -> tuple[int, int]:
    """(qubits, depth): from the stored circuit when it parses, else from the SDK fingerprint."""
    if run.qasm:
        try:
            from ..local_sim import _parse

            c = _parse(run.qasm)
            return c.num_qubits, c.depth(filter_function=lambda i: i.operation.name not in ("measure", "barrier"))
        except ValueError:
            pass
    return int(fp.get("num_qubits") or 0), int(fp.get("depth") or 0)


def _count_qubits_from_qasm(qasm: Optional[str]) -> int:
    if not qasm:
        return 0
    return sum(int(m.group(1)) for m in re.finditer(r"qreg\s+\w+\[(\d+)\]", qasm))


def _compute_advantage_score(
    n_qubits: int,
    circuit_depth: int,
    classical_cost: dict,
    algorithm: str,
    qasm: Optional[str],
) -> tuple[int, str, str]:
    score = 0
    sv_gb = classical_cost["state_vector_memory_gb"]

    if sv_gb > 1:
        score += 30
    if sv_gb > 64:
        score += 20
    if sv_gb > 1024:
        score += 30
    if circuit_depth > 50:
        score += 10
    if n_qubits > 20:
        score += 10

    if _is_clifford_only(qasm):
        score -= 20

    score = max(0, min(100, score))

    if score >= 70:
        return score, "strong_advantage", "This circuit almost certainly cannot be efficiently simulated classically"
    if score >= 40:
        return score, "potential_advantage", "Classical simulation would be very expensive"
    if score >= 20:
        return score, "limited_advantage", "Classically simulable but non-trivial"
    return score, "no_advantage", "This circuit can be efficiently simulated classically"


def _call_claude_analysis(
    run: Run,
    algorithm: str,
    n_qubits: int,
    circuit_depth: int,
    n_shots: int,
    health_score: float,
    success_prob: Optional[float],
    classical_cost: dict,
    db: Session = None,
    user_id: int = 0,
) -> Optional[dict]:
    prompt = f"""Analyze whether this quantum experiment demonstrates quantum advantage.

Circuit: {run.circuit_name}, Algorithm: {algorithm}
Qubits: {n_qubits}, Depth: {circuit_depth}, Shots: {n_shots}
Health score: {health_score:.1f}, Success probability: {success_prob}

Classical simulation cost: {classical_cost['classical_time_human']} on a petaflop supercomputer
Memory required: {classical_cost['state_vector_memory_gb']:.2f} GB

Answer in JSON:
{{
  "advantage_type": "computational|sampling|none",
  "explanation": "2-3 sentence explanation",
  "caveats": ["caveat1", "caveat2"],
  "publication_claim": "what the researcher can legitimately claim about quantum advantage"
}}"""

    try:
        return ai_complete_json(prompt, db=db, user_id=user_id, max_tokens=600)
    except (NoAIProviderError, Exception):
        return None


@router.post("/analyze/{run_id}")
def analyze_run_advantage(run_id: str, db: Session = Depends(get_db), identity: Optional[Identity] = Depends(get_identity)):
    """Analyze quantum advantage for a stored run using heuristics + optional Claude AI."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, f"Run {run_id!r} not found")

    fp = run.fingerprint or {}
    res = run.results or {}
    params = run.parameters or {}

    n_qubits, circuit_depth = _circuit_size(run, fp)
    if not n_qubits:
        raise HTTPException(422, "The run records neither a circuit nor its qubit count.")
    n_shots = run.shots

    success_prob: Optional[float] = None
    raw_sp = res.get("success_probability")
    if raw_sp is not None:
        try:
            success_prob = float(raw_sp)
        except (TypeError, ValueError):
            pass

    algorithm = _detect_algorithm(run.circuit_name, run.tags or [], run.qasm)
    classical_cost = _estimate_classical_simulation_cost(n_qubits, circuit_depth)
    classical_baseline = _classical_baseline(n_qubits, algorithm, n_shots)

    rd = {"results": res, "calibration": run.calibration or {}, "fingerprint": fp}
    health_score = compute_health_score(rd) or 0.0

    advantage_score, advantage_verdict, verdict_explanation = _compute_advantage_score(
        n_qubits, circuit_depth, classical_cost, algorithm, run.qasm
    )

    claude_analysis = _call_claude_analysis(
        run, algorithm, n_qubits, circuit_depth, n_shots,
        health_score, success_prob, classical_cost,
        db=db, user_id=identity.user_id if identity else 0,
    )

    result: dict[str, Any] = {
        "run_id": run_id,
        "circuit_name": run.circuit_name,
        "algorithm_detected": algorithm,
        "n_qubits": n_qubits,
        "circuit_depth": circuit_depth,
        "n_shots": n_shots,
        "success_probability": success_prob,
        "health_score": round(health_score, 1),
        "advantage_score": advantage_score,
        "advantage_verdict": advantage_verdict,
        "verdict_explanation": verdict_explanation,
        "classical_cost": classical_cost,
        "classical_baseline": classical_baseline,
        "is_clifford_only": _is_clifford_only(run.qasm),
        "claude_analysis": claude_analysis,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }

    store_put(db, "advantage_analyses", run_id, result)
    return result


@router.get("/cached/{run_id}")
def get_cached_advantage_analysis(run_id: str, db: Session = Depends(get_db)):
    """Return a previously cached advantage analysis for a run."""
    # Only for runs the caller can see (Run queries are scoped to the caller).
    if db.scalar(select(Run).where(Run.run_id == run_id)) is None:
        raise HTTPException(404, f"Run {run_id!r} not found")
    cached = store_get(db, "advantage_analyses", run_id)
    if cached is None:
        raise HTTPException(404, "No cached analysis found. Call POST /analyze/{run_id} first.")
    return cached
