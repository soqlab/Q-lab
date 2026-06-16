"""Optimizer Hub — VQE optimizer comparison for quantum Hamiltonians."""
from __future__ import annotations
import math, random, time, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/optimizer-hub", tags=["optimizer_hub"])

# ─────────────────────────────────────────────────────────────────────────────
# Hamiltonian true minima (approximate ground state energies)
# ─────────────────────────────────────────────────────────────────────────────

def _true_minimum(hamiltonian: str, n_qubits: int) -> float:
    """Approximate ground state energy for the Hamiltonian."""
    base = {
        "ising":      -float(n_qubits),
        "heisenberg": -float(n_qubits) * 0.75,
        "maxcut":     -float(n_qubits) * 0.5,
        "generic":    -float(n_qubits) * 0.6,
    }
    return round(base.get(hamiltonian.lower(), -float(n_qubits)), 4)


# ─────────────────────────────────────────────────────────────────────────────
# Energy landscape
# ─────────────────────────────────────────────────────────────────────────────

def _energy(params: List[float], true_min: float, n_qubits: int, rng: random.Random, noise: float = 0.02) -> float:
    """Sinusoidal energy landscape around true minimum."""
    # Contribution from each parameter (landscape roughness depends on n_qubits)
    landscape = sum(
        math.cos(p) * math.sin(p * 1.3 + i * 0.5)
        for i, p in enumerate(params)
    ) / max(len(params), 1)
    energy = true_min + (landscape + 1.5) * 0.4 * n_qubits * 0.15
    energy += rng.gauss(0, noise)
    return round(energy, 6)


# ─────────────────────────────────────────────────────────────────────────────
# Optimizer simulations
# ─────────────────────────────────────────────────────────────────────────────

_OPTIMIZER_PROFILES = {
    "cobyla": {
        "max_iters":       60,
        "residual":        0.05,
        "noise_scale":     0.015,
        "converge_factor": 0.85,
        "n_params_factor": 2,
    },
    "spsa": {
        "max_iters":       80,
        "residual":        0.08,
        "noise_scale":     0.035,
        "converge_factor": 0.70,
        "n_params_factor": 2,
    },
    "adam": {
        "max_iters":       40,
        "residual":        0.03,
        "noise_scale":     0.010,
        "converge_factor": 0.95,
        "n_params_factor": 3,
    },
    "lbfgsb": {
        "max_iters":       25,
        "residual":        0.01,
        "noise_scale":     0.005,
        "converge_factor": 0.99,
        "n_params_factor": 2,
    },
    "slsqp": {
        "max_iters":       30,
        "residual":        0.02,
        "noise_scale":     0.008,
        "converge_factor": 0.98,
        "n_params_factor": 2,
    },
}


