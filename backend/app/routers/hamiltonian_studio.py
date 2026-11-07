"""Hamiltonian Studio: exact spectrum of a Pauli-sum Hamiltonian, plus an ansatz circuit.

The Hamiltonian is built with Qiskit's SparsePauliOp and diagonalised exactly (numpy eigvalsh on
the dense matrix), so the ground energy, gap and eigenvalues are exact for up to MAX_QUBITS
qubits. Presets are standard model Hamiltonians, defined by their formula and the qubit count.
There are no molecule presets: their coefficients depend on geometry, basis and mapping, and Q-Lab
has no chemistry package to compute them, so a user supplies such terms themselves.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/hamiltonian-studio", tags=["hamiltonian_studio"])

MAX_QUBITS = 10
METHOD = "Exact diagonalisation of the Hamiltonian matrix (Qiskit SparsePauliOp, numpy eigvalsh)."


class PauliTerm(BaseModel):
    pauli_string: str = Field(..., description="e.g. 'ZZ', 'XX', 'IZ'; leftmost character is the highest qubit")
    coefficient: float


class HamiltonianRequest(BaseModel):
    terms: List[PauliTerm] = Field(default_factory=list)
    pauli_terms: List[PauliTerm] = Field(default_factory=list)  # name the dashboard sends
    preset: Optional[str] = None
    n_qubits: int = Field(4, ge=2, le=MAX_QUBITS)
    generate_ansatz: bool = True
    ansatz_type: Optional[str] = None
    ansatz: Optional[str] = None  # name the dashboard sends
    n_layers: int = Field(2, ge=1, le=8)


def _chain(n: int, pair: str, coeff: float) -> List[PauliTerm]:
    out = []
    for q in range(n - 1):
        s = ["I"] * n
        s[q] = s[q + 1] = pair
        out.append(PauliTerm(pauli_string="".join(s), coefficient=coeff))
    return out


def _field(n: int, pauli: str, coeff: float) -> List[PauliTerm]:
    return [PauliTerm(pauli_string="".join(pauli if k == q else "I" for k in range(n)), coefficient=coeff)
            for q in range(n)]


PRESETS: Dict[str, Dict[str, Any]] = {
    "ising_1d": {"name": "Transverse-field Ising chain", "formula": "H = -Σ Z_i Z_{i+1} - Σ X_i (J = h = 1, open chain)",
                 "build": lambda n: _chain(n, "Z", -1.0) + _field(n, "X", -1.0)},
    "heisenberg": {"name": "Heisenberg XXX chain", "formula": "H = Σ (X_i X_{i+1} + Y_i Y_{i+1} + Z_i Z_{i+1}), open chain",
                   "build": lambda n: _chain(n, "X", 1.0) + _chain(n, "Y", 1.0) + _chain(n, "Z", 1.0)},
    "maxcut_ring": {"name": "MaxCut on a ring", "formula": "H = Σ_(i,j) ½ Z_i Z_j over the edges of an n-cycle",
                    "build": lambda n: _chain(n, "Z", 0.5) + (
                        [PauliTerm(pauli_string="Z" + "I" * (n - 2) + "Z", coefficient=0.5)] if n > 2 else [])},
}


def _spectrum(terms: List[PauliTerm], n: int) -> List[float]:
    import numpy as np
    from qiskit.quantum_info import SparsePauliOp

    op = SparsePauliOp([t.pauli_string for t in terms], coeffs=[t.coefficient for t in terms]).simplify()
    return [float(e) for e in np.linalg.eigvalsh(op.to_matrix())]


def _commuting(terms: List[PauliTerm]) -> bool:
    from qiskit.quantum_info import Pauli

    paulis = [Pauli(t.pauli_string) for t in terms]
    return all(a.commutes(b) for i, a in enumerate(paulis) for b in paulis[i + 1:])


def _depth(lines: List[str], n: int) -> int:
    """Circuit depth of our own gate list: ASAP layering, measurements included."""
    import re

    level = [0] * n
    for line in lines:
        qs = [int(q) for q in re.findall(r"q\[(\d+)\]", line)]
        if not qs or line.startswith(("qreg", "creg")):
            continue
        d = max(level[q] for q in qs) + 1
        for q in qs:
            level[q] = d
    return max(level)


def _ansatz(kind: str, n: int, layers: int) -> Dict[str, Any]:
    body: List[str] = []
    p = 0
    if kind == "hea":
        for _ in range(layers):
            for q in range(n):
                body += [f"ry(theta[{p}]) q[{q}];", f"rz(theta[{p + 1}]) q[{q}];"]
                p += 2
            body += [f"cx q[{q}],q[{q + 1}];" for q in range(n - 1)]
    elif kind == "uccsd":
        body += [f"x q[{q}];" for q in range(n // 2)]
        for _ in range(layers):
            for q in range(n - 1):
                body += [f"cx q[{q}],q[{q + 1}];", f"ry(theta[{p}]) q[{q + 1}];", f"cx q[{q}],q[{q + 1}];"]
                p += 1
            for q in range(0, n - 3, 2):
                body += [f"cx q[{q}],q[{q + 1}];", f"cx q[{q + 2}],q[{q + 3}];", f"cx q[{q + 1}],q[{q + 2}];",
                         f"ry(theta[{p}]) q[{q + 2}];", f"cx q[{q + 1}],q[{q + 2}];", f"cx q[{q}],q[{q + 1}];",
                         f"cx q[{q + 2}],q[{q + 3}];"]
                p += 1
    elif kind == "qaoa":
        body += [f"h q[{q}];" for q in range(n)]
        for layer in range(layers):
            for q in range(n - 1):
                body += [f"cx q[{q}],q[{q + 1}];", f"rz(gamma[{layer}]) q[{q + 1}];", f"cx q[{q}],q[{q + 1}];"]
            body += [f"rx(beta[{layer}]) q[{q}];" for q in range(n)]
            p += 2
    else:
        raise HTTPException(status_code=422, detail="ansatz must be 'hea', 'uccsd' or 'qaoa'.")
    body += [f"measure q[{q}] -> c[{q}];" for q in range(n)]
    header = ["OPENQASM 2.0;", 'include "qelib1.inc";', f"qreg q[{n}];", f"creg c[{n}];"]
    return {"qasm": "\n".join(header + body), "n_params": p, "depth": _depth(body, n)}


@router.post("")
def hamiltonian_studio(req: HamiltonianRequest) -> Dict[str, Any]:
    terms = list(req.terms or req.pauli_terms)
    n = req.n_qubits
    preset = None
    if not terms and req.preset:
        preset = PRESETS.get(req.preset)
        if preset is None:
            raise HTTPException(status_code=422, detail=f"Unknown preset '{req.preset}'. Known: {', '.join(PRESETS)}.")
        terms = preset["build"](n)
    if not terms:
        raise HTTPException(status_code=422, detail="Give Pauli terms or a preset.")
    for t in terms:
        t.pauli_string = t.pauli_string.upper()
    lengths = {len(t.pauli_string) for t in terms}
    if len(lengths) != 1 or any(set(t.pauli_string) - set("IXYZ") for t in terms):
        raise HTTPException(status_code=422, detail="Every Pauli string must use only I, X, Y, Z and have the same length.")
    n = lengths.pop()
    if not 1 <= n <= MAX_QUBITS:
        raise HTTPException(status_code=422, detail=f"Up to {MAX_QUBITS} qubits can be diagonalised exactly.")

    eigenvalues = _spectrum(terms, n)
    total_weight = sum(abs(t.coefficient) for t in terms) or 1.0
    kind = (req.ansatz_type or req.ansatz or "hea").lower()
    ansatz = _ansatz(kind, n, req.n_layers) if req.generate_ansatz else {}
    return {
        "studio_id": str(uuid.uuid4()),
        "n_qubits": n,
        "preset": req.preset if preset else None,
        "formula": preset["formula"] if preset else None,
        "n_pauli_terms": len(terms),
        "total_terms": len(terms),
        "pauli_terms": [{"pauli_string": t.pauli_string, "coefficient": t.coefficient,
                         "weight": round(abs(t.coefficient) / total_weight, 6)} for t in terms],
        "ground_state_energy": round(eigenvalues[0], 8),
        "first_excited_energy": round(eigenvalues[1], 8),
        "spectral_gap": round(eigenvalues[1] - eigenvalues[0], 8),
        "eigenvalues": [round(e, 8) for e in eigenvalues[:16]],
        "is_commuting": _commuting(terms),
        "is_hermitian": True,  # real coefficients on Pauli strings
        "ansatz_type": kind,
        "ansatz_qasm": ansatz.get("qasm", ""),
        "n_ansatz_params": ansatz.get("n_params", 0),
        "ansatz_depth": ansatz.get("depth", 0),
        "method": METHOD,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/presets")
def list_presets() -> Dict[str, Any]:
    return {"presets": [{"key": k, "name": v["name"], "formula": v["formula"]} for k, v in PRESETS.items()]}
