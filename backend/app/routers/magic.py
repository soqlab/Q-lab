"""Non-Stabilizerness (Magic) Tracker — Feature #8.

Quantifies the non-Clifford resource content of a circuit from its stored
fingerprint gate counts. Reports T-count, magic score, stabilizer rank bound,
classical simulation cost, and whether the circuit is in the quantum-advantage
regime.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["magic"])

# ---------------------------------------------------------------------------
# Gate classification sets
# ---------------------------------------------------------------------------

NON_CLIFFORD: frozenset[str] = frozenset({
    "t", "tdg", "rx", "ry", "rz",
    "u1", "u2", "u3", "p", "r",
    "ccx", "cccx",
})

CLIFFORD: frozenset[str] = frozenset({
    "h", "x", "y", "z", "s", "sdg",
    "cx", "cz", "cy", "swap",
    "sx", "sxdg", "ecr", "ch", "dcx",
})

# Cap for display only — actual exponentiation is unbounded
_RANK_DISPLAY_CAP = int(1e15)


# ---------------------------------------------------------------------------
# Interpretation helpers
# ---------------------------------------------------------------------------

def _t_count_interpretation(t_count: int) -> str:
    if t_count == 0:
        return "Clifford-only — classically simulable"
    if t_count <= 8:
        return "Low magic (T≤8) — extended stabilizer tractable"
    if t_count <= 50:
        return "Moderate magic — T-simulation feasible"
    return "High magic — exponential classical cost"


def _classical_simulation_cost(t_count: int) -> str:
    if t_count <= 8:
        return "polynomial"
    if t_count <= 50:
        return "sub-exponential (t-sim)"
    return "exponential"


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/runs/{run_id}/magic")
def magic_tracker(run_id: str, db: Session = Depends(get_db)):
    """Non-Clifford resource analysis for a stored run.

    Derives T-count, magic score, stabilizer rank bound, and classical
    simulation complexity from the run's fingerprint gate counts.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp: dict = run.fingerprint or {}
    gate_counts: dict[str, int] = fp.get("gate_counts", {})

    total_gates: int = sum(gate_counts.values()) or fp.get("size", 0) or 0
    t_count: int = gate_counts.get("t", 0) + gate_counts.get("tdg", 0)
    nc_count: int = sum(gate_counts.get(g, 0) for g in NON_CLIFFORD)

    clifford_fraction: float = (
        round((total_gates - nc_count) / total_gates, 4)
        if total_gates > 0
        else 1.0
    )
    magic_score: float = round(nc_count / max(total_gates, 1), 4)

    # Stabilizer rank bound: 2^(t // 2), display-capped
    raw_rank_bound = 2 ** (t_count // 2)
    stabilizer_rank_bound = min(raw_rank_bound, _RANK_DISPLAY_CAP)

    n_qubits: int = fp.get("num_qubits", fp.get("n_qubits", 0)) or 0
    backend: str | None = run.backend

    return {
        "run_id":                  run_id,
        "backend":                 backend,
        "n_qubits":                n_qubits,
        "total_gates":             total_gates,
        "t_count":                 t_count,
        "nc_count":                nc_count,
        "clifford_fraction":       clifford_fraction,
        "magic_score":             magic_score,
        "stabilizer_rank_bound":   stabilizer_rank_bound,
        "classical_simulation_cost": _classical_simulation_cost(t_count),
        "quantum_advantage_regime": t_count > 20 and magic_score > 0.1,
        "t_count_interpretation":  _t_count_interpretation(t_count),
    }
