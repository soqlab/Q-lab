from __future__ import annotations
import math, uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/channel-capacity", tags=["channel_capacity"])

CHANNELS = {
    "depolarizing":    {"desc": "p_err → single qubit depolarizing channel (4/3)*p"},
    "amplitude_damp":  {"desc": "γ → amplitude damping (T1 decay)"},
    "phase_damp":      {"desc": "λ → phase/dephasing (T2 decay)"},
    "erasure":         {"desc": "ε → qubit erasure with probability ε"},
    "pauli":           {"desc": "px, py, pz → general Pauli noise channel"},
}

class ChannelRequest(BaseModel):
    channel: str = "depolarizing"
    p_err: float = Field(default=0.05, ge=0, le=1)
    gamma: float = Field(default=0.1, ge=0, le=1)
    lam: float = Field(default=0.1, ge=0, le=1)
    epsilon: float = Field(default=0.1, ge=0, le=1)
    px: float = Field(default=0.01, ge=0, le=1)
    py: float = Field(default=0.01, ge=0, le=1)
    pz: float = Field(default=0.03, ge=0, le=1)
    n_uses: int = Field(default=100, ge=1, le=10000)
    uses_entanglement: bool = True
    compute_quantum_cap: bool = True

def _h(p: float) -> float:
    if p <= 0 or p >= 1: return 0.0
    return -p*math.log2(p) - (1-p)*math.log2(1-p)

@router.post("")
def analyze_channel(req: ChannelRequest):
    ch = req.channel

    if ch == "depolarizing":
        p = req.p_err
        ep = 4*p/3
        classical_cap = 1 - _h(ep)
        quantum_cap = max(0.0, 1 - 2*_h(p))
        entanglement_assisted = 2 - _h(p)
        coherent_info = 1 - _h(p)
        error_rates = {"X": p/3, "Y": p/3, "Z": p/3}
        fidelity = 1 - p

    elif ch == "amplitude_damp":
        g = req.gamma
        classical_cap = max(0.0, 1 - _h(g))
        quantum_cap = max(0.0, 1 - _h(g) - g)
        entanglement_assisted = 1 + (1-g)*math.log2(1-g) if g < 1 else 0
        coherent_info = max(0.0, 1 - _h(g))
        error_rates = {"amplitude_damp": g}
        fidelity = 1 - g/2

    elif ch == "phase_damp":
        l = req.lam
        classical_cap = 1.0
        quantum_cap = max(0.0, 1 - _h(l/2))
        entanglement_assisted = 2 - _h(l)
        coherent_info = quantum_cap
        error_rates = {"Z": l}
        fidelity = 1 - l/2

    elif ch == "erasure":
        e = req.epsilon
        classical_cap = (1-e)
        quantum_cap = max(0.0, 1 - 2*e)
        entanglement_assisted = 2*(1-e)
        coherent_info = max(0.0, 1 - 2*e)
        error_rates = {"erasure": e}
        fidelity = 1 - e

    else:  # pauli
        px, py, pz = req.px, req.py, req.pz
        p0 = 1 - px - py - pz
        hs = sum(-q*math.log2(q) for q in [p0, px, py, pz] if q > 1e-12)
        classical_cap = max(0.0, 1 - hs)
        quantum_cap = max(0.0, 1 - 2*hs)
        entanglement_assisted = 2 - hs
        coherent_info = max(0.0, 1 - hs)
        error_rates = {"X": px, "Y": py, "Z": pz}
        fidelity = 1 - px - py - pz

    n = req.n_uses
    total_bits = classical_cap * n
    total_qubits = quantum_cap * n
    total_ebits = (entanglement_assisted - classical_cap) * n if req.uses_entanglement else 0.0

    overhead = 1/max(quantum_cap, 1e-9) if quantum_cap > 0 else float('inf')
    threshold = None
    if ch in ("depolarizing", "erasure"):
        threshold = 0.5 if ch == "erasure" else 0.25

    return {
        "cap_id": str(uuid.uuid4()),
        "channel": ch,
        "classical_capacity_bits_per_use": round(classical_cap, 6),
        "quantum_capacity_qubits_per_use": round(quantum_cap, 6),
        "entanglement_assisted_capacity": round(entanglement_assisted, 6),
        "coherent_information": round(coherent_info, 6),
        "fidelity": round(fidelity, 6),
        "error_rates": {k: round(v, 6) for k, v in error_rates.items()},
        "n_uses": n,
        "total_classical_bits": round(total_bits, 2),
        "total_quantum_bits": round(total_qubits, 2),
        "total_ebits_needed": round(total_ebits, 2),
        "error_correction_overhead": round(overhead, 2) if overhead != float('inf') else None,
        "hashing_bound": round(quantum_cap, 6),
        "threshold_error_rate": threshold,
        "above_threshold": (req.p_err < threshold) if threshold is not None else None,
        "superadditivity_possible": quantum_cap > coherent_info,
        "interpretation": f"Channel transmits {round(classical_cap,3)} classical bits/use, {round(quantum_cap,3)} qubits/use (coherent). Entanglement assistance boosts this to {round(entanglement_assisted,3)} bits/use.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/channels")
def list_channels():
    return {"channels": [{"id": k, "desc": v["desc"]} for k, v in CHANNELS.items()]}
