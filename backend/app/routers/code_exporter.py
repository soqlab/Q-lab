from __future__ import annotations
import re, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/code-export", tags=["code_exporter"])

FRAMEWORKS = {
    "qiskit":    {"version": "qiskit>=1.0,qiskit-aer>=0.13", "install": "pip install qiskit qiskit-aer"},
    "cirq":      {"version": "cirq>=1.3",                     "install": "pip install cirq"},
    "pennylane": {"version": "pennylane>=0.36",               "install": "pip install pennylane"},
    "braket":    {"version": "amazon-braket-sdk>=1.70",       "install": "pip install amazon-braket-sdk"},
}

class ExportRequest(BaseModel):
    qasm: str
    framework: str = "qiskit"
    backend: str = "simulator"
    n_shots: int = Field(default=1024, ge=1, le=100000)
    include_visualization: bool = True
    add_error_mitigation: bool = False

def _parse_qasm(qasm: str):
    n_qubits = 0; gates = []
    for line in qasm.strip().splitlines():
        line = line.strip().rstrip(';')
        if not line or line.startswith('//') or line.startswith('OPENQASM') or line.startswith('include'): continue
        if line.startswith('qreg'):
            m = re.search(r'\[(\d+)\]', line)
            if m: n_qubits = int(m.group(1))
            continue
        if line.startswith('creg'): continue
        m = re.match(r'(\w+)(?:\(([^)]*)\))?\s+(.*)', line)
        if not m: continue
        gate, params_s, qubits_s = m.group(1), m.group(2) or '', m.group(3)
        params = [p.strip() for p in params_s.split(',') if p.strip()]
        qubits = []
        for q in qubits_s.split(','):
            mm = re.search(r'\[(\d+)\]', q.strip())
            if mm: qubits.append(int(mm.group(1)))
        gates.append({'gate': gate.lower(), 'params': params, 'qubits': qubits})
    return n_qubits, gates

def _to_qiskit(n: int, gates: list, n_shots: int, backend: str, viz: bool, mit: bool) -> str:
    lines = [
        "from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister, transpile",
        "from qiskit_aer import AerSimulator",
        "",
        f"qr = QuantumRegister({n}, 'q')",
        f"cr = ClassicalRegister({n}, 'c')",
        "qc = QuantumCircuit(qr, cr)",
        "",
    ]
    for g in gates:
        q = g['qubits']; p = g['params']
        if g['gate'] == 'h' and q:      lines.append(f"qc.h(qr[{q[0]}])")
        elif g['gate'] == 'x' and q:    lines.append(f"qc.x(qr[{q[0]}])")
        elif g['gate'] == 'y' and q:    lines.append(f"qc.y(qr[{q[0]}])")
        elif g['gate'] == 'z' and q:    lines.append(f"qc.z(qr[{q[0]}])")
        elif g['gate'] == 's' and q:    lines.append(f"qc.s(qr[{q[0]}])")
        elif g['gate'] == 't' and q:    lines.append(f"qc.t(qr[{q[0]}])")
        elif g['gate'] == 'cx' and len(q)>=2:   lines.append(f"qc.cx(qr[{q[0]}], qr[{q[1]}])")
        elif g['gate'] == 'cz' and len(q)>=2:   lines.append(f"qc.cz(qr[{q[0]}], qr[{q[1]}])")
        elif g['gate'] == 'rx' and q and p:      lines.append(f"qc.rx({p[0]}, qr[{q[0]}])")
        elif g['gate'] == 'ry' and q and p:      lines.append(f"qc.ry({p[0]}, qr[{q[0]}])")
        elif g['gate'] == 'rz' and q and p:      lines.append(f"qc.rz({p[0]}, qr[{q[0]}])")
        elif g['gate'] == 'measure' and q:       lines.append(f"qc.measure(qr[{q[0]}], cr[{q[0]}])")
    lines += [
        "",
        f"simulator = AerSimulator()",
        f"job = simulator.run(transpile(qc, simulator), shots={n_shots})",
        "result = job.result()",
        "counts = result.get_counts()",
        "print(counts)",
    ]
    if viz: lines += ["", "qc.draw('mpl')"]
    return "\n".join(lines)

def _to_pennylane(n: int, gates: list, n_shots: int, **kw) -> str:
    lines = [
        "import pennylane as qml",
        "import numpy as np",
        "",
        f"dev = qml.device('default.qubit', wires={n}, shots={n_shots})",
        "",
        "@qml.qnode(dev)",
        "def circuit():",
    ]
    for g in gates:
        q = g['qubits']; p = g['params']
        if g['gate'] == 'h' and q:    lines.append(f"    qml.Hadamard(wires={q[0]})")
        elif g['gate'] == 'x' and q:  lines.append(f"    qml.PauliX(wires={q[0]})")
        elif g['gate'] == 'y' and q:  lines.append(f"    qml.PauliY(wires={q[0]})")
        elif g['gate'] == 'z' and q:  lines.append(f"    qml.PauliZ(wires={q[0]})")
        elif g['gate'] == 's' and q:  lines.append(f"    qml.S(wires={q[0]})")
        elif g['gate'] == 't' and q:  lines.append(f"    qml.T(wires={q[0]})")
        elif g['gate'] == 'cx' and len(q)>=2: lines.append(f"    qml.CNOT(wires=[{q[0]},{q[1]}])")
        elif g['gate'] == 'cz' and len(q)>=2: lines.append(f"    qml.CZ(wires=[{q[0]},{q[1]}])")
        elif g['gate'] == 'rx' and q and p:   lines.append(f"    qml.RX({p[0]}, wires={q[0]})")
        elif g['gate'] == 'ry' and q and p:   lines.append(f"    qml.RY({p[0]}, wires={q[0]})")
        elif g['gate'] == 'rz' and q and p:   lines.append(f"    qml.RZ({p[0]}, wires={q[0]})")
    lines.append(f"    return qml.counts(wires=range({n}))")
    lines += ["", "result = circuit()", "print(result)"]
    return "\n".join(lines)

