"""Quantum Speedup Certifier — estimates and certifies quantum vs classical complexity."""
from __future__ import annotations
import math, random, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/speedup-certifier", tags=["speedup_certifier"])

# ---------------------------------------------------------------------------
# Problem definitions with complexity models
# ---------------------------------------------------------------------------

PROBLEMS: Dict[str, Dict] = {
    "sampling": {
        "name": "Random Circuit Sampling",
        "quantum_class": "BQP",
        "classical_class": "Conjectured exponential",
        "description": "Sample from the output distribution of a random quantum circuit (Google/RCS-style).",
        "reference": "Arute et al., Nature 574 (2019)",
        "known_advantage": True,
        "caveats": [
            "Spoofing attacks (linear XEB) may underestimate classical hardness.",
            "Requires verification of genuine quantum advantage.",
            "Noise can reduce effective circuit fidelity below threshold.",
        ],
    },
    "search": {
        "name": "Unstructured Search (Grover)",
        "quantum_class": "BQP",
        "classical_class": "Classical O(N)",
        "description": "Search an unordered database of N=2^n items for a marked element.",
        "reference": "Grover, STOC 1996",
        "known_advantage": True,
        "caveats": [
            "Quadratic speedup only, not exponential.",
            "Requires oracle access — oracle implementation overhead often negates speedup.",
            "Best classical algorithm is already O(N); Grover achieves O(sqrt(N)).",
        ],
    },
    "factoring": {
        "name": "Integer Factoring (Shor)",
        "quantum_class": "BQP",
        "classical_class": "Sub-exponential (GNFS)",
        "description": "Factor an n-bit integer using quantum period finding.",
        "reference": "Shor, FOCS 1994",
        "known_advantage": True,
        "caveats": [
            "Requires fault-tolerant qubits; current hardware cannot factor RSA-2048.",
            "GNFS classical algorithm is sub-exponential, narrowing practical gap.",
            "Modular exponentiation circuit requires ~n^3 gates total.",
        ],
    },
    "simulation": {
        "name": "Quantum System Simulation",
        "quantum_class": "BQP",
        "classical_class": "Exponential",
        "description": "Simulate time evolution of a quantum many-body Hamiltonian.",
        "reference": "Feynman, Int. J. Theor. Phys. 21, 467 (1982)",
        "known_advantage": True,
        "caveats": [
            "Speedup depends heavily on the specific Hamiltonian structure.",
            "Tensor network methods can simulate certain quantum states classically.",
            "Gate decomposition of Hamiltonian evolution introduces Trotter errors.",
        ],
    },
    "optimization": {
        "name": "Combinatorial Optimization (QAOA)",
        "quantum_class": "BQP / heuristic",
        "classical_class": "NP-hard (worst case)",
        "description": "Approximate optimization using the Quantum Approximate Optimization Algorithm.",
        "reference": "Farhi, Goldstone & Gutmann, arXiv:1411.4028 (2014)",
        "known_advantage": False,
        "caveats": [
            "No proven quantum advantage over classical heuristics (simulated annealing, GUROBI).",
            "QAOA at shallow depth may be simulable classically.",
            "Best performance often requires deep circuits beyond near-term capability.",
        ],
    },
    "linear_systems": {
        "name": "Linear Systems (HHL)",
        "quantum_class": "BQP",
        "classical_class": "Polynomial (classical solvers)",
        "description": "Solve Ax=b using the Harrow-Hassidim-Lloyd quantum algorithm.",
        "reference": "Harrow, Hassidim & Lloyd, PRL 103, 150502 (2009)",
        "known_advantage": False,
        "caveats": [
            "Exponential speedup assumes sparse, well-conditioned A and quantum-accessible b.",
            "Reading out the full solution x destroys the quantum speedup.",
            "Classical sparse solvers are highly optimized and competitive for structured problems.",
        ],
    },
}


def _quantum_complexity(problem: str, n: int, depth: int, shots: int) -> Dict[str, Any]:
    """Estimate quantum gate count and wall-clock time."""
    if problem == "sampling":
        gates = n * depth
        time_ms = shots * depth * 0.001  # ~1 ns per gate layer
    elif problem == "search":
        oracle_cost = n  # O(n) gates for oracle
        iterations = max(1, int(math.pi / 4 * math.sqrt(2 ** n)))
        gates = iterations * 2 * oracle_cost
        time_ms = shots * gates * 0.001
    elif problem == "factoring":
        gates = n ** 3 * int(math.log2(max(n, 2)))  # Shor: O(n^3 log n)
        time_ms = shots * gates * 0.001
    elif problem == "simulation":
        trotter_steps = depth
        gates = n * trotter_steps  # O(n * t) for local Hamiltonians
        time_ms = shots * gates * 0.001
    elif problem == "optimization":
        layers = depth  # QAOA depth = p
        gates = layers * 2 * n  # 2n gates per layer (mixer + cost)
        time_ms = shots * gates * 0.001
    elif problem == "linear_systems":
        gates = n ** 2 * depth  # HHL: O(n^2 * kappa^2 / epsilon)
        time_ms = shots * gates * 0.001
    else:
        gates = n * depth
        time_ms = shots * gates * 0.001

    return {"gate_count": int(gates), "time_ms": round(max(time_ms, 0.001), 6)}


