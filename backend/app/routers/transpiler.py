"""Cross-Provider Native Gate Transpiler.

Converts standard OpenQASM 2.0 to the native gate sets of:
  - IBM:     {cx, id, rz, sx, x}
  - IonQ:    {rx, ry, rz, cnot}  (simplified; real IonQ uses gpi/ms)
  - Braket:  {cnot, h, rx, ry, rz, s, t, x, y, z, swap}
  - Rigetti: {cz, cnot, h, rx, ry, rz, swap}

No quantum platform does multi-provider auto-transpilation today.
"""
from __future__ import annotations

import math
import re
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/transpile", tags=["transpiler"])

PROVIDERS = ["ibm", "ionq", "braket", "rigetti"]

# ─────────────────────────────────────────────────────────────────────────────
# Gate decomposition rules
# Format: (gate_name, qubits) → list of (native_gate, qubits, params)
# ─────────────────────────────────────────────────────────────────────────────

PI = math.pi
PI2 = math.pi / 2
PI4 = math.pi / 4


def _fmt(angle: float) -> str:
    """Format angle to 6 sig figs, clean trailing zeros."""
    s = f"{angle:.6f}".rstrip("0").rstrip(".")
    return s if s else "0"


def _decompose_for_provider(gate: str, qubits: list[int], params: list[float], provider: str) -> list[str]:
    """Return list of native gate instruction strings."""
    q = qubits
    p = params

    if provider == "ibm":
        return _to_ibm(gate, q, p)
    elif provider == "ionq":
        return _to_ionq(gate, q, p)
    elif provider == "braket":
        return _to_braket(gate, q, p)
    elif provider == "rigetti":
        return _to_rigetti(gate, q, p)
    return [f"{gate} q[{q[0]}];"]


def _to_ibm(gate: str, q: list[int], p: list[float]) -> list[str]:
    """IBM native: cx, id, rz, sx, x"""
    g = gate.lower()
    if g == "h":
        return [f"rz({_fmt(PI2)}) q[{q[0]}];", f"sx q[{q[0]}];", f"rz({_fmt(PI2)}) q[{q[0]}];"]
    if g == "x":
        return [f"x q[{q[0]}];"]
    if g == "y":
        return [f"rz({_fmt(PI)}) q[{q[0]}];", f"x q[{q[0]}];"]
    if g == "z":
        return [f"rz({_fmt(PI)}) q[{q[0]}];"]
    if g == "s":
        return [f"rz({_fmt(PI2)}) q[{q[0]}];"]
    if g == "sdg":
        return [f"rz({_fmt(-PI2)}) q[{q[0]}];"]
    if g == "t":
        return [f"rz({_fmt(PI4)}) q[{q[0]}];"]
    if g == "tdg":
        return [f"rz({_fmt(-PI4)}) q[{q[0]}];"]
    if g in ("rx", "ry", "rz"):
        angle = p[0] if p else 0
        if g == "rx":
            return [f"rz({_fmt(-PI2)}) q[{q[0]}];", f"sx q[{q[0]}];", f"rz({_fmt(PI - angle)}) q[{q[0]}];",
                    f"sx q[{q[0]}];", f"rz({_fmt(-PI2)}) q[{q[0]}];"]
        if g == "ry":
            return [f"rz({_fmt(-PI2)}) q[{q[0]}];", f"sx q[{q[0]}];", f"rz({_fmt(angle)}) q[{q[0]}];",
                    f"sx q[{q[0]}];", f"rz({_fmt(PI2)}) q[{q[0]}];"]
        return [f"rz({_fmt(angle)}) q[{q[0]}];"]
    if g in ("cx", "cnot"):
        return [f"cx q[{q[0]}],q[{q[1]}];"]
    if g == "cz":
        return [f"rz({_fmt(PI2)}) q[{q[1]}];", f"sx q[{q[1]}];", f"rz({_fmt(PI2)}) q[{q[1]}];",
                f"cx q[{q[0]}],q[{q[1]}];", f"rz({_fmt(PI2)}) q[{q[1]}];", f"sx q[{q[1]}];", f"rz({_fmt(PI2)}) q[{q[1]}];"]
    if g == "swap":
        return [f"cx q[{q[0]}],q[{q[1]}];", f"cx q[{q[1]}],q[{q[0]}];", f"cx q[{q[0]}],q[{q[1]}];"]
    if g == "id":
        return [f"id q[{q[0]}];"]
    return [f"// unsupported: {gate} → rz(0) as noop", f"rz(0) q[{q[0]}];"]


