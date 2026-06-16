"""Circuit Template Library — pre-built and user-defined QASM circuits.

Built-in templates are seeded on first startup (see seed_builtin_templates()).
Users can add custom templates via POST.

Categories: entanglement | vqe | qft | grover | benchmark | custom | error_correction
"""
from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CircuitTemplate

router = APIRouter(prefix="/api/v1/templates", tags=["circuit_templates"])


# ─────────────────────────────────────────────────────────────────────────────
# Built-in template library
# ─────────────────────────────────────────────────────────────────────────────

BUILTIN_TEMPLATES = [
    {
        "name": "Bell State |Φ+⟩",
        "category": "entanglement",
        "description": "Maximum entanglement between 2 qubits. Foundation of quantum teleportation and superdense coding.",
        "n_qubits": 2,
        "tags": ["bell", "entanglement", "epr"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q[0] -> c[0];
measure q[1] -> c[1];""",
    },
    {
        "name": "GHZ State (3 qubits)",
        "category": "entanglement",
        "description": "Greenberger-Horne-Zeilinger state — maximal multipartite entanglement across 3 qubits.",
        "n_qubits": 3,
        "tags": ["ghz", "entanglement", "multipartite"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cx q[0],q[1];
cx q[0],q[2];
measure q -> c;""",
    },
    {
        "name": "Quantum Fourier Transform (3 qubits)",
        "category": "qft",
        "description": "QFT on 3 qubits. Core subroutine of Shor's algorithm and phase estimation.",
        "n_qubits": 3,
        "tags": ["qft", "fourier", "shor"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
h q[0];
cp(pi/2) q[1],q[0];
cp(pi/4) q[2],q[0];
h q[1];
cp(pi/2) q[2],q[1];
h q[2];
swap q[0],q[2];
measure q -> c;""",
    },
    {
        "name": "Grover's Search (2 qubits, target |11⟩)",
        "category": "grover",
        "description": "Grover amplitude amplification for 2-qubit space. Marks and amplifies |11⟩.",
        "n_qubits": 2,
        "tags": ["grover", "search", "amplitude-amplification"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
h q[1];
cz q[0],q[1];
h q[0];
h q[1];
x q[0];
x q[1];
cz q[0],q[1];
x q[0];
x q[1];
h q[0];
h q[1];
measure q -> c;""",
    },
    {
        "name": "Randomized Benchmarking Unit",
        "category": "benchmark",
        "description": "Single Clifford gate + inverse for RB calibration. Identity in the absence of noise.",
        "n_qubits": 1,
        "tags": ["rb", "benchmark", "calibration"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];
h q[0];
s q[0];
sdg q[0];
h q[0];
measure q[0] -> c[0];""",
    },
    {
        "name": "QAOA MaxCut (2 nodes)",
        "category": "vqe",
        "description": "QAOA p=1 circuit for MaxCut on a 2-node graph. Parameterised with gamma=π/4, beta=π/8.",
        "n_qubits": 2,
        "tags": ["qaoa", "maxcut", "optimization"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
h q[1];
cx q[0],q[1];
rz(0.785398) q[1];
cx q[0],q[1];
rx(0.392699) q[0];
rx(0.392699) q[1];
measure q -> c;""",
    },
    {
        "name": "VQE Hydrogen Ansatz (H₂)",
        "category": "vqe",
        "description": "Hardware-efficient ansatz for H₂ ground state. 2 qubits, UCCSD-inspired.",
        "n_qubits": 2,
        "tags": ["vqe", "chemistry", "h2", "ansatz"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
x q[0];
ry(0.5) q[0];
ry(0.5) q[1];
cx q[0],q[1];
ry(-0.5) q[1];
cx q[0],q[1];
measure q -> c;""",
    },
    {
        "name": "Bit Flip Repetition Code (3 qubits)",
        "category": "error_correction",
        "description": "3-qubit repetition code for bit-flip error correction. Encodes 1 logical qubit.",
        "n_qubits": 3,
        "tags": ["qec", "repetition-code", "error-correction"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
// Encode logical |0>
cx q[0],q[1];
cx q[0],q[2];
// Syndrome measurement via ancilla would follow
measure q -> c;""",
    },
    {
        "name": "Teleportation Protocol",
        "category": "entanglement",
        "description": "3-qubit quantum teleportation of q[0] state using an EPR pair (q[1],q[2]).",
        "n_qubits": 3,
        "tags": ["teleportation", "bell", "protocol"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
// Prepare message qubit q[0] in |+>
h q[0];
// Create Bell pair
h q[1];
cx q[1],q[2];
// Bell measurement
cx q[0],q[1];
h q[0];
measure q[0] -> c[0];
measure q[1] -> c[1];
// Conditional corrections (classically controlled)
if(c[1]==1) x q[2];
if(c[0]==1) z q[2];
measure q[2] -> c[2];""",
    },
    {
        "name": "W State (3 qubits)",
        "category": "entanglement",
        "description": "W-class entangled state: (|100⟩ + |010⟩ + |001⟩)/√3. Robust against qubit loss.",
        "n_qubits": 3,
        "tags": ["w-state", "entanglement", "robust"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];
ry(1.9106) q[0];
cx q[0],q[1];
ry(0.7854) q[1];
cx q[1],q[2];
ry(-0.7854) q[1];
cx q[0],q[1];
measure q -> c;""",
    },
    {
        "name": "Quantum Phase Estimation",
        "category": "benchmark",
        "description": "QPE circuit estimating phase θ=0.25 of a T gate unitary on 3 counting qubits.",
        "n_qubits": 4,
        "tags": ["qpe", "phase", "estimation"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[4];
creg c[4];
// Counting qubits
h q[0];
h q[1];
h q[2];
// Eigenstate
x q[3];
// Controlled-U operations
cp(0.785398) q[0],q[3];
cp(1.570796) q[1],q[3];
cp(3.141593) q[2],q[3];
// Inverse QFT
h q[2];
cp(-1.570796) q[1],q[2];
h q[1];
cp(-0.785398) q[0],q[2];
cp(-1.570796) q[0],q[1];
h q[0];
measure q -> c;""",
    },
    {
        "name": "Hadamard Test",
        "category": "benchmark",
        "description": "Hadamard test circuit for estimating ⟨ψ|U|ψ⟩ with ancilla qubit.",
        "n_qubits": 2,
        "tags": ["hadamard-test", "expectation", "ancilla"],
        "qasm": """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[1];
h q[0];
cx q[0],q[1];
h q[0];
measure q[0] -> c[0];""",
    },
]


def seed_builtin_templates(db: Session) -> None:
    """Insert built-in templates if the table is empty."""
    existing = db.scalar(select(CircuitTemplate).where(CircuitTemplate.is_builtin == True))
    if existing is not None:
        return
    for t in BUILTIN_TEMPLATES:
        row = CircuitTemplate(
            template_id=f"tpl-{uuid.uuid4().hex[:12]}",
            name=t["name"],
            category=t["category"],
            description=t["description"],
            qasm=t["qasm"],
            n_qubits=t["n_qubits"],
            parameters=[],
            tags=t["tags"],
            is_builtin=True,
            use_count=0,
        )
        db.add(row)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class TemplateCreate(BaseModel):
    name: str
    category: str = "custom"
    description: str = ""
    qasm: str
    n_qubits: int = Field(ge=1, le=100)
    parameters: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Serializer
# ─────────────────────────────────────────────────────────────────────────────

def _to_dict(t: CircuitTemplate, include_qasm: bool = True) -> dict:
    d: dict[str, Any] = {
        "template_id": t.template_id,
        "name": t.name,
        "category": t.category,
        "description": t.description,
        "n_qubits": t.n_qubits,
        "parameters": t.parameters,
        "tags": t.tags,
        "is_builtin": t.is_builtin,
        "use_count": t.use_count,
        "created_at": t.created_at.isoformat(),
    }
    if include_qasm:
        d["qasm"] = t.qasm
    return d


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("")
def list_templates(
    category: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
    builtin_only: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """List templates, optionally filtered."""
    seed_builtin_templates(db)
    query = select(CircuitTemplate).order_by(CircuitTemplate.use_count.desc())
    if category:
        query = query.where(CircuitTemplate.category == category)
    if builtin_only:
        query = query.where(CircuitTemplate.is_builtin == True)
    templates = db.scalars(query.limit(limit)).all()
    if tag:
        templates = [t for t in templates if tag in (t.tags or [])]
    if q:
        ql = q.lower()
        templates = [t for t in templates if ql in t.name.lower() or ql in t.description.lower()]
    return [_to_dict(t, include_qasm=False) for t in templates]


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    seed_builtin_templates(db)
    templates = db.scalars(select(CircuitTemplate)).all()
    cats: dict[str, int] = {}
    for t in templates:
        cats[t.category] = cats.get(t.category, 0) + 1
    return [{"category": k, "count": v} for k, v in sorted(cats.items())]


@router.get("/{template_id}")
def get_template(template_id: str, db: Session = Depends(get_db)):
    t = db.scalar(select(CircuitTemplate).where(CircuitTemplate.template_id == template_id))
    if t is None:
        raise HTTPException(404, "Template not found")
    t.use_count += 1
    db.commit()
    return _to_dict(t, include_qasm=True)


@router.post("")
def create_template(req: TemplateCreate, db: Session = Depends(get_db)):
    t = CircuitTemplate(
        template_id=f"tpl-{uuid.uuid4().hex[:12]}",
        name=req.name,
        category=req.category,
        description=req.description,
        qasm=req.qasm,
        n_qubits=req.n_qubits,
        parameters=req.parameters,
        tags=req.tags,
        is_builtin=False,
        use_count=0,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _to_dict(t)


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db)):
    t = db.scalar(select(CircuitTemplate).where(CircuitTemplate.template_id == template_id))
    if t is None:
        raise HTTPException(404, "Template not found")
    if t.is_builtin:
        raise HTTPException(403, "Cannot delete built-in templates")
    db.delete(t)
    db.commit()
