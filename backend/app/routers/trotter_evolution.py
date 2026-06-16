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

@router.post("")
def run_trotter(req: TrotterRequest):
    if req.hamiltonian not in HAMILTONIANS:
        raise HTTPException(400, f"Unknown hamiltonian. Options: {list(HAMILTONIANS.keys())}")
    n = req.n_qubits; dt = req.t_total / req.n_steps
    state = _init_state(n, req.initial_state)

    time_pts, energies, mags, entropies, errors = [], [], [], [], []
    E0 = _energy_ising(state, n, req.J, req.h)

    for step in range(req.n_steps):
        t = step * dt
        # 1st-order Trotter: exp(-i H dt) ≈ prod_k exp(-i h_k dt)
        # ZZ terms (Ising)
        for k in range(n-1):
            _apply_rzz(state, n, k, k+1, req.J * dt)
        # X terms
        for k in range(n):
            _apply_rx(state, n, k, req.h * dt)
        if req.trotter_order == 2 and step < req.n_steps - 1:
            for k in range(n-1):
                _apply_rzz(state, n, k, k+1, req.J * dt * 0.5)
            for k in range(n):
                _apply_rx(state, n, k, req.h * dt * 0.5)

        time_pts.append(round(t + dt, 6))
        E = _energy_ising(state, n, req.J, req.h)
        energies.append(round(E, 6))
        mags.append(round(_magnetization(state, n), 6))
        entropies.append(round(_entropy(state, n), 6))
        errors.append(round(abs(E - E0), 6))

    # top-8 final probabilities
    probs_all = [(abs(state[i])**2, i) for i in range(1<<n)]
    probs_all.sort(reverse=True)
    top8 = probs_all[:8]
    final_probs = [round(p, 8) for p, _ in top8]
    final_labels = [format(i, f'0{n}b') for _, i in top8]

    trotter_error = max(errors) if errors else 0.0
    # recommend n_steps for error < 0.01
    rec_steps = max(req.n_steps, math.ceil(req.t_total * abs(req.J) * n * 10))

    qasm_step = f'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[{n}];\n'
    for k in range(n-1):
        qasm_step += f'cx q[{k}],q[{k+1}];\nrz({2*req.J*dt:.4f}) q[{k+1}];\ncx q[{k}],q[{k+1}];\n'
    for k in range(n):
        qasm_step += f'rx({2*req.h*dt:.4f}) q[{k}];\n'

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
        "final_probabilities": final_probs,
        "final_state_labels": final_labels,
        "ground_state_energy_estimate": round(min(energies) if energies else E0, 6),
        "max_trotter_error": round(trotter_error, 6),
        "energy_conservation_error": round(abs(energies[-1] - E0) if energies else 0, 6),
        "recommended_n_steps": rec_steps,
        "qasm_circuit": qasm_step,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/hamiltonians")
def list_hamiltonians():
    return {"hamiltonians": [{"id": k, **v} for k, v in HAMILTONIANS.items()]}