def _to_ionq(gate: str, q: list[int], p: list[float]) -> list[str]:
    """IonQ native (simplified): rx, ry, rz, cnot"""
    g = gate.lower()
    if g == "h":
        return [f"ry({_fmt(PI2)}) q[{q[0]}];", f"rx({_fmt(PI)}) q[{q[0]}];"]
    if g == "x":
        return [f"rx({_fmt(PI)}) q[{q[0]}];"]
    if g == "y":
        return [f"ry({_fmt(PI)}) q[{q[0]}];"]
    if g == "z":
        return [f"rz({_fmt(PI)}) q[{q[0]}];"]
    if g == "s":
        return [f"rz({_fmt(PI2)}) q[{q[0]}];"]
    if g == "sdg":
        return [f"rz({_fmt(-PI2)}) q[{q[0]}];"]
    if g == "t":
        return [f"rz({_fmt(PI4)}) q[{q[0]}];"]
    if g == "tdg":
        return [f"rz({_fmt(-PI4)}) q[{q[0]}];"]
    if g in ("rx", "ry", "rz"):
        angle = p[0] if p else 0
        return [f"{g}({_fmt(angle)}) q[{q[0]}];"]
    if g in ("cx", "cnot"):
        return [f"cnot q[{q[0]}],q[{q[1]}];"]
    if g == "cz":
        return [f"ry({_fmt(-PI2)}) q[{q[1]}];", f"cnot q[{q[0]}],q[{q[1]}];", f"ry({_fmt(PI2)}) q[{q[1]}];"]
    if g == "swap":
        return [f"cnot q[{q[0]}],q[{q[1]}];", f"cnot q[{q[1]}],q[{q[0]}];", f"cnot q[{q[0]}],q[{q[1]}];"]
    return [f"// unsupported: {gate}", f"rz(0) q[{q[0]}];"]


def _to_braket(gate: str, q: list[int], p: list[float]) -> list[str]:
    """Braket native: cnot, h, rx, ry, rz, s, t, x, y, z, swap"""
    g = gate.lower()
    if g in ("h", "x", "y", "z", "s", "t"):
        return [f"{g} q[{q[0]}];"]
    if g == "sdg":
        return [f"si q[{q[0]}];"]
    if g == "tdg":
        return [f"ti q[{q[0]}];"]
    if g in ("rx", "ry", "rz"):
        angle = p[0] if p else 0
        return [f"{g}({_fmt(angle)}) q[{q[0]}];"]
    if g in ("cx", "cnot"):
        return [f"cnot q[{q[0]}],q[{q[1]}];"]
    if g == "cz":
        return [f"cz q[{q[0]}],q[{q[1]}];"]
    if g == "swap":
        return [f"swap q[{q[0]}],q[{q[1]}];"]
    return [f"// unsupported: {gate}", f"rz(0) q[{q[0]}];"]


def _to_rigetti(gate: str, q: list[int], p: list[float]) -> list[str]:
    """Rigetti native: cz, cnot, h, rx, ry, rz, swap"""
    g = gate.lower()
    if g in ("h", "x", "y", "z"):
        return [f"{g} q[{q[0]}];"]
    if g == "s":
        return [f"rz({_fmt(PI2)}) q[{q[0]}];"]
    if g == "sdg":
        return [f"rz({_fmt(-PI2)}) q[{q[0]}];"]
    if g == "t":
        return [f"rz({_fmt(PI4)}) q[{q[0]}];"]
    if g == "tdg":
        return [f"rz({_fmt(-PI4)}) q[{q[0]}];"]
    if g in ("rx", "ry", "rz"):
        angle = p[0] if p else 0
        return [f"{g}({_fmt(angle)}) q[{q[0]}];"]
    if g in ("cx", "cnot"):
        return [f"cnot q[{q[0]}],q[{q[1]}];"]
    if g == "cz":
        return [f"cz q[{q[0]}],q[{q[1]}];"]
    if g == "swap":
        return [f"swap q[{q[0]}],q[{q[1]}];"]
    return [f"// unsupported: {gate}", f"rz(0) q[{q[0]}];"]


