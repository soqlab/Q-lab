"""Circuit checks, optimisation and a plain-language summary, computed from the circuit itself.

Statistics (qubits, depth, gate counts) come from parsing the circuit with Qiskit. Optimisation is
Qiskit's transpiler at optimization level 3 without a target device, and the figures reported are
measured on the circuit it returns. The checks in /debug are fixed rules on the circuit text.
Nothing is randomised, and no fidelity gain is claimed: that would need a noise model or hardware.
"""
from __future__ import annotations
import uuid
import re
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/v1/circuit-ai", tags=["circuit-ai"])

TWO_QUBIT = {"cx", "cy", "cz", "ch", "swap", "iswap", "rzz", "rxx", "ryy", "rzx", "ecr", "cp", "crx", "cry", "crz", "cu", "cu1", "cu3", "dcx"}

class DebugRequest(BaseModel):
    circuit_qasm: str
    n_qubits: Optional[int] = None
    backend: Optional[str] = None

class OptimizeRequest(BaseModel):
    circuit_qasm: str
    backend: Optional[str] = None
    objective: Optional[str] = "depth"

class ExplainRequest(BaseModel):
    circuit_qasm: str
    detail_level: Optional[str] = "medium"

def _circuit(qasm: str):
    from ..local_sim import _parse

    try:
        return _parse(qasm)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None


def _stats_of(circuit) -> dict:
    ops = circuit.count_ops()
    gates = {k: v for k, v in ops.items() if k not in ("measure", "barrier", "reset")}
    return {
        "n_qubits": circuit.num_qubits,
        "depth": circuit.depth(filter_function=lambda inst: inst.operation.name != "barrier"),
        "gate_count": sum(gates.values()),
        "two_qubit_gates": sum(v for k, v in gates.items() if k in TWO_QUBIT),
        "t_gates": gates.get("t", 0) + gates.get("tdg", 0),
    }


def _parse_stats(qasm: str) -> dict:
    return _stats_of(_circuit(qasm))

def _detect_bugs(qasm: str, stats: dict) -> tuple[list, list]:
    bugs = []
    warnings = []
    lines = qasm.strip().splitlines()

    measured = set()
    reset_after_measure = set()
    for i, line in enumerate(lines):
        l = line.strip()
        m = re.match(r'measure\s+\w+\[(\d+)\]', l)
        if m:
            measured.add(m.group(1))
        r = re.match(r'reset\s+\w+\[(\d+)\]', l)
        if r and r.group(1) in measured:
            reset_after_measure.add(r.group(1))

    has_measure = "measure" in qasm
    has_barrier = "barrier" in qasm
    if not has_barrier and stats["gate_count"] > 5:
        warnings.append({"line": -1, "message": "No barrier instructions found — transpiler may reorder gates across logical sections"})

    if stats["two_qubit_gates"] > 20:
        bugs.append({"line": -1, "type": "high_cnot_depth", "severity": "warning",
                     "description": f"High two-qubit gate count ({stats['two_qubit_gates']}) will amplify noise significantly",
                     "fix": "Apply gate synthesis (e.g., Solovay-Kitaev) or reduce algorithm depth"})

    if stats["t_gates"] > 15:
        bugs.append({"line": -1, "type": "high_t_complexity", "severity": "info",
                     "description": f"T-gate count {stats['t_gates']} increases fault-tolerant overhead",
                     "fix": "Use T-count optimizers like PyZX or t|ket> T-gate reduction pass"})

    for i, line in enumerate(lines):
        l = line.strip()
        if re.match(r'cx\s+\w+\[(\d+)\],\s*\w+\[(\d+)\]', l):
            m = re.findall(r'\[(\d+)\]', l)
            if len(m) == 2 and abs(int(m[0]) - int(m[1])) > 3:
                bugs.append({"line": i+1, "type": "non_adjacent_cnot", "severity": "warning",
                             "description": f"CNOT between qubits {m[0]} and {m[1]} requires SWAP routing overhead",
                             "fix": "Insert SWAP chain or use a routing-aware transpiler pass"})
                break

    if has_measure and not has_barrier:
        warnings.append({"line": -1, "message": "Measurements detected without preceding barrier — may cause timing issues on real hardware"})

    if stats["n_qubits"] > 0 and stats["gate_count"] > 0:
        qubits_used = set(re.findall(r'\[(\d+)\]', qasm))
        if len(qubits_used) < stats["n_qubits"]:
            unused = stats["n_qubits"] - len(qubits_used)
            warnings.append({"line": -1, "message": f"{unused} allocated qubit(s) appear unused — consider reducing qreg size"})

    return bugs, warnings

