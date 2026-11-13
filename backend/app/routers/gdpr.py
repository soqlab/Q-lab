"""GDPR and Data Management Tools — Article 17 erasure, Article 20 portability, retention policies.

Endpoints:
  POST /api/v1/gdpr/export/request                  — request full data export
  GET  /api/v1/gdpr/export/{request_id}             — download exported data
  POST /api/v1/gdpr/delete/request                  — delete your account (locked now, erased after 7 days)
  GET  /api/v1/gdpr/delete/requests                 — deletion requests and scheduled erasures (admin)
  POST /api/v1/gdpr/delete/process                  — erase accounts whose grace period is over (admin)
  POST /api/v1/gdpr/anonymize/{run_id}              — anonymize a specific run
  POST /api/v1/gdpr/retention-policy                — create retention policy
  GET  /api/v1/gdpr/retention-policies              — list retention policies
  POST /api/v1/gdpr/retention-policy/{policy_id}/apply  — dry-run or apply policy
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
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, log_audit, require_auth, require_passkey_session, require_role
from ..models import Run, User
from ..store import store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/gdpr", tags=["gdpr"])

NS_REQUESTS = "gdpr_requests"
NS_POLICIES = "retention_policies"


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
    """GDPR Articles 15 and 20: everything Q-Lab holds about you, as JSON (app/erasure.py export()).

    The export is built when you download it, so it is always current and no copy is kept."""
    from ..erasure import export

    user = _require_user(identity)
    request_id = f"gdpr_exp_{uuid.uuid4().hex[:12]}"
    now = _utcnow_str()
    record_count = len(export(db, user)["runs"])
    store_put(db, NS_REQUESTS, request_id, {
        "request_id": request_id,
        "user_id": user.id,
        "request_type": "export",
        "status": "completed",
        "reason": None,
        "requested_at": now,
        "completed_at": now,
        "download_url": f"/api/v1/gdpr/export/{request_id}",
    })
    log_audit(db, action="gdpr.export.completed", resource_type="gdpr_export", resource_id=request_id,
              identity=identity)
    return {
        "request_id": request_id,
        "status": "completed",
        "record_count": record_count,
        "export_ready": True,
        "download_url": f"/api/v1/gdpr/export/{request_id}",
    }


@router.get("/export/{request_id}")
def download_export(
    request_id: str,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Download your export. Only the person who asked for it can download it."""
    from ..erasure import export

    user = _require_user(identity)
    req = store_get(db, NS_REQUESTS, request_id)
    if not req or req.get("request_type") != "export" or req.get("user_id") != user.id:
        raise HTTPException(404, "Export request not found")
    content = json.dumps(export(db, user), indent=2, default=str)
    return Response(
        content=content,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="qlab_export_{request_id}.json"'},
    )


@router.post("/delete/request")
def request_deletion(
    body: DeleteRequestBody,
    identity: Identity = Depends(require_passkey_session),
    db: Session = Depends(get_db),
):
    """GDPR Article 17: delete your account. The same as deleting it in Settings: the account is
    locked now and erased after the grace period (app/erasure.py); signing in before then cancels."""
    from .. import erasure
    from ..email_service import send_account_deletion_scheduled_email

    user = _require_user(identity)
    if not body.confirm:
        raise HTTPException(400, "confirm must be true to proceed with deletion request")

    request_id = f"gdpr_del_{uuid.uuid4().hex[:12]}"
    now = _utcnow_str()
    due = erasure.schedule(db, user, via="gdpr_request")
    erase_on = f"{due.day} {due:%B %Y}"
    store_put(db, NS_REQUESTS, request_id, {
        "request_id": request_id,
        "user_id": user.id,
        "request_type": "delete",
        "status": "scheduled",
        "reason": body.reason,
        "requested_at": now,
        "erase_at": due.isoformat(),
        "completed_at": None,
        "download_url": None,
    })
    if user.email:
        try:
            send_account_deletion_scheduled_email(to_email=user.email, user_name=user.name, erase_on=erase_on)
        except Exception:
            pass
    return {
        "request_id": request_id,
        "status": "scheduled",
        "erase_at": due.isoformat(),
        "message": (
            f"Your account is locked and will be erased on {erase_on}. Sign in with your passkey before "
            "then to cancel. Public share links have been turned off."
        ),
        "what_will_be_deleted": [
            "Your runs and everything attached to them (notes, metrics, results)",
            "Projects nobody else has runs in",
            "API keys, passkeys and recovery codes",
            "Saved provider keys, webhooks, notification channels and integration settings you made",
            "Your profile, preferences and other records you made",
            "Your organisation and its data, if you are its last member",
        ],
        "what_will_be_retained": [
            "Security log entries about the account, with the account replaced by an opaque code and "
            "without browser details",
        ],
        "contact": "contact@soqlab.com",
    }


@router.get("/delete/requests")
def list_deletion_requests(
    identity: Identity = Depends(require_role("admin", "owner")),
    db: Session = Depends(get_db),
):
    """Deletion requests and the erasures scheduled from them (admin use)."""
    from ..erasure import NS_PENDING

    deletions = [r for r in store_list(db, NS_REQUESTS) if r.get("request_type") == "delete"]
    return {"requests": deletions, "total": len(deletions), "scheduled": store_list(db, NS_PENDING)}


@router.post("/delete/process")
def process_deletions(
    identity: Identity = Depends(require_role("admin", "owner")),
    db: Session = Depends(get_db),
):
    """Erase now every account whose grace period is over (the server also does this hourly)."""
    from ..erasure import process_due

    erased = process_due(db)
    return {"erased": len(erased), "security_log_subjects": erased}


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
