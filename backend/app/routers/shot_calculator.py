"""Shot Calculator — statistical power calculator for quantum experiments.

"How many shots do I need?" answered with proper statistical formulas.
No external dependencies — pure Python stdlib + math.

Router prefix: /api/v1/shots
"""

from __future__ import annotations

import math
from typing import List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/shots", tags=["shot_calculator"])


# ---------------------------------------------------------------------------
# Statistical formulas
# ---------------------------------------------------------------------------

def _shots_for_bernoulli(p: float, margin_of_error: float, confidence: float) -> int:
    """Shots needed to estimate a Bernoulli probability p within ±margin at given confidence."""
    z_table = {0.90: 1.645, 0.95: 1.960, 0.99: 2.576, 0.999: 3.291}
    z = z_table.get(confidence, 1.960)
    n = (z ** 2 * p * (1 - p)) / (margin_of_error ** 2)
    return max(100, math.ceil(n))


def _shots_for_detection(effect_size: float, confidence: float, power: float = 0.80) -> int:
    """Shots to detect a given effect size (Cohen's h for proportions)."""
    z_alpha = {0.90: 1.282, 0.95: 1.645, 0.99: 2.326}.get(confidence, 1.645)
    z_beta = {0.80: 0.842, 0.90: 1.282, 0.95: 1.645}.get(power, 0.842)
    if effect_size <= 0:
        return 1_000_000
    n = ((z_alpha + z_beta) / effect_size) ** 2
    return max(100, math.ceil(n))


def _shots_for_tomography(n_qubits: int) -> int:
    """Minimum shots for state tomography."""
    return min(3 ** n_qubits * 1000, 1_000_000)


def _shot_noise_std(p: float, n_shots: int) -> float:
    """Standard deviation of estimated probability."""
    return math.sqrt(p * (1 - p) / n_shots)


def _margin_at_n(p: float, n: int, confidence: float) -> float:
    """Margin of error at a given shot count."""
    z_table = {0.90: 1.645, 0.95: 1.960, 0.99: 2.576, 0.999: 3.291}
    z = z_table.get(confidence, 1.960)
    return z * _shot_noise_std(p, n)


def _adjust_for_readout_error(n: int, readout_error: float) -> int:
    """Inflate shot count to compensate for readout error degradation."""
    if readout_error <= 0:
        return n
    # Effective sample reduction factor: more shots needed when readout is noisy
    factor = 1.0 / max(0.5, 1.0 - 2 * readout_error)
    return max(n, math.ceil(n * factor))


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class ShotCalcRequest(BaseModel):
    mode: str = Field(..., description="estimate_probability | detect_change | tomography | vqe_energy")
    # For estimate_probability
    expected_probability: float = Field(0.5, ge=0.0, le=1.0)
    margin_of_error: float = Field(0.05, gt=0.0, le=0.5)
    confidence_level: float = Field(0.95)
    # For detect_change
    baseline_probability: Optional[float] = Field(None, ge=0.0, le=1.0)
    expected_change: Optional[float] = Field(None, gt=0.0)
    statistical_power: float = Field(0.80)
    # For tomography
    n_qubits: Optional[int] = Field(None, ge=1, le=12)
    # For vqe_energy
    energy_precision_mhartree: Optional[float] = Field(1.0, gt=0.0)
    n_terms_hamiltonian: Optional[int] = Field(50, ge=1)
    # General
    readout_error: float = Field(0.02, ge=0.0, le=1.0)


# ---------------------------------------------------------------------------
# Core calculation logic
# ---------------------------------------------------------------------------

