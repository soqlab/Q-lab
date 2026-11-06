"""Noiseless local simulation of a stored circuit, with Qiskit Aer."""
from __future__ import annotations

from typing import Optional


def simulate_counts(qasm: str, shots: int, seed: Optional[int] = None) -> dict[str, int]:
    """Measurement counts for an OpenQASM 2 or 3 circuit. Raises ValueError if it can't be parsed."""
    from qiskit import transpile
    from qiskit_aer import AerSimulator

    circuit = _parse(qasm)
    if circuit.num_clbits == 0:
        circuit.measure_all()
    simulator = AerSimulator(seed_simulator=seed)
    counts = simulator.run(transpile(circuit, simulator), shots=shots).result().get_counts()
    return {key.replace(" ", ""): value for key, value in counts.items()}


MAX_STATEVECTOR_QUBITS = 20


def _parse(qasm: str):
    from qiskit import QuantumCircuit, qasm3

    try:
        return QuantumCircuit.from_qasm_str(qasm)
    except Exception:
        try:
            return qasm3.loads(qasm)
        except Exception as exc:
            raise ValueError(f"Could not parse the circuit: {exc}") from None


def ideal_probabilities(qasm: str) -> dict[str, float]:
    """Exact noiseless outcome probabilities, keyed like Qiskit counts (classical bit 0 rightmost).

    Only outcomes with non-zero probability are returned. Raises ValueError for circuits it can't
    treat exactly: unparseable, mid-circuit measurement, a classical bit measured twice or never,
    or more than MAX_STATEVECTOR_QUBITS qubits.
    """
    from qiskit.quantum_info import Statevector

    circuit = _parse(qasm)
    if circuit.num_qubits > MAX_STATEVECTOR_QUBITS:
        raise ValueError(f"{circuit.num_qubits} qubits is too many for an exact statevector "
                         f"(the limit is {MAX_STATEVECTOR_QUBITS}).")
    if circuit.num_clbits == 0:
        circuit.measure_all()
    qubit_of_clbit: dict[int, int] = {}
    for inst in circuit.data:
        if inst.operation.name == "measure":
            clbit = circuit.find_bit(inst.clbits[0]).index
            if clbit in qubit_of_clbit:
                raise ValueError("A classical bit is measured more than once.")
            qubit_of_clbit[clbit] = circuit.find_bit(inst.qubits[0]).index
    if sorted(qubit_of_clbit) != list(range(circuit.num_clbits)):
        raise ValueError("Every classical bit must be measured exactly once.")
    unitary_part = circuit.remove_final_measurements(inplace=False)
    if any(inst.operation.name in ("measure", "reset") for inst in unitary_part.data):
        raise ValueError("Mid-circuit measurements and resets have no single ideal distribution.")
    qargs = [qubit_of_clbit[c] for c in range(circuit.num_clbits)]
    probs = Statevector(unitary_part).probabilities_dict(qargs=qargs)
    return {str(key): float(p) for key, p in probs.items() if p > 1e-12}
