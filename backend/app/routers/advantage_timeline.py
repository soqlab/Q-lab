"""Quantum Advantage Timeline — project when quantum computers will outperform classical
for specific algorithms, given hardware improvement rates.

Hardware baseline (2025):
  - Best quantum volume: ~1000  → ~10 logical qubits equivalent
  - Physical qubit count: ~1000 (with error correction overhead ~100:1)
  - 2Q gate error rate: ~0.1%
  - Logical qubit count: ~10-50 (surface code, distance ~7)

Roadmap model:
  - Logical qubit count doubles every 18 months
  - Error rate halves every 24 months
"""
from __future__ import annotations
import math, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/advantage-timeline", tags=["advantage_timeline"])

BASELINE_YEAR        = 2025
BASELINE_LOGICAL     = 50          # logical qubits with QEC
BASELINE_PHYSICAL    = 1000        # physical qubits
BASELINE_ERROR_RATE  = 0.001       # 0.1 % two-qubit gate error
LOGICAL_DOUBLING_MO  = 18          # months to double logical qubit count
ERROR_HALVING_MO     = 24          # months to halve error rate
QEC_OVERHEAD         = 1000        # physical per logical (surface code d~31 target)

ALGORITHMS: Dict[str, Dict[str, Any]] = {
    "factoring": {
        "display_name": "Integer Factoring (Shor's Algorithm)",
        "complexity_quantum": "O(n³ log n log log n)",
        "complexity_classical": "O(exp(n^(1/3) log^(2/3) n))  — GNFS",
        "description": "Factor n-bit integers. Classical best: GNFS. Quantum: Shor runs in polynomial time.",
        "qubits_formula": "2n + 3 logical qubits for n-bit number",
        "t_gates_per_qubit": 40,
        "classical_hardness_base_years": 1e4,      # 2048-bit RSA classical estimate
        "classical_hardness_scaling": 3.0,          # exponent scaling with size
    },
    "search": {
        "display_name": "Unstructured Search (Grover's Algorithm)",
        "complexity_quantum": "O(√N)",
        "complexity_classical": "O(N)",
        "description": "Search N-item database. Grover gives quadratic speedup.",
        "qubits_formula": "log₂(N) logical qubits",
        "t_gates_per_qubit": 2,
        "classical_hardness_base_years": 1e6,
        "classical_hardness_scaling": 1.0,
    },
    "simulation": {
        "display_name": "Hamiltonian Simulation",
        "complexity_quantum": "O(n poly(log n))",
        "complexity_classical": "O(exp(n))",
        "description": "Simulate n-qubit quantum system. Exponential classical cost, polynomial quantum cost.",
        "qubits_formula": "n logical qubits (direct encoding)",
        "t_gates_per_qubit": 100,
        "classical_hardness_base_years": 1e2,
        "classical_hardness_scaling": 0.3,
    },
    "optimization": {
        "display_name": "Combinatorial Optimization (QAOA)",
        "complexity_quantum": "O(n · p) with p layers",
        "complexity_classical": "O(exp(n)) for exact, heuristics may be competitive",
        "description": "Approximate solutions to NP-hard combinatorial problems via QAOA.",
        "qubits_formula": "n logical qubits for n-variable problem",
        "t_gates_per_qubit": 20,
        "classical_hardness_base_years": 1e3,
        "classical_hardness_scaling": 0.5,
    },
    "ml": {
        "display_name": "Quantum Machine Learning (QML)",
        "complexity_quantum": "O(poly(log N)) for some kernels",
        "complexity_classical": "O(N·d) — linear in dataset size",
        "description": "Quantum kernel methods and quantum neural networks. Advantage contested.",
        "qubits_formula": "O(log N) logical qubits",
        "t_gates_per_qubit": 15,
        "classical_hardness_base_years": 1e5,
        "classical_hardness_scaling": 0.5,
    },
    "chemistry": {
        "display_name": "Quantum Chemistry (VQE / QPE)",
        "complexity_quantum": "O(n^4 to n^5) with QPE",
        "complexity_classical": "O(exp(n)) for FCI; CCSD(T) O(n^7) approximate",
        "description": "Compute ground state energies of molecular systems. Key application for drug discovery.",
        "qubits_formula": "2×(number of orbitals) logical qubits",
        "t_gates_per_qubit": 200,
        "classical_hardness_base_years": 1e1,
        "classical_hardness_scaling": 0.4,
    },
    "sampling": {
        "display_name": "Random Circuit Sampling (Quantum Supremacy)",
        "complexity_quantum": "O(n × depth) on hardware",
        "complexity_classical": "O(exp(n)) for exact simulation",
        "description": "Sample from the output distribution of random quantum circuits. Already demonstrated at 53 qubits.",
        "qubits_formula": "n physical qubits (no QEC needed at small scales)",
        "t_gates_per_qubit": 1,
        "classical_hardness_base_years": 1e4,
        "classical_hardness_scaling": 0.3,
    },
    "linear_systems": {
        "display_name": "Linear Systems Solver (HHL Algorithm)",
        "complexity_quantum": "O(log(N) × κ² / ε)",
        "complexity_classical": "O(N × κ) for conjugate gradient",
        "description": "Solve Ax=b for sparse matrices. Exponential speedup in matrix dimension, but with caveats.",
        "qubits_formula": "O(log N) logical qubits",
        "t_gates_per_qubit": 50,
        "classical_hardness_base_years": 1e8,
        "classical_hardness_scaling": 2.0,
    },
}


