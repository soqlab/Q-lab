from __future__ import annotations
import math, random, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/mirror", tags=["mirror_circuit"])

class MirrorRequest(BaseModel):
    n_qubits: int = Field(default=4, ge=2, le=20)
    circuit_depth: int = Field(default=10, ge=1, le=50)
    n_circuits: int = Field(default=20, ge=1, le=100)
    n_shots: int = Field(default=1024, ge=100, le=65536)
    noise_level: float = Field(default=0.002, ge=0, le=0.1)
    gate_set: str = "clifford"

@router.post("")
def run_mirror(req: MirrorRequest):
    rng = random.Random(42)
    n, d = req.n_qubits, req.circuit_depth
    gate_options_1q = ['h', 's', 'x', 'z']
    gate_options_2q = [('cx', i, (i+1)%n) for i in range(n-1)]

    n_1q_per_layer = n
    n_2q_per_layer = n // 2
    n_gates_per_circuit = (n_1q_per_layer + n_2q_per_layer) * d
    n_total_gates = n_gates_per_circuit * 2  # circuit + mirror

    per_circuit_success = []
    for _ in range(req.n_circuits):
        # Ideal success prob: (1-noise)^total_gates
        p_success_ideal = (1 - req.noise_level) ** n_total_gates
        # Add shot noise
        observed = sum(1 for _ in range(req.n_shots) if rng.random() < p_success_ideal)
        per_circuit_success.append(observed / req.n_shots)

    mean_success = sum(per_circuit_success) / len(per_circuit_success)
    std_success = math.sqrt(sum((x-mean_success)**2 for x in per_circuit_success)/max(len(per_circuit_success)-1,1))

    polarization = mean_success  # Fraction returning |0...0>
    epl = 1 - (mean_success ** (1/(2*d))) if mean_success > 0 else 1.0
    epg = 1 - (mean_success ** (1/n_total_gates)) if mean_success > 0 else 1.0

    elf = (1 - epg) ** n_2q_per_layer  # entangling layer fidelity
    clops = req.n_circuits * req.n_shots / 0.5  # assuming 0.5s total

    grade = 'A' if mean_success > 0.9 else 'B' if mean_success > 0.7 else 'C' if mean_success > 0.5 else 'D' if mean_success > 0.3 else 'F'
    qv_estimate = 2 ** int(math.log2(max(1/(epg*n+1e-9), 1)))

    recs = []
    if epg > 0.01: recs.append("Gate error >1% — implement error mitigation or reduce circuit depth")
    if epl > 0.05: recs.append("High error per layer — check 2-qubit gate calibration")
    if mean_success < 0.5: recs.append("Success probability <50% — circuit may be too deep for current hardware")

    return {
        "mirror_id": str(uuid.uuid4()),
        "n_qubits": n,
        "circuit_depth": d,
        "n_circuits": req.n_circuits,
        "n_shots": req.n_shots,
        "noise_level": req.noise_level,
        "gate_set": req.gate_set,
        "n_gates_per_circuit": n_gates_per_circuit,
        "n_total_gates": n_total_gates,
        "per_circuit_success": [round(x,6) for x in per_circuit_success],
        "mean_success_probability": round(mean_success, 6),
        "std_success_probability": round(std_success, 6),
        "polarization_fidelity": round(polarization, 6),
        "effective_error_per_layer": round(epl, 6),
        "effective_error_per_gate": round(epg, 6),
        "entanglement_layer_fidelity": round(elf, 6),
        "clops_estimate": round(clops, 0),
        "quality_grade": grade,
        "comparison_to_ideal": f"{round(mean_success*100,1)}% of circuits returned |0⟩ (ideal: 100%)",
        "vs_qv_score": qv_estimate,
        "recommendations": recs,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