# ─────────────────────────────────────────────────────────────────────────────
# QASM parser
# ─────────────────────────────────────────────────────────────────────────────

_GATE_RE = re.compile(
    r"^(\w+)(?:\(([^)]*)\))?\s+(q\[\d+\](?:\s*,\s*q\[\d+\])*)\s*;",
    re.IGNORECASE,
)


def _parse_params(raw: str | None) -> list[float]:
    if not raw:
        return []
    parts = [p.strip() for p in raw.split(",")]
    result = []
    _safe_env = {"__builtins__": {}, "pi": math.pi}
    for part in parts:
        try:
            val = float(eval(part.replace("pi", str(math.pi)), _safe_env, {}))
            result.append(val)
        except Exception:
            result.append(0.0)
    return result


def transpile_qasm(qasm: str, provider: str) -> dict[str, Any]:
    lines = qasm.strip().split("\n")
    header: list[str] = []
    body: list[str] = []
    n_qubits = 2

    for line in lines:
        s = line.strip()
        if not s:
            continue
        if s.startswith(("OPENQASM", "include", "//")):
            header.append(line)
            continue
        if s.startswith("qreg"):
            m = re.search(r"\[(\d+)\]", s)
            if m:
                n_qubits = int(m.group(1))
            header.append(line)
            continue
        if s.startswith("creg"):
            header.append(line)
            continue
        if s.startswith("measure"):
            body.append(line)
            continue

        m = _GATE_RE.match(s)
        if m:
            gate_name = m.group(1)
            raw_params = m.group(2)
            qubits = [int(q) for q in re.findall(r"q\[(\d+)\]", m.group(3))]
            params = _parse_params(raw_params)
            native = _decompose_for_provider(gate_name, qubits, params, provider)
            body.extend(native)
        else:
            body.append(line)

    native_gates = {
        "ibm": "cx, id, rz, sx, x",
        "ionq": "rx, ry, rz, cnot",
        "braket": "cnot, h, rx, ry, rz, s, t, x, y, z, swap",
        "rigetti": "cz, cnot, h, rx, ry, rz, swap",
    }

    transpiled = "\n".join(header) + "\n" + "\n".join(body)
    original_gate_count = sum(1 for l in qasm.split("\n") if _GATE_RE.match(l.strip()))
    transpiled_gate_count = sum(1 for l in body if not l.strip().startswith(("measure", "//", "creg")))

    return {
        "provider": provider,
        "native_gate_set": native_gates.get(provider, "unknown"),
        "transpiled_qasm": transpiled,
        "original_gate_count": original_gate_count,
        "transpiled_gate_count": transpiled_gate_count,
        "overhead_ratio": round(transpiled_gate_count / max(original_gate_count, 1), 2),
        "n_qubits": n_qubits,
    }


class TranspileRequest(BaseModel):
    qasm: str
    providers: list[str] = Field(default=["ibm", "ionq", "braket", "rigetti"])


@router.post("")
def transpile(req: TranspileRequest):
    invalid = [p for p in req.providers if p not in PROVIDERS]
    if invalid:
        raise HTTPException(422, f"Unknown providers: {invalid}. Valid: {PROVIDERS}")
    results = {}
    for provider in req.providers:
        results[provider] = transpile_qasm(req.qasm, provider)
    return {
        "original_qasm": req.qasm,
        "results": results,
        "providers_requested": req.providers,
    }


@router.post("/{provider}")
def transpile_single(provider: str, req: TranspileRequest):
    if provider not in PROVIDERS:
        raise HTTPException(422, f"Unknown provider '{provider}'. Valid: {PROVIDERS}")
    return transpile_qasm(req.qasm, provider)
