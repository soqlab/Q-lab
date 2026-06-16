import hashlib
from typing import Any, Dict, Optional

NON_CLIFFORD_GATES = {
    "t",
    "tdg",
    "ccx",
    "rx",
    "ry",
    "rz",
    "u",
    "u1",
    "u2",
    "u3",
    "p",
}

def fingerprint_circuit(circuit, qasm: Optional[str] = None) -> Dict[str, Any]:
    gate_counts = circuit.count_ops()
    total_gates = sum(gate_counts.values())

    non_clifford_count = sum(
        count
        for gate, count in gate_counts.items()
        if gate.lower() in NON_CLIFFORD_GATES
    )

    non_clifford_ratio = (
        non_clifford_count / total_gates
        if total_gates > 0
        else 0
    )

    fingerprint = {
        "num_qubits": circuit.num_qubits,
        "num_clbits": circuit.num_clbits,
        "depth": circuit.depth(),
        "size": circuit.size(),
        "gate_counts": dict(gate_counts),
        "non_clifford_count": non_clifford_count,
        "non_clifford_ratio": non_clifford_ratio,
    }

    if qasm:
        fingerprint["qasm_sha256"] = hashlib.sha256(qasm.encode("utf-8")).hexdigest()

    return fingerprint
