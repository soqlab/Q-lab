from __future__ import annotations
import math, cmath, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/trotter", tags=["trotter_evolution"])

HAMILTONIANS = {
    "ising_1d":        {"display": "1D Transverse-Field Ising", "desc": "H = -J Σ ZZ - h Σ X"},
    "heisenberg_xxz":  {"display": "Heisenberg XXZ Chain",       "desc": "H = J Σ (XX+YY+ΔZZ)"},
    "transverse_field":{"display": "Transverse-Field Model",     "desc": "H = -h Σ X - J Σ ZZ"},
    "xy_model":        {"display": "XY Model",                   "desc": "H = J Σ (XX+YY)"},
}

class TrotterRequest(BaseModel):
    hamiltonian: str = "ising_1d"
    n_qubits: int = Field(default=4, ge=2, le=8)
    t_total: float = Field(default=2.0, gt=0, le=50.0)
    n_steps: int = Field(default=20, ge=2, le=200)
    trotter_order: int = Field(default=1, ge=1, le=2)
    J: float = Field(default=1.0)
    h: float = Field(default=0.5)
    delta: float = Field(default=1.0)
    initial_state: str = "neel"

def _init_state(n: int, kind: str) -> list:
    size = 1 << n
    state = [complex(0)] * size
    if kind == "neel":
        idx = int("".join("10" * (n//2) + ("1" if n%2 else ""), 2) if n > 1 else "1", 2)
        idx = 0
        for i in range(n):
            if i % 2 == 0: idx |= (1 << i)
        state[idx] = complex(1)
    elif kind == "all_up":
        state[0] = complex(1)
    elif kind == "ghz":
        state[0] = 1/math.sqrt(2); state[-1] = 1/math.sqrt(2)
    elif kind == "superposition":
        v = 1/math.sqrt(size)
        for i in range(size): state[i] = v
    else:
        state[0] = complex(1)
    return state

def _apply_rzz(state: list, n: int, i: int, j: int, angle: float):
    for idx in range(1 << n):
        bi = (idx >> i) & 1; bj = (idx >> j) & 1
        phase = angle if bi == bj else -angle
        state[idx] *= cmath.exp(1j * phase)

def _apply_rx(state: list, n: int, q: int, angle: float):
    size = 1 << n
    c, s = math.cos(angle), math.sin(angle)
    for idx in range(size):
        if not ((idx >> q) & 1):
            j = idx | (1 << q)
            a, b = state[idx], state[j]
            state[idx] = c*a - 1j*s*b
            state[j]   = -1j*s*a + c*b

def _apply_rxx(state: list, n: int, i: int, j: int, angle: float):
    _apply_rx(state, n, i, angle)
    _apply_rx(state, n, j, angle)

def _energy_ising(state: list, n: int, J: float, h: float) -> float:
    size = 1 << n
    E = 0.0
    for idx in range(size):
        p = abs(state[idx])**2
        if p < 1e-14: continue
        zz = sum(((1 if not((idx>>(k))&1) else -1) * (1 if not((idx>>(k+1))&1) else -1)) for k in range(n-1))
        E += p * (-J * zz)
    return E

def _magnetization(state: list, n: int) -> float:
    size = 1 << n
    m = 0.0
    for idx in range(size):
        p = abs(state[idx])**2
        z_tot = sum(1 - 2*((idx>>k)&1) for k in range(n))
        m += p * z_tot / n
    return m

def _entropy(state: list, n: int) -> float:
    size = 1 << n
    half = n // 2
    dim_a = 1 << half; dim_b = 1 << (n - half)
    rho = [[complex(0)]*dim_a for _ in range(dim_a)]
    for i in range(dim_a):
        for j in range(dim_a):
            for b in range(dim_b):
                ia = i | (b << half); ja = j | (b << half)
                rho[i][j] += state[ia] * state[ja].conjugate()
    S = 0.0
    for i in range(dim_a):
        ev = rho[i][i].real
        if ev > 1e-14: S -= ev * math.log2(ev)
    return max(0.0, S)

def _hamiltonian(kind: str, n: int, J: float, h: float, delta: float):
    """The chosen model as a Qiskit SparsePauliOp (open chain; qubit q is character n-1-q)."""
    from qiskit.quantum_info import SparsePauliOp

    def label(ops: dict) -> str:
        return "".join(ops.get(n - 1 - k, "I") for k in range(n))

    terms = []
    bonds = [(k, k + 1) for k in range(n - 1)]
    if kind in ("ising_1d", "transverse_field"):
        terms += [(label({i: "Z", j: "Z"}), -J) for i, j in bonds]
        terms += [(label({k: "X"}), -h) for k in range(n)]
    elif kind == "heisenberg_xxz":
        for i, j in bonds:
            terms += [(label({i: "X", j: "X"}), J), (label({i: "Y", j: "Y"}), J), (label({i: "Z", j: "Z"}), J * delta)]
    elif kind == "xy_model":
        for i, j in bonds:
            terms += [(label({i: "X", j: "X"}), J), (label({i: "Y", j: "Y"}), J)]
    return SparsePauliOp([t for t, _ in terms], coeffs=[c for _, c in terms])


def _step_operators(op, dt: float, order: int):
    """(Trotterised step, exact step) as matrices."""
    import numpy as np
    from qiskit.circuit.library import PauliEvolutionGate
    from qiskit.quantum_info import Operator
    from qiskit.synthesis import LieTrotter, SuzukiTrotter
    from scipy.linalg import expm

    synthesis = LieTrotter() if order == 1 else SuzukiTrotter(order=2)
    # Operator() of the gate itself would be the exact exponential; use the synthesised circuit.
    trotter = Operator(synthesis.synthesize(PauliEvolutionGate(op, time=dt))).data
    exact = expm(-1j * dt * np.asarray(op.to_matrix()))
    return trotter, exact


def _infidelity(a, b) -> float:
    import numpy as np

    return max(0.0, 1.0 - float(abs(np.vdot(a, b)) ** 2))


@router.post("")
def run_trotter(req: TrotterRequest):
    """Trotterised time evolution of the chosen model, compared with exact evolution.

    The Hamiltonian is built from `hamiltonian`, J, h and delta. Each step applies Qiskit's
    PauliEvolutionGate with Lie-Trotter (order 1) or second-order Suzuki-Trotter synthesis; the
    reference is the exact propagator exp(-iH dt). Energies are <H> of the Trotterised state, the
    Trotter error is the state infidelity 1 - |<exact|trotter>|^2, and the ground energy is exact
    diagonalisation of H. Everything is a statevector calculation.
    """
    import numpy as np
    from qiskit.quantum_info import Statevector

    from ..exact_state import reduced, von_neumann

    if req.hamiltonian not in HAMILTONIANS:
        raise HTTPException(400, f"Unknown hamiltonian. Options: {list(HAMILTONIANS.keys())}")
    n = req.n_qubits
    dt = req.t_total / req.n_steps
    op = _hamiltonian(req.hamiltonian, n, req.J, req.h, req.delta)
    H = np.asarray(op.to_matrix())
    psi0 = np.array(_init_state(n, req.initial_state), dtype=complex)
    trotter_step, exact_step = _step_operators(op, dt, req.trotter_order)

    def energy(psi) -> float:
        return float(np.vdot(psi, H @ psi).real)

    def magnetization(psi) -> float:
        probs = np.abs(psi) ** 2
        z = np.array([sum(1 - 2 * ((idx >> k) & 1) for k in range(n)) / n for idx in range(1 << n)])
        return float(probs @ z)

    psi_t, psi_e = psi0.copy(), psi0.copy()
    E0 = energy(psi0)
    time_pts, energies, mags, entropies, errors = [], [], [], [], []
    for step in range(req.n_steps):
        psi_t = trotter_step @ psi_t
        psi_e = exact_step @ psi_e
        time_pts.append(round((step + 1) * dt, 6))
        energies.append(round(energy(psi_t), 6))
        mags.append(round(magnetization(psi_t), 6))
        entropies.append(round(von_neumann(reduced(Statevector(psi_t), n, set(range(n // 2)))) / np.log(2), 6))
        errors.append(round(_infidelity(psi_e, psi_t), 8))

    # Fewest steps (doubling from n_steps, up to 1600) that keep the final infidelity below 1e-2.
    rec_steps = None
    steps = req.n_steps
    while steps <= 1600:
        t_step, e_step = _step_operators(op, req.t_total / steps, req.trotter_order)
        if _infidelity(np.linalg.matrix_power(e_step, steps) @ psi0, np.linalg.matrix_power(t_step, steps) @ psi0) < 1e-2:
            rec_steps = steps
            break
        steps *= 2

    probs = np.abs(psi_t) ** 2
    top8 = np.argsort(-probs)[:8]
    qasm_step = None
    try:
        from qiskit import QuantumCircuit, qasm2, transpile
        from qiskit.circuit.library import PauliEvolutionGate
        from qiskit.synthesis import LieTrotter, SuzukiTrotter

        qc = QuantumCircuit(n)
        qc.append(PauliEvolutionGate(op, time=dt, synthesis=LieTrotter() if req.trotter_order == 1 else SuzukiTrotter(order=2)), range(n))
        qasm_step = qasm2.dumps(transpile(qc, basis_gates=["cx", "rz", "rx", "ry", "h", "sdg", "s"], optimization_level=0))
    except Exception:
        pass

    return {
        "sim_id": str(uuid.uuid4()),
        "hamiltonian": req.hamiltonian,
        "n_qubits": n,
        "t_total": req.t_total,
        "n_steps": req.n_steps,
        "dt": round(dt, 6),
        "trotter_order": req.trotter_order,
        "J": req.J,
        "h": req.h,
        "initial_state": req.initial_state,
        "time_points": time_pts,
        "energy_evolution": energies,
        "magnetization_evolution": mags,
        "entanglement_evolution": entropies,
        "trotter_error_evolution": errors,
        "final_probabilities": [round(float(probs[i]), 8) for i in top8],
        "final_state_labels": [format(int(i), f"0{n}b") for i in top8],
        "ground_state_energy_estimate": round(float(np.linalg.eigvalsh(H)[0]), 6),
        "max_trotter_error": round(max(errors), 8) if errors else 0.0,
        "energy_conservation_error": round(abs(energies[-1] - E0), 6) if energies else 0.0,
        "recommended_n_steps": rec_steps,
        "qasm_circuit": qasm_step,
        "method": ("Statevector: Qiskit PauliEvolutionGate (Lie-Trotter or 2nd-order Suzuki) vs exact exp(-iHt). "
                   "Trotter error = state infidelity; entanglement = half-chain entropy in bits; ground energy exact."),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/hamiltonians")
def list_hamiltonians():
    return {"hamiltonians": [{"id": k, **v} for k, v in HAMILTONIANS.items()]}
