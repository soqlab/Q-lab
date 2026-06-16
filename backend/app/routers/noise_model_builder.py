from __future__ import annotations
import math, uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/noise-model", tags=["noise_model_builder"])

class GateNoise(BaseModel):
    gate: str
    qubits: List[int] = []
    error_type: str = "depolarizing"
    error_rate: float = Field(default=0.001, ge=0, le=1)

class MeasurementNoise(BaseModel):
    qubit: int = 0
    p_meas_error: float = Field(default=0.01, ge=0, le=1)
    p0_given_1: float = Field(default=0.01, ge=0, le=1)
    p1_given_0: float = Field(default=0.01, ge=0, le=1)

class NoiseModelRequest(BaseModel):
    n_qubits: int = Field(default=5, ge=1, le=30)
    hardware_type: str = "superconducting"
    t1_us: float = Field(default=100.0, gt=0)
    t2_us: float = Field(default=80.0, gt=0)
    gate_time_1q_ns: float = Field(default=25.0, gt=0)
    gate_time_2q_ns: float = Field(default=200.0, gt=0)
    readout_fidelity: float = Field(default=0.99, ge=0, le=1)
    custom_gates: List[GateNoise] = []
    custom_measurements: List[MeasurementNoise] = []
    include_crosstalk: bool = False
    crosstalk_strength: float = Field(default=0.001, ge=0, le=0.1)

HARDWARE_TYPES = {
    "superconducting": {"t1_typ": 100, "t2_typ": 80, "gate_1q_ns": 25, "gate_2q_ns": 200},
    "trapped_ion":     {"t1_typ": 1e6, "t2_typ": 1e5, "gate_1q_ns": 10000, "gate_2q_ns": 100000},
    "photonic":        {"t1_typ": float('inf'), "t2_typ": 1e6, "gate_1q_ns": 1, "gate_2q_ns": 100},
    "spin_qubit":      {"t1_typ": 1000, "t2_typ": 500, "gate_1q_ns": 1000, "gate_2q_ns": 5000},
    "neutral_atom":    {"t1_typ": 10000, "t2_typ": 5000, "gate_1q_ns": 500, "gate_2q_ns": 2000},
}

def _relaxation_error(t_gate_ns: float, t1_us: float, t2_us: float) -> Dict:
    t_gate_us = t_gate_ns / 1000.0
    p_relax = 1 - math.exp(-t_gate_us / t1_us)
    p_dephase = 0.5 * (1 - math.exp(-t_gate_us / t2_us))
    total = max(p_relax + p_dephase, 0)
    return {"p_relaxation": round(p_relax, 8), "p_dephasing": round(p_dephase, 8), "p_total": round(total, 8)}

@router.post("")
def build_noise_model(req: NoiseModelRequest):
    n = req.n_qubits
    t1, t2 = req.t1_us, req.t2_us

    err_1q = _relaxation_error(req.gate_time_1q_ns, t1, t2)
    err_2q = _relaxation_error(req.gate_time_2q_ns, t1, t2)

    p_1q = err_1q["p_total"]
    p_2q = err_2q["p_total"]

    # Build per-gate noise table
    gate_error_table = {
        "h":  {"error_rate": round(p_1q, 8), "error_type": "depolarizing+relaxation"},
        "x":  {"error_rate": round(p_1q, 8), "error_type": "depolarizing+relaxation"},
        "y":  {"error_rate": round(p_1q, 8), "error_type": "depolarizing+relaxation"},
        "z":  {"error_rate": round(p_1q * 0.5, 8), "error_type": "dephasing"},
        "s":  {"error_rate": round(p_1q, 8), "error_type": "depolarizing+relaxation"},
        "t":  {"error_rate": round(p_1q * 1.5, 8), "error_type": "depolarizing+relaxation"},
        "cx": {"error_rate": round(p_2q, 8), "error_type": "two_qubit_depolarizing"},
        "cz": {"error_rate": round(p_2q, 8), "error_type": "two_qubit_depolarizing"},
        "rx": {"error_rate": round(p_1q, 8), "error_type": "depolarizing+relaxation"},
        "ry": {"error_rate": round(p_1q, 8), "error_type": "depolarizing+relaxation"},
        "rz": {"error_rate": round(p_1q * 0.3, 8), "error_type": "dephasing"},
    }

    for cg in req.custom_gates:
        gate_error_table[cg.gate] = {"error_rate": cg.error_rate, "error_type": cg.error_type}

    p_meas = 1 - req.readout_fidelity
    measurement_errors = [{"qubit": i, "p_meas_error": round(p_meas + i*0.001, 6), "p0_given_1": round(p_meas/2, 6), "p1_given_0": round(p_meas/2, 6)} for i in range(n)]
    for cm in req.custom_measurements:
        if cm.qubit < n:
            measurement_errors[cm.qubit] = {"qubit": cm.qubit, "p_meas_error": cm.p_meas_error, "p0_given_1": cm.p0_given_1, "p1_given_0": cm.p1_given_0}

    crosstalk = []
    if req.include_crosstalk:
        for i in range(n-1):
            crosstalk.append({"qubit_a": i, "qubit_b": i+1, "strength": req.crosstalk_strength})

    # Total circuit fidelity estimate for depth-10 circuit
    d = 10
    n_1q_gates = n * d; n_2q_gates = (n-1) * (d//2)
    avg_fidelity = (1-p_1q)**n_1q_gates * (1-p_2q)**n_2q_gates * req.readout_fidelity**n
    qv_estimate = 1
    while avg_fidelity > 0.5 and qv_estimate < n:
        qv_estimate *= 2; avg_fidelity *= (1-p_1q)**3 * (1-p_2q)

    qasm_noise_pragma = f"// Noise model for {req.hardware_type}\n// T1={t1}us, T2={t2}us\n// Apply depolarizing({p_1q:.2e}) after each 1Q gate\n// Apply depolarizing({p_2q:.2e}) after each 2Q gate"

    return {
        "model_id": str(uuid.uuid4()),
        "n_qubits": n,
        "hardware_type": req.hardware_type,
        "t1_us": t1,
        "t2_us": t2,
        "gate_time_1q_ns": req.gate_time_1q_ns,
        "gate_time_2q_ns": req.gate_time_2q_ns,
        "readout_fidelity": req.readout_fidelity,
        "gate_error_1q": err_1q,
        "gate_error_2q": err_2q,
        "gate_error_table": gate_error_table,
        "measurement_errors": measurement_errors,
        "crosstalk_terms": crosstalk,
        "estimated_circuit_fidelity_d10": round(avg_fidelity, 6),
        "estimated_qv_lower_bound": qv_estimate,
        "dominant_error_source": "relaxation" if p_1q > p_meas else "measurement",
        "qasm_noise_pragma": qasm_noise_pragma,
        "compatible_backends": ["qiskit-aer", "cirq", "pyquil-quilc"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/hardware-types")
def list_hardware():
    return {"hardware_types": [{"id": k, **{kk: str(vv) for kk, vv in v.items()}} for k, v in HARDWARE_TYPES.items()]}
