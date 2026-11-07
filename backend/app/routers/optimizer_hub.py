"""Optimizer Hub — VQE optimizer comparison for quantum Hamiltonians."""
from __future__ import annotations
import math, random, time, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/optimizer-hub", tags=["optimizer_hub"])

LAYERS = 2          # hardware-efficient ansatz: Ry layer, CX chain, repeated; final Ry layer
MAX_QUBITS = 8
_PRESET_OF = {"ising": "ising_1d", "heisenberg": "heisenberg", "maxcut": "maxcut_ring"}
_OPTIMIZERS = ("cobyla", "spsa", "adam", "lbfgsb", "slsqp")


def _problem(ham: str, n: int):
    """(exact ground energy, energy function of the ansatz parameters)."""
    import numpy as np
    from qiskit.quantum_info import SparsePauliOp

    from .hamiltonian_studio import PRESETS
    from .vqe_landscape import _cx_chain_permutation

    terms = PRESETS[_PRESET_OF[ham]]["build"](n)
    H = SparsePauliOp([t.pauli_string for t in terms], coeffs=[t.coefficient for t in terms]).to_matrix()
    ground = float(np.linalg.eigvalsh(H)[0])
    perm = _cx_chain_permutation(n)

    def state(params):
        psi = np.zeros(1 << n, dtype=complex)
        psi[0] = 1.0
        for layer in range(LAYERS + 1):
            t = psi.reshape([2] * n)
            for q in range(n):
                th = params[layer * n + q]
                c, s_ = np.cos(th / 2), np.sin(th / 2)
                axis = n - 1 - q
                a0, a1 = np.take(t, 0, axis=axis), np.take(t, 1, axis=axis)
                t = np.stack([c * a0 - s_ * a1, s_ * a0 + c * a1], axis=axis)
            psi = t.reshape(-1)
            if layer < LAYERS:
                nxt = np.empty_like(psi)
                nxt[perm] = psi
                psi = nxt
        return psi

    def energy(params) -> float:
        psi = state(params)
        return float(np.real(np.vdot(psi, H @ psi)))

    return ground, energy


def _run_optimizer(name: str, energy, x0, max_iter: int, seed: int) -> Dict[str, Any]:
    """Runs one optimizer for real on the exact energy. Counts every energy evaluation."""
    import numpy as np
    from scipy.optimize import minimize

    evals = {"n": 0}

    def f(x) -> float:
        evals["n"] += 1
        return energy(x)

    def grad(x):  # parameter-shift rule: exact for Ry rotations
        g = np.zeros_like(x)
        for i in range(len(x)):
            e = np.zeros_like(x)
            e[i] = np.pi / 2
            g[i] = (f(x + e) - f(x - e)) / 2
        return g

    curve: List[Dict[str, Any]] = []
    t0 = time.perf_counter()
    x = np.array(x0, dtype=float)
    if name in ("cobyla", "lbfgsb", "slsqp"):
        method = {"cobyla": "COBYLA", "lbfgsb": "L-BFGS-B", "slsqp": "SLSQP"}[name]
        kwargs = {} if name == "cobyla" else {"jac": grad}

        def cb(xk, *_):
            curve.append({"iter": len(curve) + 1, "energy": round(energy(xk), 8)})

        res = minimize(f, x, method=method, callback=cb, options={"maxiter": max_iter}, **kwargs)
        x = res.x
    elif name == "adam":
        lr, b1, b2, eps = 0.1, 0.9, 0.999, 1e-8
        m = np.zeros_like(x)
        v = np.zeros_like(x)
        for it in range(1, max_iter + 1):
            g = grad(x)
            m = b1 * m + (1 - b1) * g
            v = b2 * v + (1 - b2) * g * g
            x = x - lr * (m / (1 - b1 ** it)) / (np.sqrt(v / (1 - b2 ** it)) + eps)
            curve.append({"iter": it, "energy": round(energy(x), 8)})
    else:  # spsa, standard gain sequences (Spall 1998)
        rng = np.random.default_rng(seed)
        a, c, A = 0.2, 0.1, max_iter * 0.1
        for it in range(1, max_iter + 1):
            ak, ck = a / (it + A) ** 0.602, c / it ** 0.101
            delta = rng.choice([-1.0, 1.0], size=len(x))
            ghat = (f(x + ck * delta) - f(x - ck * delta)) / (2 * ck) * delta
            x = x - ak * ghat
            curve.append({"iter": it, "energy": round(energy(x), 8)})
    return {"x": x, "final": energy(x), "curve": curve, "evals": evals["n"],
            "ms": round((time.perf_counter() - t0) * 1000, 2)}


