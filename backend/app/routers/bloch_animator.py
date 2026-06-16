from __future__ import annotations
import math, uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/bloch", tags=["bloch_animator"])

class BlochFrame(BaseModel):
    theta: float  # polar angle [0, pi]
    phi: float    # azimuthal angle [0, 2pi]

class BlochRequest(BaseModel):
    gate_sequence: List[str] = ["h", "t", "h", "s"]
    initial_state: str = "0"
    n_frames: int = Field(default=30, ge=5, le=100)
    include_trajectory: bool = True
    noise_level: float = Field(default=0.0, ge=0, le=0.1)

def _bloch_from_state(a: complex, b: complex):
    n = math.sqrt(abs(a)**2 + abs(b)**2)
    if n < 1e-12: return 0.0, 0.0, 1.0
    a, b = a/n, b/n
    bx = 2 * (a.real*b.real + a.imag*b.imag)
    by = 2 * (a.imag*b.real - a.real*b.imag)
    bz = abs(a)**2 - abs(b)**2
    return bx, by, bz

def _apply_gate(a: complex, b: complex, gate: str, noise: float):
    import cmath
    g = gate.lower()
    c2 = math.sqrt(0.5)
    if g == 'i': pass
    elif g == 'x': a, b = b, a
    elif g == 'y': a, b = -1j*b, 1j*a
    elif g == 'z': b = -b
    elif g == 'h': a, b = c2*(a+b), c2*(a-b)
    elif g == 's': b = 1j * b
    elif g == 'sdg': b = -1j * b
    elif g == 't': b = cmath.exp(1j*math.pi/4) * b
    elif g == 'tdg': b = cmath.exp(-1j*math.pi/4) * b
    elif g in ('rx45', 'rx'): a, b = (a+b)*c2, (-a+b)*c2  # pi/2 rotation
    elif g == 'ry': a, b = c2*(a-b), c2*(a+b)
    elif g == 'reset': a, b = complex(1), complex(0)
    elif g.startswith('rx('):
        ang = _parse_angle(g)
        ca, sa = math.cos(ang/2), math.sin(ang/2)
        a, b = ca*a - 1j*sa*b, -1j*sa*a + ca*b
    elif g.startswith('ry('):
        ang = _parse_angle(g)
        ca, sa = math.cos(ang/2), math.sin(ang/2)
        a, b = ca*a - sa*b, sa*a + ca*b
    elif g.startswith('rz('):
        ang = _parse_angle(g)
        a = cmath.exp(-1j*ang/2)*a; b = cmath.exp(1j*ang/2)*b
    # Apply depolarizing noise
    if noise > 0:
        import random
        if random.random() < noise:
            r = random.random()
            if r < 1/3: a, b = b, a
            elif r < 2/3: a, b = -1j*b, 1j*a
            else: b = -b
    n = math.sqrt(abs(a)**2 + abs(b)**2)
    return (a/n, b/n) if n > 1e-12 else (a, b)

def _parse_angle(gate: str) -> float:
    try:
        inner = gate[gate.index('(')+1:gate.index(')')]
        if 'pi' in inner: return float(inner.replace('pi', str(math.pi)))
        return float(inner)
    except Exception:
        return math.pi/2

def _init(state: str):
    if state == '0': return complex(1), complex(0)
    elif state == '1': return complex(0), complex(1)
    elif state == '+': c = math.sqrt(0.5); return complex(c), complex(c)
    elif state == '-': c = math.sqrt(0.5); return complex(c), complex(-c)
    elif state == '+i': c = math.sqrt(0.5); return complex(c), complex(0, c)
    elif state == '-i': c = math.sqrt(0.5); return complex(c), complex(0, -c)
    return complex(1), complex(0)

