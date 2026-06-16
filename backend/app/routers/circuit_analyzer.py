"""Circuit Intelligence Analyzer.

Static QASM analysis — no execution required:
  - Gate count by type (Clifford, T, rotation, multi-qubit)
  - Circuit depth (layers of non-commuting gates)
  - T-gate count (non-Clifford resource measure)
  - Non-Clifford ratio
  - Estimated decoherence risk per qubit
  - Optimization opportunities (gate cancellations, commutation)
  - Resource estimate for real QPU execution
"""
from __future__ import annotations

import math
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/analyze", tags=["circuit_analyzer"])

# Approximate gate times in nanoseconds (IBM-like)
GATE_TIMES_NS: dict[str, float] = {
    "h": 50, "x": 50, "y": 50, "z": 0, "s": 0, "sdg": 0, "t": 0, "tdg": 0,
    "sx": 50, "id": 0, "rx": 50, "ry": 50, "rz": 0,
    "cx": 300, "cz": 300, "swap": 900, "ccx": 1200, "cy": 300,
}

# Typical QPU T1 for error budget (in ns)
TYPICAL_T1_NS = 100_000

# Non-Clifford gates (universal quantum computation resource)
NON_CLIFFORD = {"t", "tdg", "rx", "ry", "rz", "u", "u1", "u2", "u3", "p", "cp", "crz", "rzz"}

# Error rates
GATE_ERRORS: dict[str, float] = {
    "h": 0.001, "x": 0.001, "y": 0.001, "z": 0.0001, "s": 0.0001, "sdg": 0.0001,
    "t": 0.001, "tdg": 0.001, "rx": 0.001, "ry": 0.001, "rz": 0.0001,
    "cx": 0.01, "cz": 0.01, "swap": 0.03, "ccx": 0.05,
}


def _parse_gates(qasm: str) -> list[dict[str, Any]]:
    gate_re = re.compile(
        r"^(\w+)(?:\([^)]*\))?\s+(q\[\d+\](?:,q\[\d+\])*)\s*;",
        re.MULTILINE,
    )
    gates = []
    for m in gate_re.finditer(qasm):
        name = m.group(1).lower()
        if name in ("openqasm", "include", "qreg", "creg", "measure", "barrier", "reset"):
            continue
        qubits = [int(q) for q in re.findall(r"q\[(\d+)\]", m.group(2))]
        gates.append({"name": name, "qubits": qubits, "raw": m.group(0)})
    return gates


def _compute_depth(gates: list[dict], n_qubits: int) -> int:
    """Layer depth: place each gate in the earliest layer where none of its qubits are busy."""
    qubit_ready = [0] * n_qubits
    for gate in gates:
        layer = max((qubit_ready[q] for q in gate["qubits"]), default=0)
        next_layer = layer + 1
        for q in gate["qubits"]:
            qubit_ready[q] = next_layer
    return max(qubit_ready) if qubit_ready else 0


def _find_cancellations(gates: list[dict]) -> list[str]:
    """Find adjacent self-inverse gate pairs that cancel."""
    suggestions = []
    self_inverse = {"h", "x", "y", "z", "cx", "swap", "cy", "cz"}
    for i in range(len(gates) - 1):
        g1, g2 = gates[i], gates[i + 1]
        if g1["name"] == g2["name"] and g1["qubits"] == g2["qubits"] and g1["name"] in self_inverse:
            suggestions.append(f"Gate pair {g1['name']}[{g1['qubits']}] at positions {i}–{i+1} cancels (self-inverse)")
    return suggestions[:10]


