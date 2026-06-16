"""Syndrome Decoder — simulates quantum error correction codes and decoding strategies."""
from __future__ import annotations
import math, random, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/syndrome-decoder", tags=["syndrome_decoder"])

# ---------------------------------------------------------------------------
# Code definitions
# ---------------------------------------------------------------------------

CODES: Dict[str, Dict] = {
    "surface_d3": {
        "name": "Surface Code d=3",
        "distance": 3,
        "n_data": 9,
        "n_syndrome": 8,
        "threshold": 0.01,
        "description": "Distance-3 surface code: 9 data qubits, 8 syndrome (4 X-type, 4 Z-type) ancillas.",
        "check_matrix": [
            # Each row: indices of data qubits in this parity check (Z-type stabilizers)
            [0, 1, 3, 4],
            [1, 2, 4, 5],
            [3, 4, 6, 7],
            [4, 5, 7, 8],
            # X-type stabilizers
            [0, 1],
            [1, 2, 3, 4],
            [4, 5, 6, 7],
            [7, 8],
        ],
    },
    "surface_d5": {
        "name": "Surface Code d=5",
        "distance": 5,
        "n_data": 25,
        "n_syndrome": 24,
        "threshold": 0.01,
        "description": "Distance-5 surface code: 25 data qubits, 24 syndrome ancillas.",
        "check_matrix": [[i, i + 1, i + 5, i + 6] for i in range(0, 20, 5)] +
                        [[i, i + 1] for i in range(20, 25, 2)] +
                        [[i, i + 5] for i in range(0, 5)] +
                        [[i, i + 1, i + 5, i + 6] for i in [1, 2, 6, 7, 11, 12, 16, 17]],
    },
    "repetition_d3": {
        "name": "Repetition Code d=3",
        "distance": 3,
        "n_data": 3,
        "n_syndrome": 2,
        "threshold": 0.5,
        "description": "Distance-3 repetition code: 3 data qubits, 2 syndrome qubits. Corrects 1 bit-flip.",
        "check_matrix": [[0, 1], [1, 2]],
    },
    "repetition_d5": {
        "name": "Repetition Code d=5",
        "distance": 5,
        "n_data": 5,
        "n_syndrome": 4,
        "threshold": 0.5,
        "description": "Distance-5 repetition code: 5 data qubits, 4 syndrome qubits. Corrects 2 bit-flips.",
        "check_matrix": [[0, 1], [1, 2], [2, 3], [3, 4]],
    },
}


def _simulate_errors(n_data: int, error_rate: float, rng: random.Random) -> List[str]:
    """Generate random Pauli errors on data qubits."""
    errors = []
    for _ in range(n_data):
        r = rng.random()
        if r < error_rate / 3:
            errors.append("X")
        elif r < 2 * error_rate / 3:
            errors.append("Z")
        elif r < error_rate:
            errors.append("Y")
        else:
            errors.append("I")
    return errors


def _compute_syndromes(errors: List[str], check_matrix: List[List[int]], error_type: str = "Z") -> List[int]:
    """Compute which syndrome qubits are triggered."""
    syndromes = []
    for check in check_matrix:
        parity = 0
        for qubit in check:
            if qubit < len(errors):
                e = errors[qubit]
                # Z-type checks detect X/Y errors; X-type checks detect Z/Y errors
                if error_type == "Z" and e in ("X", "Y"):
                    parity ^= 1
                elif error_type == "X" and e in ("Z", "Y"):
                    parity ^= 1
        syndromes.append(parity)
    return syndromes


def _mwpm_decode(syndromes: List[int], n_data: int, check_matrix: List[List[int]], rng: random.Random) -> List[int]:
    """Minimum Weight Perfect Matching decoder (simplified greedy version)."""
    triggered = [i for i, s in enumerate(syndromes) if s == 1]
    correction = [0] * n_data

    # Pair triggered syndromes greedily by proximity
    remaining = list(triggered)
    while len(remaining) >= 2:
        i = remaining.pop(0)
        # Find closest partner
        best_j_idx = 0
        for k, j in enumerate(remaining):
            if abs(j - i) < abs(remaining[best_j_idx] - i):
                best_j_idx = k
        j = remaining.pop(best_j_idx)

        # Apply correction on data qubits between syndromes i and j
        for q in check_matrix[i]:
            if q < n_data:
                correction[q] ^= 1
    return correction


def _union_find_decode(syndromes: List[int], n_data: int, check_matrix: List[List[int]], rng: random.Random) -> List[int]:
    """Union-Find decoder (simplified clustering version)."""
    triggered = [i for i, s in enumerate(syndromes) if s == 1]
    correction = [0] * n_data

    # Cluster syndromes and correct within each cluster
    visited = set()
    for idx in triggered:
        if idx not in visited:
            visited.add(idx)
            for q in check_matrix[idx]:
                if q < n_data:
                    correction[q] ^= 1
    return correction


