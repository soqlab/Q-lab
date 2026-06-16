from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math

from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/process-tomo", tags=["process-tomo"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_RESULTS = "process_tomo_results"

_GATE_PROFILES: dict = {
    "h": {"base_fidelity": 0.9985, "dominant_error": "coherent_rotation", "unitarity_base": 0.9982},
    "x": {"base_fidelity": 0.9991, "dominant_error": "depolarizing", "unitarity_base": 0.9989},
    "y": {"base_fidelity": 0.9990, "dominant_error": "depolarizing", "unitarity_base": 0.9988},
    "z": {"base_fidelity": 0.9995, "dominant_error": "coherent_phase", "unitarity_base": 0.9994},
    "s": {"base_fidelity": 0.9992, "dominant_error": "coherent_phase", "unitarity_base": 0.9991},
    "t": {"base_fidelity": 0.9988, "dominant_error": "coherent_phase", "unitarity_base": 0.9986},
    "cx": {"base_fidelity": 0.9920, "dominant_error": "two_qubit_depolarizing", "unitarity_base": 0.9910},
    "cz": {"base_fidelity": 0.9915, "dominant_error": "zz_crosstalk", "unitarity_base": 0.9905},
    "rx": {"base_fidelity": 0.9983, "dominant_error": "amplitude_damping", "unitarity_base": 0.9980},
    "ry": {"base_fidelity": 0.9984, "dominant_error": "amplitude_damping", "unitarity_base": 0.9981},
    "rz": {"base_fidelity": 0.9994, "dominant_error": "coherent_phase", "unitarity_base": 0.9993},
    "swap": {"base_fidelity": 0.9880, "dominant_error": "two_qubit_depolarizing", "unitarity_base": 0.9870},
    "ecr": {"base_fidelity": 0.9908, "dominant_error": "zz_crosstalk", "unitarity_base": 0.9898},
}

_BACKEND_NOISE_SCALE: dict = {
    "ibm_brisbane": 1.0,
    "ibm_kyoto": 0.85,
    "ionq_aria_1": 0.25,
    "rigetti_ankaa_2": 1.8,
    "quantinuum_h2": 0.12,
    "simulator": 0.05,
}


class QPTResult(BaseModel):
    result_id: str
    backend: str
    gate_name: str
    n_qubits: int
    method: str
    process_fidelity: float
    average_gate_fidelity: float
    unitarity: float
    diamond_norm_error: float
    chi_matrix_real: List[List[float]]
    chi_matrix_imag: List[List[float]]
    dominant_error_type: str
    error_breakdown: dict
    n_circuits_used: int
    shots_per_circuit: int
    created_at: str


class QPTSummary(BaseModel):
    backend: str
    gate_name: str
    process_fidelity: float
    average_gate_fidelity: float
    diamond_norm_error: float
    created_at: str


class RunRequest(BaseModel):
    backend: str
    gate_name: str
    n_qubits: int = 1
    method: str = "standard"
    shots_per_circuit: int = 1024


def _ideal_chi_1q() -> tuple[List[List[float]], List[List[float]]]:
    real = [[0.0] * 4 for _ in range(4)]
    imag = [[0.0] * 4 for _ in range(4)]
    real[0][0] = 1.0
    return real, imag


def _noisy_chi(process_fidelity: float, noise_scale: float) -> tuple[List[List[float]], List[List[float]]]:
    ideal_real, ideal_imag = _ideal_chi_1q()
    noise_amplitude = (1.0 - process_fidelity) * 0.5

    real = [[0.0] * 4 for _ in range(4)]
    imag = [[0.0] * 4 for _ in range(4)]

    for i in range(4):
        for j in range(4):
            r_noise = random.gauss(0, noise_amplitude * 0.3)
            i_noise = random.gauss(0, noise_amplitude * 0.2)
            real[i][j] = round(ideal_real[i][j] + r_noise, 6)
            imag[i][j] = round(ideal_imag[i][j] + i_noise, 6)

    real[0][0] = round(max(0.5, process_fidelity + random.gauss(0, 0.003)), 6)
    error_spread = (1.0 - real[0][0]) / 3
    real[1][1] = round(error_spread * random.uniform(0.8, 1.2), 6)
    real[2][2] = round(error_spread * random.uniform(0.8, 1.2), 6)
    real[3][3] = round(max(0.0, 1.0 - real[0][0] - real[1][1] - real[2][2]), 6)

    return real, imag


def _make_chi_2q(process_fidelity: float) -> tuple[List[List[float]], List[List[float]]]:
    dim = 4
    real = [[round(random.gauss(0, 0.01), 6) for _ in range(dim)] for _ in range(dim)]
    imag = [[round(random.gauss(0, 0.008), 6) for _ in range(dim)] for _ in range(dim)]
    real[0][0] = round(process_fidelity + random.gauss(0, 0.003), 6)
    for i in range(1, dim):
        real[i][i] = round((1.0 - real[0][0]) / (dim - 1) * random.uniform(0.7, 1.3), 6)
    return real, imag


