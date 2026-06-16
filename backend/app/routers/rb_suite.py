"""Randomized Benchmarking Suite — standard, interleaved, and simultaneous RB."""
from __future__ import annotations
import math, random, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/rb-suite", tags=["rb_suite"])

# ─────────────────────────────────────────────────────────────────────────────
# Backend noise profiles
# ─────────────────────────────────────────────────────────────────────────────

_BACKENDS: Dict[str, Dict[str, Any]] = {
    "ibm_nairobi":    {"error_rate": 0.002, "t1_us": 120.0, "t2_us": 80.0,  "n_qubits": 7},
    "ibm_cairo":      {"error_rate": 0.003, "t1_us": 100.0, "t2_us": 70.0,  "n_qubits": 5},
    "ibm_brisbane":   {"error_rate": 0.0015,"t1_us": 200.0, "t2_us": 150.0, "n_qubits": 127},
    "ibm_sherbrooke": {"error_rate": 0.001, "t1_us": 300.0, "t2_us": 200.0, "n_qubits": 127},
    "ionq_harmony":   {"error_rate": 0.0008,"t1_us": 1e6,   "t2_us": 1e5,   "n_qubits": 11},
    "rigetti_aspen":  {"error_rate": 0.004, "t1_us": 80.0,  "t2_us": 60.0,  "n_qubits": 80},
    "simulator":      {"error_rate": 0.0,   "t1_us": 1e9,   "t2_us": 1e9,   "n_qubits": 32},
}

# Gate-specific interleaved error additions (on top of base error rate)
_GATE_EXTRA_ERROR: Dict[str, float] = {
    "x":    0.0005,
    "sx":   0.0005,
    "rz":   0.0001,
    "h":    0.0005,
    "cx":   0.005,
    "cz":   0.005,
    "ecr":  0.005,
    "swap": 0.012,
    "t":    0.0003,
    "s":    0.0002,
}

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _log_space(start: int, stop: int, n: int) -> List[int]:
    """Return n integers log-spaced between start and stop (inclusive)."""
    if n <= 1:
        return [stop]
    result = []
    for i in range(n):
        val = int(round(start * (stop / max(start, 1)) ** (i / (n - 1))))
        val = max(1, val)
        if val not in result:
            result.append(val)
    result.sort()
    return result


def _survival_prob(m: int, p: float, A: float, B: float, rng: random.Random, shots: int) -> float:
    """Noisy survival probability at sequence length m."""
    ideal = A * (1 - 2 * p) ** m + B
    # Shot noise: binomial std ≈ sqrt(p*(1-p)/shots)
    sigma = math.sqrt(ideal * (1 - ideal) / max(shots, 1))
    return round(max(0.0, min(1.0, ideal + rng.gauss(0, sigma))), 5)


def _fit_rb_decay(lengths: List[int], probs: List[float]) -> Dict[str, float]:
    """
    Fit A * (1 - 2p)^m + B via log-linearisation.
    Assume B=0.5, A=0.5 and fit p from linear regression of
    log((prob - B) / A) = m * log(1 - 2p).
    """
    A, B = 0.5, 0.5
    xs, ys = [], []
    for m, sp in zip(lengths, probs):
        val = (sp - B) / max(A, 1e-9)
        if val > 1e-9:
            xs.append(float(m))
            ys.append(math.log(val))

    if len(xs) < 2:
        return {"A": A, "B": B, "p": 0.001}

    # Linear regression: y = slope * x + 0
    n = len(xs)
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs) or 1e-9
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = sxy / sxx

    # slope = log(1 - 2p) => p = (1 - exp(slope)) / 2
    p_fit = max(0.0, min(0.5, (1 - math.exp(slope)) / 2))
    return {"A": A, "B": B, "p": round(p_fit, 7)}


def _quality_grade(epc: float) -> str:
    if epc < 0.0005:
        return "A+ (world-class)"
    if epc < 0.001:
        return "A (excellent)"
    if epc < 0.003:
        return "B (good)"
    if epc < 0.01:
        return "C (moderate)"
    return "D (poor)"


# ─────────────────────────────────────────────────────────────────────────────
# Request model
# ─────────────────────────────────────────────────────────────────────────────

