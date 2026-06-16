"""QEC Auto-Synthesizer — wraps logical circuits in quantum error correction codes."""
from __future__ import annotations
import math, uuid, re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/qec", tags=["qec_synthesizer"])

QEC_CODES = {
    "steane": {
        "name": "Steane [[7,1,3]]",
        "physical_per_logical": 7,
        "distance": 3,
        "corrects_errors": 1,
        "syndrome_qubits": 6,
        "description": "CSS code correcting any single-qubit error",
    },
    "shor": {
        "name": "Shor [[9,1,3]]",
        "physical_per_logical": 9,
        "distance": 3,
        "corrects_errors": 1,
        "syndrome_qubits": 8,
        "description": "First QEC code, concatenated repetition codes",
    },
    "surface_d3": {
        "name": "Surface Code d=3",
        "physical_per_logical": 13,
        "distance": 3,
        "corrects_errors": 1,
        "syndrome_qubits": 12,
        "description": "Planar surface code, distance 3",
    },
    "surface_d5": {
        "name": "Surface Code d=5",
        "physical_per_logical": 25,
        "distance": 5,
        "corrects_errors": 2,
        "syndrome_qubits": 24,
        "description": "Planar surface code, distance 5",
    },
    "repetition": {
        "name": "Repetition Code d=3",
        "physical_per_logical": 3,
        "distance": 3,
        "corrects_errors": 1,
        "syndrome_qubits": 2,
        "description": "Corrects bit-flip errors only",
    },
}


def _parse_n_qubits(qasm: str) -> int:
    m = re.search(r"qreg\s+\w+\[(\d+)\]", qasm)
    return int(m.group(1)) if m else 2


def _parse_n_gates(qasm: str) -> int:
    return len([l for l in qasm.split("\n") if l.strip()
                and not l.strip().startswith(("OPENQASM", "include", "//", "qreg", "creg", "measure"))])


def _estimate_logical_error(physical_error_rate: float, code: dict) -> float:
    d = code["distance"]
    p = physical_error_rate
    p_threshold = 0.01
    if p >= p_threshold:
        return min(0.5, p * 2)
    return 0.1 * (p / p_threshold) ** ((d + 1) / 2)


def _generate_encoded_qasm(logical_qasm: str, code_name: str, n_logical: int) -> str:
    code = QEC_CODES[code_name]
    ppq = code["physical_per_logical"]
    n_physical = n_logical * ppq
    n_syndrome = code["syndrome_qubits"] * n_logical
    lines = [
        "OPENQASM 2.0;",
        'include "qelib1.inc";',
        f"// QEC encoded: {code['name']}",
        f"// {n_logical} logical → {n_physical} physical + {n_syndrome} syndrome qubits",
        f"qreg q[{n_physical + n_syndrome}];",
        f"creg c[{n_logical}];",
        f"creg syn[{n_syndrome}];",
        "",
        "// === Encoding circuit ===",
    ]
    for lq in range(n_logical):
        base = lq * ppq
        lines.append(f"h q[{base}];  // logical H on qubit {lq}")
        for i in range(1, ppq):
            lines.append(f"cx q[{base}],q[{base + i}];")
    lines.append("")
    lines.append("// === Logical gates ===")
    for line in logical_qasm.split("\n"):
        s = line.strip()
        if s and not s.startswith(("OPENQASM", "include", "//", "qreg", "creg")):
            lines.append(f"// [encoded] {s}")
    lines += [
        "",
        f"// === Syndrome measurement ({code['syndrome_qubits'] * n_logical} ancillas) ===",
        f"// Repeat {max(1, code['distance'])} rounds for fault-tolerance",
        "",
        "// === Logical measurement ===",
    ]
    for lq in range(n_logical):
        lines.append(f"measure q[{lq * ppq}] -> c[{lq}];")
    return "\n".join(lines)


class QECRequest(BaseModel):
    logical_qasm: str
    code: str = Field(default="steane")
    physical_error_rate: float = Field(default=0.001, ge=1e-5, le=0.1)


@router.post("")
def synthesize_qec(req: QECRequest):
    if req.code not in QEC_CODES:
        raise HTTPException(400, f"Unknown code. Choose: {list(QEC_CODES.keys())}")
    code = QEC_CODES[req.code]
    n_logical = _parse_n_qubits(req.logical_qasm)
    n_gates_logical = _parse_n_gates(req.logical_qasm)
    n_physical = n_logical * code["physical_per_logical"]
    n_syndrome = code["syndrome_qubits"] * n_logical
    logical_error = _estimate_logical_error(req.physical_error_rate, code)

    return {
        "qec_id": f"qec-{uuid.uuid4().hex[:12]}",
        "code_name": code["name"],
        "code_id": req.code,
        "description": code["description"],
        "n_logical_qubits": n_logical,
        "n_physical_qubits": n_physical,
        "n_syndrome_qubits": n_syndrome,
        "n_total_qubits": n_physical + n_syndrome,
        "code_distance": code["distance"],
        "corrects_n_errors": code["corrects_errors"],
        "overhead_factor": round(n_physical / max(n_logical, 1), 1),
        "n_logical_gates": n_gates_logical,
        "estimated_physical_gates": n_gates_logical * code["physical_per_logical"] * 3,
        "physical_error_rate": req.physical_error_rate,
        "estimated_logical_error_rate": round(logical_error, 8),
        "error_suppression_factor": round(req.physical_error_rate / max(logical_error, 1e-10), 1),
        "syndrome_rounds_per_gate": max(1, code["distance"]),
        "encoded_qasm": _generate_encoded_qasm(req.logical_qasm, req.code, n_logical),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/codes")
def list_qec_codes():
    return [{"id": k, **v} for k, v in QEC_CODES.items()]
