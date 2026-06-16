"""CI/CD quantum regression gates."""

from __future__ import annotations

import math
import secrets
import string
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_auth
from ..models import CICDCheck, CICDIntegration, Run

router = APIRouter(prefix="/api/v1/ci", tags=["ci_regression"])
_CHARS = string.ascii_lowercase + string.digits


class RegressionGateCreate(BaseModel):
    name: str = Field(..., max_length=200)
    repo_url: str = Field("local", max_length=500)
    project_slug: Optional[str] = Field(None, max_length=120)
    baseline_run_id: str = Field(..., max_length=64)
    fidelity_drop_threshold_pct: float = Field(2.0, ge=0.0, le=100.0)


class RegressionCheckRequest(BaseModel):
    run_id: str
    baseline_run_id: Optional[str] = None
    commit_sha: str = "manual"
    branch: Optional[str] = None
    fidelity_drop_threshold_pct: Optional[float] = None


def _new(prefix: str) -> str:
    return prefix + "_" + "".join(secrets.choice(_CHARS) for _ in range(14))


def _gate_counts(run: Run) -> dict[str, int]:
    return {str(k).lower(): int(v) for k, v in ((run.fingerprint or {}).get("gate_counts") or {}).items()}


def _structural_fidelity(a: Run, b: Run) -> dict[str, Any]:
    afp, bfp = a.fingerprint or {}, b.fingerprint or {}
    ac, bc = _gate_counts(a), _gate_counts(b)
    keys = set(ac) | set(bc)
    diff = sum(abs(ac.get(k, 0) - bc.get(k, 0)) for k in keys)
    total = max(1, sum(ac.values()) + sum(bc.values()))
    gate_score = max(0.0, 1.0 - diff / total)
    depth_a, depth_b = int(afp.get("depth") or 0), int(bfp.get("depth") or 0)
    qubits_a, qubits_b = int(afp.get("num_qubits") or 0), int(bfp.get("num_qubits") or 0)
    depth_score = 1.0 - min(1.0, abs(depth_a - depth_b) / max(1, max(depth_a, depth_b)))
    qubit_score = 1.0 if qubits_a == qubits_b else max(0.0, 1.0 - abs(qubits_a - qubits_b) / max(1, max(qubits_a, qubits_b)))
    qasm_equal = bool(a.qasm and b.qasm and a.qasm == b.qasm)
    fingerprint = round((0.55 * gate_score + 0.30 * depth_score + 0.15 * qubit_score) * (1.0 if not qasm_equal else 1.02), 6)
    return {
        "estimated_unitary_fidelity": min(1.0, fingerprint),
        "gate_score": round(gate_score, 6),
        "depth_score": round(depth_score, 6),
        "qubit_score": round(qubit_score, 6),
        "qasm_exact_match": qasm_equal,
        "gate_count_l1_delta": diff,
    }


@router.post("/regression-gates")
def create_gate(body: RegressionGateCreate, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    baseline = db.scalar(select(Run).where(Run.run_id == body.baseline_run_id))
    if baseline is None:
        raise HTTPException(404, "Baseline run not found")
    integ = CICDIntegration(
        integration_id=_new("ci"),
        org_id=identity.org_id,
        name=body.name,
        provider="webhook",
        repo_url=body.repo_url,
        webhook_secret=secrets.token_urlsafe(24),
        project_slug=body.project_slug,
        baseline_run_id=body.baseline_run_id,
        auto_fail_threshold=body.fidelity_drop_threshold_pct,
        checks=["unitary_fidelity_regression"],
    )
    db.add(integ)
    db.commit()
    db.refresh(integ)
    return {
        "integration_id": integ.integration_id,
        "name": integ.name,
        "project_slug": integ.project_slug,
        "baseline_run_id": integ.baseline_run_id,
        "fidelity_drop_threshold_pct": integ.auto_fail_threshold,
        "webhook_secret": integ.webhook_secret,
    }


@router.get("/regression-gates")
def list_gates(db: Session = Depends(get_db)):
    gates = db.scalars(select(CICDIntegration).order_by(CICDIntegration.created_at.desc()).limit(100)).all()
    return [
        {
            "integration_id": g.integration_id,
            "name": g.name,
            "project_slug": g.project_slug,
            "baseline_run_id": g.baseline_run_id,
            "fidelity_drop_threshold_pct": g.auto_fail_threshold,
            "is_active": g.is_active,
            "last_triggered_at": g.last_triggered_at.isoformat() if g.last_triggered_at else None,
        }
        for g in gates
    ]


@router.post("/regression-check")
def regression_check(body: RegressionCheckRequest, db: Session = Depends(get_db)):
    candidate = db.scalar(select(Run).where(Run.run_id == body.run_id))
    if candidate is None:
        raise HTTPException(404, "Candidate run not found")
    baseline_id = body.baseline_run_id
    if not baseline_id:
        gate = db.scalar(select(CICDIntegration).where(CICDIntegration.project_slug == candidate.project_slug, CICDIntegration.is_active == True).order_by(CICDIntegration.created_at.desc()))
        baseline_id = gate.baseline_run_id if gate else None
        threshold = gate.auto_fail_threshold if gate else (body.fidelity_drop_threshold_pct or 2.0)
    else:
        threshold = body.fidelity_drop_threshold_pct or 2.0
    if not baseline_id:
        raise HTTPException(422, "No baseline_run_id supplied or configured for project")
    baseline = db.scalar(select(Run).where(Run.run_id == baseline_id))
    if baseline is None:
        raise HTTPException(404, "Baseline run not found")
    fidelity = _structural_fidelity(baseline, candidate)
    drop_pct = round((1.0 - fidelity["estimated_unitary_fidelity"]) * 100.0, 4)
    passed = drop_pct <= threshold
    check = CICDCheck(
        check_id=_new("chk"),
        integration_id="manual",
        commit_sha=body.commit_sha,
        branch=body.branch,
        status="passed" if passed else "failed",
        results={"baseline_run_id": baseline_id, "candidate_run_id": body.run_id, "drop_pct": drop_pct, "threshold_pct": threshold, **fidelity},
    )
    db.add(check)
    db.commit()
    return {
        "check_id": check.check_id,
        "status": check.status,
        "passed": passed,
        "baseline_run_id": baseline_id,
        "candidate_run_id": body.run_id,
        "fidelity_drop_pct": drop_pct,
        "threshold_pct": threshold,
        **fidelity,
    }

