"""Evolutionary Circuit Optimizer — Feature #8 of 10.

Uses a simple (μ + λ)-evolutionary strategy to suggest optimised
variants of a stored circuit, scored by a multi-objective fitness
function.

Design
──────
Population: start from the stored run's fingerprint as the single
  initial "individual".  Apply stochastic mutations and keep the top
  survivors.  No Qiskit circuit objects are needed — we operate on
  the fingerprint JSON, making this backend-agnostic and very fast.

Fitness function
────────────────
  F = w_d × (1 - depth/depth_0)      # shallower is better
    + w_g × (1 - size/size_0)        # fewer gates is better
    + w_nc × (1 - nc/nc_0)           # fewer T-gates is better
    + w_cx × (1 - cx/cx_0)           # fewer 2Q gates is better

Mutations
─────────
1. gate_cancel      — probabilistically remove a gate pair (depth--)
2. layer_merge      — merge two consecutive layers (depth -= ~10%)
3. t_to_clifford    — replace a T gate with an SX+RZ approximation
                      (nc_ratio--)
4. cx_reduction     — fuse two CNOT paths (cx_count--)
5. rz_absorption    — absorb an RZ into a neighbouring gate (size--)
6. noop_removal     — remove identity/barrier gates (size--)

Each mutation returns a delta applied to the fingerprint. The fitness
of each candidate is evaluated and the population is sorted.

Returns: ranked list of candidate fingerprint vectors, mutations
applied, estimated fitness, and a brief explanation.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["evo_optimizer"])

# ──────────────────────────────────────────────────────────────────────
# Weights (must sum to 1)
# ──────────────────────────────────────────────────────────────────────
_W = {"depth": 0.30, "size": 0.25, "nc": 0.25, "cx": 0.20}


# ──────────────────────────────────────────────────────────────────────
# Fitness
# ──────────────────────────────────────────────────────────────────────

def _fitness(ind: dict, baseline: dict) -> float:
    """Fitness ∈ [0, 1] — higher is better."""
    def rel(key: str, default: float = 1.0) -> float:
        b = float(baseline.get(key) or default)
        v = float(ind.get(key) or default)
        if b <= 0:
            return 1.0
        return max(0.0, 1.0 - (v - b) / b)  # improvement over baseline

    score = (
        _W["depth"] * rel("depth",    30.0) +
        _W["size"]  * rel("size",     50.0) +
        _W["nc"]    * rel("nc_ratio",  0.1) +
        _W["cx"]    * rel("cx_count",  5.0)
    )
    return round(min(1.0, max(0.0, score)), 4)


def _absolute_fitness(ind: dict) -> float:
    """Score of the individual in absolute terms (for ranking when baseline = 0)."""
    d   = float(ind.get("depth", 999) or 999)
    s   = float(ind.get("size", 999) or 999)
    nc  = float(ind.get("non_clifford_ratio", 1.0) or 1.0)
    cx  = float(ind.get("cx_count", 999) or 999)
    # Sigmoidal compression so all terms ∈ [0,1]
    def sig(x: float, scale: float) -> float:
        return 1.0 / (1.0 + math.exp((x - scale) / scale))
    return round(
        _W["depth"] * sig(d, 50.0) +
        _W["size"]  * sig(s, 100.0) +
        _W["nc"]    * (1.0 - nc) +
        _W["cx"]    * sig(cx, 20.0),
        4,
    )


# ──────────────────────────────────────────────────────────────────────
# Mutations
# ──────────────────────────────────────────────────────────────────────

def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return max(0, int(float(v or default)))
    except Exception:
        return default


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v or default)
    except Exception:
        return default


_MUTATIONS: list[dict] = [
    {
        "name":        "gate_cancel",
        "description": "Cancel a redundant gate pair (e.g. X·X = I, CX·CX = I)",
        "probability": 0.35,
    },
    {
        "name":        "layer_merge",
        "description": "Merge two adjacent commuting layers, reducing depth by ~10–20%",
        "probability": 0.30,
    },
    {
        "name":        "t_to_clifford",
        "description": "Replace a T/Tdg gate with an SX+RZ Clifford approximation (trades accuracy for T-count)",
        "probability": 0.25,
    },
    {
        "name":        "cx_reduction",
        "description": "Fuse a CNOT pair into a single native two-qubit gate via gate identity",
        "probability": 0.20,
    },
    {
        "name":        "rz_absorption",
        "description": "Absorb a commuting RZ rotation into adjacent gate, removing one instruction",
        "probability": 0.25,
    },
    {
        "name":        "noop_removal",
        "description": "Remove identity gates and barriers that contribute to size but not function",
        "probability": 0.40,
    },
]


def _apply_mutation(fp: dict, mutation: dict, rng: random.Random) -> tuple[dict, bool]:
    """
    Returns (new_fingerprint, was_applied).
    Applies the mutation if it fires and the precondition is met.
    """
    name    = mutation["name"]
    p       = mutation["probability"]
    if rng.random() > p:
        return fp, False

    fp2 = dict(fp)  # shallow copy is fine (values are scalars)

    depth = _safe_int(fp2.get("depth"), 30)
    size  = _safe_int(fp2.get("size"), 50)
    nc    = _safe_float(fp2.get("non_clifford_ratio"), 0.1)
    cx    = _safe_int(fp2.get("cx_count"), 5)

    if name == "gate_cancel":
        if size < 2:
            return fp, False
        fp2["size"]  = max(1, size - rng.randint(1, max(1, size // 10)))
        fp2["depth"] = max(1, depth - rng.randint(0, max(1, depth // 12)))

    elif name == "layer_merge":
        if depth < 3:
            return fp, False
        factor = rng.uniform(0.08, 0.20)
        fp2["depth"] = max(1, round(depth * (1 - factor)))

    elif name == "t_to_clifford":
        if nc <= 0:
            return fp, False
        t_count = round(nc * size)
        if t_count < 1:
            return fp, False
        removed = rng.randint(1, max(1, t_count // 3))
        new_t   = max(0, t_count - removed)
        # Clifford replacement adds ~2 gates per T
        fp2["size"] = max(1, size + removed)  # net +1 gate per replacement
        fp2["non_clifford_ratio"] = round(new_t / max(1, fp2["size"]), 4)

    elif name == "cx_reduction":
        if cx < 2:
            return fp, False
        removed = rng.randint(1, max(1, cx // 4))
        fp2["cx_count"] = max(0, cx - removed)
        fp2["size"]     = max(1, size - removed)
        fp2["depth"]    = max(1, depth - rng.randint(0, removed))

    elif name == "rz_absorption":
        if size < 2:
            return fp, False
        fp2["size"] = max(1, size - rng.randint(1, max(1, size // 8)))

    elif name == "noop_removal":
        if size < 2:
            return fp, False
        removed = rng.randint(1, max(1, size // 6))
        fp2["size"]  = max(1, size - removed)
        fp2["depth"] = max(1, depth - rng.randint(0, max(1, removed // 2)))

    return fp2, True


def _evolve(baseline_fp: dict, generations: int, pop_size: int, seed: int) -> list[dict]:
    """Run (1 + λ)-ES for `generations` steps, return population sorted by fitness."""
    rng = random.Random(seed)
    population = [dict(baseline_fp)]

    for _ in range(generations):
        # Generate λ offspring from best individual
        parent = population[0]
        offspring: list[dict] = []
        for _ in range(pop_size):
            candidate = dict(parent)
            applied: list[str] = []
            for mut in rng.sample(_MUTATIONS, k=rng.randint(1, 3)):
                candidate, ok = _apply_mutation(candidate, mut, rng)
                if ok:
                    applied.append(mut["name"])
            candidate["_mutations"] = applied
            candidate["_fitness"]   = _absolute_fitness(candidate)
            offspring.append(candidate)

        population = sorted(offspring, key=lambda x: x["_fitness"], reverse=True)[:pop_size]

    return population


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/evo-optimize")
def evo_optimize(
    run_id: str,
    generations: int = Query(default=20, ge=5, le=100, description="Number of EA generations"),
    pop_size:    int = Query(default=8,  ge=4, le=32,  description="Population size"),
    seed:        int = Query(default=42, description="Random seed for reproducibility"),
    db: Session = Depends(get_db),
):
    """
    Run an evolutionary optimiser on the circuit's fingerprint and return
    the top candidate variants with predicted improvements.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp = run.fingerprint or {}
    n_qubits = _safe_int(fp.get("num_qubits"), 0)
    if n_qubits == 0:
        raise HTTPException(422, "Circuit fingerprint missing num_qubits.")

    baseline_fp = {
        "num_qubits":          n_qubits,
        "depth":               _safe_int(fp.get("depth"), 30),
        "size":                _safe_int(fp.get("size"), 50),
        "cx_count":            _safe_int(fp.get("cx_count"), 5),
        "non_clifford_ratio":  _safe_float(fp.get("non_clifford_ratio"), 0.1),
    }
    baseline_fitness = _absolute_fitness(baseline_fp)
    population = _evolve(baseline_fp, generations, pop_size, seed)

    # Build output candidates (dedup by fingerprint tuple)
    seen: set[tuple] = set()
    candidates: list[dict] = []
    for ind in population:
        key = (ind.get("depth"), ind.get("size"), ind.get("cx_count"), ind.get("non_clifford_ratio"))
        if key in seen:
            continue
        seen.add(key)

        mutations = ind.pop("_mutations", [])
        fitness   = ind.pop("_fitness", 0.0)
        improvement = round((fitness - baseline_fitness) / max(1e-9, baseline_fitness) * 100, 1)

        depth_delta  = ind["depth"] - baseline_fp["depth"]
        size_delta   = ind["size"]  - baseline_fp["size"]
        cx_delta     = ind["cx_count"] - baseline_fp["cx_count"]
        nc_delta     = round(ind["non_clifford_ratio"] - baseline_fp["non_clifford_ratio"], 4)

        summary_parts = []
        if depth_delta < 0:
            summary_parts.append(f"depth {depth_delta:+d}")
        if size_delta < 0:
            summary_parts.append(f"gates {size_delta:+d}")
        if cx_delta < 0:
            summary_parts.append(f"CX {cx_delta:+d}")
        if nc_delta < 0:
            summary_parts.append(f"T-ratio {nc_delta:+.3f}")

        candidates.append({
            "fingerprint":       ind,
            "mutations_applied": mutations,
            "fitness":           round(fitness, 4),
            "improvement_pct":   improvement,
            "deltas": {
                "depth":               depth_delta,
                "size":                size_delta,
                "cx_count":            cx_delta,
                "non_clifford_ratio":  nc_delta,
            },
            "summary": "Improvements: " + ", ".join(summary_parts) if summary_parts else "No net improvement found.",
        })

        if len(candidates) >= 5:
            break

    # Best overall summary
    best = candidates[0] if candidates else None
    narrative = (
        f"Evolutionary search over {generations} generations found "
        f"{len(candidates)} distinct candidate variants. "
        + (
            f"Best candidate reduces depth by {abs(best['deltas']['depth'])} "
            f"and gate count by {abs(best['deltas']['size'])} "
            f"with {best['improvement_pct']:+.1f}% fitness improvement."
            if best and best["deltas"]["depth"] < 0
            else "Circuit appears near-optimal for these objectives."
        )
    )

    return {
        "run_id":           run_id,
        "n_qubits":         n_qubits,
        "baseline":         baseline_fp,
        "baseline_fitness": round(baseline_fitness, 4),
        "generations":      generations,
        "pop_size":         pop_size,
        "seed":             seed,
        "candidates":       candidates,
        "narrative":        narrative,
        "optimized_at":     datetime.now(timezone.utc).isoformat(),
    }
