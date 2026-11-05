import hashlib
import json
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


# Transpiler options that change what runs on the device.
SETUP_TRANSPILER_KEYS = (
    "optimization_level", "seed_transpiler", "layout_method", "routing_method",
    "translation_method", "scheduling_method", "approximation_degree", "basis_gates",
)
# Packages whose version can change a result.
SETUP_PACKAGES = ("qiskit", "qiskit-aer", "qiskit-ibm-runtime", "qiskit-terra", "qlab-sdk")


def canonical_json(value: Any) -> str:
    """Deterministic JSON: sorted keys, no whitespace, non-JSON values as str."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def setup_material(
    circuit_fingerprint: Dict[str, Any],
    backend_name: Optional[str] = None,
    transpiler_settings: Optional[Dict[str, Any]] = None,
    shots: Optional[int] = None,
    precision: Optional[float] = None,
    package_versions: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """What the setup fingerprint hashes: the circuit plus where and how it was run."""
    settings = transpiler_settings or {}
    transpiler = {k: settings[k] for k in SETUP_TRANSPILER_KEYS if settings.get(k) is not None}
    if isinstance(transpiler.get("basis_gates"), (list, tuple, set)):
        transpiler["basis_gates"] = sorted(str(g) for g in transpiler["basis_gates"])
    versions = package_versions or {}
    return {
        "circuit": hashlib.sha256(canonical_json(circuit_fingerprint or {}).encode("utf-8")).hexdigest(),
        "backend": backend_name,
        "transpiler": transpiler,
        "shots": shots,
        "precision": precision,
        "packages": {k: versions[k] for k in SETUP_PACKAGES if versions.get(k)},
    }


def setup_fingerprint(material: Dict[str, Any]) -> str:
    """SHA-256 of the canonical JSON of setup_material(): equal only for the same circuit,
    backend, transpiler options, shots and package versions."""
    return hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()
