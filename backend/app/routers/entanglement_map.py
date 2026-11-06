"""Entanglement map: how entanglement builds up, layer by layer, in the ideal state of a circuit.

After each layer of the circuit (Qiskit's DAG layers) the exact statevector is computed, and from it
each qubit's entanglement entropy S(rho_q) with the rest of the register, in bits, and the mutual
information I(a:b) = S_a + S_b - S_ab of every pair. A pair counts as entangled-correlated when its
mutual information is above 1e-6. Nothing is sampled or estimated.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..exact_state import METHOD, reduced, unitary_circuit, von_neumann

router = APIRouter(prefix="/api/v1/entanglement-map", tags=["entanglement_map"])

MAX_QUBITS = 10
MAX_LAYERS = 40
MI_THRESHOLD = 1e-6


class EntanglementMapRequest(BaseModel):
    qasm: str = Field(min_length=1, max_length=200_000)
    # Kept for older clients; the qubit count comes from the circuit itself.
    n_qubits: Optional[int] = None


def _gate_text(circuit, inst) -> str:
    qubits = ",".join(f"q[{circuit.find_bit(q).index}]" for q in inst.qubits)
    params = getattr(inst.operation, "params", []) or []
    shown = "(" + ",".join(f"{float(p):.4g}" for p in params) + ")" if params and all(
        isinstance(p, (int, float)) for p in params) else ""
    return f"{inst.operation.name}{shown} {qubits}"


def _analyse(state, n: int) -> tuple[list[float], list[tuple[int, int]]]:
    """Each qubit's entropy, and the pairs with non-zero mutual information."""
    singles = [von_neumann(reduced(state, n, {q})) for q in range(n)]
    pairs = []
    for a in range(n):
        for b in range(a + 1, n):
            if singles[a] > MI_THRESHOLD and singles[b] > MI_THRESHOLD:
                if singles[a] + singles[b] - von_neumann(reduced(state, n, {a, b})) > MI_THRESHOLD:
                    pairs.append((a, b))
    return singles, pairs


@router.post("")
def map_entanglement(req: EntanglementMapRequest):
    from qiskit.converters import circuit_to_dag, dag_to_circuit
    from qiskit.quantum_info import Statevector

    try:
        circuit = unitary_circuit(req.qasm, MAX_QUBITS)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    n = circuit.num_qubits
    if n < 2:
        raise HTTPException(status_code=422, detail="Entanglement needs at least two qubits.")

    layers = [dag_to_circuit(layer["graph"]) for layer in circuit_to_dag(circuit).layers()]
    state = Statevector.from_label("0" * n)
    layer_maps = []
    max_entropy = 0.0
    for depth, layer in enumerate(layers):
        state = state.evolve(layer)
        if depth >= MAX_LAYERS:
            continue
        singles, pairs = _analyse(state, n)
        qubit_entanglement = [{
            "qubit": q,
            "entropy": round(singles[q], 6),
            "is_entangled": singles[q] > MI_THRESHOLD,
            "n_entangled_partners": sum(1 for p in pairs if q in p),
        } for q in range(n)]
        max_entropy = max(max_entropy, *singles)
        layer_maps.append({
            "depth": depth,
            "gates": [_gate_text(layer, i) for i in layer.data],
            "qubit_entanglement": qubit_entanglement,
            "total_entropy": round(sum(singles), 6),
            "entangled_pairs": [{"q1": a, "q2": b} for a, b in pairs],
        })

    final_singles, final_pairs = _analyse(state, n)
    return {
        "map_id": f"emap-{uuid.uuid4().hex[:12]}",
        "n_qubits": n,
        "n_layers": len(layers),
        "n_layers_displayed": len(layer_maps),
        "layers": layer_maps,
        "max_entropy_observed": round(max_entropy, 6),
        # A single qubit's entropy is at most 1 bit (maximally entangled with the rest).
        "max_possible_entropy": 1.0,
        "entanglement_fraction": round(max_entropy, 6),
        "final_entangled_pairs": [{"q1": a, "q2": b} for a, b in final_pairs],
        "n_entangled_pairs": len(final_pairs),
        "is_fully_entangled": all(s > MI_THRESHOLD for s in final_singles),
        "method": METHOD,
        "source": "Your circuit, simulated exactly. Not a measurement of hardware.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
