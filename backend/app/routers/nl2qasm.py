"""Natural Language → QASM Compiler — converts English descriptions to quantum circuits."""
from __future__ import annotations
import re, uuid
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/nl2qasm", tags=["nl2qasm"])

TEMPLATES = [
    {
        "pattern": r"bell\s*state|bell\s*pair|epr\s*pair",
        "name": "Bell State (Φ+)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;',
        "explanation": "Hadamard creates superposition on qubit 0; CNOT entangles it with qubit 1.",
        "n_qubits": 2, "confidence": 0.98,
    },
    {
        "pattern": r"ghz",
        "name": "GHZ State (3-qubit)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\nmeasure q -> c;',
        "explanation": "GHZ generalizes Bell state to 3 qubits with maximal tripartite entanglement.",
        "n_qubits": 3, "confidence": 0.97,
    },
    {
        "pattern": r"(quantum\s*)?fourier\s*transform|qft",
        "name": "Quantum Fourier Transform (3-qubit)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\nrz(1.5708) q[1];\ncx q[0],q[1];\nrz(-1.5708) q[1];\ncx q[0],q[1];\nrz(0.7854) q[2];\ncx q[0],q[2];\nrz(-0.7854) q[2];\ncx q[0],q[2];\nh q[1];\nrz(1.5708) q[2];\ncx q[1],q[2];\nrz(-1.5708) q[2];\ncx q[1],q[2];\nh q[2];\nswap q[0],q[2];\nmeasure q -> c;',
        "explanation": "3-qubit QFT using Hadamard gates and controlled phase rotations (Rz), then bit-reversal swap.",
        "n_qubits": 3, "confidence": 0.95,
    },
    {
        "pattern": r"grover",
        "name": "Grover Search (2-qubit, target |11⟩)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\nh q[1];\ncz q[0],q[1];\nh q[0];\nh q[1];\nx q[0];\nx q[1];\ncz q[0],q[1];\nx q[0];\nx q[1];\nh q[0];\nh q[1];\nmeasure q -> c;',
        "explanation": "Oracle marks |11⟩ with CZ phase flip; diffusion operator amplifies the marked state amplitude.",
        "n_qubits": 2, "confidence": 0.93,
    },
    {
        "pattern": r"teleport",
        "name": "Quantum Teleportation",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[1];\ncx q[1],q[2];\ncx q[0],q[1];\nh q[0];\nmeasure q[0] -> c[0];\nmeasure q[1] -> c[1];\ncx q[1],q[2];\ncz q[0],q[2];\nmeasure q[2] -> c[2];',
        "explanation": "Shares Bell pair between qubits 1-2; Bell measurement on qubits 0-1 transfers state to qubit 2.",
        "n_qubits": 3, "confidence": 0.94,
    },
    {
        "pattern": r"uniform\s*superposition|hadamard\s*all|all.*superposition",
        "name": "Uniform Superposition (3-qubit)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\nh q[1];\nh q[2];\nmeasure q -> c;',
        "explanation": "H on all qubits creates uniform superposition over all 2^n=8 computational basis states.",
        "n_qubits": 3, "confidence": 0.96,
    },
    {
        "pattern": r"swap\s*test",
        "name": "SWAP Test",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[1];\nh q[0];\ncx q[0],q[1];\nswap q[1],q[2];\ncx q[0],q[1];\nh q[0];\nmeasure q[0] -> c[0];',
        "explanation": "Estimates overlap |⟨ψ|φ⟩|² between two states using an ancilla and controlled-SWAP.",
        "n_qubits": 3, "confidence": 0.91,
    },
    {
        "pattern": r"phase\s*kickback|kickback",
        "name": "Phase Kickback",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\nx q[1];\nh q[1];\ncx q[0],q[1];\nh q[0];\nmeasure q -> c;',
        "explanation": "Target qubit eigenphase kicks back to control qubit — the basis of quantum phase estimation.",
        "n_qubits": 2, "confidence": 0.89,
    },
    {
        "pattern": r"(variational|vqe|ansatz)",
        "name": "Hardware-Efficient VQE Ansatz (4-qubit)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[4];\ncreg c[4];\nry(0.5) q[0];\nry(1.2) q[1];\nry(0.8) q[2];\nry(1.7) q[3];\ncx q[0],q[1];\ncx q[1],q[2];\ncx q[2],q[3];\nry(2.1) q[0];\nry(0.3) q[1];\nry(1.5) q[2];\nry(0.9) q[3];\nmeasure q -> c;',
        "explanation": "Ry rotation layers separated by CX entanglement — hardware-efficient ansatz for VQE.",
        "n_qubits": 4, "confidence": 0.92,
    },
    {
        "pattern": r"(entangl|w\s*state)",
        "name": "Linear Entanglement Chain (3-qubit)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\nmeasure q -> c;',
        "explanation": "Creates a linear entanglement chain: q0 entangles q1, q1 entangles q2.",
        "n_qubits": 3, "confidence": 0.90,
    },
    {
        "pattern": r"(random|bernstein|deutsch)",
        "name": "Deutsch–Jozsa (2-qubit)",
        "qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[1];\nh q[0];\nx q[1];\nh q[1];\ncx q[0],q[1];\nh q[0];\nmeasure q[0] -> c[0];',
        "explanation": "Determines if a function is constant or balanced in a single query using phase kickback.",
        "n_qubits": 2, "confidence": 0.88,
    },
]


class NL2QASMRequest(BaseModel):
    description: str
    n_qubits_hint: Optional[int] = None


@router.post("")
def compile_nl(req: NL2QASMRequest):
    desc = req.description.strip()
    for tmpl in TEMPLATES:
        if re.search(tmpl["pattern"], desc, re.IGNORECASE):
            n_g = len([l for l in tmpl["qasm"].split("\n") if l.strip()
                       and not l.strip().startswith(("OPENQASM", "include", "qreg", "creg", "//", "measure"))])
            return {
                "compile_id": f"nl2q-{uuid.uuid4().hex[:12]}",
                "input_description": req.description,
                "circuit_name": tmpl["name"],
                "qasm": tmpl["qasm"],
                "n_qubits": tmpl["n_qubits"],
                "n_gates": n_g,
                "confidence": tmpl["confidence"],
                "explanation": tmpl["explanation"],
                "is_exact_match": True,
                "suggestions": [],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

    n_q = req.n_qubits_hint or 2
    fallback = (
        f'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[{n_q}];\ncreg c[{n_q}];\n'
        + "\n".join(f"h q[{i}];" for i in range(n_q))
        + "\nmeasure q -> c;"
    )
    return {
        "compile_id": f"nl2q-{uuid.uuid4().hex[:12]}",
        "input_description": req.description,
        "circuit_name": "Generic Superposition",
        "qasm": fallback,
        "n_qubits": n_q,
        "n_gates": n_q,
        "confidence": 0.3,
        "explanation": f"No exact match found. Returned uniform superposition over {n_q} qubits.",
        "is_exact_match": False,
        "suggestions": [{"name": t["name"], "try_saying": re.sub(r"[|()?\\]", "", t["pattern"])[:40]} for t in TEMPLATES[:5]],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/examples")
def list_examples():
    return [{"name": t["name"], "pattern_hint": re.sub(r"[|()?\\]", "", t["pattern"])[:40], "n_qubits": t["n_qubits"]} for t in TEMPLATES]


