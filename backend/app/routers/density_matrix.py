"""Ideal state analysis: each qubit's exact reduced state in the circuit's noiseless output.

Bloch vectors, purities, entropies and Pauli expectations are computed from the exact statevector
of the supplied circuit, and the fidelity to a named target state is |<target|psi>|^2. This is not
tomography of hardware (no measurements are taken), and the response says so.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..exact_state import METHOD, qubit_state, unitary_circuit, von_neumann

router = APIRouter(prefix="/api/v1/tomography", tags=["state_tomography"])

MAX_QUBITS = 12


class TomoRequest(BaseModel):
    qasm: str = Field(min_length=1, max_length=200_000)
    target_state: Optional[str] = None  # "bell", "ghz" or "uniform"
    # Kept for older clients and ignored: the qubit count comes from the circuit, and nothing is sampled.
    n_qubits: Optional[int] = None
    shots: Optional[int] = None
    seed: Optional[int] = None


def _target(name: str, n: int):
    from qiskit.quantum_info import Statevector

    dim = 2 ** n
    amps = [0j] * dim
    if name in ("bell", "ghz"):
        if name == "bell" and n != 2:
            raise ValueError("The Bell target needs a 2-qubit circuit; use 'ghz' for more qubits.")
        amps[0] = amps[dim - 1] = 1 / math.sqrt(2)
    elif name == "uniform":
        amps = [1 / math.sqrt(dim)] * dim
    else:
        raise ValueError("target_state must be 'bell', 'ghz' or 'uniform'.")
    return Statevector(amps)


@router.post("")
def run_tomography(req: TomoRequest):
    from qiskit.quantum_info import DensityMatrix, Statevector, state_fidelity

    try:
        circuit = unitary_circuit(req.qasm, MAX_QUBITS)
        n = circuit.num_qubits
        target = _target(req.target_state, n) if req.target_state else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if n < 1:
        raise HTTPException(status_code=422, detail="The circuit has no qubits.")

    state = Statevector(circuit)
    qubits = [qubit_state(state, n, q) for q in range(n)]
    m = qubits[0]["matrix"]
    avg_purity = sum(q["purity"] for q in qubits) / n
    return {
        "tomo_id": f"tomo-{uuid.uuid4().hex[:12]}",
        "n_qubits": n,
        "shots_per_basis": None,
        "total_shots": None,
        "bloch_vectors": [{k: q[k] for k in ("qubit", "x", "y", "z", "purity")} for q in qubits],
        "density_matrix": {
            "re": [[round(float(v.real), 6) for v in row] for row in m],
            "im": [[round(float(v.imag), 6) for v in row] for row in m],
        },
        # Mean purity and entropy of the single-qubit reduced states (the whole state is pure).
        "purity": round(avg_purity, 6),
        "von_neumann_entropy": round(sum(q["entropy"] for q in qubits) / n, 6),
        "global_state_entropy": round(von_neumann(DensityMatrix(state)), 6),
        "is_pure": avg_purity > 0.95,
        "is_mixed": avg_purity < 0.7,
        "pauli_expectations": {f"{axis.upper()}{q['qubit']}": q[axis] for q in qubits for axis in ("x", "y", "z")},
        "fidelity_to_target": None if target is None else round(float(state_fidelity(state, target)), 6),
        "target_state": req.target_state,
        "method": METHOD,
        "source": "Your circuit, simulated exactly. Not a measurement of hardware.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
