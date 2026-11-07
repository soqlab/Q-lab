"""Physical-consistency checks on reported device figures (T1, T2, fidelities).

Fixed rules: T2 <= 2*T1, positivity, fidelities within [0, 1]. Each check reports the observed
value and the limit it was compared with. Nothing is estimated, and results are not stored.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/v1/anomaly-physics", tags=["anomaly-physics"])

PHYSICS_RULES = [
    {"rule": "T2_leq_2T1", "description": "T2 ≤ 2·T1 (Ramsey limit)", "severity": "critical"},
    {"rule": "T2_leq_T1_superconducting", "description": "T2 ≤ T1 (practical superconducting limit)", "severity": "warning"},
    {"rule": "gate_fidelity_leq_1", "description": "Gate fidelity must be ≤ 1.0", "severity": "critical"},
    {"rule": "readout_fidelity_leq_1", "description": "Readout fidelity must be ≤ 1.0", "severity": "critical"},
    {"rule": "fidelity_geq_0", "description": "Fidelity must be ≥ 0", "severity": "critical"},
    {"rule": "fidelity_leq_1", "description": "Fidelity must be ≤ 1.0", "severity": "critical"},
    {"rule": "T1_positive", "description": "T1 relaxation time must be positive", "severity": "critical"},
    {"rule": "T2_positive", "description": "T2 dephasing time must be positive", "severity": "critical"},
]

class CheckRequest(BaseModel):
    t1_us: Optional[float] = None
    t2_us: Optional[float] = None
    gate_fidelity: Optional[float] = None
    readout_fidelity: Optional[float] = None
    energy: Optional[float] = None
    fidelity: Optional[float] = None
    backend: Optional[str] = None
    n_qubits: Optional[int] = None

@router.post("/check")
def check_physics(req: CheckRequest):
    check_id = str(uuid.uuid4())
    violations = []
    warnings = []
    passed = []

    if req.t1_us is not None and req.t2_us is not None:
        if req.t2_us > 2 * req.t1_us:
            violations.append({
                "rule": "T2_leq_2T1", "severity": "critical",
                "observed": req.t2_us, "limit": 2 * req.t1_us,
                "explanation": f"T2={req.t2_us}µs exceeds Ramsey bound 2·T1={2*req.t1_us}µs — physically impossible"
            })
        else:
            passed.append("T2_leq_2T1")
        if req.t2_us > req.t1_us:
            warnings.append({"rule": "T2_leq_T1_superconducting",
                             "message": f"T2={req.t2_us}µs > T1={req.t1_us}µs; unusual for superconducting qubits"})
        else:
            passed.append("T2_leq_T1_superconducting")

    if req.t1_us is not None:
        if req.t1_us <= 0:
            violations.append({"rule": "T1_positive", "severity": "critical",
                                "observed": req.t1_us, "limit": 0, "explanation": "T1 must be strictly positive"})
        else:
            passed.append("T1_positive")

    if req.t2_us is not None:
        if req.t2_us <= 0:
            violations.append({"rule": "T2_positive", "severity": "critical",
                                "observed": req.t2_us, "limit": 0, "explanation": "T2 must be strictly positive"})
        else:
            passed.append("T2_positive")

    if req.gate_fidelity is not None:
        if req.gate_fidelity > 1.0:
            violations.append({"rule": "gate_fidelity_leq_1", "severity": "critical",
                                "observed": req.gate_fidelity, "limit": 1.0, "explanation": "Fidelity > 1 is non-physical"})
        else:
            passed.append("gate_fidelity_leq_1")

    if req.readout_fidelity is not None:
        if req.readout_fidelity > 1.0:
            violations.append({"rule": "readout_fidelity_leq_1", "severity": "critical",
                                "observed": req.readout_fidelity, "limit": 1.0, "explanation": "Readout fidelity > 1 is non-physical"})
        else:
            passed.append("readout_fidelity_leq_1")

    if req.fidelity is not None:
        if req.fidelity < 0:
            violations.append({"rule": "fidelity_geq_0", "severity": "critical",
                                "observed": req.fidelity, "limit": 0, "explanation": "Negative fidelity is non-physical"})
        else:
            passed.append("fidelity_geq_0")
        if req.fidelity > 1.0:
            violations.append({"rule": "fidelity_leq_1", "severity": "critical",
                                "observed": req.fidelity, "limit": 1.0, "explanation": "Fidelity > 1 is non-physical"})
        else:
            passed.append("fidelity_leq_1")

    n_total = len(violations) + len(warnings) + len(passed)
    physics_score = round(len(passed) / max(n_total, 1), 3)
    record = {
        "check_id": check_id,
        "violations": violations,
        "warnings": warnings,
        "passed": passed,
        "overall_valid": len(violations) == 0,
        "physics_score": physics_score,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
    return record

@router.get("/rules")
def list_rules():
    return {"count": len(PHYSICS_RULES), "rules": PHYSICS_RULES}
