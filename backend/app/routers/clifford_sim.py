"""Clifford simulator: the exact stabilizer state of a Clifford circuit, with Qiskit.

The circuit is parsed with Qiskit and converted to a Clifford tableau (qiskit.quantum_info.Clifford,
the Aaronson-Gottesman representation), which works for any number of qubits. Stabilizer
generators and Pauli expectations come from that tableau. A gate that is not Clifford (T, a
rotation by a non-multiple of pi/2, ...) is counted and located; such a circuit has no stabilizer
state, so none is reported.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..exact_state import unitary_circuit

router = APIRouter(prefix="/api/v1/clifford-sim", tags=["clifford_sim"])

MAX_QUBITS = 1000
METHOD = "Stabilizer tableau from Qiskit (qiskit.quantum_info.Clifford, Aaronson-Gottesman)."


class CliffordSimRequest(BaseModel):
    qasm: str = Field(min_length=1, max_length=500_000)
    # Kept for older clients and ignored: the qubit count comes from the circuit.
    n_qubits: int | None = None
    track_tableau: bool = True
    seed: int | None = None


def _is_clifford(op) -> bool:
    from qiskit.quantum_info import Clifford

    try:
        Clifford(op)
        return True
    except Exception:
        return False


@router.post("")
def run_clifford_sim(req: CliffordSimRequest):
    from qiskit.quantum_info import Clifford, Pauli, StabilizerState

    started = time.perf_counter()
    try:
        circuit = unitary_circuit(req.qasm, MAX_QUBITS)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    n = circuit.num_qubits
    verdicts = [_is_clifford(inst.operation) for inst in circuit.data]
    magic_positions = [i for i, ok in enumerate(verdicts) if not ok]
    is_clifford = not magic_positions

    stab_gens, tableau, z0, z1 = [], [], None, None
    if is_clifford:
        cliff = Clifford(circuit)
        state = StabilizerState(cliff)
        # Labels such as "+ZZ" or "-XI" (leftmost character is the highest qubit).
        stab_gens = cliff.to_labels(mode="S")[:6]
        if req.track_tableau:
            # One row per stabilizer: x bits for qubits 0..n-1, z bits for qubits 0..n-1, phase bit.
            for i in range(min(n, 8)):
                bits = list(cliff.stab_x[i]) + list(cliff.stab_z[i]) + [cliff.stab_phase[i]]
                tableau.append(["1" if b else "0" for b in bits])
        z0 = float(state.expectation_value(Pauli("I" * (n - 1) + "Z")))
        z1 = float(state.expectation_value(Pauli("I" * (n - 2) + "Z" + "I"))) if n > 1 else None

    return {
        "sim_id": f"csim-{uuid.uuid4().hex[:12]}",
        "n_qubits": n,
        "n_gates_clifford": sum(verdicts),
        "n_gates_non_clifford": len(magic_positions),
        "is_clifford_circuit": is_clifford,
        # Gottesman-Knill: Clifford circuits are efficiently simulable classically.
        "is_classically_simulable": is_clifford,
        "stabilizer_generators": stab_gens,
        "tableau_snapshot": tableau,
        "magic_state_count": len(magic_positions),
        "magic_state_positions": magic_positions[:20],
        "pauli_expectation_z0": z0,
        "pauli_expectation_z1": z1,
        "simulation_time_us": round((time.perf_counter() - started) * 1e6, 2),
        "max_simulable_qubits": None,
        "method": METHOD,
        "note": None if is_clifford else "The circuit has non-Clifford gates, so it has no stabilizer state.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/info")
def clifford_sim_info():
    return {
        "formalism": "Stabilizer tableau (Aaronson-Gottesman), via qiskit.quantum_info.Clifford",
        "description": (
            "The stabilizer formalism represents an n-qubit state by n Pauli generators. Each Clifford "
            "gate updates the tableau in polynomial time, so Clifford circuits are simulated efficiently "
            "whatever their size. Non-Clifford gates (T, general rotations) leave the formalism."
        ),
        "reference": "Aaronson & Gottesman, Phys. Rev. A 70, 052328 (2004)",
    }
