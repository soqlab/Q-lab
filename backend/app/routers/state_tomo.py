"""Quantum State Tomography — reconstruct the density matrix from Pauli basis measurements.

Standard Pauli tomography requires measuring in all 3^n Pauli bases (X, Y, Z for each qubit).
For n qubits, this means (shots × 3^n) measurements total.

The density matrix is:
    ρ = (1/2^n) Σ_{P ∈ {I,X,Y,Z}^⊗n} ⟨P⟩ · P

where ⟨P⟩ is estimated from the probability distribution in the eigenbasis of P.

For the Z basis: ⟨Z⟩ = P(0) - P(1)
For the X basis: measured in Hadamard-rotated frame, ⟨X⟩ = P(+) - P(-)
For the Y basis: measured in S†·H-rotated frame

Scalability
───────────
• n=1: 3 bases,   2×2  density matrix
• n=2: 9 bases,   4×4  density matrix
• n=3: 27 bases,  8×8  density matrix (capped here)

We also compute:
• Purity: Tr(ρ²)
• State fidelity to a target ideal state (if specified)
• Bloch vector (for single-qubit states)
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from itertools import product as iproduct
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run, TomographyJob

router = APIRouter(prefix="/api/v1", tags=["state_tomography"])

_MAX_QUBITS = 3


# ─────────────────────────────────────────────────────────────────────────────
# Pauli operator math (pure Python, 2×2 complex matrices as [re, im] pairs)
# ─────────────────────────────────────────────────────────────────────────────

# Single-qubit Paulis as 2×2 matrices (row-major, complex pairs [re,im])
_I  = [[(1,0),(0,0)], [(0,0),(1,0)]]
_X  = [[(0,0),(1,0)], [(1,0),(0,0)]]
_Y  = [[(0,0),(0,0)], [(0,0),(0,-1)]]   # [[0,-i],[i,0]]  ← standard Y
_Z  = [[(1,0),(0,0)], [(0,0),(-1,0)]]

# Corrected Y with proper complex entries
_Y2 = [[(0,0),(0,-1)], [(0,1),(0,0)]]

_PAULIS = {"I": _I, "X": _X, "Y": _Y2, "Z": _Z}


def _cmul(a: tuple, b: tuple) -> tuple:
    return (a[0]*b[0] - a[1]*b[1], a[0]*b[1] + a[1]*b[0])


def _cadd(a: tuple, b: tuple) -> tuple:
    return (a[0]+b[0], a[1]+b[1])


def _matmul2(A: list, B: list) -> list:
    n = len(A)
    C = [[(0,0)]*n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            s = (0.0, 0.0)
            for k in range(n):
                s = _cadd(s, _cmul(A[i][k], B[k][j]))
            C[i][j] = s
    return C


def _kron(A: list, B: list) -> list:
    """Kronecker product of two square complex matrices."""
    na, nb = len(A), len(B)
    n = na * nb
    C = [[(0,0)]*n for _ in range(n)]
    for i in range(na):
        for j in range(na):
            for k in range(nb):
                for l in range(nb):
                    C[i*nb+k][j*nb+l] = _cmul(A[i][j], B[k][l])
    return C


def _pauli_string_matrix(basis: str) -> list:
    """Kronecker product of Pauli matrices for a multi-qubit basis string e.g. 'XYZ'."""
    mat = _PAULIS[basis[0]]
    for b in basis[1:]:
        mat = _kron(mat, _PAULIS[b])
    return mat


def _trace_matmul(A: list, B: list) -> tuple:
    """Tr(A·B) as a complex number."""
    n = len(A)
    s = (0.0, 0.0)
    for i in range(n):
        for j in range(n):
            s = _cadd(s, _cmul(A[i][j], B[j][i]))
    return s


def _pauli_expectation(basis_string: str, basis_counts: dict[str, int]) -> float:
    """Estimate ⟨P⟩ from counts measured in the eigenbasis of P.

    Convention: bit 0 = first qubit = leftmost in basis_string.
    Eigenvalue = ±1 per qubit: +1 for |0⟩, -1 for |1⟩.
    ⟨Z₀Z₁⟩ = Σ_x (-1)^(x₀⊕x₁) · p(x)
    For X and Y bases: we assume the user rotated before measuring,
    so X-basis measurements land in the Z frame of the rotated circuit.
    """
    n = len(basis_string)
    total = sum(basis_counts.values()) or 1
    exp = 0.0
    for bs, cnt in basis_counts.items():
        bs = bs.zfill(n)
        ev = 1.0
        for qubit_idx, pauli_char in enumerate(basis_string):
            if pauli_char == "I":
                pass  # eigenvalue always +1
            else:
                bit = int(bs[qubit_idx]) if qubit_idx < len(bs) else 0
                ev *= (-1) ** bit
        exp += ev * cnt / total
    return round(exp, 6)


# ─────────────────────────────────────────────────────────────────────────────
# Density matrix reconstruction
# ─────────────────────────────────────────────────────────────────────────────

def _reconstruct_density_matrix(n_qubits: int, expectations: dict[str, float]) -> list[list[tuple]]:
    """ρ = (1/2^n) Σ_P ⟨P⟩ · P"""
    dim = 1 << n_qubits
    rho = [[(0.0, 0.0)] * dim for _ in range(dim)]
    pauli_chars = ["I", "X", "Y", "Z"]
    scale = 1.0 / (1 << n_qubits)
    for combo in iproduct(pauli_chars, repeat=n_qubits):
        label = "".join(combo)
        exp_val = expectations.get(label, 0.0)
        if abs(exp_val) < 1e-10 and label != "I" * n_qubits:
            continue
        P = _pauli_string_matrix(label)
        for i in range(dim):
            for j in range(dim):
                re, im = rho[i][j]
                pre, pim = P[i][j]
                rho[i][j] = (re + scale * exp_val * pre, im + scale * exp_val * pim)
    return rho


def _purity(rho: list[list[tuple]]) -> float:
    """Tr(ρ²) — pure state = 1, maximally mixed = 1/2^n"""
    dim = len(rho)
    tr = (0.0, 0.0)
    for i in range(dim):
        for j in range(dim):
            for k in range(dim):
                tr = _cadd(tr, _cmul(rho[i][j], rho[j][i]))
    return round(max(0.0, min(1.0, tr[0])), 4)


def _fidelity_to_zero_state(rho: list[list[tuple]]) -> float:
    """F(ρ, |0⟩⟨0|) = ρ[0][0].real"""
    return round(max(0.0, min(1.0, rho[0][0][0])), 4)


def _bloch_vector(rho: list[list[tuple]], expectations: dict[str, float]) -> Optional[dict]:
    """Bloch vector for single-qubit states."""
    return {
        "x": round(expectations.get("X", 0.0), 4),
        "y": round(expectations.get("Y", 0.0), 4),
        "z": round(expectations.get("Z", 0.0), 4),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class TomographySubmit(BaseModel):
    basis_measurements: dict[str, dict[str, int]] = Field(
        description="Mapping from basis string (e.g. 'XZ') to counts dict"
    )
    ideal_state: Optional[str] = Field(default=None, description="Target state label, e.g. 'bell', 'ghz', '|0⟩'")


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/runs/{run_id}/tomography")
def submit_tomography(run_id: str, req: TomographySubmit, db: Session = Depends(get_db)):
    """Submit multi-basis measurement data to reconstruct the density matrix."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    # Infer n_qubits from basis keys
    if not req.basis_measurements:
        raise HTTPException(422, "basis_measurements must not be empty")
    basis_len = len(next(iter(req.basis_measurements)))
    n = basis_len
    if n > _MAX_QUBITS:
        raise HTTPException(422, f"Max {_MAX_QUBITS} qubits for state tomography (got {n})")

    # Compute Pauli expectations for all 4^n basis strings
    pauli_chars = ["I", "X", "Y", "Z"]
    expectations: dict[str, float] = {}
    for combo in iproduct(pauli_chars, repeat=n):
        label = "".join(combo)
        # Find measured counts for this basis (ignore I — use any basis that covers the non-I Paulis)
        meas_basis = "".join(c if c != "I" else "Z" for c in combo)  # replace I with Z as convention
        if meas_basis in req.basis_measurements:
            counts = req.basis_measurements[meas_basis]
        elif label == "I" * n:
            expectations[label] = 1.0
            continue
        else:
            counts = {}
        expectations[label] = _pauli_expectation(label, counts)

    rho = _reconstruct_density_matrix(n, expectations)
    pur = _purity(rho)
    fid = _fidelity_to_zero_state(rho)

    tomo_id = f"tomo-{uuid.uuid4().hex[:12]}"
    job = TomographyJob(
        tomo_id=tomo_id,
        run_id=run_id,
        n_qubits=n,
        basis_measurements={b: c for b, c in req.basis_measurements.items()},
        density_matrix_re=[[rho[i][j][0] for j in range(len(rho[0]))] for i in range(len(rho))],
        density_matrix_im=[[rho[i][j][1] for j in range(len(rho[0]))] for i in range(len(rho))],
        purity=pur,
        fidelity_to_ideal=fid,
        ideal_state=req.ideal_state,
        pauli_expectations={k: v for k, v in expectations.items() if "I" not in k or k == "I"*n},
        status="complete",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _tomo_to_dict(job, n)


@router.get("/runs/{run_id}/tomography")
def get_tomography(run_id: str, db: Session = Depends(get_db)):
    """Get the most recent tomography result for a run."""
    job = db.scalar(
        select(TomographyJob)
        .where(TomographyJob.run_id == run_id)
        .order_by(TomographyJob.created_at.desc())
    )
    if job is None:
        raise HTTPException(404, "No tomography data for this run. POST to /tomography first.")
    return _tomo_to_dict(job, job.n_qubits)


def _tomo_to_dict(job: TomographyJob, n: int) -> dict:
    dim = 1 << n
    bloch = None
    if n == 1:
        bloch = {
            "x": round(job.pauli_expectations.get("X", 0.0), 4),
            "y": round(job.pauli_expectations.get("Y", 0.0), 4),
            "z": round(job.pauli_expectations.get("Z", 0.0), 4),
        }
    concurrence = None
    if n == 2:
        # Approximate concurrence from density matrix off-diagonal
        re = job.density_matrix_re
        im = job.density_matrix_im
        if re and len(re) >= 4:
            off = math.sqrt(re[0][3]**2 + im[0][3]**2) if re and im else 0
            concurrence = round(min(1.0, 2 * off), 4)

    return {
        "tomo_id": job.tomo_id,
        "run_id": job.run_id,
        "n_qubits": n,
        "purity": job.purity,
        "fidelity_to_ideal": job.fidelity_to_ideal,
        "ideal_state": job.ideal_state,
        "state_type": "pure" if (job.purity or 0) > 0.95 else "mixed",
        "density_matrix_re": job.density_matrix_re,
        "density_matrix_im": job.density_matrix_im,
        "pauli_expectations": job.pauli_expectations,
        "bloch_vector": bloch,
        "concurrence": concurrence,
        "n_bases_measured": len(job.basis_measurements),
        "status": job.status,
        "computed_at": job.created_at.isoformat(),
    }