def _calculate_single(req: ShotCalcRequest) -> dict:
    mode = req.mode
    p = req.expected_probability
    moe = req.margin_of_error
    conf = req.confidence_level
    readout = req.readout_error

    if mode == "estimate_probability":
        recommended = _shots_for_bernoulli(p, moe, conf)
        minimum = _shots_for_bernoulli(p, moe * 1.5, conf)
        generous = _shots_for_bernoulli(p, moe * 0.7, conf)
        formula = "Bernoulli proportion estimation"
        noise_at_rec = round(_shot_noise_std(p, recommended), 4)
        interpretation = (
            f"With {recommended} shots, you'll estimate the probability "
            f"within ±{moe*100:.0f}% with {conf*100:.0f}% confidence."
        )

    elif mode == "detect_change":
        baseline = req.baseline_probability if req.baseline_probability is not None else 0.5
        change = req.expected_change if req.expected_change is not None else 0.1
        # Cohen's h effect size
        phi1 = 2 * math.asin(math.sqrt(max(0.0, min(1.0, baseline))))
        phi2 = 2 * math.asin(math.sqrt(max(0.0, min(1.0, baseline + change))))
        effect_h = abs(phi2 - phi1)
        recommended = _shots_for_detection(effect_h, conf, req.statistical_power)
        minimum = _shots_for_detection(effect_h * 0.8, conf, 0.70)
        generous = _shots_for_detection(effect_h, conf, 0.95)
        formula = "Cohen's h effect size (two-proportion z-test)"
        noise_at_rec = round(_shot_noise_std(baseline, recommended), 4)
        interpretation = (
            f"With {recommended} shots, you can detect a {change*100:.0f}% change "
            f"from {baseline*100:.0f}% with {req.statistical_power*100:.0f}% power "
            f"at {conf*100:.0f}% confidence."
        )
        p = baseline

    elif mode == "tomography":
        nq = req.n_qubits if req.n_qubits is not None else 3
        recommended = _shots_for_tomography(nq)
        minimum = max(100, recommended // 4)
        generous = min(1_000_000, recommended * 2)
        formula = f"State tomography: 3^{nq} bases × 1000 shots"
        noise_at_rec = round(_shot_noise_std(0.5, recommended), 4)
        interpretation = (
            f"State tomography for {nq} qubits requires {3**nq} measurement bases. "
            f"{recommended:,} shots provides ~1000 counts per basis."
        )
        p = 0.5
        moe = round(_margin_at_n(0.5, recommended, conf), 3)

    elif mode == "vqe_energy":
        prec = req.energy_precision_mhartree if req.energy_precision_mhartree is not None else 1.0
        n_terms = req.n_terms_hamiltonian if req.n_terms_hamiltonian is not None else 50
        z_table = {0.90: 1.645, 0.95: 1.960, 0.99: 2.576}
        z = z_table.get(conf, 1.960)
        # Shots per Pauli term ≈ (z / precision_in_variance_units)^2 × 0.25
        prec_in_hartree = prec / 1000.0
        shots_per_term = max(100, math.ceil((z / prec_in_hartree) ** 2 * 0.25))
        recommended = n_terms * shots_per_term
        minimum = n_terms * max(100, shots_per_term // 4)
        generous = n_terms * shots_per_term * 3
        formula = f"VQE: {n_terms} Pauli terms × (z/ε)² shots per term"
        noise_at_rec = round(_shot_noise_std(0.5, recommended), 4)
        interpretation = (
            f"For VQE with {n_terms} Hamiltonian terms and energy precision "
            f"{prec:.1f} mHartree, {recommended:,} total shots recommended "
            f"({shots_per_term} per term)."
        )
        p = 0.5
        moe = prec_in_hartree

    else:
        return {"error": f"Unknown mode: {mode}. Use estimate_probability, detect_change, tomography, or vqe_energy."}

    # Readout-adjusted shot count
    readout_adjusted = _adjust_for_readout_error(recommended, readout)

    # Comparison table for common shot counts
    comparison = {}
    for n_compare in [1024, 4096, 8192]:
        margin = round(_margin_at_n(p, n_compare, conf), 4)
        comparison[str(n_compare)] = {"margin": margin, "confidence": conf}

    # Cost estimate (rough)
    ibm_cost = round(recommended * 0.0000016, 6)   # ~$0.0016 per 1000 shots
    ionq_cost = round(recommended / 1000 * 0.001, 6)  # rough estimate

    return {
        "mode": mode,
        "recommended_shots": recommended,
        "minimum_shots": minimum,
        "generous_shots": generous,
        "formula_used": formula,
        "interpretation": interpretation,
        "shot_noise_at_recommended": noise_at_rec,
        "readout_error_adjustment": readout_adjusted,
        "comparison": comparison,
        "cost_estimate": {
            "ibm_shots_cost_usd": ibm_cost,
            "ionq_credit_cost": round(ionq_cost, 6),
        },
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/calculate")
def calculate_shots(req: ShotCalcRequest):
    """Main shot calculator — returns recommended shots for the specified mode."""
    return _calculate_single(req)


@router.get("/quick/{n_qubits}")
def quick_recommendation(n_qubits: int):
    """Quick shot recommendation for 3 quality tiers based on qubit count."""
    # Typical probability for an n-qubit circuit outcome
    p = 0.5

    fast = _shots_for_bernoulli(p, 0.10, 0.95)
    standard = _shots_for_bernoulli(p, 0.05, 0.95)
    publication = _shots_for_bernoulli(p, 0.02, 0.99)

    tomo = _shots_for_tomography(n_qubits)

    return {
        "n_qubits": n_qubits,
        "tiers": {
            "fast": {
                "shots": fast,
                "description": "Quick scan (95% CI, ±10%)",
                "confidence": "95%",
                "margin_of_error": "±10%",
            },
            "standard": {
                "shots": standard,
                "description": "Standard (95% CI, ±5%)",
                "confidence": "95%",
                "margin_of_error": "±5%",
            },
            "publication": {
                "shots": publication,
                "description": "Publication-quality (99% CI, ±2%)",
                "confidence": "99%",
                "margin_of_error": "±2%",
            },
        },
        "tomography_minimum": tomo,
        "tomography_note": f"Full {n_qubits}-qubit state tomography requires {3**min(n_qubits,12):,} bases.",
    }


@router.post("/batch")
def batch_calculate(requests: List[ShotCalcRequest]):
    """Calculate shot requirements for multiple scenarios at once."""
    return [_calculate_single(req) for req in requests]
