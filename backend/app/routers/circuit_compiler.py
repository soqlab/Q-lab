from __future__ import annotations
import re
import time
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/circuits", tags=["circuit-compiler"])

# Native gate sets per provider
NATIVE_GATES: dict[str, list[str]] = {
    "ibm":      ["cx", "id", "rz", "sx", "x"],
    "ionq":     ["rx", "ry", "rz", "cnot"],
    "rigetti":  ["cz", "cnot", "h", "rx", "ry", "rz", "swap"],
    "braket":   ["cnot", "h", "rx", "ry", "rz", "s", "t", "x", "y", "z", "swap"],
    "simulator":["h", "x", "y", "z", "cx", "rz", "rx", "ry", "measure"],
}

PROVIDER_BACKENDS = {
    "ibm_brisbane": "ibm", "ibm_kyoto": "ibm", "ibm_sherbrooke": "ibm",
    "ionq_aria_1": "ionq", "ionq_forte_1": "ionq",
    "rigetti_ankaa_2": "rigetti",
    "simulator": "simulator",
}

OPT_DESCRIPTIONS = {
    0: "No optimisation — only maps to native gates",
    1: "Light — removes redundant gates, basic simplification",
    2: "Medium — commutation analysis, gate cancellation (recommended)",
    3: "Heavy — full optimisation, maximum depth reduction",
}


class CompileRequest(BaseModel):
    qasm: str
    target_backend: str = "ibm_brisbane"
    optimization_level: int = Field(default=2, ge=0, le=3)


class CompileResult(BaseModel):
    compiled_qasm: str
    target_backend: str
    provider: str
    optimization_level: int
    optimization_description: str
    original_depth: int
    compiled_depth: int
    original_gate_count: int
    compiled_gate_count: int
    depth_reduction_pct: float
    gate_reduction_pct: float
    estimated_fidelity: float
    native_gates_used: list[str]
    compile_time_ms: float
    warnings: list[str]


def _count_gates(qasm: str) -> tuple[int, int]:
    """Return (gate_count, depth_estimate)."""
    lines = [
        ln.strip() for ln in qasm.splitlines()
        if ln.strip()
        and not ln.strip().startswith("//")
        and not ln.strip().startswith("OPENQASM")
        and not ln.strip().startswith("include")
        and not ln.strip().startswith("qreg")
        and not ln.strip().startswith("creg")
        and not ln.strip().startswith("barrier")
        and ln.strip()
    ]
    gate_count = len(lines)
    qreg = re.findall(r"qreg\s+\w+\[(\d+)\]", qasm)
    n_qubits = max(sum(int(q) for q in qreg), 1) if qreg else 1
    depth = max(1, gate_count // n_qubits)
    return gate_count, depth


def _compile_with_qiskit(qasm: str, provider: str, opt_level: int) -> tuple[str, list[str]]:
    """Try Qiskit transpiler; fall back to rule-based if unavailable."""
    warnings: list[str] = []
    try:
        from qiskit import QuantumCircuit
        from qiskit.compiler import transpile

        basis_map = {
            "ibm":      ["cx", "id", "rz", "sx", "x"],
            "ionq":     ["rx", "ry", "rz", "cx"],
            "rigetti":  ["cz", "cx", "h", "rx", "ry", "rz", "swap"],
            "braket":   ["cx", "h", "rx", "ry", "rz", "s", "t", "x", "y", "z", "swap"],
            "simulator":["h", "x", "y", "z", "cx", "rz", "rx", "ry"],
        }
        basis = basis_map.get(provider, basis_map["simulator"])

        qc = QuantumCircuit.from_qasm_str(qasm)
        compiled = transpile(qc, basis_gates=basis, optimization_level=opt_level)
        compiled_qasm = compiled.qasm()
        return compiled_qasm, warnings

    except ImportError:
        warnings.append("Qiskit not available — using rule-based compilation")
    except Exception as e:
        warnings.append(f"Qiskit transpiler error: {e} — using rule-based compilation")

    return _rule_based_compile(qasm, provider, opt_level), warnings


def _rule_based_compile(qasm: str, provider: str, opt_level: int) -> str:
    """Simple rule-based optimiser when Qiskit is unavailable."""
    lines = qasm.splitlines()
    output = []
    prev_gate = None

    for line in lines:
        stripped = line.strip()

        # Always keep headers
        if (stripped.startswith("OPENQASM") or stripped.startswith("include")
                or stripped.startswith("qreg") or stripped.startswith("creg")
                or stripped.startswith("//") or not stripped):
            output.append(line)
            continue

        if opt_level >= 1:
            # Remove double X gates (X;X = I)
            if stripped.startswith("x ") and prev_gate == stripped:
                output.pop()
                prev_gate = None
                continue
            # Remove double H gates
            if stripped.startswith("h ") and prev_gate == stripped:
                output.pop()
                prev_gate = None
                continue

        output.append(line)
        prev_gate = stripped

    return "\n".join(output)


def _get_native_gates_used(qasm: str, provider: str) -> list[str]:
    native = set(NATIVE_GATES.get(provider, []))
    used: set[str] = set()
    for line in qasm.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(("//", "OPENQASM", "include", "qreg", "creg")):
            continue
        gate_name = re.split(r"[\s(]", stripped)[0].lower()
        if gate_name in native:
            used.add(gate_name)
    return sorted(used)


@router.post("/compile", response_model=CompileResult)
def compile_circuit(req: CompileRequest) -> CompileResult:
    """Compile and optimise a QASM circuit for a target backend."""
    provider = PROVIDER_BACKENDS.get(req.target_backend, "simulator")
    t0 = time.time()

    original_gates, original_depth = _count_gates(req.qasm)
    compiled_qasm, warnings = _compile_with_qiskit(req.qasm, provider, req.optimization_level)
    compiled_gates, compiled_depth = _count_gates(compiled_qasm)

    compile_ms = round((time.time() - t0) * 1000, 1)

    depth_reduction = round((1 - compiled_depth / max(original_depth, 1)) * 100, 1)
    gate_reduction = round((1 - compiled_gates / max(original_gates, 1)) * 100, 1)

    # Fidelity estimate based on compiled depth
    qreg = re.findall(r"qreg\s+\w+\[(\d+)\]", req.qasm)
    n_qubits = max(sum(int(q) for q in qreg), 1) if qreg else 1

    gate_error_map = {"ibm": 0.001, "ionq": 0.0003, "rigetti": 0.002, "braket": 0.001, "simulator": 0.0}
    readout_map = {"ibm": 0.015, "ionq": 0.005, "rigetti": 0.02, "braket": 0.01, "simulator": 0.0}
    gate_err = gate_error_map.get(provider, 0.001)
    readout_err = readout_map.get(provider, 0.015)
    fidelity = round((1 - gate_err) ** compiled_depth * (1 - readout_err) ** n_qubits, 4)

    native_used = _get_native_gates_used(compiled_qasm, provider)

    return CompileResult(
        compiled_qasm=compiled_qasm,
        target_backend=req.target_backend,
        provider=provider,
        optimization_level=req.optimization_level,
        optimization_description=OPT_DESCRIPTIONS[req.optimization_level],
        original_depth=original_depth,
        compiled_depth=compiled_depth,
        original_gate_count=original_gates,
        compiled_gate_count=compiled_gates,
        depth_reduction_pct=depth_reduction,
        gate_reduction_pct=gate_reduction,
        estimated_fidelity=fidelity,
        native_gates_used=native_used,
        compile_time_ms=compile_ms,
        warnings=warnings,
    )