def _to_cirq(n: int, gates: list, n_shots: int, **kw) -> str:
    lines = [
        "import cirq",
        "import numpy as np",
        "",
        f"qubits = cirq.LineQubit.range({n})",
        "circuit = cirq.Circuit()",
        "",
    ]
    for g in gates:
        q = g['qubits']; p = g['params']
        if g['gate'] == 'h' and q:    lines.append(f"circuit.append(cirq.H(qubits[{q[0]}]))")
        elif g['gate'] == 'x' and q:  lines.append(f"circuit.append(cirq.X(qubits[{q[0]}]))")
        elif g['gate'] == 'y' and q:  lines.append(f"circuit.append(cirq.Y(qubits[{q[0]}]))")
        elif g['gate'] == 'z' and q:  lines.append(f"circuit.append(cirq.Z(qubits[{q[0]}]))")
        elif g['gate'] == 's' and q:  lines.append(f"circuit.append(cirq.S(qubits[{q[0]}]))")
        elif g['gate'] == 't' and q:  lines.append(f"circuit.append(cirq.T(qubits[{q[0]}]))")
        elif g['gate'] == 'cx' and len(q)>=2: lines.append(f"circuit.append(cirq.CNOT(qubits[{q[0]}], qubits[{q[1]}]))")
        elif g['gate'] == 'cz' and len(q)>=2: lines.append(f"circuit.append(cirq.CZ(qubits[{q[0]}], qubits[{q[1]}]))")
        elif g['gate'] == 'rx' and q and p:   lines.append(f"circuit.append(cirq.rx({p[0]})(qubits[{q[0]}]))")
        elif g['gate'] == 'rz' and q and p:   lines.append(f"circuit.append(cirq.rz({p[0]})(qubits[{q[0]}]))")
        elif g['gate'] == 'measure' and q:    lines.append(f"circuit.append(cirq.measure(qubits[{q[0]}], key='q{q[0]}'))")
    lines += [
        "",
        "simulator = cirq.Simulator()",
        f"result = simulator.run(circuit, repetitions={n_shots})",
        "print(result)",
    ]
    return "\n".join(lines)

def _to_braket(n: int, gates: list, n_shots: int, **kw) -> str:
    lines = [
        "from braket.circuits import Circuit",
        "from braket.devices import LocalSimulator",
        "",
        "circuit = Circuit()",
    ]
    for g in gates:
        q = g['qubits']; p = g['params']
        if g['gate'] == 'h' and q:    lines.append(f"circuit.h({q[0]})")
        elif g['gate'] == 'x' and q:  lines.append(f"circuit.x({q[0]})")
        elif g['gate'] == 'cx' and len(q)>=2: lines.append(f"circuit.cnot({q[0]}, {q[1]})")
        elif g['gate'] == 'cz' and len(q)>=2: lines.append(f"circuit.cz({q[0]}, {q[1]})")
        elif g['gate'] == 'rx' and q and p:   lines.append(f"circuit.rx({q[0]}, {p[0]})")
        elif g['gate'] == 'rz' and q and p:   lines.append(f"circuit.rz({q[0]}, {p[0]})")
    lines += [
        "",
        "device = LocalSimulator()",
        f"task = device.run(circuit, shots={n_shots})",
        "result = task.result()",
        "print(result.measurement_counts)",
    ]
    return "\n".join(lines)

GENERATORS = {"qiskit": _to_qiskit, "pennylane": _to_pennylane, "cirq": _to_cirq, "braket": _to_braket}

@router.post("")
def export_code(req: ExportRequest):
    if req.framework not in FRAMEWORKS:
        raise HTTPException(400, f"Unknown framework. Options: {list(FRAMEWORKS.keys())}")
    n, gates = _parse_qasm(req.qasm)
    if n == 0: n = 2
    gen = GENERATORS[req.framework]
    code = gen(n, gates, req.n_shots, backend=req.backend, viz=req.include_visualization, mit=req.add_error_mitigation)
    fw = FRAMEWORKS[req.framework]
    notes = []
    if req.framework == 'cirq' and any(g['gate'] == 't' for g in gates):
        notes.append("T gate is native in Cirq.")
    if req.framework == 'pennylane' and any(g['gate'] == 'measure' for g in gates):
        notes.append("PennyLane uses return statements instead of mid-circuit measurements.")
    return {
        "export_id": str(uuid.uuid4()),
        "framework": req.framework,
        "framework_version": fw["version"],
        "backend": req.backend,
        "n_qubits": n,
        "n_gates": len(gates),
        "code": code,
        "install_command": fw["install"],
        "run_command": "python circuit.py",
        "estimated_run_time_s": round(req.n_shots / 1e5, 3),
        "notes": notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/frameworks")
def list_frameworks():
    return {"frameworks": [{"id": k, "version": v["version"], "install": v["install"]} for k, v in FRAMEWORKS.items()]}
