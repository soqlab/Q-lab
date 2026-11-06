"""Exact noiseless quantum states of a user's circuit, for tools that describe the ideal state.

Everything here is a statevector calculation with Qiskit: no sampling, no randomness, and no
claim about hardware. Callers say so in their responses.
"""
from __future__ import annotations

from typing import Any

from .local_sim import _parse

METHOD = ("Exact statevector simulation of the circuit you supplied (noiseless, final measurements "
          "removed). This is the ideal state, not a reconstruction from hardware measurements.")


def unitary_circuit(qasm: str, max_qubits: int):
    """The circuit without its final measurements. ValueError if it can't be treated exactly."""
    circuit = _parse(qasm)
    if circuit.num_qubits > max_qubits:
        raise ValueError(f"The circuit has {circuit.num_qubits} qubits; the limit here is {max_qubits}.")
    stripped = circuit.remove_final_measurements(inplace=False)
    from qiskit import QuantumCircuit

    clean = QuantumCircuit(stripped.num_qubits)
    for inst in stripped.data:
        name = inst.operation.name
        if name in ("measure", "reset"):
            raise ValueError("Mid-circuit measurements and resets have no single ideal state.")
        if inst.clbits:
            raise ValueError("Classically controlled operations have no single ideal state.")
        if name != "barrier":
            clean.append(inst.operation, [stripped.find_bit(q).index for q in inst.qubits])
    return clean


def reduced(state, n_qubits: int, keep: set[int]) -> Any:
    """Density matrix of the qubits in `keep` (Qiskit's ordering: lowest index rightmost)."""
    from qiskit.quantum_info import DensityMatrix, partial_trace

    others = [k for k in range(n_qubits) if k not in keep]
    return partial_trace(state, others) if others else DensityMatrix(state)


def von_neumann(rho) -> float:
    from qiskit.quantum_info import entropy

    return max(0.0, float(entropy(rho, base=2)))


def qubit_state(state, n_qubits: int, q: int) -> dict:
    """Bloch vector, purity and entropy of one qubit's reduced state, plus its 2x2 matrix."""
    rho = reduced(state, n_qubits, {q})
    m = rho.data
    return {
        "qubit": q,
        "x": round(2 * float(m[0][1].real), 6),
        "y": round(2 * float(m[1][0].imag), 6),
        "z": round(float((m[0][0] - m[1][1]).real), 6),
        "purity": round(float(rho.purity().real), 6),
        "entropy": round(von_neumann(rho), 6),
        "matrix": m,
    }