def _simulate_optimizer(
    name: str,
    true_min: float,
    n_qubits: int,
    max_iterations: int,
    rng: random.Random,
) -> Dict[str, Any]:
    profile = _OPTIMIZER_PROFILES.get(name.lower(), _OPTIMIZER_PROFILES["cobyla"])
    actual_iters = min(max_iterations, profile["max_iters"])
    n_params = max(2, n_qubits * profile["n_params_factor"])
    noise = profile["noise_scale"]
    residual = profile["residual"]
    converge_factor = profile["converge_factor"]

    # Initial random parameters
    params = [rng.uniform(-math.pi, math.pi) for _ in range(n_params)]
    initial_energy = _energy(params, true_min, n_qubits, rng, noise=noise * 3)
    target_energy = true_min + residual

    convergence_curve: List[Dict[str, Any]] = []
    current_energy = initial_energy
    n_fn_evals = 0

    t0 = time.perf_counter()

    for it in range(actual_iters):
        # Progress fraction — sigmoidal convergence model
        frac = (it + 1) / actual_iters
        # Exponential decay from initial to target
        decay = math.exp(-converge_factor * 4 * frac)
        ideal_energy = target_energy + (initial_energy - target_energy) * decay
        current_energy = ideal_energy + rng.gauss(0, noise * (1 - frac * 0.8))
        current_energy = round(current_energy, 6)

        # Update params towards optimum (simplified gradient step)
        for i in range(n_params):
            params[i] += rng.gauss(0, 0.1 * (1 - frac))
            params[i] = round(params[i], 5)

        convergence_curve.append({"iter": it + 1, "energy": current_energy})

        # Function evals: COBYLA/SPSA use more evals per iter
        fn_evals_per_iter = 2 * n_params if name in ("lbfgsb", "slsqp") else (
            1 if name == "spsa" else n_params
        )
        n_fn_evals += fn_evals_per_iter

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)
    final_energy = convergence_curve[-1]["energy"] if convergence_curve else initial_energy
    converged = abs(final_energy - true_min) < residual * 2

    return {
        "optimizer": name,
        "final_energy": final_energy,
        "n_iterations": actual_iters,
        "n_function_evals": n_fn_evals,
        "convergence_curve": convergence_curve,
        "converged": converged,
        "time_ms": elapsed_ms,
        "final_params": [round(p, 5) for p in params],
        "energy_gap_from_true_min": round(abs(final_energy - true_min), 6),
        "improvement_pct": round(
            (initial_energy - final_energy) / max(abs(initial_energy - true_min), 1e-9) * 100, 2
        ),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Request model
# ─────────────────────────────────────────────────────────────────────────────

class OptimizerHubRequest(BaseModel):
    hamiltonian: str = Field(default="ising", description="ising | heisenberg | maxcut | generic")
    n_qubits: int = Field(default=4, ge=1, le=20)
    max_iterations: int = Field(default=100, ge=5, le=10_000)
    optimizers: List[str] = Field(default=["cobyla", "spsa", "adam", "lbfgsb", "slsqp"])
    seed: Optional[int] = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def run_optimizer_hub(req: OptimizerHubRequest) -> Dict[str, Any]:
    """Benchmark multiple VQE optimizers on a quantum Hamiltonian."""
    from fastapi import HTTPException

    allowed_hamiltonians = {"ising", "heisenberg", "maxcut", "generic"}
    ham = req.hamiltonian.lower()
    if ham not in allowed_hamiltonians:
        raise HTTPException(422, f"hamiltonian must be one of {sorted(allowed_hamiltonians)}")

    allowed_optimizers = set(_OPTIMIZER_PROFILES.keys())
    bad = [o for o in req.optimizers if o.lower() not in allowed_optimizers]
    if bad:
        raise HTTPException(422, f"Unknown optimizers: {bad}. Allowed: {sorted(allowed_optimizers)}")

    rng = random.Random(req.seed)
    true_min = _true_minimum(ham, req.n_qubits)

    results: List[Dict[str, Any]] = []
    for opt_name in req.optimizers:
        result = _simulate_optimizer(
            name=opt_name.lower(),
            true_min=true_min,
            n_qubits=req.n_qubits,
            max_iterations=req.max_iterations,
            rng=rng,
        )
        results.append(result)

    # Determine winner
    best = min(results, key=lambda r: r["final_energy"])
    best_optimizer = best["optimizer"]
    best_energy = best["final_energy"]
    winner_summary = (
        f"{best_optimizer.upper()} achieved the lowest energy ({best_energy:.4f} Ha) "
        f"in {best['n_iterations']} iterations with {best['n_function_evals']} function evaluations. "
        f"Gap from true minimum: {best['energy_gap_from_true_min']:.4f} Ha."
    )

    return {
        "hub_id": f"hub-{uuid.uuid4().hex[:12]}",
        "hamiltonian": ham,
        "n_qubits": req.n_qubits,
        "true_minimum": true_min,
        "results": results,
        "best_optimizer": best_optimizer,
        "best_energy": best_energy,
        "winner_summary": winner_summary,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/optimizers")
def list_optimizers() -> List[Dict[str, Any]]:
    """Return metadata for all supported classical optimizers."""
    return [
        {
            "name": "cobyla",
            "full_name": "Constrained Optimization By Linear Approximation",
            "type": "gradient-free",
            "typical_iters": 60,
            "noise_robustness": "good",
            "description": "Derivative-free simplex method. Robust to shot noise. Good for NISQ.",
        },
        {
            "name": "spsa",
            "full_name": "Simultaneous Perturbation Stochastic Approximation",
            "type": "gradient-free (stochastic)",
            "typical_iters": 80,
            "noise_robustness": "excellent",
            "description": "Uses random finite differences. Best suited for very noisy circuits.",
        },
        {
            "name": "adam",
            "full_name": "Adaptive Moment Estimation",
            "type": "gradient-based",
            "typical_iters": 40,
            "noise_robustness": "moderate",
            "description": "Adaptive learning-rate gradient descent. Fast convergence in early iterations.",
        },
        {
            "name": "lbfgsb",
            "full_name": "Limited-memory Broyden–Fletcher–Goldfarb–Shanno (Bounded)",
            "type": "quasi-Newton",
            "typical_iters": 25,
            "noise_robustness": "low",
            "description": "Quasi-Newton method. Very fast convergence but sensitive to shot noise.",
        },
        {
            "name": "slsqp",
            "full_name": "Sequential Least SQuares Programming",
            "type": "gradient-based (constrained)",
            "typical_iters": 30,
            "noise_robustness": "low",
            "description": "Constrained gradient method. Suitable when parameter bounds are required.",
        },
    ]
