from __future__ import annotations
import math, cmath, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/circuit-debugger", tags=["circuit_debugger"])

PRESETS = [
    {"name": "Bell State", "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'},
    {"name": "GHZ (3Q)", "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\nmeasure q -> c;'},
    {"name": "T-gate Phase", "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[1];\nh q[0];\nt q[0];\nh q[0];\nmeasure q[0] -> c[0];'},
    {"name": "Teleportation", "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[1];\ncx q[1],q[2];\ncx q[0],q[1];\nh q[0];\nmeasure q[0] -> c[0];\nmeasure q[1] -> c[1];'},
]

class DebugRequest(BaseModel):
    qasm: str
    n_shots: int = Field(default=1024, ge=1, le=65536)

def _parse_qasm(qasm: str):
    n_qubits = 0
    gates = []
    for line in qasm.strip().splitlines():
        line = line.strip().rstrip(';')
        if not line or line.startswith('//') or line.startswith('OPENQASM') or line.startswith('include'):
            continue
        if line.startswith('qreg'):
            import re
            m = re.search(r'\[(\d+)\]', line)
            if m: n_qubits = int(m.group(1))
            continue
        if line.startswith('creg'): continue
        # parse gate
        import re
        m = re.match(r'(\w+)(?:\(([^)]*)\))?\s+(.*)', line)
        if not m: continue
        gate, params_s, qubits_s = m.group(1), m.group(2) or '', m.group(3)
        params = [float(p.strip()) for p in params_s.split(',') if p.strip()] if params_s else []
        qubits = []
        for q in qubits_s.split(','):
            q = q.strip()
            mm = re.search(r'\[(\d+)\]', q)
            if mm: qubits.append(int(mm.group(1)))
        gates.append({'gate': gate.lower(), 'params': params, 'qubits': qubits})
    return n_qubits, gates

def _apply_single(state: list, n: int, q: int, matrix: list):
    size = 1 << n
    for i in range(size):
        if (i >> q) & 1 == 0:
            j = i | (1 << q)
            a, b = state[i], state[j]
            state[i] = matrix[0][0]*a + matrix[0][1]*b
            state[j] = matrix[1][0]*a + matrix[1][1]*b

def _apply_cx(state: list, n: int, ctrl: int, tgt: int):
    size = 1 << n
    for i in range(size):
        if ((i >> ctrl) & 1) and not ((i >> tgt) & 1):
            j = i | (1 << tgt)
            state[i], state[j] = state[j], state[i]

def _apply_cz(state: list, n: int, q0: int, q1: int):
    size = 1 << n
    for i in range(size):
        if ((i >> q0) & 1) and ((i >> q1) & 1):
            state[i] = -state[i]

def _bloch(state: list, n: int, q: int):
    size = 1 << n
    rho00 = sum(abs(state[i])**2 for i in range(size) if not ((i >> q) & 1))
    rho01 = complex(0)
    for i in range(size):
        if not ((i >> q) & 1):
            j = i | (1 << q)
            rho01 += state[i].conjugate() * state[j]
    return round(2*rho01.real, 6), round(-2*rho01.imag, 6), round(2*rho00 - 1, 6)

def _probs(state: list):
    return [round(abs(a)**2, 8) for a in state]

def _snap(state: list, n: int, gate: str, params: list, qubits: list, idx: int):
    bx, by, bz = _bloch(state, n, 0)
    return {
        "step_index": idx,
        "gate_name": gate,
        "gate_params": params,
        "target_qubits": qubits,
        "state_real": [round(a.real, 8) for a in state],
        "state_imag": [round(a.imag, 8) for a in state],
        "probabilities": _probs(state),
        "bloch_x": bx, "bloch_y": by, "bloch_z": bz,
    }

@router.post("")
def debug_circuit(req: DebugRequest):
    n_qubits, gates = _parse_qasm(req.qasm)
    if n_qubits < 1 or n_qubits > 8:
        raise HTTPException(400, "n_qubits must be 1-8")
    if not n_qubits and gates:
        n_qubits = max(max(g['qubits']) for g in gates if g['qubits']) + 1

    size = 1 << n_qubits
    state = [complex(0)] * size
    state[0] = complex(1)

    H = [[1/math.sqrt(2), 1/math.sqrt(2)], [1/math.sqrt(2), -1/math.sqrt(2)]]
    X = [[0,1],[1,0]]; Y = [[0,-1j],[1j,0]]; Z = [[1,0],[0,-1]]
    S = [[1,0],[0,1j]]; Sdg = [[1,0],[0,-1j]]
    T = [[1,0],[0,cmath.exp(1j*math.pi/4)]]; Tdg = [[1,0],[0,cmath.exp(-1j*math.pi/4)]]
    I2 = [[1,0],[0,1]]

    steps = []
    step_idx = 0
    import random
    rng = random.Random(42)

    for g in gates[:100]:
        gate, params, qubits = g['gate'], g['params'], g['qubits']
        if not qubits: continue
        q = qubits[0]
        if gate == 'h': _apply_single(state, n_qubits, q, H)
        elif gate == 'x': _apply_single(state, n_qubits, q, X)
        elif gate == 'y': _apply_single(state, n_qubits, q, Y)
        elif gate == 'z': _apply_single(state, n_qubits, q, Z)
        elif gate == 's': _apply_single(state, n_qubits, q, S)
        elif gate == 'sdg': _apply_single(state, n_qubits, q, Sdg)
        elif gate == 't': _apply_single(state, n_qubits, q, T)
        elif gate == 'tdg': _apply_single(state, n_qubits, q, Tdg)
        elif gate == 'rx':
            th = params[0] if params else 0
            c, s = math.cos(th/2), math.sin(th/2)
            _apply_single(state, n_qubits, q, [[c, -1j*s], [-1j*s, c]])
        elif gate == 'ry':
            th = params[0] if params else 0
            c, s = math.cos(th/2), math.sin(th/2)
            _apply_single(state, n_qubits, q, [[c, -s], [s, c]])
        elif gate == 'rz':
            th = params[0] if params else 0
            _apply_single(state, n_qubits, q, [[cmath.exp(-1j*th/2), 0], [0, cmath.exp(1j*th/2)]])
        elif gate == 'cx' and len(qubits) >= 2: _apply_cx(state, n_qubits, qubits[0], qubits[1])
        elif gate == 'cz' and len(qubits) >= 2: _apply_cz(state, n_qubits, qubits[0], qubits[1])
        elif gate == 'measure':
            probs = _probs(state)
            p1 = sum(probs[i] for i in range(size) if (i >> q) & 1)
            outcome = 1 if rng.random() < p1 else 0
            norm = math.sqrt(sum(probs[i] for i in range(size) if ((i >> q) & 1) == outcome) or 1)
            for i in range(size):
                if ((i >> q) & 1) != outcome: state[i] = complex(0)
                else: state[i] /= norm
        else:
            pass
        steps.append(_snap(state, n_qubits, gate, params, qubits, step_idx))
        step_idx += 1

    final_probs = _probs(state)
    counts: Dict[str, int] = {}
    for _ in range(req.n_shots):
        r = rng.random(); cum = 0.0
        for i, p in enumerate(final_probs):
            cum += p
            if r < cum:
                key = format(i, f'0{n_qubits}b')
                counts[key] = counts.get(key, 0) + 1
                break

    return {
        "debug_id": str(uuid.uuid4()),
        "n_qubits": n_qubits,
        "n_gates": len(gates),
        "n_steps": len(steps),
        "final_state_real": [round(a.real, 8) for a in state],
        "final_state_imag": [round(a.imag, 8) for a in state],
        "final_probabilities": final_probs,
        "measurement_outcomes": counts,
        "steps": steps,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/presets")
def list_presets():
    return {"presets": PRESETS}
