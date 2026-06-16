from __future__ import annotations
import math, uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/quantum-sensing", tags=["quantum_sensing"])

SENSING_PROTOCOLS = {
    "ramsey":   {"desc": "Ramsey interferometry — phase accumulation between two pi/2 pulses"},
    "spin_echo":{"desc": "Hahn spin echo — pi pulse cancels static inhomogeneities"},
    "xy8":      {"desc": "XY-8 dynamical decoupling — periodic pi pulses extend T2 4-8x"},
    "ghz":      {"desc": "GHZ entangled probe — Heisenberg limit scaling 1/N"},
    "adaptive": {"desc": "Adaptive phase estimation — Kitaev-style iterative refinement"},
}

SENSOR_TYPES = {
    "nv_center":     {"t2_us": 100.0, "sensitivity_fT": 50.0, "application": "DC/AC magnetic field sensing"},
    "atom_interferometer": {"t2_us": 1e6, "sensitivity_fT": 0.1, "application": "Gravimetry, inertial navigation"},
    "optical_clock": {"t2_us": 1e8, "sensitivity_fT": 0.001, "application": "Timekeeping, geodesy"},
    "squid":         {"t2_us": 10.0, "sensitivity_fT": 1.0, "application": "Low-field MRI, MEG"},
    "qubit_array":   {"t2_us": 80.0, "sensitivity_fT": 10.0, "application": "On-chip field imaging"},
}

class SensingRequest(BaseModel):
    protocol: str = "ramsey"
    sensor_type: str = "nv_center"
    n_sensors: int = Field(default=1, ge=1, le=100)
    n_repetitions: int = Field(default=1000, ge=1, le=100000)
    interrogation_time_us: float = Field(default=10.0, gt=0, le=1000.0)
    total_time_us: float = Field(default=1000.0, gt=0)
    signal_frequency_MHz: float = Field(default=1.0, gt=0)
    use_entanglement: bool = False
    t1_us: float = Field(default=1000.0, gt=0)
    t2_us: Optional[float] = None

@router.post("")
def run_sensing(req: SensingRequest):
    sensor = SENSOR_TYPES.get(req.sensor_type, SENSOR_TYPES["nv_center"])
    t2 = req.t2_us or sensor["t2_us"]
    t1 = req.t1_us
    T = min(req.interrogation_time_us, t2)
    n = req.n_sensors
    N_rep = req.n_repetitions

    # SQL (standard quantum limit)
    sql_sensitivity = 1.0 / (math.sqrt(N_rep) * T * math.sqrt(n))
    # HL (Heisenberg limit) with N-qubit GHZ
    hl_sensitivity = 1.0 / (math.sqrt(N_rep) * T * n)

    if req.protocol == "xy8":
        t2_effective = t2 * 6.0
        T = min(req.interrogation_time_us, t2_effective)
    elif req.protocol == "adaptive":
        N_rep_eff = N_rep * math.log2(N_rep) if N_rep > 1 else N_rep
        sql_sensitivity = 1.0 / (math.sqrt(N_rep_eff) * T * math.sqrt(n))
    elif req.protocol == "ghz" and req.use_entanglement:
        sql_sensitivity = hl_sensitivity

    sensitivity_phase = sql_sensitivity  # rad / sqrt(Hz)
    sensitivity_freq_Hz = sql_sensitivity / (2 * math.pi * T * 1e-6) if T > 0 else 0

    # Decoherence impact
    decay_factor = math.exp(-T / t2) * math.exp(-T / (2*t1))
    effective_sensitivity = sensitivity_phase / max(decay_factor, 1e-12)

    # Fisher information
    classical_fi = N_rep / (1/(4 * T**2 * n))
    quantum_fi = N_rep / (1/(4 * T**2 * n**2)) if req.use_entanglement else classical_fi
    qfi_advantage = quantum_fi / max(classical_fi, 1e-12)

    duty_cycle = T / (req.total_time_us / N_rep) if N_rep > 0 else 0
    duty_cycle = min(1.0, duty_cycle)

    # SNR at signal frequency
    signal_amp = 1e-9  # 1 nT
    snr = signal_amp * decay_factor / max(effective_sensitivity, 1e-30)

    # Sensitivity in T/sqrt(Hz)
    sens_T_per_rtHz = sensor["sensitivity_fT"] * 1e-15 / math.sqrt(max(N_rep, 1))
    if req.use_entanglement: sens_T_per_rtHz /= math.sqrt(n)

    return {
        "sensing_id": str(uuid.uuid4()),
        "protocol": req.protocol,
        "sensor_type": req.sensor_type,
        "n_sensors": n,
        "n_repetitions": N_rep,
        "interrogation_time_us": round(T, 4),
        "t1_us": t1,
        "t2_us": t2,
        "signal_frequency_MHz": req.signal_frequency_MHz,
        "use_entanglement": req.use_entanglement,
        "sql_sensitivity_phase": round(sql_sensitivity, 10),
        "hl_sensitivity_phase": round(hl_sensitivity, 10),
        "effective_sensitivity": round(effective_sensitivity, 10),
        "sensitivity_freq_Hz": round(sensitivity_freq_Hz, 6),
        "sensitivity_T_per_rtHz": round(sens_T_per_rtHz * 1e15, 4),  # in fT/sqrt(Hz)
        "decoherence_factor": round(decay_factor, 6),
        "classical_fisher_info": round(classical_fi, 4),
        "quantum_fisher_info": round(quantum_fi, 4),
        "qfi_advantage_over_classical": round(qfi_advantage, 4),
        "duty_cycle": round(duty_cycle, 4),
        "snr_estimate": round(min(snr, 1e12), 4),
        "scaling_type": "Heisenberg (1/N)" if req.use_entanglement else "Standard Quantum Limit (1/√N)",
        "protocol_description": SENSING_PROTOCOLS.get(req.protocol, {}).get("desc", ""),
        "sensor_application": sensor.get("application", ""),
        "beats_classical": decay_factor > 0.5 and (req.use_entanglement and n > 1),
        "recommendations": [
            f"Use T={round(t2*0.5,1)}µs interrogation (T2/2 optimum)" if T < t2*0.3 else "Interrogation time is near T2 optimum",
            "Enable entanglement to reach Heisenberg limit" if not req.use_entanglement and n > 1 else "Entanglement active — approaching Heisenberg limit",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/protocols")
def list_protocols():
    return {"protocols": [{"id": k, "description": v["desc"]} for k, v in SENSING_PROTOCOLS.items()]}

@router.get("/sensors")
def list_sensors():
    return {"sensors": [{"id": k, **v} for k, v in SENSOR_TYPES.items()]}
