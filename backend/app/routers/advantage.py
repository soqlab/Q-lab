"""Quantum Advantage — two feature sets in one router.

1. Classic Advantage Detector (existing endpoints, unchanged):
   POST /api/v1/advantage          — run a problem-based advantage test
   GET  /api/v1/advantage          — list recent results
   GET  /api/v1/advantage/sweep/{problem_type}

2. Quantum Advantage Analyzer (new AI-powered endpoints):
   POST /api/v1/advantage/analyze/{run_id}   — analyze advantage for a stored run
   GET  /api/v1/advantage/cached/{run_id}    — fetch cached analysis

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

from ..database import get_db
from ..deps import get_identity, Identity
from ..models import AdvantageResult, Run
from ..health_score import compute_health_score
from ..store import store_put, store_get
from .credentials import get_active_key_for_user

router = APIRouter(prefix="/api/v1/advantage", tags=["advantage"])


# =============================================================================
# SECTION 1 — CLASSIC PROBLEM-BASED ADVANTAGE TESTS (UNCHANGED)
# =============================================================================

def _random_graph(n: int, edge_prob: float, rng: random.Random) -> list[tuple[int, int]]:
    return [(i, j) for i in range(n) for j in range(i + 1, n) if rng.random() < edge_prob]


def _cut_value(partition: list[int], edges: list[tuple[int, int]]) -> int:
    return sum(1 for u, v in edges if partition[u] != partition[v])


def _greedy_maxcut(n: int, edges: list[tuple[int, int]], rng: random.Random) -> tuple[int, float]:
    t0 = time.perf_counter()
    best_cut, best_part = 0, [0] * n
    for _ in range(min(20, 2 ** n)):
        part = [rng.randint(0, 1) for _ in range(n)]
        cut = _cut_value(part, edges)
        if cut > best_cut:
            best_cut, best_part = cut, part
    return best_cut, (time.perf_counter() - t0) * 1000


def _qaoa_maxcut(n: int, edges: list[tuple[int, int]], rng: random.Random) -> tuple[int, float]:
    t0 = time.perf_counter()
    best_cut = 0
    for trial in range(50):
        gamma = rng.uniform(0.3, 1.2)
        beta = rng.uniform(0.1, 0.8)
        part = []
        for i in range(n):
            bias = sum(math.sin(gamma) * math.cos(2 * beta) for u, v in edges if u == i or v == i)
            prob = 0.5 + 0.1 * math.tanh(bias)
            part.append(1 if rng.random() < prob else 0)
        cut = _cut_value(part, edges)
        if cut > best_cut:
            best_cut = cut
    ms = (time.perf_counter() - t0) * 1000
    return best_cut, ms


def _linear_search(n: int, target: int, rng: random.Random) -> tuple[int, float]:
    t0 = time.perf_counter()
    items = list(range(2 ** n))
    rng.shuffle(items)
    queries = items.index(target) + 1
    return queries, (time.perf_counter() - t0) * 1000


def _grover_search(n: int, target: int, rng: random.Random) -> tuple[int, float]:
    t0 = time.perf_counter()
    N = 2 ** n
    expected_queries = int(math.ceil(math.pi / 4 * math.sqrt(N)))
    success_prob = math.sin((2 * expected_queries + 1) * math.asin(1 / math.sqrt(N))) ** 2
    queries = expected_queries if rng.random() < success_prob else expected_queries * 2
    return queries, (time.perf_counter() - t0) * 1000


def _total_variation_distance(p: dict, q: dict) -> float:
    keys = set(p) | set(q)
    return 0.5 * sum(abs(p.get(k, 0) - q.get(k, 0)) for k in keys)


def _quantum_sampling(n: int, shots: int, rng: random.Random) -> tuple[float, float]:
    t0 = time.perf_counter()
    try:
        from .job_executor import _simulate_qasm
        qasm = f"OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[{n}];\ncreg c[{n}];\nh q[0];\n"
        qasm += "".join(f"cx q[{i}],q[{i+1}];\n" for i in range(n - 1))
        qasm += "".join(f"measure q[{i}] -> c[{i}];\n" for i in range(n))
        counts = _simulate_qasm(qasm, shots, seed=rng.randint(0, 2 ** 30))
        total = sum(counts.values()) or 1
        dist = {k: v / total for k, v in counts.items()}
    except Exception:
        dist = {format(i, f"0{n}b"): 1 / (2 ** n) for i in range(2 ** n)}
    uniform = {format(i, f"0{n}b"): 1 / (2 ** n) for i in range(2 ** n)}
    tvd = _total_variation_distance(dist, uniform)
    return tvd, (time.perf_counter() - t0) * 1000


def _classical_sampling(n: int, shots: int, rng: random.Random) -> tuple[float, float]:
    t0 = time.perf_counter()
    N = 2 ** n
    counts: dict[str, int] = {}
    for _ in range(shots):
        key = format(rng.randint(0, N - 1), f"0{n}b")
        counts[key] = counts.get(key, 0) + 1
    total = shots
    dist = {k: v / total for k, v in counts.items()}
    all_keys = {format(i, f"0{n}b") for i in range(N)}
    for k in all_keys:
        dist.setdefault(k, 0)
    uniform = {k: 1 / N for k in all_keys}
    tvd = _total_variation_distance(dist, uniform)
    return tvd, (time.perf_counter() - t0) * 1000


def _run_advantage_test(problem_type: str, n_qubits: int, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)

    if problem_type == "maxcut":
        edges = _random_graph(n_qubits, 0.5, rng)
        q_score, q_ms = _qaoa_maxcut(n_qubits, edges, rng)
        c_score, c_ms = _greedy_maxcut(n_qubits, edges, rng)
        max_possible = len(edges)
        q_approx = q_score / max_possible if max_possible else 0
        c_approx = c_score / max_possible if max_possible else 0
        advantage_ratio = q_approx / c_approx if c_approx > 0 else 1.0
        verdict = "quantum_wins" if q_score > c_score else ("tie" if q_score == c_score else "classical_wins")
        details = {"edges": len(edges), "quantum_cut": q_score, "classical_cut": c_score,
                   "max_possible_cut": max_possible, "quantum_approx_ratio": round(q_approx, 4),
                   "classical_approx_ratio": round(c_approx, 4)}

    elif problem_type == "search":
        target = rng.randint(0, 2 ** n_qubits - 1)
        q_score, q_ms = _grover_search(n_qubits, target, rng)
        c_score, c_ms = _linear_search(n_qubits, target, rng)
        advantage_ratio = c_score / q_score if q_score > 0 else 1.0
        verdict = "quantum_wins" if q_score < c_score else ("tie" if q_score == c_score else "classical_wins")
        details = {"N": 2 ** n_qubits, "quantum_queries": q_score, "classical_queries": c_score,
                   "theoretical_grover": int(math.ceil(math.pi / 4 * math.sqrt(2 ** n_qubits)))}

    elif problem_type == "sampling":
        shots = 512
        q_score, q_ms = _quantum_sampling(n_qubits, shots, rng)
        c_score, c_ms = _classical_sampling(n_qubits, shots, rng)
        advantage_ratio = q_score / c_score if c_score > 0 else 1.0
        verdict = "quantum_wins" if q_score > c_score else ("tie" if abs(q_score - c_score) < 0.01 else "classical_wins")
        details = {"shots": shots, "quantum_tvd_from_uniform": round(q_score, 4),
                   "classical_tvd_from_uniform": round(c_score, 4),
                   "interpretation": "higher TVD = more structured distribution = more quantum-like"}
    else:
        raise HTTPException(422, f"Unknown problem_type '{problem_type}'")

    return {
        "problem_type": problem_type, "n_qubits": n_qubits,
        "quantum_score": round(float(q_score), 4), "classical_score": round(float(c_score), 4),
        "advantage_ratio": round(advantage_ratio, 4),
        "quantum_time_ms": round(q_ms, 3), "classical_time_ms": round(c_ms, 3),
        "verdict": verdict, "details": details,
    }


class AdvantageRequest(BaseModel):
    problem_type: str = Field(default="maxcut", description="maxcut | search | sampling")
    n_qubits: int = Field(default=4, ge=2, le=12)
    seed: int = 42


@router.post("")
def detect_advantage(req: AdvantageRequest, db: Session = Depends(get_db)):
    data = _run_advantage_test(req.problem_type, req.n_qubits, req.seed)
    result_id = f"adv-{uuid.uuid4().hex[:12]}"
    record = AdvantageResult(
        result_id=result_id, problem_type=data["problem_type"], n_qubits=data["n_qubits"],
        quantum_score=data["quantum_score"], classical_score=data["classical_score"],
        advantage_ratio=data["advantage_ratio"], quantum_time_ms=data["quantum_time_ms"],
        classical_time_ms=data["classical_time_ms"], verdict=data["verdict"], details=data["details"],
    )
    db.add(record); db.commit(); db.refresh(record)
    return {"result_id": result_id, **data, "created_at": record.created_at.isoformat()}


@router.get("")
def list_advantage_results(problem_type: Optional[str] = None, db: Session = Depends(get_db)):
    q = select(AdvantageResult).order_by(AdvantageResult.created_at.desc()).limit(100)
    if problem_type:
        q = q.where(AdvantageResult.problem_type == problem_type)
    rows = db.scalars(q).all()
    return [{"result_id": r.result_id, "problem_type": r.problem_type, "n_qubits": r.n_qubits,
             "advantage_ratio": r.advantage_ratio, "verdict": r.verdict,
             "quantum_time_ms": r.quantum_time_ms, "classical_time_ms": r.classical_time_ms,
             "created_at": r.created_at.isoformat()} for r in rows]


@router.get("/sweep/{problem_type}")
def advantage_sweep(problem_type: str, max_qubits: int = 8, seed: int = 42, db: Session = Depends(get_db)):
    """Run advantage test for n=2..max_qubits and return scaling curve."""
    results = []
    for n in range(2, max_qubits + 1):
        try:
            data = _run_advantage_test(problem_type, n, seed + n)
            results.append({"n_qubits": n, "advantage_ratio": data["advantage_ratio"],
                            "verdict": data["verdict"], "quantum_score": data["quantum_score"],
                            "classical_score": data["classical_score"]})
        except Exception:
            break
    return {"problem_type": problem_type, "sweep": results}


# =============================================================================
# SECTION 2 — AI-POWERED RUN ADVANTAGE ANALYZER (NEW ENDPOINTS)
# =============================================================================

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
    api_key: Optional[str] = None,
) -> Optional[dict]:
    if not api_key:
        return None

    try:
        import anthropic
    except ImportError:
        return None

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
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = msg.content[0].text.strip()
        json_match = re.search(r"\{.*\}", raw, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
    except Exception:
        pass
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

    n_qubits = int(fp.get("num_qubits") or _count_qubits_from_qasm(run.qasm) or 1)
    circuit_depth = int(fp.get("depth") or 1)
    n_shots = int(res.get("shots") or params.get("shots") or 1024)

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

    api_key = get_active_key_for_user(db, "anthropic", identity.user_id) if identity else None
    claude_analysis = _call_claude_analysis(
        run, algorithm, n_qubits, circuit_depth, n_shots,
        health_score, success_prob, classical_cost, api_key=api_key,
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
    cached = store_get(db, "advantage_analyses", run_id)
    if cached is None:
        raise HTTPException(404, "No cached analysis found. Call POST /analyze/{run_id} first.")
    return cached