def _logical_qubits_at(year: float) -> int:
    months_elapsed = (year - BASELINE_YEAR) * 12
    doublings = months_elapsed / LOGICAL_DOUBLING_MO
    return int(BASELINE_LOGICAL * (2 ** doublings))


def _error_rate_at(year: float) -> float:
    months_elapsed = (year - BASELINE_YEAR) * 12
    halvings = months_elapsed / ERROR_HALVING_MO
    return BASELINE_ERROR_RATE / (2 ** halvings)


def _qubits_needed(algo_key: str, problem_size: int) -> int:
    algo = ALGORITHMS[algo_key]
    key = algo_key
    if key == "factoring":
        n_bits = int(math.log2(max(problem_size, 2)) + 1)
        return 2 * n_bits + 3
    elif key == "search":
        return max(1, int(math.log2(max(problem_size, 2))) + 1)
    elif key == "simulation":
        return max(problem_size, 1)
    elif key == "optimization":
        return max(problem_size, 1)
    elif key == "ml":
        return max(1, int(math.log2(max(problem_size, 2))) + 1)
    elif key == "chemistry":
        return max(2 * problem_size, 4)
    elif key == "sampling":
        return max(problem_size, 1)
    elif key == "linear_systems":
        return max(1, int(math.log2(max(problem_size, 2))) + 1)
    return problem_size


def _t_gates_needed(algo_key: str, logical_qubits: int) -> int:
    tpq = ALGORITHMS[algo_key]["t_gates_per_qubit"]
    return logical_qubits * logical_qubits * tpq


def _classical_time_years(algo_key: str, problem_size: int) -> float:
    algo = ALGORITHMS[algo_key]
    base = algo["classical_hardness_base_years"]
    scale = algo["classical_hardness_scaling"]
    return base * (problem_size ** scale) / 1000.0


def _quantum_time_seconds(logical_qubits: int, t_gates: int, error_rate: float) -> float:
    # Gate time ~100 ns for superconducting at advantage year
    gate_time_s = 100e-9
    # Add QEC overhead: ~d rounds per logical gate, d~sqrt(log(1/error)/error_rate)
    d = max(3, int(math.sqrt(abs(math.log(error_rate + 1e-10) / (error_rate + 1e-10)))))
    return t_gates * gate_time_s * d


def _year_hardware_ready(logical_needed: int, error_needed: float = 1e-4) -> float:
    """Binary search for the year when hardware meets requirements."""
    for y_tenth in range(0, 200):
        year = BASELINE_YEAR + y_tenth * 0.5
        if _logical_qubits_at(year) >= logical_needed and _error_rate_at(year) <= error_needed:
            return year
    return BASELINE_YEAR + 100.0


class TimelineRequest(BaseModel):
    algorithm: str = Field(default="factoring")
    problem_size: int = Field(default=1000, ge=1, le=100000)
    hardware_improvement_rate: float = Field(default=0.5, ge=0.1, le=2.0,
        description="Multiplier on default improvement rates (1.0 = standard, 2.0 = optimistic)")
    include_scenarios: bool = Field(default=True)