@router.post("")
def animate_bloch(req: BlochRequest):
    a, b = _init(req.initial_state)
    gates = req.gate_sequence

    bx0, by0, bz0 = _bloch_from_state(a, b)
    frames = [{"step": 0, "gate": "init", "bx": round(bx0,6), "by": round(by0,6), "bz": round(bz0,6), "theta": round(math.acos(max(-1,min(1,bz0))),6), "phi": round(math.atan2(by0,bx0),6)}]

    trajectory = [{"bx": round(bx0,6), "by": round(by0,6), "bz": round(bz0,6)}]

    for gi, gate in enumerate(gates):
        if req.n_frames > len(gates):
            # interpolate
            a_prev, b_prev = a, b
            a, b = _apply_gate(a, b, gate, req.noise_level)
            bx1, by1, bz1 = _bloch_from_state(a, b)
            bx0, by0, bz0 = _bloch_from_state(a_prev, b_prev)
            substeps = max(1, req.n_frames // len(gates))
            for s in range(substeps):
                t = (s+1)/substeps
                bxt = bx0 + t*(bx1-bx0); byt = by0 + t*(by1-by0); bzt = bz0 + t*(bz1-bz0)
                n = math.sqrt(bxt**2+byt**2+bzt**2); n = n if n > 0 else 1
                trajectory.append({"bx": round(bxt/n,6), "by": round(byt/n,6), "bz": round(bzt/n,6)})
        else:
            a, b = _apply_gate(a, b, gate, req.noise_level)

        bx, by, bz = _bloch_from_state(a, b)
        theta = math.acos(max(-1, min(1, bz)))
        phi = math.atan2(by, bx)
        frames.append({"step": gi+1, "gate": gate, "bx": round(bx,6), "by": round(by,6), "bz": round(bz,6), "theta": round(theta,6), "phi": round(phi%(2*math.pi),6)})

    final_bx, final_by, final_bz = _bloch_from_state(a, b)
    purity = abs(a)**2 + abs(b)**2
    bloch_len = math.sqrt(final_bx**2 + final_by**2 + final_bz**2)

    svg_frames = []
    for f in frames:
        cx = 100 + 80 * f["bx"]; cy = 100 - 80 * f["bz"]
        opacity = f"{0.3 + 0.7 * (f['step'] + 1) / len(frames):.2f}"
        svg_frames.append(f'<circle cx="{round(cx,1)}" cy="{round(cy,1)}" r="4" fill="blue" opacity="{opacity}"/>')
    svg = f'<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="80" fill="none" stroke="#aaa" stroke-width="1"/><line x1="100" y1="20" x2="100" y2="180" stroke="#aaa" stroke-width="1"/><line x1="20" y1="100" x2="180" y2="100" stroke="#aaa" stroke-width="1"/>{"".join(svg_frames)}</svg>'

    return {
        "anim_id": str(uuid.uuid4()),
        "gate_sequence": req.gate_sequence,
        "initial_state": req.initial_state,
        "n_frames": len(frames),
        "frames": frames,
        "trajectory": trajectory if req.include_trajectory else [],
        "final_bloch_vector": {"bx": round(final_bx,6), "by": round(final_by,6), "bz": round(final_bz,6)},
        "bloch_sphere_radius": round(bloch_len, 6),
        "purity": round(purity, 6),
        "is_pure_state": purity > 0.99,
        "amplitude_0": {"real": round(a.real,6), "imag": round(a.imag,6)},
        "amplitude_1": {"real": round(b.real,6), "imag": round(b.imag,6)},
        "prob_0": round(abs(a)**2, 6),
        "prob_1": round(abs(b)**2, 6),
        "svg_preview": svg,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/gates")
def list_gates():
    return {"gates": ["i", "x", "y", "z", "h", "s", "sdg", "t", "tdg", "rx45", "ry", "reset", "rx(pi/2)", "rz(pi/4)"]}

@router.get("/initial-states")
def list_states():
    return {"states": [
        {"id": "0",  "label": "|0⟩ — north pole"},
        {"id": "1",  "label": "|1⟩ — south pole"},
        {"id": "+",  "label": "|+⟩ — +X axis"},
        {"id": "-",  "label": "|-⟩ — -X axis"},
        {"id": "+i", "label": "|+i⟩ — +Y axis"},
        {"id": "-i", "label": "|-i⟩ — -Y axis"},
    ]}