def _error_breakdown(dominant: str, noise_scale: float, process_fidelity: float) -> dict:
    total_error = round(1.0 - process_fidelity, 6)
    fractions: dict[str, float] = {
        "depolarizing": 0.0,
        "amplitude_damping": 0.0,
        "coherent_rotation": 0.0,
        "coherent_phase": 0.0,
        "two_qubit_depolarizing": 0.0,
        "zz_crosstalk": 0.0,
        "readout": 0.0,
        "leakage": 0.0,
    }
    dominant_fraction = random.uniform(0.45, 0.70)
    fractions[dominant] = dominant_fraction
    remaining = 1.0 - dominant_fraction
    others = [k for k in fractions if k != dominant]
    splits = sorted([random.random() for _ in range(len(others) - 1)])
    splits = [0.0] + splits + [1.0]
    for idx, k in enumerate(others):
        fractions[k] = round(remaining * (splits[idx + 1] - splits[idx]), 6)
    fractions[dominant] = round(dominant_fraction, 6)
    return {k: round(v * total_error, 8) for k, v in fractions.items()}


@router.post("/run", response_model=QPTResult)
def run(req: RunRequest, db: Session = Depends(get_db)) -> QPTResult:
    valid_methods = ("standard", "compressed", "direct_fidelity")
    if req.method not in valid_methods:
        raise HTTPException(status_code=422, detail=f"method must be one of {valid_methods}")

    gate_name_lower = req.gate_name.lower()
    profile = _GATE_PROFILES.get(gate_name_lower, {
        "base_fidelity": 0.985,
        "dominant_error": "depolarizing",
        "unitarity_base": 0.983,
    })

    noise_scale = _BACKEND_NOISE_SCALE.get(req.backend, 1.0)

    method_fidelity_penalty = {"standard": 0.0, "compressed": 0.001, "direct_fidelity": 0.003}
    penalty = method_fidelity_penalty.get(req.method, 0.0)

    degradation = (1.0 - profile["base_fidelity"]) * noise_scale
    process_fidelity = round(min(0.9999, max(0.5, 1.0 - degradation - penalty + random.gauss(0, 0.001))), 5)

    d = 2 ** req.n_qubits
    average_gate_fidelity = round((d * process_fidelity + 1) / (d + 1), 5)

    unitarity_degradation = (1.0 - profile["unitarity_base"]) * noise_scale
    unitarity = round(min(1.0, max(0.0, 1.0 - unitarity_degradation + random.gauss(0, 0.001))), 5)

    diamond_norm_error = round((1.0 - process_fidelity) * random.uniform(1.8, 2.2), 6)

    if req.n_qubits == 1:
        chi_real, chi_imag = _noisy_chi(process_fidelity, noise_scale)
    else:
        chi_real, chi_imag = _make_chi_2q(process_fidelity)

    if req.method == "standard":
        n_circuits = 4 ** (2 * req.n_qubits)
    elif req.method == "compressed":
        n_circuits = max(10, int(4 ** (2 * req.n_qubits) * 0.3))
    else:
        n_circuits = max(5, int(4 ** (2 * req.n_qubits) * 0.15))

    error_bd = _error_breakdown(profile["dominant_error"], noise_scale, process_fidelity)

    result_id = str(uuid.uuid4())
    result = QPTResult(
        result_id=result_id,
        backend=req.backend,
        gate_name=req.gate_name,
        n_qubits=req.n_qubits,
        method=req.method,
        process_fidelity=process_fidelity,
        average_gate_fidelity=average_gate_fidelity,
        unitarity=unitarity,
        diamond_norm_error=diamond_norm_error,
        chi_matrix_real=chi_real,
        chi_matrix_imag=chi_imag,
        dominant_error_type=profile["dominant_error"],
        error_breakdown=error_bd,
        n_circuits_used=n_circuits,
        shots_per_circuit=req.shots_per_circuit,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_RESULTS, result_id, result.model_dump())
    return result


@router.get("/results", response_model=List[QPTSummary])
def list_results(db: Session = Depends(get_db)) -> List[QPTSummary]:
    records = store_list(db, NS_RESULTS)
    return [
        QPTSummary(
            backend=r["backend"],
            gate_name=r["gate_name"],
            process_fidelity=r["process_fidelity"],
            average_gate_fidelity=r["average_gate_fidelity"],
            diamond_norm_error=r["diamond_norm_error"],
            created_at=r["created_at"],
        )
        for r in records
    ]


@router.get("/result/{result_id}", response_model=QPTResult)
def get_result(result_id: str, db: Session = Depends(get_db)) -> QPTResult:
    result = store_get(db, NS_RESULTS, result_id)
    if not result:
        raise HTTPException(status_code=404, detail="Result not found")
    return result


@router.delete("/result/{result_id}", status_code=204)
def delete_result(result_id: str, db: Session = Depends(get_db)) -> Response:
    deleted = store_delete(db, NS_RESULTS, result_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Result not found")
    return Response(status_code=204)
