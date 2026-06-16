"""Quantum Advantage Oracle — Feature #4 of 10.

Estimates whether a circuit is classically hard to simulate and how close
it is to demonstrating genuine quantum advantage.

Classical simulation strategies analysed
─────────────────────────────────────────
1. Stabilizer-rank simulation   cost ∝ 2^(T/2) × n × d
2. Tensor-network contraction   cost ∝ χ³ × d × n  (χ = bond dimension)
3. Clifford + T simulation      cost ∝ n² × C + 2^T × n
4. MPS/DMRG simulation          cost ∝ n × χ² × d  (only low-entanglement)
5. Brute-force state vector     cost ∝ 2^n × d

Each strategy has a FLOP estimate.  We report the *easiest* (minimum cost)
classical strategy, which is the tightest upper bound on classical hardness.

Hardness tiers (FLOPs)
──────────────────────
easy        < 10^9    (laptop, seconds)
moderate    10^9–10^15 (server/cluster, minutes–hours)
hard        10^15–10^45 (supercomputer, days–years)
intractable > 10^45   (beyond foreseeable classical hardware)

Quantum advantage indicators
────────────────────────────
• heavy_output_fraction > 2/3  (XEB-like signal)
• T-count above Gottesman–Knill threshold
• Entanglement width too large for MPS
• Circuit too deep for tensor-network light-cone tricks
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["advantage_oracle"])

_LOG10_LAPTOP    = 9
_LOG10_CLUSTER   = 15
_LOG10_SUPER     = 45


# ──────────────────────────────────────────────────────────────────────
# Cost estimators  (all return log10 of FLOPs)
# ──────────────────────────────────────────────────────────────────────

def _stabilizer_rank_cost(n: int, depth: int, t_count: int) -> float:
    """
    Bravyi et al. stabilizer rank simulation:
    cost ~ 2^(T/2) gates × depth × n  (rough)
    """
    if t_count == 0:
        return math.log10(max(1, n * depth))  # Clifford: poly cost
    return (t_count / 2) * math.log10(2) + math.log10(max(1, n * depth))


def _tensor_network_cost(n: int, depth: int, entanglement_width: int) -> float:
    """
    Tensor-network contraction cost:
    χ = 2^(entanglement_width/2), cost ~ χ^3 × d × n
    """
    ew = max(1, min(entanglement_width, n))
    chi = ew / 2 * math.log10(2)   # log10(χ) = ew/2 * log10(2)
    return 3 * chi + math.log10(max(1, depth * n))


def _mps_cost(n: int, depth: int, cx_count: int) -> float:
    """
    MPS simulation cost. Breaks down when entanglement is high.
    Assumes χ grows as O(2^(cx_count/n)) per layer.
    """
    chi_log = (cx_count / max(n, 1)) * math.log10(2)
    return 2 * chi_log + math.log10(max(1, n * depth))


def _statevector_cost(n: int, depth: int) -> float:
    """Brute-force statevector: 2^n amplitudes × depth."""
    return n * math.log10(2) + math.log10(max(1, depth))


def _clifford_t_cost(n: int, depth: int, t_count: int, clifford_count: int) -> float:
    """Clifford + T decomposition: O(n^2 × C + 2^T × n)."""
    clifford_cost = math.log10(max(1, n * n * clifford_count))
    if t_count == 0:
        return clifford_cost
    t_cost = t_count * math.log10(2) + math.log10(max(1, n))
    combined = max(clifford_cost, t_cost)  # log-space max ≈ sum when well-separated
    return combined


# ──────────────────────────────────────────────────────────────────────
# Tier classification
# ──────────────────────────────────────────────────────────────────────

def _hardness_tier(log10_flops: float) -> str:
    if log10_flops < _LOG10_LAPTOP:
        return "easy"
    elif log10_flops < _LOG10_CLUSTER:
        return "moderate"
    elif log10_flops < _LOG10_SUPER:
        return "hard"
    else:
        return "intractable"


def _tier_label(tier: str) -> str:
    return {
        "easy":        "Classically easy",
        "moderate":    "Classically moderate",
        "hard":        "Classically hard",
        "intractable": "Classically intractable",
    }.get(tier, tier)


def _flops_human(log10_flops: float) -> str:
    if log10_flops < 3:
        return f"~{10**log10_flops:.0f} FLOPs"
    exponent = int(log10_flops)
    mantissa = 10 ** (log10_flops - exponent)
    return f"~{mantissa:.1f}×10^{exponent} FLOPs"


# ──────────────────────────────────────────────────────────────────────
# Advantage score
# ──────────────────────────────────────────────────────────────────────

def _advantage_score(
    best_log10: float,
    n_qubits: int,
    t_count: int,
    cx_count: int,
    heavy_fraction: float | None,
) -> dict:
    """Return a 0–1 quantum advantage probability with contributing factors."""
    score = 0.0
    factors = []

    # Classical hardness factor (0–0.4)
    if best_log10 >= _LOG10_SUPER:
        score += 0.40
        factors.append("circuit is classically intractable")
    elif best_log10 >= _LOG10_CLUSTER:
        score += 0.25
        factors.append("circuit requires supercomputer to simulate")
    elif best_log10 >= _LOG10_LAPTOP:
        score += 0.10
        factors.append("circuit is moderately hard classically")

    # T-count factor (0–0.25)
    t_threshold = max(10, n_qubits)
    if t_count >= t_threshold * 3:
        score += 0.25
        factors.append(f"very high T-count ({t_count}) — stabilizer-rank hardness")
    elif t_count >= t_threshold:
        score += 0.15
        factors.append(f"T-count {t_count} exceeds Gottesman–Knill threshold")
    elif t_count > 0:
        score += 0.05

    # Qubit scaling factor (0–0.20)
    if n_qubits >= 50:
        score += 0.20
        factors.append("≥50 qubits — statevector simulation impossible")
    elif n_qubits >= 30:
        score += 0.15
        factors.append("≥30 qubits — severe memory bottleneck for classical simulation")
    elif n_qubits >= 20:
        score += 0.08

    # Heavy output fraction XEB signal (0–0.15)
    if heavy_fraction is not None:
        if heavy_fraction > 2/3:
            score += 0.15
            factors.append(f"heavy output fraction {heavy_fraction:.1%} > 2/3 (XEB signal)")
        elif heavy_fraction > 0.55:
            score += 0.07

    return {
        "advantage_score": round(min(1.0, score), 3),
        "contributing_factors": factors,
    }


# ──────────────────────────────────────────────────────────────────────
# Heavy output fraction from results
# ──────────────────────────────────────────────────────────────────────

def _heavy_fraction(results: dict) -> float | None:
    counts = results.get("counts") or results
    if not isinstance(counts, dict):
        return None
    try:
        total = sum(int(v) for v in counts.values())
        if total == 0:
            return None
        probs = {k: int(v) / total for k, v in counts.items()}
        sorted_p = sorted(probs.values(), reverse=True)
        median_p = sorted_p[len(sorted_p) // 2]
        heavy = sum(1 for p in probs.values() if p > median_p)
        return round(heavy / len(probs), 4)
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/advantage-oracle")
def advantage_oracle(run_id: str, db: Session = Depends(get_db)):
    """
    Estimate classical simulation cost and quantum advantage probability
    for this run's circuit.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp = run.fingerprint or {}
    n_qubits = int(fp.get("num_qubits") or 0)
    if n_qubits == 0:
        raise HTTPException(422, "Circuit fingerprint missing num_qubits.")

    depth   = int(fp.get("depth") or 1)
    gc      = fp.get("gate_counts") or {}
    t_count = int(gc.get("t", 0) + gc.get("tdg", 0))
    cx_count = int(gc.get("cx", 0) + gc.get("cnot", 0) + gc.get("ecr", 0) + gc.get("cz", 0))
    clifford_count = max(0, sum(gc.values()) - t_count)

    # Estimate entanglement width from CX density (heuristic)
    cx_per_layer = cx_count / max(depth, 1)
    entanglement_width = min(n_qubits, int(cx_per_layer * 2) + 2)

    # Compute each strategy cost
    strategies = {
        "stabilizer_rank": _stabilizer_rank_cost(n_qubits, depth, t_count),
        "tensor_network":  _tensor_network_cost(n_qubits, depth, entanglement_width),
        "mps_simulation":  _mps_cost(n_qubits, depth, cx_count),
        "statevector":     _statevector_cost(n_qubits, depth),
        "clifford_t":      _clifford_t_cost(n_qubits, depth, t_count, clifford_count),
    }

    # Best (cheapest) classical strategy
    best_strategy = min(strategies, key=strategies.__getitem__)
    best_log10 = strategies[best_strategy]
    hardness = _hardness_tier(best_log10)

    # XEB-like signal from results
    heavy = _heavy_fraction(run.results or {})

    # Advantage score
    adv = _advantage_score(best_log10, n_qubits, t_count, cx_count, heavy)

    # Limiting factor
    most_expensive = max(strategies, key=strategies.__getitem__)
    limiting_factor_map = {
        "stabilizer_rank": "T-gate count (non-Clifford magic)",
        "tensor_network":  "Entanglement width",
        "mps_simulation":  "Entanglement entropy (CX density)",
        "statevector":     "Qubit count (exponential memory)",
        "clifford_t":      "T-count in Clifford+T decomposition",
    }

    # Classical simulation feasibility narrative
    narrative = _narrative(hardness, n_qubits, t_count, cx_count, best_strategy, best_log10)

    return {
        "run_id":              run_id,
        "backend":             run.backend,
        "n_qubits":            n_qubits,
        "depth":               depth,
        "t_count":             t_count,
        "cx_count":            cx_count,
        "entanglement_width":  entanglement_width,
        "hardness_tier":       hardness,
        "hardness_label":      _tier_label(hardness),
        "best_classical_strategy": best_strategy,
        "best_classical_cost_log10": round(best_log10, 2),
        "best_classical_cost_human": _flops_human(best_log10),
        "limiting_factor":     limiting_factor_map.get(most_expensive, most_expensive),
        "strategies": {
            k: {
                "log10_flops": round(v, 2),
                "human":       _flops_human(v),
                "tier":        _hardness_tier(v),
            }
            for k, v in strategies.items()
        },
        "heavy_output_fraction": heavy,
        "advantage_score":     adv["advantage_score"],
        "contributing_factors": adv["contributing_factors"],
        "narrative":           narrative,
        "analyzed_at":         datetime.now(timezone.utc).isoformat(),
    }


def _narrative(hardness: str, n: int, t: int, cx: int, best: str, log10: float) -> str:
    parts = []
    if hardness == "easy":
        parts.append(f"This {n}-qubit circuit can be simulated classically in polynomial time.")
        if t == 0:
            parts.append("Zero T-gates — the circuit is fully within the Clifford group (Gottesman–Knill theorem).")
    elif hardness == "moderate":
        parts.append(f"Classical simulation requires significant compute (~{_flops_human(log10)}) but is feasible on a server.")
        parts.append(f"Best strategy: {best.replace('_', ' ')}.")
    elif hardness == "hard":
        parts.append(f"Classical simulation is hard (~{_flops_human(log10)}) — requires supercomputer-scale resources.")
        if t > 20:
            parts.append(f"T-count {t} drives the stabilizer-rank cost to 2^{t//2}.")
        if n > 25:
            parts.append(f"{n} qubits exceeds feasible statevector memory on commodity hardware.")
    else:
        parts.append(f"Classical simulation is practically intractable (~{_flops_human(log10)}).")
        parts.append("This circuit is a strong candidate for genuine quantum advantage.")
    return " ".join(parts)
