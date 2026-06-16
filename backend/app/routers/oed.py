"""Optimal Experiment Design — compute Fisher information and Cramér-Rao bounds for quantum experiments."""

from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/oed", tags=["oed"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_DESIGNS = "oed_designs"
NS_SIMULATIONS = "oed_simulations"

# ---------------------------------------------------------------------------
# Experiment type profiles
# ---------------------------------------------------------------------------

_EXPERIMENT_PROFILES: dict[str, dict] = {
    "tomography": {
        "base_circuits_per_qubit": 3,
        "base_shots_per_circuit": 1024,
        "fisher_scale": 0.85,
        "runtime_per_qubit_min": 2.5,
        "circuit_templates": [
            "PrepX_MeasX", "PrepX_MeasY", "PrepX_MeasZ",
            "PrepY_MeasX", "PrepY_MeasY", "PrepY_MeasZ",
            "PrepZ_MeasX", "PrepZ_MeasY", "PrepZ_MeasZ",
        ],
    },
    "characterization": {
        "base_circuits_per_qubit": 2,
        "base_shots_per_circuit": 512,
        "fisher_scale": 0.72,
        "runtime_per_qubit_min": 1.2,
        "circuit_templates": [
            "RB_m1_K100", "RB_m5_K100", "RB_m10_K100",
            "RB_m20_K100", "RB_m50_K100", "RB_m100_K100",
        ],
    },
    "vqe": {
        "base_circuits_per_qubit": 4,
        "base_shots_per_circuit": 2048,
        "fisher_scale": 0.60,
        "runtime_per_qubit_min": 4.0,
        "circuit_templates": [
            "UCCSD_ansatz_p1", "UCCSD_ansatz_p2",
            "HF_reference", "Energy_Pauli_ZZ", "Energy_Pauli_XX",
            "Energy_Pauli_YY", "Energy_Pauli_ZI", "Energy_Pauli_IZ",
        ],
    },
    "rb": {
        "base_circuits_per_qubit": 6,
        "base_shots_per_circuit": 1024,
        "fisher_scale": 0.91,
        "runtime_per_qubit_min": 1.8,
        "circuit_templates": [
            "RB_m1_K100", "RB_m2_K100", "RB_m4_K100",
            "RB_m8_K100", "RB_m16_K100", "RB_m32_K100",
            "RB_m64_K100", "RB_m128_K100", "RB_m256_K100",
        ],
    },
}

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ExperimentDesign(BaseModel):
    design_id: str
    name: str
    experiment_type: str
    n_qubits: int
    target_precision: float
    optimal_shots: int
    fisher_information: float
    cramér_rao_bound: float
    recommended_circuits: List[str]
    estimated_runtime_min: float
    created_at: str


class SimulatedOutcome(BaseModel):
    outcome_id: str
    design_id: str
    achieved_precision: float
    achieved_fidelity: float
    total_shots_used: int
    runtime_min: float
    converged: bool


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class DesignRequest(BaseModel):
    name: str
    experiment_type: str
    n_qubits: int
    target_precision: float
    budget_shots: int


class SimulateOutcomeRequest(BaseModel):
    design_id: str
    noise_level: float = 0.01


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_fisher(experiment_type: str, n_qubits: int, budget_shots: int) -> float:
    profile = _EXPERIMENT_PROFILES.get(experiment_type, _EXPERIMENT_PROFILES["characterization"])
    n_params = 4**n_qubits if experiment_type == "tomography" else 3 * n_qubits
    shots_per_param = budget_shots / max(n_params, 1)
    base_fisher = profile["fisher_scale"] * shots_per_param
    return round(base_fisher * (1.0 - random.uniform(0.02, 0.08)), 4)


def _cramér_rao_bound(fisher_information: float) -> float:
    if fisher_information <= 0:
        return 1.0
    return round(1.0 / math.sqrt(fisher_information), 8)


def _optimal_shots(target_precision: float, fisher_scale: float, budget_shots: int) -> int:
    required = int(math.ceil(1.0 / (target_precision**2 * fisher_scale)))
    return min(required, budget_shots)