def _check_logical_error(errors: List[str], correction: List[int], distance: int) -> bool:
    """Check if a logical error occurred after correction."""
    # Residual errors after correction
    residual_x = sum(1 for i, e in enumerate(errors) if e in ("X", "Y") and not correction[i])
    residual_x += sum(1 for i, c in enumerate(correction) if c and errors[i] not in ("X", "Y"))
    # Logical error if residual chain spans the code distance
    return residual_x >= math.ceil(distance / 2)


def _correction_operator_str(correction: List[int], n_data: int) -> str:
    pauli = []
    for i in range(n_data):
        pauli.append("X" if correction[i] else "I")
    return "".join(pauli)


class SyndromeRequest(BaseModel):
    code: str = Field(default="surface_d3")
    error_rate: float = Field(default=0.01, ge=0.0, le=0.5)
    n_rounds: int = Field(default=1, ge=1, le=10)
    decoder: str = Field(default="mwpm")
    seed: Optional[int] = None


@router.post("")
def decode_syndrome(req: SyndromeRequest):
    code_key = req.code if req.code in CODES else "surface_d3"
    code = CODES[code_key]
    rng = random.Random(req.seed if req.seed is not None else random.randint(0, 2**31))

    n_data = code["n_data"]
    n_syndrome = code["n_syndrome"]
    distance = code["distance"]
    check_matrix = code["check_matrix"]
    threshold = code["threshold"]

    # Single-shot error simulation
    errors = _simulate_errors(n_data, req.error_rate, rng)
    syndromes_z = _compute_syndromes(errors, check_matrix[:n_syndrome // 2], "Z")
    syndromes_x = _compute_syndromes(errors, check_matrix[n_syndrome // 2:], "X")
    all_syndromes = syndromes_z + syndromes_x
    triggered_indices = [i for i, s in enumerate(all_syndromes) if s == 1]

    if req.decoder == "union_find":
        correction = _union_find_decode(all_syndromes, n_data, check_matrix, rng)
    else:
        correction = _mwpm_decode(all_syndromes, n_data, check_matrix, rng)

    logical_error = _check_logical_error(errors, correction, distance)

    # 100-trial Monte Carlo for logical error rate
    n_trials = 100
    n_logical_errors = 0
    for _ in range(n_trials):
        trial_errors = _simulate_errors(n_data, req.error_rate, rng)
        trial_syndromes_z = _compute_syndromes(trial_errors, check_matrix[:n_syndrome // 2], "Z")
        trial_syndromes_x = _compute_syndromes(trial_errors, check_matrix[n_syndrome // 2:], "X")
        trial_all = trial_syndromes_z + trial_syndromes_x
        if req.decoder == "union_find":
            trial_corr = _union_find_decode(trial_all, n_data, check_matrix, rng)
        else:
            trial_corr = _mwpm_decode(trial_all, n_data, check_matrix, rng)
        if _check_logical_error(trial_errors, trial_corr, distance):
            n_logical_errors += 1

    logical_error_rate = round(n_logical_errors / n_trials, 4)
    decoder_success_rate = round(1.0 - logical_error_rate, 4)

    error_locations = [
        {
            "qubit": i,
            "error_type": e,
            "corrected": bool(correction[i]) if i < len(correction) else False,
        }
        for i, e in enumerate(errors) if e != "I"
    ]

    return {
        "decode_id": f"dec-{uuid.uuid4().hex[:12]}",
        "code_name": code["name"],
        "code_distance": distance,
        "n_data_qubits": n_data,
        "n_syndrome_qubits": n_syndrome,
        "error_rate": req.error_rate,
        "decoder_used": req.decoder,
        "n_rounds": req.n_rounds,
        "syndrome_pattern": all_syndromes,
        "n_triggered_syndromes": len(triggered_indices),
        "correction_operator": _correction_operator_str(correction, n_data),
        "logical_error_occurred": logical_error,
        "logical_error_rate_estimate": logical_error_rate,
        "decoder_success_rate": decoder_success_rate,
        "error_locations": error_locations,
        "threshold_estimate": threshold,
        "below_threshold": req.error_rate < threshold,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/codes")
def list_codes():
    return [
        {
            "code_id": k,
            "name": v["name"],
            "distance": v["distance"],
            "n_data_qubits": v["n_data"],
            "n_syndrome_qubits": v["n_syndrome"],
            "threshold_estimate": v["threshold"],
            "description": v["description"],
        }
        for k, v in CODES.items()
    ]
