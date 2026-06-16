"""Clifford + T Resource Counter — decomposes circuits and counts fault-tolerant resources."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/clifford-t", tags=["clifford_t"])

CLIFFORD_1Q = {"h", "x", "y", "z", "s", "sdg", "sx", "sxdg", "id"}
CLIFFORD_2Q = {"cx", "cy", "cz", "swap", "iswap"}
T_GATES = {"t", "tdg"}
NON_CLIFFORD_1Q = {"rx", "ry", "rz", "u1", "u2", "u3", "p"}

SYNTH_COST = {
    "rx": {"t_count": 4, "t_depth": 3},
    "ry": {"t_count": 4, "t_depth": 3},
    "rz": {"t_count": 4, "t_depth": 3},
    "u1": {"t_count": 4, "t_depth": 3},
    "u2": {"t_count": 8, "t_depth": 6},
    "u3": {"t_count": 8, "t_depth": 6},
    "p": {"t_count": 4, "t_depth": 3},
}


def _classify(line: str) -> dict:
    s = line.strip().rstrip(";")
    gate = s.split()[0].split("(")[0].lower() if s else ""
    if gate in T_GATES:
        return {"gate": gate, "type": "T", "t_count": 1, "clifford": False}
    if gate in CLIFFORD_1Q:
        return {"gate": gate, "type": "Clifford-1Q", "t_count": 0, "clifford": True}
    if gate in CLIFFORD_2Q:
        return {"gate": gate, "type": "Clifford-2Q", "t_count": 0, "clifford": True}
    if gate in NON_CLIFFORD_1Q:
        cost = SYNTH_COST.get(gate, {"t_count": 4, "t_depth": 3})
        return {"gate": gate, "type": "Non-Clifford", "t_count": cost["t_count"], "clifford": False}
    return {"gate": gate, "type": "Unknown", "t_count": 0, "clifford": True}


class CliffordTRequest(BaseModel):
    qasm: str


@router.post("")
def analyze_clifford_t(req: CliffordTRequest):
    lines = [l.strip() for l in req.qasm.split("\n")
             if l.strip() and not l.strip().startswith(("OPENQASM", "include", "//", "qreg", "creg", "measure"))]

    gate_analysis = [_classify(l) for l in lines]
    total_gates = len(gate_analysis)
    t_count = sum(g["t_count"] for g in gate_analysis)
    clifford_count = sum(1 for g in gate_analysis if g["clifford"])
    non_clifford_types = list({g["gate"] for g in gate_analysis if g["type"] == "Non-Clifford"})
    t_gate_ratio = round(t_count / max(total_gates, 1), 4)

    magic_state_cost = t_count * 15
    distillation_overhead = t_count * 115
    code_distance = 7 if t_count > 100 else (5 if t_count > 20 else 3)

    recs = []
    if t_count == 0:
        recs.append("Circuit is Clifford-only — efficiently simulable classically (Gottesman-Knill theorem)")
    if t_count > 50:
        recs.append(f"High T-count ({t_count}): consider T-gate cancellation via PyZX or T-par optimizer")
    if len(non_clifford_types) > 2:
        recs.append("Multiple non-Clifford types: decompose to Rz(π/4k) rotations first for better T-count bounds")
    if t_gate_ratio > 0.3:
        recs.append("T-ratio > 30%: circuit is deeply non-Clifford; fault-tolerant overhead will be large")

    return {
        "resource_id": f"ct-{uuid.uuid4().hex[:12]}",
        "total_gates": total_gates,
        "t_count": t_count,
        "clifford_count": clifford_count,
        "non_clifford_gate_types": non_clifford_types,
        "t_gate_ratio": t_gate_ratio,
        "is_clifford_only": t_count == 0,
        "estimated_magic_states": magic_state_cost,
        "distillation_overhead_gates": distillation_overhead,
        "recommended_code_distance": code_distance,
        "total_physical_gates_ftqc": clifford_count + magic_state_cost,
        "gate_type_counts": {
            "T_gates": sum(1 for g in gate_analysis if g["type"] == "T"),
            "Clifford_1Q": sum(1 for g in gate_analysis if g["type"] == "Clifford-1Q"),
            "Clifford_2Q": sum(1 for g in gate_analysis if g["type"] == "Clifford-2Q"),
            "Non_Clifford": sum(1 for g in gate_analysis if g["type"] == "Non-Clifford"),
        },
        "gate_breakdown": gate_analysis[:40],
        "recommendations": recs,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