@router.post("")
def compute_timeline(req: TimelineRequest):
    algo_key = req.algorithm if req.algorithm in ALGORITHMS else "factoring"
    algo = ALGORITHMS[algo_key]

    # Scale improvement rates
    eff_log_doubling = LOGICAL_DOUBLING_MO / req.hardware_improvement_rate
    eff_err_halving  = ERROR_HALVING_MO  / req.hardware_improvement_rate

    logical_needed  = _qubits_needed(algo_key, req.problem_size)
    physical_needed = logical_needed * QEC_OVERHEAD
    t_gates         = _t_gates_needed(algo_key, logical_needed)

    # Year when hardware is ready (most likely = default rates)
    def year_ready_custom(rate_mult: float) -> float:
        for y_tenth in range(0, 300):
            year = BASELINE_YEAR + y_tenth * 0.5
            months = (year - BASELINE_YEAR) * 12
            lq = int(BASELINE_LOGICAL * (2 ** (months / (LOGICAL_DOUBLING_MO / rate_mult))))
            er = BASELINE_ERROR_RATE / (2 ** (months / (ERROR_HALVING_MO / rate_mult)))
            if lq >= logical_needed and er <= 1e-4:
                return round(year, 1)
        return BASELINE_YEAR + 150.0

    most_likely_year = year_ready_custom(req.hardware_improvement_rate)
    optimistic_year  = year_ready_custom(req.hardware_improvement_rate * 2.0)
    pessimistic_year = year_ready_custom(req.hardware_improvement_rate * 0.5)

    classical_time_years = _classical_time_years(algo_key, req.problem_size)

    # Error rate and quantum time at advantage year
    adv_error = max(1e-6, BASELINE_ERROR_RATE / (2 ** ((most_likely_year - BASELINE_YEAR) * 12 / eff_err_halving)))
    qt_seconds = _quantum_time_seconds(logical_needed, t_gates, adv_error)

    speedup = (classical_time_years * 365.25 * 86400) / max(qt_seconds, 1e-9)

    # Roadmap: every 3 years from 2025 to 2055
    roadmap = []
    for yr in range(BASELINE_YEAR, BASELINE_YEAR + 31, 3):
        months = (yr - BASELINE_YEAR) * 12
        lq = int(BASELINE_LOGICAL * (2 ** (months / (LOGICAL_DOUBLING_MO / req.hardware_improvement_rate))))
        er = BASELINE_ERROR_RATE / (2 ** (months / (ERROR_HALVING_MO / req.hardware_improvement_rate)))
        can_run = lq >= logical_needed and er <= 1e-4
        roadmap.append({
            "year": yr,
            "logical_qubits": lq,
            "error_rate": round(er, 8),
            "can_run": can_run,
        })

    years_to_advantage = round(most_likely_year - BASELINE_YEAR, 1)

    # Scenarios
    scenarios = []
    if req.include_scenarios:
        scenarios = [
            {
                "name": "Optimistic (2× faster progress)",
                "assumption": "Error rates halve every 12 months, qubit count doubles every 9 months",
                "year": optimistic_year,
            },
            {
                "name": "Most Likely (current trajectory)",
                "assumption": f"Error rates halve every {int(eff_err_halving)} months, logical qubits double every {int(eff_log_doubling)} months",
                "year": most_likely_year,
            },
            {
                "name": "Pessimistic (0.5× slower progress)",
                "assumption": "Technical plateaus slow hardware scaling significantly",
                "year": pessimistic_year,
            },
            {
                "name": "Engineering-Only (no new algorithms)",
                "assumption": "Same algorithm, brute-force hardware improvements only",
                "year": round(most_likely_year + 5, 1),
            },
        ]

    # Recommendation
    if most_likely_year <= BASELINE_YEAR + 5:
        rec = f"Quantum advantage for {algo['display_name']} is imminent (~{int(most_likely_year)}). Begin migration planning now."
    elif most_likely_year <= BASELINE_YEAR + 15:
        rec = f"Quantum advantage expected around {int(most_likely_year)}. Start algorithm prototyping on NISQ devices."
    else:
        rec = f"Advantage for this problem size is long-term ({int(most_likely_year)}). Focus on reducing problem size or wait for hardware maturation."

    return {
        "timeline_id": str(uuid.uuid4()),
        "algorithm": algo_key,
        "algorithm_display_name": algo["display_name"],
        "problem_size": req.problem_size,
        "qubits_needed_logical": logical_needed,
        "physical_qubits_needed": physical_needed,
        "t_gates_needed": t_gates,
        "current_logical_qubits": BASELINE_LOGICAL,
        "current_error_rate": BASELINE_ERROR_RATE,
        "years_to_advantage": years_to_advantage,
        "year_of_advantage": most_likely_year,
        "hardware_roadmap": roadmap,
        "optimistic_year": optimistic_year,
        "pessimistic_year": pessimistic_year,
        "most_likely_year": most_likely_year,
        "classical_time_years": round(classical_time_years, 4),
        "quantum_time_seconds": round(qt_seconds, 6),
        "speedup_at_advantage": round(speedup, 2),
        "scenarios": scenarios,
        "recommendation": rec,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/algorithms")
def list_algorithms():
    return {
        "algorithms": [
            {
                "key": k,
                "display_name": v["display_name"],
                "complexity_quantum": v["complexity_quantum"],
                "complexity_classical": v["complexity_classical"],
                "description": v["description"],
                "qubits_formula": v["qubits_formula"],
            }
            for k, v in ALGORITHMS.items()
        ]
    }
