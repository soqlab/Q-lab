"""Noise-Aware Qubit Router — optimal qubit assignment based on backend calibration data."""
from __future__ import annotations
import uuid, re
from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/noise-router", tags=["noise_router"])

BACKENDS = {
    "ibm_nairobi": {
        "n_qubits": 7,
        "qubits": [
            {"t1": 120, "t2":  95, "gate_error_1q": 0.0012, "readout_error": 0.025},
            {"t1":  98, "t2":  72, "gate_error_1q": 0.0021, "readout_error": 0.031},
            {"t1": 145, "t2": 110, "gate_error_1q": 0.0008, "readout_error": 0.018},
            {"t1":  88, "t2":  65, "gate_error_1q": 0.0035, "readout_error": 0.042},
            {"t1": 132, "t2": 108, "gate_error_1q": 0.0014, "readout_error": 0.022},
            {"t1":  76, "t2":  58, "gate_error_1q": 0.0028, "readout_error": 0.038},
            {"t1": 115, "t2":  90, "gate_error_1q": 0.0018, "readout_error": 0.028},
        ],
        "coupling_map": [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]],
    },
    "ibm_oslo": {
        "n_qubits": 7,
        "qubits": [
            {"t1": 200, "t2": 150, "gate_error_1q": 0.0005, "readout_error": 0.015},
            {"t1": 180, "t2": 140, "gate_error_1q": 0.0007, "readout_error": 0.018},
            {"t1": 220, "t2": 170, "gate_error_1q": 0.0004, "readout_error": 0.012},
            {"t1": 160, "t2": 120, "gate_error_1q": 0.0009, "readout_error": 0.022},
            {"t1": 210, "t2": 165, "gate_error_1q": 0.0006, "readout_error": 0.016},
            {"t1": 150, "t2": 115, "gate_error_1q": 0.0011, "readout_error": 0.025},
            {"t1": 195, "t2": 148, "gate_error_1q": 0.0008, "readout_error": 0.019},
        ],
        "coupling_map": [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6]],
    },
    "ionq_aria": {
        "n_qubits": 11,
        "qubits": [{"t1": 10000, "t2": 1000, "gate_error_1q": 0.0002, "readout_error": 0.005}] * 11,
        "coupling_map": [[i, j] for i in range(11) for j in range(i + 1, 11)],
    },
}


def _cost(q: dict) -> float:
    return 100 / max(q["t1"], 1) + 100 / max(q["t2"], 1) + q["gate_error_1q"] * 100 + q["readout_error"] * 10


class NoiseRouterRequest(BaseModel):
    qasm: str
    backend: str = Field(default="ibm_nairobi")


@router.post("")
def route_circuit(req: NoiseRouterRequest):
    profile = BACKENDS.get(req.backend, BACKENDS["ibm_nairobi"])
    qubits = profile["qubits"]

    m = re.search(r"qreg\s+\w+\[(\d+)\]", req.qasm)
    n_logical = int(m.group(1)) if m else 2
    n_physical = profile["n_qubits"]

    cx_pairs = [(int(a), int(b)) for a, b in re.findall(r"cx q\[(\d+)\],q\[(\d+)\]", req.qasm)]

    # Original: sequential 0..n_logical-1
    orig = {i: i for i in range(n_logical)}
    # Optimized: assign to lowest-cost physical qubits
    sorted_phys = sorted(range(min(len(qubits), n_physical)), key=lambda i: _cost(qubits[i]))
    opt = {lq: sorted_phys[min(lq, len(sorted_phys) - 1)] for lq in range(n_logical)}

    # Remap QASM
    def remap(line: str) -> str:
        if line.strip().startswith(("OPENQASM", "include", "//", "qreg", "creg", "measure")):
            return line
        return re.sub(r"q\[(\d+)\]", lambda m2: f"q[{opt.get(int(m2.group(1)), int(m2.group(1)))}]", line)

    optimized_qasm = "\n".join(remap(l) for l in req.qasm.split("\n"))

    orig_cost = sum(_cost(qubits[min(v, len(qubits)-1)]) for v in orig.values())
    opt_cost = sum(_cost(qubits[min(v, len(qubits)-1)]) for v in opt.values())
    error_reduction = round(max(0.0, (orig_cost - opt_cost) / max(orig_cost, 0.01)), 4)

    qubit_analysis = []
    for lq in range(n_logical):
        oq = qubits[min(orig[lq], len(qubits)-1)]
        aq = qubits[min(opt[lq], len(qubits)-1)]
        qubit_analysis.append({
            "logical_qubit": lq,
            "original_physical": orig[lq],
            "optimized_physical": opt[lq],
            "original_t1_us": oq["t1"],
            "optimized_t1_us": aq["t1"],
            "original_gate_error": oq["gate_error_1q"],
            "optimized_gate_error": aq["gate_error_1q"],
            "improved": oq["gate_error_1q"] > aq["gate_error_1q"],
        })

    return {
        "route_id": f"nr-{uuid.uuid4().hex[:12]}",
        "backend": req.backend,
        "n_logical_qubits": n_logical,
        "n_physical_qubits": n_physical,
        "n_coupling_gates": len(cx_pairs),
        "original_assignment": orig,
        "optimized_assignment": opt,
        "assignment_changed": orig != opt,
        "expected_error_reduction": error_reduction,
        "expected_fidelity_gain": round(error_reduction * 0.5, 4),
        "qubit_analysis": qubit_analysis,
        "optimized_qasm": optimized_qasm,
        "backend_coupling_map": profile["coupling_map"][:10],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/backends")
def list_backends():
    return [{"id": k, "n_qubits": v["n_qubits"], "coupling_pairs": len(v["coupling_map"])} for k, v in BACKENDS.items()]