# ─────────────────────────────────────────────────────────────────────────────
# Request model
# ─────────────────────────────────────────────────────────────────────────────

class OptimizerHubRequest(BaseModel):
    hamiltonian: str = Field(default="ising", description="ising | heisenberg | maxcut")
    n_qubits: int = Field(default=4, ge=2, le=MAX_QUBITS)
    max_iterations: int = Field(default=100, ge=5, le=500)
    optimizers: List[str] = Field(default=["cobyla", "spsa", "adam", "lbfgsb", "slsqp"])
    seed: Optional[int] = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def run_optimizer_hub(req: OptimizerHubRequest) -> Dict[str, Any]:
    """Runs each optimizer for real on the exact VQE energy of a model Hamiltonian.

    Ansatz: LAYERS repetitions of an Ry layer and a CX chain, then a final Ry layer. Energies are
    exact statevector expectation values; gradients (Adam, L-BFGS-B, SLSQP) use the parameter-shift
    rule. All optimizers start from the same seeded random point. The true minimum is the exact
    ground energy. Energies are in the units of the Hamiltonian's coefficients.
    """
    import numpy as np
    from fastapi import HTTPException

    ham = req.hamiltonian.lower()
    if ham not in _PRESET_OF:
        raise HTTPException(422, f"hamiltonian must be one of {sorted(_PRESET_OF)}")
    bad = [o for o in req.optimizers if o.lower() not in _OPTIMIZERS]
    if bad:
        raise HTTPException(422, f"Unknown optimizers: {bad}. Allowed: {sorted(_OPTIMIZERS)}")
    seed = 0 if req.seed is None else req.seed
    n = req.n_qubits
    true_min, energy = _problem(ham, n)
    x0 = np.random.default_rng(seed).uniform(-np.pi, np.pi, size=n * (LAYERS + 1))
    e0 = energy(x0)

    results: List[Dict[str, Any]] = []
    for name in (o.lower() for o in req.optimizers):
        r = _run_optimizer(name, energy, x0, req.max_iterations, seed)
        gap = r["final"] - true_min
        results.append({
            "optimizer": name,
            "final_energy": round(r["final"], 8),
            "n_iterations": len(r["curve"]),
            "n_function_evals": r["evals"],
            "convergence_curve": r["curve"],
            "converged": gap < 1e-2,  # within 0.01 of the exact ground energy
            "time_ms": r["ms"],
            "final_params": [round(float(v), 6) for v in r["x"]],
            "energy_gap_from_true_min": round(gap, 8),
            "improvement_pct": round((e0 - r["final"]) / max(abs(e0 - true_min), 1e-12) * 100, 2),
        })

    best = min(results, key=lambda r: r["final_energy"])
    return {
        "hub_id": f"hub-{uuid.uuid4().hex[:12]}",
        "hamiltonian": ham,
        "n_qubits": n,
        "true_minimum": round(true_min, 8),
        "initial_energy": round(e0, 8),
        "results": results,
        "best_optimizer": best["optimizer"],
        "best_energy": best["final_energy"],
        "winner_summary": (
            f"{best['optimizer'].upper()} reached {best['final_energy']:.4f} in {best['n_iterations']} iterations "
            f"({best['n_function_evals']} energy evaluations); exact ground energy {true_min:.4f}."
        ),
        "method": ("Exact statevector VQE; hardware-efficient Ry/CX ansatz; scipy COBYLA, L-BFGS-B, SLSQP; "
                   "numpy Adam and SPSA; parameter-shift gradients."),
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
            "noise_robustness": "good",
            "description": "Derivative-free simplex method. Robust to shot noise. Good for NISQ.",
        },
        {
            "name": "spsa",
            "full_name": "Simultaneous Perturbation Stochastic Approximation",
            "type": "gradient-free (stochastic)",
            "noise_robustness": "excellent",
            "description": "Uses random finite differences. Best suited for very noisy circuits.",
        },
        {
            "name": "adam",
            "full_name": "Adaptive Moment Estimation",
            "type": "gradient-based",
            "noise_robustness": "moderate",
            "description": "Adaptive learning-rate gradient descent. Fast convergence in early iterations.",
        },
        {
            "name": "lbfgsb",
            "full_name": "Limited-memory Broyden–Fletcher–Goldfarb–Shanno (Bounded)",
            "type": "quasi-Newton",
            "noise_robustness": "low",
            "description": "Quasi-Newton method. Very fast convergence but sensitive to shot noise.",
        },
        {
            "name": "slsqp",
            "full_name": "Sequential Least SQuares Programming",
            "type": "gradient-based (constrained)",
            "noise_robustness": "low",
            "description": "Constrained gradient method. Suitable when parameter bounds are required.",
        },
    ]