def _estimate_decoherence_risk(gates: list[dict], n_qubits: int) -> list[dict]:
    qubit_time = [0.0] * n_qubits
    qubit_error = [0.0] * n_qubits
    for gate in gates:
        t = GATE_TIMES_NS.get(gate["name"], 50)
        e = GATE_ERRORS.get(gate["name"], 0.005)
        for q in gate["qubits"]:
            qubit_time[q] += t
            qubit_error[q] += e
    result = []
    for q in range(n_qubits):
        total_ns = qubit_time[q]
        acc_error = qubit_error[q]
        decay_prob = 1 - math.exp(-total_ns / TYPICAL_T1_NS)
        combined_error = 1 - (1 - acc_error) * (1 - decay_prob)
        risk = "critical" if combined_error > 0.5 else "high" if combined_error > 0.2 else "medium" if combined_error > 0.05 else "low"
        result.append({
            "qubit": q, "total_gate_time_ns": round(total_ns),
            "accumulated_gate_error": round(acc_error, 4),
            "t1_decay_probability": round(decay_prob, 4),
            "estimated_qubit_error": round(combined_error, 4),
            "risk_level": risk,
        })
    return result


def analyze_qasm(qasm: str) -> dict[str, Any]:
    n_qubits = 2
    m = re.search(r"qreg\s+\w+\[(\d+)\]", qasm)
    if m:
        n_qubits = int(m.group(1))

    gates = _parse_gates(qasm)
    if not gates:
        raise HTTPException(422, "No gates found in QASM")

    gate_counts: dict[str, int] = {}
    for g in gates:
        gate_counts[g["name"]] = gate_counts.get(g["name"], 0) + 1

    t_count = sum(gate_counts.get(g, 0) for g in ["t", "tdg"])
    non_clifford_count = sum(v for k, v in gate_counts.items() if k in NON_CLIFFORD)
    total_gates = len(gates)
    non_clifford_ratio = non_clifford_count / total_gates if total_gates else 0
    multi_qubit_count = sum(1 for g in gates if len(g["qubits"]) > 1)
    clifford_count = total_gates - non_clifford_count

    depth = _compute_depth(gates, n_qubits)
    qubit_risks = _estimate_decoherence_risk(gates, n_qubits)
    avg_error = sum(q["estimated_qubit_error"] for q in qubit_risks) / max(len(qubit_risks), 1)
    total_time_ns = max((q["total_gate_time_ns"] for q in qubit_risks), default=0)
    cancellations = _find_cancellations(gates)

    # Volume estimate: depth × width
    circuit_volume = depth * n_qubits
    # Resource estimate
    resource = {
        "estimated_execution_time_us": round(total_time_ns / 1000, 2),
        "circuit_volume": circuit_volume,
        "magic_state_cost": t_count,
        "two_qubit_gate_fraction": round(multi_qubit_count / total_gates, 3) if total_gates else 0,
    }

    quality_score = max(0.0, 1.0 - avg_error - non_clifford_ratio * 0.3)

    return {
        "n_qubits": n_qubits, "total_gates": total_gates, "circuit_depth": depth,
        "clifford_gates": clifford_count, "non_clifford_gates": non_clifford_count,
        "non_clifford_ratio": round(non_clifford_ratio, 4), "t_gate_count": t_count,
        "multi_qubit_gates": multi_qubit_count,
        "gate_counts": dict(sorted(gate_counts.items(), key=lambda x: -x[1])),
        "circuit_volume": circuit_volume,
        "quality_score": round(quality_score, 4),
        "avg_qubit_error": round(avg_error, 4),
        "total_gate_time_ns": total_time_ns,
        "per_qubit_risk": qubit_risks,
        "optimization_suggestions": cancellations,
        "resource_estimate": resource,
    }


class AnalyzeRequest(BaseModel):
    qasm: str
    circuit_name: str = ""


@router.post("")
def analyze_circuit(req: AnalyzeRequest):
    result = analyze_qasm(req.qasm)
    return {"circuit_name": req.circuit_name, **result}


@router.post("/batch")
def analyze_batch(requests: list[AnalyzeRequest]):
    if len(requests) > 20:
        raise HTTPException(422, "Max 20 circuits per batch")
    return [{"circuit_name": r.circuit_name, **analyze_qasm(r.qasm)} for r in requests]
