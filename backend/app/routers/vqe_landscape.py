"""VQE/QAOA Loss Landscape Explorer — sweeps two parameter dimensions and maps energy."""
from __future__ import annotations
import math, uuid, random
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/landscape-explorer", tags=["vqe_landscape"])


_PRESET_OF = {"ising": "ising_1d", "heisenberg": "heisenberg", "maxcut": "maxcut_ring"}


def _ry(state, n: int, theta: float):
    """Ry(theta) on every qubit of a statevector (bit q of the index is qubit q)."""
    import numpy as np

    c, s_ = np.cos(theta / 2), np.sin(theta / 2)
    t = state.reshape([2] * n)
    for q in range(n):
        axis = n - 1 - q
        a0, a1 = np.take(t, 0, axis=axis), np.take(t, 1, axis=axis)
        t = np.stack([c * a0 - s_ * a1, s_ * a0 + c * a1], axis=axis)
    return t.reshape(-1)


def _cx_chain_permutation(n: int):
    """Index map of CX(0,1) CX(1,2) ... CX(n-2,n-1) acting on basis states."""
    import numpy as np

    idx = np.arange(1 << n)
    out = idx.copy()
    for c in range(n - 1):
        out = np.where((out >> c) & 1, out ^ (1 << (c + 1)), out)
    return out


class LandscapeRequest(BaseModel):
    qasm: str = ""  # ignored: the ansatz is fixed (see explore_landscape)
    hamiltonian: str = Field(default="ising")
    n_qubits: int = Field(default=4, ge=2, le=8)
    param1_range: List[float] = Field(default=[-3.14159, 3.14159])
    param2_range: List[float] = Field(default=[-3.14159, 3.14159])
    grid_size: int = Field(default=20, ge=5, le=50)
    seed: int = 42


@router.post("")
def explore_landscape(req: LandscapeRequest):
    """Exact energy landscape of a fixed two-parameter ansatz on a model Hamiltonian.

    Ansatz: Ry(theta1) on every qubit, a CX chain, Ry(theta2) on every qubit. The Hamiltonian is a
    Hamiltonian Studio preset (transverse-field Ising, Heisenberg XXX or MaxCut ring). Each grid
    point is <psi|H|psi> computed exactly from the statevector; the true ground energy (exact
    diagonalisation) is reported alongside, so the ansatz's best value can be judged against it.
    """
    import numpy as np
    from fastapi import HTTPException

    from .hamiltonian_studio import PRESETS, _spectrum

    key = _PRESET_OF.get(req.hamiltonian)
    if key is None:
        raise HTTPException(422, f"hamiltonian must be one of {sorted(_PRESET_OF)}.")
    nq, n = req.n_qubits, req.grid_size
    terms = PRESETS[key]["build"](nq)
    from qiskit.quantum_info import SparsePauliOp

    H = SparsePauliOp([t.pauli_string for t in terms], coeffs=[t.coefficient for t in terms]).to_matrix()
    perm = _cx_chain_permutation(nq)
    zero = np.zeros(1 << nq, dtype=complex)
    zero[0] = 1.0
    p1_min, p1_max = req.param1_range
    p2_min, p2_max = req.param2_range
    t1s = [p1_min + (p1_max - p1_min) * i / max(n - 1, 1) for i in range(n)]
    t2s = [p2_min + (p2_max - p2_min) * j / max(n - 1, 1) for j in range(n)]
    grid, energies = [], []
    for t1 in t1s:
        first = _ry(zero, nq, t1)
        entangled = np.empty_like(first)
        entangled[perm] = first
        row = []
        for t2 in t2s:
            psi = _ry(entangled, nq, t2)
            e = float(np.real(np.vdot(psi, H @ psi)))
            energies.append(e)
            row.append({"theta1": round(t1, 4), "theta2": round(t2, 4), "energy": round(e, 6)})
        grid.append(row)

    e_arr = np.array(energies)
    k = int(np.argmin(e_arr))
    best = grid[k // n][k % n]
    ground = _spectrum(terms, nq)[0]
    return {
        "landscape_id": f"lscape-{uuid.uuid4().hex[:12]}",
        "hamiltonian": req.hamiltonian,
        "n_qubits": nq,
        "grid_size": n,
        "grid": grid,
        "min_energy": round(float(e_arr.min()), 6),
        "max_energy": round(float(e_arr.max()), 6),
        "energy_range": round(float(e_arr.max() - e_arr.min()), 6),
        "optimal_theta1": best["theta1"],
        "optimal_theta2": best["theta2"],
        "exact_ground_energy": round(ground, 6),
        "ansatz_gap_to_ground": round(float(e_arr.min()) - ground, 6),
        # Variance of the energy over the grid; whether that is a "barren plateau" depends on scale.
        "has_barren_plateau": None,
        "landscape_roughness": round(float(e_arr.std()), 6),
        "gradient_variance": round(float(e_arr.var()), 8),
        "recommendations": [f"Best grid point: theta1={best['theta1']:.3f}, theta2={best['theta2']:.3f} "
                            f"(energy {e_arr.min():.4f}; exact ground {ground:.4f})."],
        "method": "Exact statevector; ansatz Ry(theta1)^n, CX chain, Ry(theta2)^n; Hamiltonian " + PRESETS[key]["formula"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
