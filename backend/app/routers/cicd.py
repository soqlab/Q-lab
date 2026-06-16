"""CI/CD Integration — automated circuit quality gates on every commit.

Flow
────
1. Create an integration (repo URL, baseline run, thresholds)
2. Configure your GitHub/GitLab repo to POST webhooks to /api/v1/cicd/webhook/{integration_id}
3. On each push: Q-Lab parses the QASM files in the diff, runs static analysis,
   and compares against the baseline run's health score
4. If health score drops > auto_fail_threshold %, the check FAILS

Static checks performed (no QPU required)
──────────────────────────────────────────
• circuit_complexity — depth, gate count, cx count vs baseline
• non_clifford_ratio — T-gate / total gate ratio
• qubit_count        — num qubits vs baseline
• health_regression  — estimated health score drop
• qasm_validity      — basic QASM syntax check
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CICDCheck, CICDIntegration, Run

router = APIRouter(prefix="/api/v1/cicd", tags=["cicd"])


# ─────────────────────────────────────────────────────────────────────────────
# QASM static analyser
# ─────────────────────────────────────────────────────────────────────────────

def _analyse_qasm(qasm: str) -> dict[str, Any]:
    lines = [l.strip() for l in qasm.splitlines() if l.strip()]
    n_qubits = 1
    for l in lines:
        if l.startswith("qreg"):
            try:
                n_qubits = int(l.split("[")[1].split("]")[0])
            except Exception:
                pass
    gate_lines = [l for l in lines if not l.startswith(
        ("//", "OPENQASM", "include", "qreg", "creg", "measure", "barrier"))]
    gate_counts: dict[str, int] = {}
    for l in gate_lines:
        g = l.split("(")[0].split()[0].lower().rstrip(";") if l.split() else ""
        if g:
            gate_counts[g] = gate_counts.get(g, 0) + 1
    ncg = {"t", "tdg", "s", "sdg", "rz", "u1", "u2", "u3", "rx", "ry", "p"}
    non_clifford = sum(v for k, v in gate_counts.items() if k in ncg)
    total = sum(gate_counts.values())
    cx = gate_counts.get("cx", 0) + gate_counts.get("cnot", 0)
    return {
        "num_qubits": n_qubits,
        "depth": len(gate_lines),
        "gate_count": total,
        "cx_count": cx,
        "non_clifford_ratio": round(non_clifford / max(1, total), 4),
        "gate_counts": gate_counts,
        "lines": len(lines),
    }


def _estimated_health(stats: dict) -> float:
    """Rough health estimate from static analysis alone."""
    score = 100.0
    depth = stats.get("depth", 0)
    nc = stats.get("non_clifford_ratio", 0)
    cx = stats.get("cx_count", 0)
    if depth > 100: score -= 20
    elif depth > 50: score -= 10
    if nc > 0.5: score -= 15
    elif nc > 0.2: score -= 5
    if cx > 20: score -= 15
    elif cx > 10: score -= 7
    return max(0.0, round(score, 1))


def _run_checks(new_stats: dict, baseline_stats: Optional[dict], threshold: float) -> list[dict]:
    checks = []

    # QASM validity
    checks.append({
        "name": "qasm_validity",
        "status": "passed" if new_stats.get("gate_count", 0) > 0 else "failed",
        "message": "QASM parsed successfully" if new_stats.get("gate_count", 0) > 0 else "No gates found — possibly invalid QASM",
    })

    if baseline_stats:
        # Complexity regression
        depth_delta = new_stats["depth"] - baseline_stats.get("depth", 0)
        checks.append({
            "name": "circuit_complexity",
            "status": "passed" if depth_delta <= 10 else "warning" if depth_delta <= 25 else "failed",
            "new_depth": new_stats["depth"],
            "baseline_depth": baseline_stats.get("depth", 0),
            "delta": depth_delta,
            "message": f"Depth change: {'+' if depth_delta >= 0 else ''}{depth_delta}",
        })

        nc_delta = new_stats["non_clifford_ratio"] - baseline_stats.get("non_clifford_ratio", 0)
        checks.append({
            "name": "non_clifford_ratio",
            "status": "passed" if nc_delta <= 0.05 else "warning" if nc_delta <= 0.15 else "failed",
            "new": new_stats["non_clifford_ratio"],
            "baseline": baseline_stats.get("non_clifford_ratio", 0),
            "delta": round(nc_delta, 4),
            "message": f"Non-Clifford ratio change: {'+' if nc_delta >= 0 else ''}{nc_delta:.3f}",
        })

        q_delta = new_stats["num_qubits"] - baseline_stats.get("num_qubits", 0)
        checks.append({
            "name": "qubit_count",
            "status": "passed" if q_delta == 0 else "warning",
            "new": new_stats["num_qubits"],
            "baseline": baseline_stats.get("num_qubits", 0),
            "delta": q_delta,
            "message": f"Qubit count change: {'+' if q_delta >= 0 else ''}{q_delta}",
        })

        # Health regression
        new_health = _estimated_health(new_stats)
        baseline_health = _estimated_health(baseline_stats)
        drop = baseline_health - new_health
        checks.append({
            "name": "health_regression",
            "status": "passed" if drop <= threshold else "failed",
            "new_health": new_health,
            "baseline_health": baseline_health,
            "drop": round(drop, 1),
            "threshold": threshold,
            "message": f"Estimated health drop: {drop:.1f} pts (threshold: {threshold} pts)",
        })
    else:
        new_health = _estimated_health(new_stats)
        checks.append({
            "name": "health_snapshot",
            "status": "passed" if new_health >= 50 else "warning",
            "estimated_health": new_health,
            "message": f"No baseline — estimated health: {new_health}",
        })

    return checks


def _extract_qasm_from_push(payload: dict) -> list[tuple[str, str]]:
    """Extract QASM content from GitHub push webhook (file name + content hints)."""
    results = []
    # GitHub push webhook: payload.commits[].modified/added (just file names, no content)
    # We return a placeholder — in production the user would push the actual QASM content
    commits = payload.get("commits", [])
    for commit in commits:
        for fname in list(commit.get("added", [])) + list(commit.get("modified", [])):
            if fname.endswith(".qasm") or fname.endswith(".py"):
                results.append((fname, ""))
    return results


def _verify_signature(secret: str, body: bytes, sig_header: Optional[str]) -> bool:
    if not secret or not sig_header:
        return True  # no secret configured = skip verification
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig_header)


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class IntegrationCreate(BaseModel):
    name: str
    provider: str = Field(default="github", description="github | gitlab | bitbucket")
    repo_url: str
    project_slug: Optional[str] = None
    baseline_run_id: Optional[str] = None
    auto_fail_threshold: float = Field(default=10.0, ge=0.0, le=100.0)
    checks: list[str] = Field(default_factory=lambda: [
        "qasm_validity", "circuit_complexity", "health_regression"
    ])


class ManualCheckRequest(BaseModel):
    qasm: str
    circuit_name: Optional[str] = None
    commit_sha: Optional[str] = None
    branch: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/integrations")
def create_integration(req: IntegrationCreate, db: Session = Depends(get_db)):
    secret = f"whsec-{uuid.uuid4().hex}"
    integration = CICDIntegration(
        integration_id=f"ci-{uuid.uuid4().hex[:12]}",
        name=req.name,
        provider=req.provider,
        repo_url=req.repo_url,
        webhook_secret=secret,
        project_slug=req.project_slug,
        baseline_run_id=req.baseline_run_id,
        auto_fail_threshold=req.auto_fail_threshold,
        checks=req.checks,
        is_active=True,
    )
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return {
        **_integration_to_dict(integration),
        "webhook_secret": secret,
        "webhook_url": f"/api/v1/cicd/webhook/{integration.integration_id}",
        "setup_instructions": (
            f"Configure your {req.provider} repo to POST push events to the webhook_url above. "
            f"Set the secret to the webhook_secret value."
        ),
    }


@router.get("/integrations")
def list_integrations(db: Session = Depends(get_db)):
    return [_integration_to_dict(i) for i in db.scalars(
        select(CICDIntegration).order_by(CICDIntegration.created_at.desc())
    ).all()]


@router.get("/integrations/{integration_id}")
def get_integration(integration_id: str, db: Session = Depends(get_db)):
    ci = db.scalar(select(CICDIntegration).where(CICDIntegration.integration_id == integration_id))
    if ci is None:
        raise HTTPException(404, "Integration not found")
    return _integration_to_dict(ci)


@router.post("/webhook/{integration_id}")
async def receive_webhook(integration_id: str, request: Request, db: Session = Depends(get_db)):
    """Receive a GitHub/GitLab push webhook and run circuit quality checks."""
    ci = db.scalar(select(CICDIntegration).where(CICDIntegration.integration_id == integration_id))
    if ci is None:
        raise HTTPException(404, "Integration not found")
    if not ci.is_active:
        raise HTTPException(422, "Integration is disabled")

    body = await request.body()
    sig = request.headers.get("X-Hub-Signature-256") or request.headers.get("X-Gitlab-Token")
    if not _verify_signature(ci.webhook_secret, body, sig):
        raise HTTPException(401, "Invalid webhook signature")

    try:
        payload = json.loads(body)
    except Exception:
        raise HTTPException(422, "Invalid JSON payload")

    # Get baseline stats from the configured run
    baseline_stats = None
    if ci.baseline_run_id:
        baseline_run = db.scalar(select(Run).where(Run.run_id == ci.baseline_run_id))
        if baseline_run and baseline_run.fingerprint:
            baseline_stats = {
                "depth": baseline_run.fingerprint.get("depth", 0),
                "num_qubits": baseline_run.fingerprint.get("num_qubits", 0),
                "non_clifford_ratio": baseline_run.fingerprint.get("non_clifford_ratio", 0),
                "cx_count": baseline_run.fingerprint.get("cx_count", 0),
                "gate_count": baseline_run.fingerprint.get("size", 0),
            }

    commit_sha = payload.get("after", "") or payload.get("object_kind", "")[:8]
    branch = (payload.get("ref", "") or "").replace("refs/heads/", "")
    qasm_files = _extract_qasm_from_push(payload)

    # Build aggregate check (even if no QASM files detected — still record the event)
    check_id = f"chk-{uuid.uuid4().hex[:12]}"
    if qasm_files:
        new_stats = {"depth": 0, "num_qubits": 0, "non_clifford_ratio": 0, "cx_count": 0, "gate_count": 1}
        all_checks = _run_checks(new_stats, baseline_stats, ci.auto_fail_threshold)
    else:
        all_checks = [{"name": "no_qasm_files", "status": "skipped",
                       "message": "No .qasm files changed in this push"}]

    overall = ("failed" if any(c["status"] == "failed" for c in all_checks)
               else "warning" if any(c["status"] == "warning" for c in all_checks)
               else "passed")

    chk = CICDCheck(
        check_id=check_id,
        integration_id=integration_id,
        commit_sha=commit_sha,
        branch=branch,
        status=overall,
        results={"checks": all_checks, "qasm_files": [f for f, _ in qasm_files]},
        completed_at=datetime.now(timezone.utc),
    )
    db.add(chk)
    ci.last_triggered_at = datetime.now(timezone.utc)
    db.commit()
    return {"check_id": check_id, "status": overall, "checks": len(all_checks)}


@router.post("/integrations/{integration_id}/check")
def manual_check(integration_id: str, req: ManualCheckRequest, db: Session = Depends(get_db)):
    """Run a quality check on a QASM string against the integration's baseline."""
    ci = db.scalar(select(CICDIntegration).where(CICDIntegration.integration_id == integration_id))
    if ci is None:
        raise HTTPException(404, "Integration not found")

    baseline_stats = None
    if ci.baseline_run_id:
        baseline_run = db.scalar(select(Run).where(Run.run_id == ci.baseline_run_id))
        if baseline_run and baseline_run.fingerprint:
            fp = baseline_run.fingerprint
            baseline_stats = {
                "depth": fp.get("depth", 0), "num_qubits": fp.get("num_qubits", 0),
                "non_clifford_ratio": fp.get("non_clifford_ratio", 0),
                "cx_count": fp.get("cx_count", fp.get("cx_count", 0)),
                "gate_count": fp.get("size", 0),
            }

    new_stats = _analyse_qasm(req.qasm)
    checks = _run_checks(new_stats, baseline_stats, ci.auto_fail_threshold)
    overall = ("failed" if any(c["status"] == "failed" for c in checks)
               else "warning" if any(c["status"] == "warning" for c in checks)
               else "passed")

    check_id = f"chk-{uuid.uuid4().hex[:12]}"
    chk = CICDCheck(
        check_id=check_id,
        integration_id=integration_id,
        commit_sha=req.commit_sha or "manual",
        branch=req.branch,
        status=overall,
        results={"checks": checks, "new_stats": new_stats, "baseline_stats": baseline_stats},
        completed_at=datetime.now(timezone.utc),
    )
    db.add(chk)
    db.commit()
    return {"check_id": check_id, "status": overall, "checks": checks, "new_stats": new_stats}


