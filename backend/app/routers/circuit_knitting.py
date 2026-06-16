from __future__ import annotations
import math, uuid, random
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/circuit-knitting", tags=["circuit_knitting"])

class KnittingRequest(BaseModel):
    n_qubits: int = Field(default=8, ge=2, le=30)
    n_subcircuits: int = Field(default=2, ge=2, le=6)
    cuts_type: str = "gate_cut"
    n_shots: int = Field(default=4096, ge=100, le=65536)
    n_qubits_per_fragment: Optional[int] = None
    noise_level: float = Field(default=0.001, ge=0, le=0.1)
    reconstruction_method: str = "quasi_prob"
    circuit_depth: int = Field(default=10, ge=1, le=50)

RECONSTRUCTION_METHODS = {
    "quasi_prob": "Quasi-probability decomposition (QPD) — handles gate cuts exactly at cost 4^k overhead",
    "tensor": "Tensor network reconstruction — efficient for low-entanglement cuts",
    "direct": "Direct sampling — approximate but fast, suitable for small circuits",
}

@router.post("")
def run_knitting(req: KnittingRequest):
    rng = random.Random(42)
    n = req.n_qubits
    k = req.n_subcircuits
    frags = req.n_qubits_per_fragment or (n // k)
    rem = n - frags * (k - 1)
    frag_sizes = [frags] * (k-1) + [rem]
    n_cuts = k - 1

    # Overhead analysis
    if req.cuts_type == "gate_cut":
        overhead_factor = 4 ** n_cuts
        n_circuit_instances = 6 * n_cuts  # 6 QPD basis terms per cut
        sampling_overhead = overhead_factor
    elif req.cuts_type == "wire_cut":
        overhead_factor = 16 ** n_cuts
        n_circuit_instances = 4 * n_cuts
        sampling_overhead = overhead_factor
    else:
        overhead_factor = 4 ** n_cuts
        n_circuit_instances = 4
        sampling_overhead = overhead_factor

    n_shots_per_instance = req.n_shots
    total_shots = n_shots_per_instance * n_circuit_instances
    effective_shots = total_shots / overhead_factor

    # Estimate noise in each fragment
    n_gates_per_fragment = (req.circuit_depth * frags * 3) // 2
    frag_fidelity = (1 - req.noise_level) ** n_gates_per_fragment

    # Full circuit would have n_full_gates
    n_full_gates = req.circuit_depth * n * 3 // 2
    full_fidelity = (1 - req.noise_level) ** n_full_gates

    knitting_advantage = frag_fidelity / max(full_fidelity, 1e-12)

    # Reconstruct mock observable expectation value
    true_ev = rng.uniform(-1, 1)
    shot_noise = 1.0 / math.sqrt(max(effective_shots, 1))
    estimated_ev = true_ev + rng.gauss(0, shot_noise * overhead_factor**0.5)
    reconstruction_error = abs(estimated_ev - true_ev)

    max_qubits_classical = max(f for f in frag_sizes)
    full_needed = n
    savings_qubits = full_needed - max_qubits_classical

    practical = overhead_factor < 1e6
    if not practical:
        recs = ["Overhead too large — reduce number of cuts to ≤3 for practical QPD"]
    else:
        recs = ["Circuit knitting is feasible with current overhead"]
    if req.noise_level > 0.01:
        recs.append("High noise — knitting may amplify errors via overhead; use error mitigation per fragment")
    if req.reconstruction_method == "quasi_prob" and n_cuts > 3:
        recs.append("Consider tensor network reconstruction for >3 cuts")

    return {
        "knitting_id": str(uuid.uuid4()),
        "n_qubits": n,
        "n_subcircuits": k,
        "n_cuts": n_cuts,
        "cuts_type": req.cuts_type,
        "reconstruction_method": req.reconstruction_method,
        "fragment_sizes": frag_sizes,
        "max_fragment_qubits": max_qubits_classical,
        "qubit_savings": savings_qubits,
        "n_circuit_instances": n_circuit_instances,
        "total_shots_required": total_shots,
        "effective_shots": round(effective_shots, 0),
        "overhead_factor": overhead_factor,
        "sampling_overhead": sampling_overhead,
        "fragment_fidelity": round(frag_fidelity, 6),
        "full_circuit_fidelity": round(full_fidelity, 6),
        "fidelity_improvement": round(knitting_advantage, 4),
        "estimated_expectation_value": round(estimated_ev, 6),
        "reconstruction_error_estimate": round(reconstruction_error, 6),
        "practical_feasibility": practical,
        "method_description": RECONSTRUCTION_METHODS.get(req.reconstruction_method, ""),
        "recommendations": recs,
        "interpretation": f"{n_cuts} cuts decompose the {n}-qubit circuit into {k} fragments of ≤{max_qubits_classical} qubits each, requiring {overhead_factor}× overhead in sampling.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/methods")
def list_methods():
    return {"methods": [{"id": k, "description": v} for k, v in RECONSTRUCTION_METHODS.items()]}
