"""Pauli Noise Learning from Run History — Feature #2 of 10.

Learns effective Pauli channel parameters directly from production run
bitstring distributions, with no dedicated characterization circuits needed.

Two endpoints:
  GET /api/v1/runs/{run_id}/pauli-noise   — per-run noise analysis
  GET /api/v1/backends/{backend}/pauli-noise-history
      — time-series of noise metrics across all backend runs

Mathematics
───────────
1. Per-qubit marginal:  P_i(0) = sum of p(bitstring) where bit i = '0'
   Polarization:        Z_i = P_i(0) − P_i(1)
   Effective flip rate: p_flip_i = (1 − |Z_i|) / 2

2. Rényi-2 entropy:     S₂ = −log₂(Σ p²)
   Under fully depolarising noise S₂ → n; under no noise S₂ → 0
   (for a deterministic ideal output) or varies.

3. Effective depolarising rate (linear interpolation):
   p_dep = 1 − (N·Σ p² − 1)/(N − 1)   where N = 2ⁿ
   p_dep = 0 → pure state, p_dep = 1 → fully mixed (max noise)

4. Heavy output fraction: fraction of observed bitstrings above the
   median probability.  Under quantum advantage it should exceed 2/3.
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

router = APIRouter(prefix="/api/v1", tags=["pauli_noise"])

_MAX_QUBITS_MARGINAL = 20   # skip per-qubit analysis for very wide circuits


# ──────────────────────────────────────────────────────────────────────
# Core analysis
# ──────────────────────────────────────────────────────────────────────

def _extract_counts(results: dict) -> dict[str, int] | None:
    if not results:
        return None
    # SDK puts counts under "counts" key or directly at top level
    counts = results.get("counts") or results
    if not isinstance(counts, dict):
        return None
    # Validate: values must be numeric
    try:
        return {str(k): int(v) for k, v in counts.items() if isinstance(v, (int, float))}
    except Exception:
        return None


def _analyze_counts(counts: dict[str, int]) -> dict:
    total = sum(counts.values())
    if total == 0:
        return {}

    probs: dict[str, float] = {bs: cnt / total for bs, cnt in counts.items()}

    # Infer qubit count from longest bitstring
    n_qubits = max(len(bs) for bs in probs)

    # Per-qubit marginals (qubit 0 = rightmost bit)
    qubit_p0 = [0.0] * n_qubits
    for bs, p in probs.items():
        bs_padded = bs.zfill(n_qubits)
        for i in range(n_qubits):
            # bit position i: index from right
            if bs_padded[-(i + 1)] == "0":
                qubit_p0[i] += p

    qubit_p1 = [1.0 - p for p in qubit_p0]
    polarizations = [abs(p0 - p1) for p0, p1 in zip(qubit_p0, qubit_p1)]
    flip_rates = [(1.0 - pol) / 2.0 for pol in polarizations]

    # Rényi-2 entropy
    sum_p2 = sum(p * p for p in probs.values())
    renyi2 = -math.log2(sum_p2) if sum_p2 > 0 else float(n_qubits)

    # Effective depolarising rate
    n_states = 1 << n_qubits  # 2^n
    if n_states > 1 and sum_p2 > 0:
        p_dep = max(0.0, min(1.0, 1.0 - (n_states * sum_p2 - 1.0) / (n_states - 1.0)))
    else:
        p_dep = 0.0

    # Heavy output fraction (bitstrings above median probability)
    sorted_probs = sorted(probs.values(), reverse=True)
    median_idx = len(sorted_probs) // 2
    median_p = sorted_probs[median_idx] if sorted_probs else 0.0
    heavy_count = sum(1 for p in probs.values() if p > median_p)
    heavy_fraction = heavy_count / len(probs) if probs else 0.0

    dominant_bs = max(probs, key=probs.__getitem__)
    dominant_p = probs[dominant_bs]

    # Noise tier
    if p_dep < 0.05:
        noise_tier = "low"
    elif p_dep < 0.25:
        noise_tier = "moderate"
    elif p_dep < 0.60:
        noise_tier = "high"
    else:
        noise_tier = "very_high"

    # Noise interpretation string
    noise_interp = _interpret_noise(n_qubits, p_dep, flip_rates, heavy_fraction)

    skip_marginals = n_qubits > _MAX_QUBITS_MARGINAL

    return {
        "n_qubits":               n_qubits,
        "total_shots":            total,
        "unique_outcomes":        len(probs),
        "renyi2_entropy":         round(renyi2, 4),
        "max_entropy":            n_qubits,
        "entropy_fraction":       round(renyi2 / n_qubits, 4) if n_qubits > 0 else 0.0,
        "effective_depolarizing_rate": round(p_dep, 4),
        "noise_tier":             noise_tier,
        "noise_interpretation":   noise_interp,
        "mean_flip_rate":         round(sum(flip_rates) / len(flip_rates), 4) if flip_rates else 0.0,
        "noisiest_qubit":         int(flip_rates.index(max(flip_rates))) if not skip_marginals else None,
        "cleanest_qubit":         int(flip_rates.index(min(flip_rates))) if not skip_marginals else None,
        "qubit_flip_rates":       [round(r, 4) for r in flip_rates] if not skip_marginals else [],
        "qubit_polarizations":    [round(p, 4) for p in polarizations] if not skip_marginals else [],
        "heavy_output_fraction":  round(heavy_fraction, 4),
        "quantum_advantage_indicator": heavy_fraction > 2/3,
        "dominant_bitstring":     dominant_bs,
        "dominant_probability":   round(dominant_p, 4),
    }


def _interpret_noise(n: int, p_dep: float, flip_rates: list[float], heavy: float) -> str:
    if p_dep < 0.05:
        tier = "low noise"
    elif p_dep < 0.25:
        tier = "moderate noise"
    elif p_dep < 0.60:
        tier = "high noise"
    else:
        tier = "very high noise"

    parts = [f"{n}-qubit circuit shows {tier} (effective depolarizing rate {p_dep:.1%})."]

    if flip_rates:
        worst = max(flip_rates)
        worst_q = flip_rates.index(worst)
        if worst > 0.35:
            parts.append(f"Qubit {worst_q} has the highest flip rate ({worst:.1%}) — likely gate or readout error hotspot.")

    if heavy > 2/3:
        parts.append(f"Heavy output fraction {heavy:.1%} > 2/3 — consistent with quantum advantage regime.")
    elif heavy < 0.4:
        parts.append(f"Low heavy output fraction ({heavy:.1%}) suggests strong decoherence.")

    return " ".join(parts)


# ──────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/pauli-noise")
def run_pauli_noise(run_id: str, db: Session = Depends(get_db)):
    """Analyse the effective Pauli noise channel from a single run's counts."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    counts = _extract_counts(run.results or {})
    if not counts:
        raise HTTPException(422, "No bitstring count data found in this run's results.")

    analysis = _analyze_counts(counts)
    if not analysis:
        raise HTTPException(422, "Count data empty or invalid.")

    # Augment with calibration context if available
    cal = run.calibration or {}
    cal_context = {}
    if cal.get("avg_readout_error") is not None:
        try:
            ro = float(cal["avg_readout_error"])
            cal_context["calibration_readout_error"] = round(ro, 6)
            cal_context["readout_vs_noise"] = (
                "readout-dominated" if ro > analysis["mean_flip_rate"] * 0.5 else "gate-dominated"
            )
        except (TypeError, ValueError):
            pass
    if cal.get("avg_gate_error") is not None:
        try:
            cal_context["calibration_gate_error"] = round(float(cal["avg_gate_error"]), 6)
        except (TypeError, ValueError):
            pass

    return {
        "run_id":      run_id,
        "backend":     run.backend,
        "circuit_name": run.circuit_name,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        **analysis,
        "calibration_context": cal_context,
    }


