"""Circuit AI Designer.

Converts natural-language descriptions into valid OpenQASM 2.0 circuits and
Qiskit Python code using Claude.

Router prefix: /api/v1/circuit-designer
"""
from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/circuit-designer", tags=["circuit-designer"])

_MODEL = "claude-sonnet-4-6"
_NAMESPACE = "circuit_designs"

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class DesignRequest(BaseModel):
    description: str
    n_qubits: Optional[int] = None
    backend: Optional[str] = None
    complexity: str = "intermediate"  # simple | intermediate | advanced
    include_measurements: bool = True
    optimization_goal: Optional[str] = None  # depth | gate_count | fidelity | balanced


class DesignResult(BaseModel):
    design_id: str
    description: str
    qasm_circuit: str
    python_code: str
    circuit_info: dict
    explanation: str
    usage_tips: List[str]
    suggested_backends: List[str]
    created_at: str


# ---------------------------------------------------------------------------
# Claude call
# ---------------------------------------------------------------------------

def _call_claude(
    description: str,
    n_qubits: Optional[int],
    backend: Optional[str],
    complexity: str,
    include_measurements: bool,
    optimization_goal: Optional[str],
) -> dict:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "Circuit Designer requires ANTHROPIC_API_KEY")

    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "anthropic package not installed. Run: pip install anthropic")

    system = (
        "You are an expert quantum circuit designer. You generate valid OpenQASM 2.0 circuits "
        "and Qiskit Python code. Always respond with valid JSON. Circuits must be syntactically "
        "correct QASM that can be parsed by Qiskit. "
        "Use only standard gates: h, cx, x, y, z, s, t, rx, ry, rz, measure. "
        "Include qubit register declarations. For n qubits use: qreg q[n]; creg c[n];"
    )

    user = f"""Design a quantum circuit for: {description}

Constraints:
- Target qubits: {n_qubits or "choose appropriate number"}
- Backend: {backend or "general"}
- Complexity: {complexity}
- Include measurements: {include_measurements}
- Optimization goal: {optimization_goal or "balanced"}

Respond with JSON:
{{
  "qasm_circuit": "OPENQASM 2.0;\\ninclude \\"qelib1.inc\\";\\n...",
  "python_code": "from qiskit import QuantumCircuit\\nqc = QuantumCircuit(N)\\n...",
  "n_qubits": N,
  "estimated_depth": D,
  "gate_counts": {{"h": 3, "cx": 4, "rz": 8}},
  "explanation": "This circuit implements... using... because...",
  "usage_tips": ["tip1", "tip2"],
  "suggested_backends": ["ibm_sherbrooke", "ibm_cairo"]
}}"""

    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=_MODEL,
        max_tokens=2000,
        temperature=0.2,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    raw = msg.content[0].text.strip()

    # Extract JSON — Claude may wrap in code fences
    json_match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not json_match:
        raise HTTPException(500, "Claude returned a non-JSON response. Please try again.")
    try:
        return json.loads(json_match.group())
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Failed to parse Claude JSON response: {exc}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/design", response_model=DesignResult)
def design_circuit(req: DesignRequest, db: Session = Depends(get_db)):
    """Generate a quantum circuit from a natural-language description."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise HTTPException(503, "Circuit Designer requires ANTHROPIC_API_KEY")

    claude_resp = _call_claude(
        description=req.description,
        n_qubits=req.n_qubits,
        backend=req.backend,
        complexity=req.complexity,
        include_measurements=req.include_measurements,
        optimization_goal=req.optimization_goal,
    )

    design_id = f"cd-{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc).isoformat()

    n_qubits_out = int(claude_resp.get("n_qubits") or req.n_qubits or 1)
    est_depth = int(claude_resp.get("estimated_depth") or 0)
    gate_counts: dict = claude_resp.get("gate_counts") or {}
    total_gates = sum(gate_counts.values()) if gate_counts else 0

    circuit_info = {
        "n_qubits": n_qubits_out,
        "depth": est_depth,
        "gate_counts": gate_counts,
        "total_gates": total_gates,
        "estimated_depth": est_depth,
    }

    result: dict[str, Any] = {
        "design_id": design_id,
        "description": req.description,
        "qasm_circuit": claude_resp.get("qasm_circuit", ""),
        "python_code": claude_resp.get("python_code", ""),
        "circuit_info": circuit_info,
        "explanation": claude_resp.get("explanation", ""),
        "usage_tips": claude_resp.get("usage_tips") or [],
        "suggested_backends": claude_resp.get("suggested_backends") or [],
        "created_at": now,
        # preserve request metadata for listing
        "complexity": req.complexity,
        "optimization_goal": req.optimization_goal,
        "backend_hint": req.backend,
    }

    store_put(db, _NAMESPACE, design_id, result)
    return DesignResult(**{k: result[k] for k in DesignResult.model_fields})


@router.get("/designs")
def list_designs(db: Session = Depends(get_db)):
    """Return the most recent 20 circuit designs."""
    all_records = store_list(db, _NAMESPACE)
    # sort newest first by created_at
    sorted_records = sorted(all_records, key=lambda r: r.get("created_at", ""), reverse=True)
    return sorted_records[:20]


@router.get("/design/{design_id}")
def get_design(design_id: str, db: Session = Depends(get_db)):
    """Retrieve a specific circuit design by ID."""
    rec = store_get(db, _NAMESPACE, design_id)
    if rec is None:
        raise HTTPException(404, f"Design {design_id!r} not found")
    return rec


@router.post("/design/{design_id}/submit-run")
def submit_run(design_id: str, db: Session = Depends(get_db)):
    """Return the QASM for manual submission to Q-Lab runs endpoint."""
    rec = store_get(db, _NAMESPACE, design_id)
    if rec is None:
        raise HTTPException(404, f"Design {design_id!r} not found")
    return {
        "qasm": rec.get("qasm_circuit", ""),
        "circuit_name": rec.get("description", "")[:50],
        "message": "Use the SDK or POST /api/v1/runs with this QASM",
    }


@router.get("/examples")
def list_examples():
    """Return 8 example prompts that work well with the circuit designer."""
    return {
        "examples": [
            "Design a 4-qubit Grover search circuit for the target state |1010⟩",
            "Create a VQE ansatz with 3 layers of hardware-efficient gates for 5 qubits",
            "Build a quantum teleportation circuit with error detection",
            "Design a QAOA circuit for 6-node MaxCut problem, p=2 layers",
            "Create a quantum Fourier transform for 4 qubits",
            "Build a Bell state preparation circuit with parity checks",
            "Design a Bernstein-Vazirani circuit for a 5-bit secret string",
            "Create a quantum phase estimation circuit for a simple unitary",
        ]
    }