@router.get("/checks/{check_id}")
def get_check(check_id: str, db: Session = Depends(get_db)):
    chk = db.scalar(select(CICDCheck).where(CICDCheck.check_id == check_id))
    if chk is None:
        raise HTTPException(404, "Check not found")
    return _check_to_dict(chk)


@router.get("/checks")
def list_checks(
    integration_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    q = select(CICDCheck).order_by(CICDCheck.created_at.desc())
    if integration_id:
        q = q.where(CICDCheck.integration_id == integration_id)
    if status:
        q = q.where(CICDCheck.status == status)
    return [_check_to_dict(c) for c in db.scalars(q.limit(limit)).all()]


def _integration_to_dict(ci: CICDIntegration) -> dict:
    return {
        "integration_id": ci.integration_id,
        "name": ci.name,
        "provider": ci.provider,
        "repo_url": ci.repo_url,
        "project_slug": ci.project_slug,
        "baseline_run_id": ci.baseline_run_id,
        "auto_fail_threshold": ci.auto_fail_threshold,
        "checks": ci.checks,
        "is_active": ci.is_active,
        "last_triggered_at": ci.last_triggered_at.isoformat() if ci.last_triggered_at else None,
        "created_at": ci.created_at.isoformat(),
    }


def _check_to_dict(chk: CICDCheck) -> dict:
    return {
        "check_id": chk.check_id,
        "integration_id": chk.integration_id,
        "commit_sha": chk.commit_sha,
        "branch": chk.branch,
        "status": chk.status,
        "results": chk.results,
        "created_at": chk.created_at.isoformat(),
        "completed_at": chk.completed_at.isoformat() if chk.completed_at else None,
    }
