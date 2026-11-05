"""Noiseless local simulation of a stored circuit, with Qiskit Aer."""
from __future__ import annotations

from typing import Optional


def simulate_counts(qasm: str, shots: int, seed: Optional[int] = None) -> dict[str, int]:
    """Measurement counts for an OpenQASM 2 or 3 circuit. Raises ValueError if it can't be parsed."""
    from qiskit import QuantumCircuit, qasm3, transpile
    from qiskit_aer import AerSimulator

    try:
        circuit = QuantumCircuit.from_qasm_str(qasm)
    except Exception:
        try:
            circuit = qasm3.loads(qasm)
        except Exception as exc:
            raise ValueError(f"Could not parse the circuit: {exc}") from None
    if circuit.num_clbits == 0:
        circuit.measure_all()
    simulator = AerSimulator(seed_simulator=seed)
    counts = simulator.run(transpile(circuit, simulator), shots=shots).result().get_counts()
    return {key.replace(" ", ""): value for key, value in counts.items()}