class RBRequest(BaseModel):
    backend: str = Field(default="ibm_nairobi")
    rb_type: str = Field(default="standard", description="standard | interleaved | simultaneous")
    qubit: int = Field(default=0, ge=0)
    gate: Optional[str] = Field(default=None, description="Gate to interleave (for interleaved RB)")
    max_length: int = Field(default=100, ge=2, le=10_000)
    n_lengths: int = Field(default=10, ge=2, le=50)
    n_shots: int = Field(default=1024, ge=64, le=100_000)
    seed: Optional[int] = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def run_rb(req: RBRequest) -> Dict[str, Any]:
    """Run a Randomized Benchmarking experiment (simulated)."""
    from fastapi import HTTPException

    allowed_types = {"standard", "interleaved", "simultaneous"}
    rb_type = req.rb_type.lower()
    if rb_type not in allowed_types:
        raise HTTPException(422, f"rb_type must be one of {sorted(allowed_types)}")

    backend_key = req.backend.lower()
    profile = _BACKENDS.get(backend_key, _BACKENDS["ibm_nairobi"])
    p_base = profile["error_rate"]

    rng = random.Random(req.seed)

    A, B = 0.5, 0.5
    lengths = _log_space(1, req.max_length, req.n_lengths)

    # Standard RB decay
    probs_standard = [_survival_prob(m, p_base, A, B, rng, req.n_shots) for m in lengths]
    fit = _fit_rb_decay(lengths, probs_standard)
    fit_p = fit["p"]
    fit_A = fit["A"]
    fit_B = fit["B"]
    epc = round(fit_p / 2, 8)
    avg_gate_fidelity = round(1 - epc, 6)
    gate_fidelity_1q = round(1 - epc * 2 / 3, 6)  # depolarising correction

    fitted_probs = [round(fit_A * (1 - 2 * fit_p) ** m + fit_B, 5) for m in lengths]
    decay_curve = [
        {"length": m, "prob": sp, "fitted_prob": fp}
        for m, sp, fp in zip(lengths, probs_standard, fitted_probs)
    ]

    # Interleaved RB
    interleaved_gate = None
    interleaved_epc = None
    gate_specific_fidelity = None

    if rb_type == "interleaved" and req.gate:
        interleaved_gate = req.gate.lower()
        gate_extra = _GATE_EXTRA_ERROR.get(interleaved_gate, 0.003)
        p_interleaved = min(0.5, p_base + gate_extra)
        probs_interleaved = [_survival_prob(m, p_interleaved, A, B, rng, req.n_shots) for m in lengths]
        fit_i = _fit_rb_decay(lengths, probs_interleaved)
        p_i = fit_i["p"]
        interleaved_epc = round(p_i / 2, 8)
        # Gate fidelity = 1 - (p_interleaved - p_standard) / 2
        gate_specific_fidelity = round(1 - (p_i - fit_p) / 2, 6)

    # Simultaneous RB: run multiple qubits, slight cross-talk increase
    n_qubits_sim = 1
    if rb_type == "simultaneous":
        n_qubits_sim = min(3, profile.get("n_qubits", 7))
        crosstalk = 0.0002 * (n_qubits_sim - 1)
        p_sim = min(0.5, p_base + crosstalk)
        probs_standard = [_survival_prob(m, p_sim, A, B, rng, req.n_shots) for m in lengths]
        fit = _fit_rb_decay(lengths, probs_standard)
        fit_p = fit["p"]
        epc = round(fit_p / 2, 8)
        avg_gate_fidelity = round(1 - epc, 6)
        gate_fidelity_1q = round(1 - epc * 2 / 3, 6)
        fitted_probs = [round(fit["A"] * (1 - 2 * fit_p) ** m + fit["B"], 5) for m in lengths]
        decay_curve = [
            {"length": m, "prob": sp, "fitted_prob": fp}
            for m, sp, fp in zip(lengths, probs_standard, fitted_probs)
        ]

    grade = _quality_grade(epc)
    recommendations = []
    if epc > 0.01:
        recommendations.append("EPC > 1%: significant gate errors — check calibration and consider recalibrating.")
    if epc > 0.003:
        recommendations.append("EPC > 0.3%: above threshold for practical quantum advantage — optimize pulse shapes.")
    if avg_gate_fidelity > 0.999:
        recommendations.append("Excellent gate fidelity: suitable for fault-tolerant applications.")
    if rb_type == "interleaved" and gate_specific_fidelity is not None and gate_specific_fidelity < 0.99:
        recommendations.append(f"Gate '{interleaved_gate}' fidelity below 99% — prioritize for individual recalibration.")
    if not recommendations:
        recommendations.append("Gate performance is within acceptable range for NISQ applications.")

    return {
        "rb_id": f"rb-{uuid.uuid4().hex[:12]}",
        "backend": req.backend,
        "rb_type": rb_type,
        "qubit": req.qubit,
        "n_qubits": n_qubits_sim if rb_type == "simultaneous" else 1,
        "sequence_lengths": lengths,
        "survival_probabilities": probs_standard,
        "fit_A": round(fit_A, 5),
        "fit_B": round(fit_B, 5),
        "fit_p": round(fit_p, 7),
        "error_per_clifford": epc,
        "average_gate_fidelity": avg_gate_fidelity,
        "gate_fidelity_1q": gate_fidelity_1q,
        "interleaved_gate": interleaved_gate,
        "interleaved_epc": interleaved_epc,
        "gate_specific_fidelity": gate_specific_fidelity,
        "decay_curve": decay_curve,
        "quality_grade": grade,
        "recommendations": recommendations,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/backends")
def list_backends() -> List[Dict[str, Any]]:
    """Return available backends for RB simulation."""
    return [
        {
            "name": key,
            "error_rate": profile["error_rate"],
            "t1_us": profile["t1_us"],
            "t2_us": profile["t2_us"],
            "n_qubits": profile["n_qubits"],
            "expected_epc": round(profile["error_rate"] / 2, 6),
            "expected_avg_gate_fidelity": round(1 - profile["error_rate"] / 2, 6),
        }
        for key, profile in _BACKENDS.items()
    ]
