"""GDPR and Data Management Tools — Article 17 erasure, Article 20 portability, retention policies.

Endpoints:
  POST /api/v1/gdpr/export/request                  — request full data export
  GET  /api/v1/gdpr/export/{request_id}             — download exported data
  POST /api/v1/gdpr/delete/request                  — request account deletion
  GET  /api/v1/gdpr/delete/requests                 — list pending deletions (admin)
  POST /api/v1/gdpr/anonymize/{run_id}              — anonymize a specific run
  POST /api/v1/gdpr/retention-policy                — create retention policy
  GET  /api/v1/gdpr/retention-policies              — list retention policies
  POST /api/v1/gdpr/retention-policy/{policy_id}/apply  — dry-run or apply policy
  GET  /api/v1/gdpr/compliance-report               — GDPR compliance status report
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_identity, log_audit, require_auth, require_role, Identity
from ..models import AuditLog, Run, User
from ..store import store_delete, store_get, store_list, store_put, store_seed

router = APIRouter(prefix="/api/v1/gdpr", tags=["gdpr"])

NS_REQUESTS = "gdpr_requests"
NS_EXPORTS = "gdpr_exports"
NS_POLICIES = "retention_policies"

QLAB_VERSION = "1.0.0"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class DataExportRequest(BaseModel):
    request_id: str
    user_id: int
    request_type: str   # "export" | "delete" | "anonymize" | "portability"
    status: str         # "pending" | "processing" | "completed" | "failed"
    reason: Optional[str] = None
    requested_at: str
    completed_at: Optional[str] = None
    download_url: Optional[str] = None


class RetentionPolicy(BaseModel):
    policy_id: str
    name: str
    retain_runs_days: int = 0       # 0 = keep forever
    retain_logs_days: int = 2557    # ~7 years default for legal
    anonymize_after_days: int = 0   # 0 = never
    applies_to_projects: List[str] = []
    enabled: bool = True
    created_at: str


class DeleteRequestBody(BaseModel):
    confirm: bool
    reason: Optional[str] = None


class AnonymizeBody(BaseModel):
    confirm: bool


class RetentionPolicyInput(BaseModel):
    name: str
    retain_runs_days: int = 0
    retain_logs_days: int = 2557
    anonymize_after_days: int = 0
    applies_to_projects: List[str] = []
    enabled: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow_str() -> str:
    return datetime.now(timezone.utc).isoformat()


def _require_user(identity: Identity) -> User:
    if not identity.user:
        raise HTTPException(401, "Authentication required (legacy keys not supported)")
    return identity.user


def _serialize_run(r: Run) -> dict[str, Any]:
    return {
        "run_id": r.run_id,
        "circuit_name": r.circuit_name,
        "backend": r.backend,
        "status": r.status,
        "project_slug": r.project_slug,
        "qasm": r.qasm,
        "parameters": r.parameters,
        "calibration": r.calibration,
        "results": r.results,
        "tags": r.tags,
        "share_token": r.share_token,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _hash_pii(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/export/request")
def request_export(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """GDPR Article 20 — Data Portability. Generate full export immediately."""
    user = _require_user(identity)
    request_id = f"gdpr_exp_{uuid.uuid4().hex[:12]}"
    now = _utcnow_str()

    # Collect all runs for this user
    runs: list[Run] = db.scalars(
        select(Run).where(Run.created_by_user_id == user.id).order_by(Run.created_at.desc())
    ).all()

    # Collect projects touched by this user
    project_slugs = list({r.project_slug for r in runs if r.project_slug})

    export_payload = {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "runs": [_serialize_run(r) for r in runs],
        "projects": project_slugs,
        "export_date": now,
        "qlab_version": QLAB_VERSION,
        "gdpr_article": "Article 20 - Right to Data Portability",
    }

    # Store export
    store_put(db, NS_EXPORTS, request_id, export_payload)

    # Store request record
    req_record = {
        "request_id": request_id,
        "user_id": user.id,
        "request_type": "export",
        "status": "completed",
        "reason": None,
        "requested_at": now,
        "completed_at": now,
        "download_url": f"/api/v1/gdpr/export/{request_id}",
    }
    store_put(db, NS_REQUESTS, request_id, req_record)

    log_audit(
        db,
        action="gdpr.export.completed",
        resource_type="gdpr_export",
        resource_id=request_id,
        identity=identity,
    )

    return {
        "request_id": request_id,
        "status": "completed",
        "record_count": len(runs),
        "export_ready": True,
        "download_url": f"/api/v1/gdpr/export/{request_id}",
    }


@router.get("/export/{request_id}")
def download_export(
    request_id: str,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Download a previously generated export."""
    user = _require_user(identity)

    # Verify ownership
    req = store_get(db, NS_REQUESTS, request_id)
    if not req:
        raise HTTPException(404, "Export request not found")
    if req.get("user_id") != user.id and (not identity.role or identity.role not in ("admin", "owner")):
        raise HTTPException(403, "Access denied")

    export_data = store_get(db, NS_EXPORTS, request_id)
    if not export_data:
        raise HTTPException(404, "Export data not found or expired")

    content = json.dumps(export_data, indent=2, default=str)
    filename = f"qlab_gdpr_export_{user.id}_{request_id}.json"

    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/delete/request")
