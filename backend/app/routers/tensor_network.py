"""Tensor network (MPS) view of a circuit's exact state.

The exact statevector of the circuit is split at every cut between neighbouring qubits by SVD
(the Schmidt decomposition). That gives, per bond, the true Schmidt coefficients, the entanglement
entropy and the exact bond dimension (Schmidt rank). Truncating to the requested maximum bond
dimension gives the discarded weight, and memory figures follow from the bond dimensions.
Nothing is estimated from circuit structure or randomised. Limited to MAX_QUBITS qubits, because
the statevector itself is built.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..exact_state import unitary_circuit

router = APIRouter(prefix="/api/v1/tensor-network", tags=["tensor_network"])

MAX_QUBITS = 20
ZERO = 1e-12
METHOD = ("Exact statevector of the circuit, split by SVD at each cut between qubits i and i+1 "
          "(Schmidt decomposition). Entropies in nats; bond dimension = Schmidt rank.")


class TensorNetworkRequest(BaseModel):
    qasm: str = Field(min_length=1, max_length=200_000)
    max_bond_dim: int = Field(default=64, ge=1, le=1 << 10)
    # Kept for older clients; the qubit count comes from the circuit and SVD is always used.
    n_qubits: Optional[int] = None
    decompose_method: Optional[str] = None
    method: Optional[str] = None
    seed: Optional[int] = None


def schmidt_spectra(state, n: int) -> List[List[float]]:
    """Squared Schmidt coefficients at each cut (qubits 0..i | i+1..n-1), largest first."""
    import numpy as np

    psi = np.asarray(state.data)
    spectra = []
    for i in range(n - 1):
        # Qiskit is little-endian: qubit 0 is the least significant index bit, so the low
        # 2^(i+1) part of the index is qubits 0..i.
        matrix = psi.reshape(2 ** (n - i - 1), 2 ** (i + 1))
        s = np.linalg.svd(matrix, compute_uv=False)
        spectra.append([float(v) for v in (s ** 2) if v * v > ZERO])
    return spectra


def _ascii_mps(n: int, bond_dims: List[int]) -> str:
    nodes = "--".join(f"[T{i}]" + (f"-D{bond_dims[i]}" if i < n - 1 else "") for i in range(n))
    return "MPS (D = bond dimension after truncation):\n" + nodes


@router.post("")
def run_tensor_network(req: TensorNetworkRequest):
    from qiskit.quantum_info import Statevector

    try:
        circuit = unitary_circuit(req.qasm, MAX_QUBITS)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    n = circuit.num_qubits
    if n < 2:
        raise HTTPException(status_code=422, detail="A tensor network needs at least two qubits.")

    spectra = schmidt_spectra(Statevector(circuit), n)
    exact_dims = [len(lam) for lam in spectra]
    bond_dims = [min(d, req.max_bond_dim) for d in exact_dims]
    discarded = [sum(lam[d:]) for lam, d in zip(spectra, bond_dims)]
    entropies = [-sum(p * math.log(p) for p in lam) for lam in spectra]

    mem_exact = 2 ** n * 16  # complex128 statevector
    mem_mps = sum(2 * (bond_dims[i - 1] if i > 0 else 1) * (bond_dims[i] if i < n - 1 else 1) * 16
                  for i in range(n))
    fits = all(d <= req.max_bond_dim for d in exact_dims)
    return {
        "tn_id": f"tn-{uuid.uuid4().hex[:12]}",
        "n_qubits": n,
        "n_tensors": n,
        "max_bond_dim_actual": max(bond_dims),
        "max_bond_dim_exact": max(exact_dims),
        "max_bond_dim_requested": req.max_bond_dim,
        "bond_dimensions": bond_dims,
        "exact_bond_dimensions": exact_dims,
        "entanglement_entropies": [round(s, 6) for s in entropies],
        "schmidt_coefficients": [[round(p, 6) for p in lam[:4]] for lam in spectra],
        # Discarded weight (sum of dropped squared Schmidt coefficients), worst bond.
        "truncation_error": round(max(discarded), 10),
        "compression_ratio": round(mem_exact / max(mem_mps, 1), 2),
        "memory_bytes_exact": mem_exact,
        "memory_bytes_mps": mem_mps,
        "memory_savings_pct": round((1 - mem_mps / mem_exact) * 100, 2),
        "fits_bond_dim": fits,
        # One state cannot show how entanglement scales with size, so no area/volume-law verdict.
        "is_area_law": None,
        "is_volume_law": None,
        "decompose_method": "svd",
        "method": METHOD,
        "network_diagram": _ascii_mps(n, bond_dims),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/methods")
def list_methods():
    return [{"method_id": "svd", "name": "Singular value decomposition",
             "description": "Exact Schmidt decomposition of the statevector at each cut; truncation keeps the "
                            "largest Schmidt coefficients.", "complexity": "O(2^n) memory: exact statevector"}]