def _detect_algorithm(qasm: str) -> Optional[str]:
    if "ry" in qasm.lower() and "cx" in qasm.lower() and qasm.count("ry") > 3:
        return "VQE / hardware-efficient ansatz"
    if re.search(r'rzz|rxx', qasm, re.I):
        return "QAOA"
    if "h " in qasm.lower() and "cx" in qasm.lower() and "measure" in qasm.lower():
        return "Bernstein-Vazirani or Deutsch-Jozsa"
    if qasm.count("cx") > 10 and "t " in qasm.lower():
        return "Quantum error correction (Clifford+T)"
    return None

@router.post("/debug")
def debug_circuit(req: DebugRequest):
    debug_id = str(uuid.uuid4())
    stats = _parse_stats(req.circuit_qasm)
    if req.n_qubits:
        stats["n_qubits"] = req.n_qubits
    bugs, warnings = _detect_bugs(req.circuit_qasm, stats)
    suggestions = [
        "Run Qiskit transpile with optimization_level=3 before submitting",
        "Use t|ket> CliffordSimplification pass on Clifford subcircuits",
    ]
    if stats["two_qubit_gates"] > 5:
        suggestions.append("Consider compiler-aware qubit mapping to minimize SWAP insertions")
    return {"debug_id": debug_id, "bugs": bugs, "warnings": warnings,
            "suggestions": suggestions, "circuit_stats": stats,
            "debugged_at": datetime.now(timezone.utc).isoformat()}

@router.post("/optimize")
def optimize_circuit(req: OptimizeRequest):
    from qiskit import qasm2, transpile

    circuit = _circuit(req.circuit_qasm)
    before = _stats_of(circuit)
    optimized = transpile(circuit, optimization_level=3, seed_transpiler=0)
    after = _stats_of(optimized)
    try:
        optimized_qasm = qasm2.dumps(optimized)
    except Exception:
        optimized_qasm = None
    return {
        "original_depth": before["depth"],
        "optimized_depth": after["depth"],
        "original_gates": before["gate_count"],
        "optimized_gates": after["gate_count"],
        "original_two_qubit_gates": before["two_qubit_gates"],
        "optimized_two_qubit_gates": after["two_qubit_gates"],
        "depth_reduction_pct": round((1 - after["depth"] / before["depth"]) * 100, 2) if before["depth"] else 0.0,
        "optimized_qasm": optimized_qasm,
        "optimizations_applied": ["qiskit transpile, optimization_level=3 (no target device)"],
        "fidelity_improvement": None,
        "method": "Qiskit transpiler, optimization level 3, seed 0; figures measured on its output.",
    }


@router.post("/explain")
def explain_circuit(req: ExplainRequest):
    stats = _parse_stats(req.circuit_qasm)
    algo = _detect_algorithm(req.circuit_qasm)
    lines = [l.strip() for l in req.circuit_qasm.splitlines() if l.strip() and not l.startswith("//") and not l.startswith("OPENQASM") and not l.startswith("include") and not l.startswith("qreg") and not l.startswith("creg")]
    steps = []
    if req.detail_level in ("medium", "high"):
        gate_purposes = {"h": "create superposition", "cx": "entangle qubits", "ry": "parametric rotation",
                         "rz": "phase rotation", "measure": "collapse to classical bit", "barrier": "synchronization point",
                         "t": "π/8 phase gate (T-gate)", "s": "π/4 phase gate (S-gate)", "x": "bit flip (Pauli-X)"}
        for line in lines[:20]:
            gate = line.split()[0].rstrip(";") if line.split() else ""
            qubits = re.findall(r'\[(\d+)\]', line)
            purpose = gate_purposes.get(gate.lower(), "apply quantum operation")
            steps.append({"gate": gate, "qubits": qubits, "purpose": purpose})

    use_case = (f"Implements {algo}" if algo else
                f"General {stats['n_qubits']}-qubit quantum circuit with {stats['gate_count']} gates")
    explanation = (
        f"This is a {stats['n_qubits']}-qubit circuit of depth {stats['depth']} containing "
        f"{stats['gate_count']} gates ({stats['two_qubit_gates']} two-qubit gates, {stats['t_gates']} T-gates). "
        f"{('Detected algorithm: ' + algo + '. ') if algo else ''}"
        f"The circuit {'includes measurements for classical readout' if 'measure' in req.circuit_qasm else 'does not include measurements (state preparation or subroutine)'}."
    )
    return {"explanation": explanation, "step_by_step": steps, "algorithm_detected": algo, "use_case": use_case}