def request_deletion(
    body: DeleteRequestBody,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """GDPR Article 17 — Right to Erasure. Creates a pending deletion request."""
    user = _require_user(identity)

    if not body.confirm:
        raise HTTPException(400, "confirm must be true to proceed with deletion request")

    request_id = f"gdpr_del_{uuid.uuid4().hex[:12]}"
    now = _utcnow_str()

    req_record = {
        "request_id": request_id,
        "user_id": user.id,
        "request_type": "delete",
        "status": "pending_confirmation",
        "reason": body.reason,
        "requested_at": now,
        "completed_at": None,
        "download_url": None,
    }
    store_put(db, NS_REQUESTS, request_id, req_record)

    log_audit(
        db,
        action="gdpr.delete.requested",
        resource_type="gdpr_delete",
        resource_id=request_id,
        identity=identity,
        meta={"reason": body.reason},
    )

    return {
        "request_id": request_id,
        "status": "pending_confirmation",
        "message": (
            "Your deletion request has been received. An administrator will process it within "
            "30 days. Your data will be permanently deleted. This action is irreversible."
        ),
        "what_will_be_deleted": [
            "All run data",
            "API keys",
            "Organization membership",
            "Personal settings",
        ],
        "what_will_be_retained": [
            "Anonymized aggregate statistics",
            "Audit logs (required by law for 7 years)",
        ],
        "contact": "privacy@qlab.app",
    }


@router.get("/delete/requests")
def list_deletion_requests(
    identity: Identity = Depends(require_role("admin", "owner")),
    db: Session = Depends(get_db),
):
    """List all pending deletion requests (admin use)."""
    all_requests = store_list(db, NS_REQUESTS)
    deletions = [r for r in all_requests if r.get("request_type") == "delete"]
    return {"requests": deletions, "total": len(deletions)}


@router.post("/anonymize/{run_id}")
def anonymize_run(
    run_id: str,
    body: AnonymizeBody,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Anonymize a specific run — replace PII with hashes, keep scientific data."""
    user = _require_user(identity)

    if not body.confirm:
        raise HTTPException(400, "confirm must be true to proceed with anonymization")

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(404, "Run not found")

    # Only allow user to anonymize their own runs (or admin)
    if run.created_by_user_id != user.id and identity.role not in ("admin", "owner"):
        raise HTTPException(403, "Cannot anonymize another user's run")

    # Anonymize circuit_name
    if run.circuit_name:
        run.circuit_name = f"[ANONYMIZED-{_hash_pii(run.circuit_name)}]"

    # Anonymize parameters — scrub email/name-like values
    if run.parameters:
        clean_params: dict[str, Any] = {}
        for k, v in run.parameters.items():
            if isinstance(v, str) and ("@" in v or k.lower() in ("name", "email", "author", "user")):
                clean_params[k] = "[ANONYMIZED]"
            else:
                clean_params[k] = v
        run.parameters = clean_params

    # Add anonymized tag
    tags = list(run.tags or [])
    if "anonymized" not in tags:
        tags.append("anonymized")
    run.tags = tags

    db.commit()

    log_audit(
        db,
        action="gdpr.run.anonymized",
        resource_type="run",
        resource_id=run_id,
        identity=identity,
    )

    return {
        "run_id": run_id,
        "status": "anonymized",
        "message": "Circuit name and PII parameters have been replaced with hashes. QASM and results retained.",
    }


@router.post("/retention-policy")
def create_retention_policy(
    body: RetentionPolicyInput,
    identity: Identity = Depends(require_role("admin", "owner")),
    db: Session = Depends(get_db),
):
    """Create a data retention policy."""
    policy_id = f"rp_{uuid.uuid4().hex[:12]}"
    now = _utcnow_str()

    record = {
        "policy_id": policy_id,
        "name": body.name,
        "retain_runs_days": body.retain_runs_days,
        "retain_logs_days": body.retain_logs_days,
        "anonymize_after_days": body.anonymize_after_days,
        "applies_to_projects": body.applies_to_projects,
        "enabled": body.enabled,
        "created_at": now,
    }
    store_put(db, NS_POLICIES, policy_id, record)

    log_audit(
        db,
        action="gdpr.retention_policy.created",
        resource_type="retention_policy",
        resource_id=policy_id,
        identity=identity,
        meta={"name": body.name},
    )

    return record


@router.get("/retention-policies")
def list_retention_policies(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List all retention policies."""
    policies = store_list(db, NS_POLICIES)
    return {"policies": policies, "total": len(policies)}


@router.post("/retention-policy/{policy_id}/apply")
def apply_retention_policy(
    policy_id: str,
    dry_run: bool = Query(default=True),
    identity: Identity = Depends(require_role("admin", "owner")),
    db: Session = Depends(get_db),
):
    """Dry-run or apply a retention policy."""
    policy = store_get(db, NS_POLICIES, policy_id)
    if not policy:
        raise HTTPException(404, "Retention policy not found")

    now = datetime.now(timezone.utc)
    cutoff_runs: Optional[datetime] = None
    cutoff_anon: Optional[datetime] = None

    if policy.get("retain_runs_days", 0) > 0:
        cutoff_runs = now - timedelta(days=policy["retain_runs_days"])
    if policy.get("anonymize_after_days", 0) > 0:
        cutoff_anon = now - timedelta(days=policy["anonymize_after_days"])

    # Build query
    q = select(Run).order_by(Run.created_at.asc())
    if policy.get("applies_to_projects"):
        q = q.where(Run.project_slug.in_(policy["applies_to_projects"]))

    runs: list[Run] = db.scalars(q).all()

    affected_delete: list[Run] = []
    affected_anon: list[Run] = []

    for r in runs:
        if not r.created_at:
            continue
        dt = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
        if cutoff_runs and dt < cutoff_runs:
            affected_delete.append(r)
        elif cutoff_anon and dt < cutoff_anon and "anonymized" not in (r.tags or []):
            affected_anon.append(r)

    all_affected = affected_delete + affected_anon
    oldest = min((r.created_at for r in all_affected if r.created_at), default=None)
    newest = max((r.created_at for r in all_affected if r.created_at), default=None)

    if not dry_run:
        # Actually apply
        for r in affected_delete:
            db.delete(r)
        for r in affected_anon:
            if r.circuit_name:
                r.circuit_name = f"[ANONYMIZED-{_hash_pii(r.circuit_name)}]"
            tags = list(r.tags or [])
            if "anonymized" not in tags:
                tags.append("anonymized")
            r.tags = tags
        db.commit()

        log_audit(
            db,
            action="gdpr.retention_policy.applied",
            resource_type="retention_policy",
            resource_id=policy_id,
            identity=identity,
            meta={
                "deleted": len(affected_delete),
                "anonymized": len(affected_anon),
                "dry_run": False,
            },
        )

    return {
        "policy_id": policy_id,
        "policy_name": policy.get("name"),
        "dry_run": dry_run,
        "runs_to_delete": len(affected_delete),
        "runs_to_anonymize": len(affected_anon),
        "runs_affected": len(all_affected),
        "oldest_affected_date": oldest.isoformat() if oldest else None,
        "newest_affected_date": newest.isoformat() if newest else None,
        "applied": not dry_run,
    }


@router.get("/compliance-report")
def compliance_report(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Generate a GDPR compliance status report."""
    now = _utcnow_str()

    total_users = db.scalar(select(func.count()).select_from(User)) or 0
    total_runs = db.scalar(select(func.count()).select_from(Run)) or 0

    # Oldest data
    oldest_run = db.scalar(select(Run.created_at).order_by(Run.created_at.asc()).limit(1))

    all_requests = store_list(db, NS_REQUESTS)
    pending_deletions = sum(
        1 for r in all_requests
        if r.get("request_type") == "delete" and r.get("status") in ("pending_confirmation", "pending")
    )

    policies = store_list(db, NS_POLICIES)
    active_policies = sum(1 for p in policies if p.get("enabled", True))

    recommendations = []
    if not policies:
        recommendations.append("No retention policies defined. Consider setting a retention policy to manage data lifecycle.")
    if pending_deletions > 0:
        recommendations.append(f"{pending_deletions} pending deletion request(s). Process within 30 days as required by GDPR.")
    if oldest_run:
        age_days = (datetime.now(timezone.utc) - (oldest_run if oldest_run.tzinfo else oldest_run.replace(tzinfo=timezone.utc))).days
        if age_days > 365 * 3 and not policies:
            recommendations.append("Data older than 3 years exists without a retention policy. Consider reviewing data minimisation obligations.")
    if not recommendations:
        recommendations.append("No immediate compliance issues detected.")

    return {
        "generated_at": now,
        "total_users": total_users,
        "total_runs": total_runs,
        "pending_deletion_requests": pending_deletions,
        "retention_policies_active": active_policies,
        "oldest_data_date": oldest_run.isoformat() if oldest_run else None,
        "data_categories": {
            "circuit_data": "Scientific/technical data — not personal data under GDPR recital 26",
            "user_accounts": "Personal data (username, email) — requires lawful basis",
            "api_keys": "Technical data — functional necessity for service delivery",
            "audit_logs": "Operational logs — retained 7 years per legal/regulatory requirement",
        },
        "lawful_basis": "Legitimate interest (scientific research, Art. 89) and contractual necessity (Art. 6(1)(b))",
        "data_processors": [
            "Anthropic (AI insights — optional feature, no data retained beyond session)",
            "Resend (email delivery — optional, only when notifications enabled)",
        ],
        "data_subject_rights": {
            "access": "GET /api/v1/gdpr/export/request",
            "portability": "GET /api/v1/gdpr/export/request",
            "erasure": "POST /api/v1/gdpr/delete/request",
            "rectification": "PUT /api/v1/users/me",
        },
        "recommendations": recommendations,
    }