def _classical_complexity(problem: str, n: int, depth: int, shots: int, algorithm: str) -> Dict[str, Any]:
    """Estimate classical operations and wall-clock time."""
    # Classical CPU: ~10^9 ops/sec
    cpu_ops_per_sec = 1e9

    if problem == "sampling":
        # Simulate 2^n amplitudes, depth layers: O(2^n * depth)
        ops = (2 ** n) * depth * shots
        class_ops = f"2^{n} × depth × shots"
    elif problem == "search":
        # Linear scan: O(N/2) on average
        ops = (2 ** n / 2) * shots
        class_ops = f"2^{n}/2 (linear scan)"
    elif problem == "factoring":
        # GNFS: exp((64/9 * n)^(1/3) * (log n)^(2/3))
        exponent = (64.0 / 9.0 * n) ** (1.0 / 3.0) * (math.log(max(n, 2))) ** (2.0 / 3.0)
        ops = math.exp(min(exponent, 300))  # cap to avoid overflow
        class_ops = f"exp((64n/9)^(1/3) (ln n)^(2/3)) — GNFS"
    elif problem == "simulation":
        # Exact diagonalization: O(2^n * n * t)
        ops = (2 ** n) * n * depth
        class_ops = f"2^{n} × n × t_steps"
    elif problem == "optimization":
        # Branch and bound / QUBO: O(2^n) worst case, heuristics ≈ poly
        ops = 2 ** (n // 2) * depth * shots  # better than brute force
        class_ops = f"2^(n/2) × depth (heuristic)"
    elif problem == "linear_systems":
        # Conjugate gradient: O(n * kappa * log(1/epsilon)) for sparse A
        ops = n * math.log2(max(n, 2)) * 10 * shots
        class_ops = f"n × log(n) × 10 — sparse CG"
    else:
        ops = (2 ** n) * depth * shots
        class_ops = f"2^{n} × depth"

    time_ms = round(ops / cpu_ops_per_sec * 1000.0, 6)
    return {"ops": ops, "time_ms": max(time_ms, 1e-6), "formula": class_ops}


def _crossover_n(problem: str, depth: int) -> int:
    """Estimate n where quantum first beats classical."""
    crossovers = {
        "sampling": 50,
        "search": 30,   # Grover only quadratic
        "factoring": 4096,  # needs fault-tolerant hardware
        "simulation": 40,
        "optimization": 100,  # unknown / contested
        "linear_systems": 200,  # very contested
    }
    return crossovers.get(problem, 50)


class SpeedupRequest(BaseModel):
    problem: str = Field(default="sampling")
    n_qubits: int = Field(default=20, ge=2, le=100)
    circuit_depth: int = Field(default=20, ge=1, le=1000)
    n_shots: int = Field(default=1000, ge=1, le=100000)
    classical_algorithm: str = Field(default="best_known")
    seed: Optional[int] = None


@router.post("")
def certify_speedup(req: SpeedupRequest):
    problem_key = req.problem if req.problem in PROBLEMS else "sampling"
    prob = PROBLEMS[problem_key]

    q = _quantum_complexity(problem_key, req.n_qubits, req.circuit_depth, req.n_shots)
    c = _classical_complexity(problem_key, req.n_qubits, req.circuit_depth, req.n_shots, req.classical_algorithm)

    speedup_ratio = round(c["time_ms"] / max(q["time_ms"], 1e-9), 4)
    speedup_log2 = round(math.log2(max(speedup_ratio, 1.0)), 4)

    # Certification criteria
    certified = (
        prob["known_advantage"]
        and speedup_ratio > 100
        and req.n_qubits >= _crossover_n(problem_key, req.circuit_depth)
    )
    confidence = 0.95 if (certified and prob["known_advantage"]) else (0.5 if prob["known_advantage"] else 0.2)

    crossover = _crossover_n(problem_key, req.circuit_depth)

    return {
        "cert_id": f"spd-{uuid.uuid4().hex[:12]}",
        "problem_type": problem_key,
        "n_qubits": req.n_qubits,
        "circuit_depth": req.circuit_depth,
        "quantum_complexity_class": prob["quantum_class"],
        "classical_complexity_class": prob["classical_class"],
        "quantum_gate_count": q["gate_count"],
        "quantum_time_estimate_ms": q["time_ms"],
        "classical_operations": c["ops"],
        "classical_time_estimate_ms": c["time_ms"],
        "classical_formula": c["formula"],
        "speedup_ratio": speedup_ratio,
        "speedup_log2": speedup_log2,
        "advantage_certified": certified,
        "confidence_level": confidence,
        "crossover_n_qubits": crossover,
        "current_best_classical_algorithm": req.classical_algorithm,
        "caveats": prob["caveats"],
        "reference": prob.get("reference", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/problems")
def list_problems():
    return [
        {
            "problem_id": k,
            "name": v["name"],
            "quantum_complexity_class": v["quantum_class"],
            "classical_complexity_class": v["classical_class"],
            "known_advantage": v["known_advantage"],
            "description": v["description"],
            "reference": v.get("reference", ""),
        }
        for k, v in PROBLEMS.items()
    ]
