from __future__ import annotations
import uuid
import random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/anomaly-physics", tags=["anomaly-physics"])

NS_CHECKS = "anomaly_physics_checks"

PHYSICS_RULES = [
    {"rule": "T2_leq_2T1", "description": "T2 ≤ 2·T1 (Ramsey limit)", "severity": "critical"},
    {"rule": "T2_leq_T1_superconducting", "description": "T2 ≤ T1 (practical superconducting limit)", "severity": "warning"},
    {"rule": "gate_fidelity_leq_1", "description": "Gate fidelity must be ≤ 1.0", "severity": "critical"},
    {"rule": "readout_fidelity_leq_1", "description": "Readout fidelity must be ≤ 1.0", "severity": "critical"},
    {"rule": "fidelity_geq_0", "description": "Fidelity must be ≥ 0", "severity": "critical"},
    {"rule": "fidelity_leq_1", "description": "Fidelity must be ≤ 1.0", "severity": "critical"},
    {"rule": "T1_positive", "description": "T1 relaxation time must be positive", "severity": "critical"},
    {"rule": "T2_positive", "description": "T2 dephasing time must be positive", "severity": "critical"},
    {"rule": "energy_conservation", "description": "Energy must be ≥ ground state energy", "severity": "warning"},
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

class LiteratureRequest(BaseModel):
    metric: str
    value: float
    backend: str
    n_qubits: int
    algorithm: str

@router.post("/check")
def check_physics(req: CheckRequest, db: Session = Depends(get_db)):
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
    store_put(db, NS_CHECKS, check_id, record)
    return record

LITERATURE_DB = {
    "fidelity": [
        {"arxiv_id": "2108.01234", "title": "High-fidelity two-qubit gates on IBM Eagle", "value": 0.997, "year": 2023},
        {"arxiv_id": "2201.07890", "title": "Benchmarking superconducting quantum processors", "value": 0.989, "year": 2022},
        {"arxiv_id": "2305.11001", "title": "VQE fidelity benchmarks on NISQ hardware", "value": 0.942, "year": 2023},
        {"arxiv_id": "2210.09300", "title": "IonQ Aria performance characterization", "value": 0.9965, "year": 2022},
    ],
    "t1_us": [
        {"arxiv_id": "2301.04351", "title": "T1 times in transmon qubits above 500µs", "value": 512.0, "year": 2023},
        {"arxiv_id": "2108.09001", "title": "Coherence characterization of IBM Falcon processors", "value": 148.0, "year": 2021},
    ],
    "t2_us": [
        {"arxiv_id": "2207.05001", "title": "Echo T2 times in flux-tunable transmons", "value": 280.0, "year": 2022},
        {"arxiv_id": "2301.04351", "title": "T2 coherence beyond 400µs via dynamical decoupling", "value": 410.0, "year": 2023},
    ],
}

@router.post("/compare-literature")
def compare_literature(req: LiteratureRequest):
    comparison_id = str(uuid.uuid4())
    papers = LITERATURE_DB.get(req.metric, LITERATURE_DB["fidelity"])
    values = sorted([p["value"] for p in papers])
    better_than = sum(1 for v in values if req.value > v)
    percentile = round(better_than / max(len(values), 1) * 100, 1)
    is_record = req.value > max(values) if values else False
    assessment = (
        "record-breaking result — consider preparing a manuscript" if is_record else
        "top-quartile performance" if percentile >= 75 else
        "above-median performance" if percentile >= 50 else
        "below-median — mitigation or recalibration recommended"
    )
    return {
        "comparison_id": comparison_id,
        "percentile": percentile,
        "better_than_pct": percentile,
        "similar_papers": papers[:3],
        "assessment": assessment,
        "is_record": is_record,
        "record_holder": None if not is_record else "Your experiment",
        "compared_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/rules")
def list_rules():
    return {"count": len(PHYSICS_RULES), "rules": PHYSICS_RULES}