@router.get("/backends/{backend}/pauli-noise-history")
def backend_pauli_noise_history(
    backend: str,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """
    Time-series of effective noise metrics for all runs on a given backend.
    Useful for detecting noise degradation trends over time.
    """
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend)
        .order_by(Run.created_at.desc())
        .limit(limit * 3)  # over-fetch to account for runs without counts
    ).all()

    points = []
    for run in runs:
        counts = _extract_counts(run.results or {})
        if not counts:
            continue
        try:
            analysis = _analyze_counts(counts)
            if not analysis:
                continue
            points.append({
                "run_id":         run.run_id,
                "circuit_name":   run.circuit_name,
                "created_at":     run.created_at.isoformat(),
                "n_qubits":       analysis["n_qubits"],
                "effective_depolarizing_rate": analysis["effective_depolarizing_rate"],
                "mean_flip_rate": analysis["mean_flip_rate"],
                "renyi2_entropy": analysis["renyi2_entropy"],
                "entropy_fraction": analysis["entropy_fraction"],
                "heavy_output_fraction": analysis["heavy_output_fraction"],
                "noise_tier":     analysis["noise_tier"],
                "total_shots":    analysis["total_shots"],
                # Add calibration metrics if available
                "cal_t1_us":      _safe_float(run.calibration, "avg_t1_us"),
                "cal_gate_error": _safe_float(run.calibration, "avg_gate_error"),
            })
        except Exception:
            continue
        if len(points) >= limit:
            break

    if not points:
        raise HTTPException(404, f"No runs with count data found for backend '{backend}'.")

    # Compute trend statistics
    dep_rates = [p["effective_depolarizing_rate"] for p in points]
    recent_half = dep_rates[:len(dep_rates)//2] if len(dep_rates) > 2 else dep_rates
    older_half  = dep_rates[len(dep_rates)//2:] if len(dep_rates) > 2 else dep_rates

    recent_avg = sum(recent_half) / len(recent_half) if recent_half else 0
    older_avg  = sum(older_half)  / len(older_half)  if older_half  else 0
    noise_trend = "improving" if recent_avg < older_avg * 0.95 else (
                  "degrading" if recent_avg > older_avg * 1.05 else "stable")

    return {
        "backend":         backend,
        "n_runs_analyzed": len(points),
        "noise_trend":     noise_trend,
        "mean_dep_rate":   round(sum(dep_rates) / len(dep_rates), 4) if dep_rates else None,
        "points":          list(reversed(points)),  # oldest first for chart
        "analyzed_at":     datetime.now(timezone.utc).isoformat(),
    }


def _safe_float(d: dict | None, key: str) -> float | None:
    if not d:
        return None
    try:
        v = d.get(key)
        return round(float(v), 6) if v is not None else None
    except (TypeError, ValueError):
        return None