def _select_circuits(experiment_type: str, n_qubits: int) -> List[str]:
    profile = _EXPERIMENT_PROFILES.get(experiment_type, _EXPERIMENT_PROFILES["characterization"])
    templates = profile["circuit_templates"]
    n_select = min(len(templates), max(3, n_qubits * profile["base_circuits_per_qubit"] // 2))
    return templates[:n_select]


def _estimate_runtime(experiment_type: str, n_qubits: int, optimal_shots: int) -> float:
    profile = _EXPERIMENT_PROFILES.get(experiment_type, _EXPERIMENT_PROFILES["characterization"])
    n_circuits = len(_select_circuits(experiment_type, n_qubits))
    seconds_per_shot = 0.001
    runtime_min = (n_circuits * optimal_shots * seconds_per_shot) / 60.0
    runtime_min += profile["runtime_per_qubit_min"] * n_qubits
    return round(runtime_min, 2)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/design", response_model=ExperimentDesign)
def create_design(body: DesignRequest, db: Session = Depends(get_db)):
    """Compute an optimal experiment design with Fisher information analysis."""
    valid_types = list(_EXPERIMENT_PROFILES.keys())
    if body.experiment_type not in valid_types:
        raise HTTPException(
            status_code=422,
            detail=f"experiment_type must be one of {valid_types}",
        )
    if body.n_qubits < 1 or body.n_qubits > 50:
        raise HTTPException(status_code=422, detail="n_qubits must be between 1 and 50")
    if body.target_precision <= 0 or body.target_precision >= 1:
        raise HTTPException(status_code=422, detail="target_precision must be in (0, 1)")
    if body.budget_shots < 64:
        raise HTTPException(status_code=422, detail="budget_shots must be at least 64")

    profile = _EXPERIMENT_PROFILES[body.experiment_type]
    fisher = _compute_fisher(body.experiment_type, body.n_qubits, body.budget_shots)
    crb = _cramér_rao_bound(fisher)
    opt_shots = _optimal_shots(body.target_precision, profile["fisher_scale"], body.budget_shots)
    circuits = _select_circuits(body.experiment_type, body.n_qubits)
    runtime = _estimate_runtime(body.experiment_type, body.n_qubits, opt_shots)

    design_id = str(uuid.uuid4())
    design = ExperimentDesign(
        design_id=design_id,
        name=body.name,
        experiment_type=body.experiment_type,
        n_qubits=body.n_qubits,
        target_precision=body.target_precision,
        optimal_shots=opt_shots,
        fisher_information=fisher,
        cramér_rao_bound=crb,
        recommended_circuits=circuits,
        estimated_runtime_min=runtime,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_DESIGNS, design_id, design.model_dump())
    return design


@router.get("/designs")
def list_designs(db: Session = Depends(get_db)):
    """List all experiment designs."""
    records = store_list(db, NS_DESIGNS)
    return {"count": len(records), "designs": records}


@router.get("/design/{design_id}", response_model=ExperimentDesign)
def get_design(design_id: str, db: Session = Depends(get_db)):
    """Retrieve a single experiment design."""
    design = store_get(db, NS_DESIGNS, design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    return design


@router.post("/simulate", response_model=SimulatedOutcome)
def simulate_outcome(body: SimulateOutcomeRequest, db: Session = Depends(get_db)):
    """Simulate running an experiment design under a specified noise level."""
    design = store_get(db, NS_DESIGNS, body.design_id)
    if not design:
        raise HTTPException(status_code=404, detail="design not found")
    if body.noise_level < 0 or body.noise_level > 1:
        raise HTTPException(status_code=422, detail="noise_level must be in [0, 1]")

    noise_factor = 1.0 - body.noise_level
    achieved_precision = round(
        design["cramér_rao_bound"] * (1.0 + body.noise_level * random.uniform(0.5, 2.0)), 6
    )
    achieved_fidelity = round(
        max(0.01, min(1.0, noise_factor * (1.0 - random.uniform(0.001, 0.02)))), 6
    )
    total_shots = int(design["optimal_shots"] * (1.0 + random.uniform(-0.05, 0.05)))
    runtime = round(design["estimated_runtime_min"] * (1.0 + body.noise_level * 0.3), 2)
    converged = achieved_precision <= design["target_precision"] * 1.1

    outcome_id = str(uuid.uuid4())
    outcome = SimulatedOutcome(
        outcome_id=outcome_id,
        design_id=body.design_id,
        achieved_precision=achieved_precision,
        achieved_fidelity=achieved_fidelity,
        total_shots_used=total_shots,
        runtime_min=runtime,
        converged=converged,
    )
    store_put(db, NS_SIMULATIONS, outcome_id, outcome.model_dump())
    return outcome
