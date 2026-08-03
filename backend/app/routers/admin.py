from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, delete
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_role
from ..models import APIKey, AuditLog, Benchmark, Organization, Run, User, Webhook

VALID_ROLES = {"owner", "admin", "researcher", "viewer"}

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/audit-logs")
def list_audit_logs(
    action: Optional[str] = None,
    user_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    logs = db.scalars(query.offset(offset).limit(limit)).all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "id": lg.id,
                "action": lg.action,
                "resource_type": lg.resource_type,
                "resource_id": lg.resource_id,
                "user_id": lg.user_id,
                "org_id": lg.org_id,
                "ip_address": lg.ip_address,
                "meta": lg.meta or {},
                "created_at": lg.created_at.isoformat(),
            }
            for lg in logs
        ],
    }


@router.delete("/audit-logs/purge")
def purge_old_audit_logs(
    days: int = Query(default=30, ge=1, le=365),
    identity: Identity = Depends(require_role("owner")),
    db: Session = Depends(get_db),
):
    """Delete audit logs older than `days` days. Owner only."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    result = db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
    db.commit()
    return {"deleted": result.rowcount, "older_than_days": days}


@router.get("/stats")
def system_stats(
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    run_count = db.scalar(select(func.count()).select_from(Run)) or 0
    user_count = db.scalar(select(func.count()).select_from(User)) or 0
    org_count = db.scalar(select(func.count()).select_from(Organization)) or 0
    webhook_count = db.scalar(select(func.count()).select_from(Webhook)) or 0
    benchmark_count = db.scalar(select(func.count()).select_from(Benchmark)) or 0
    audit_count = db.scalar(select(func.count()).select_from(AuditLog)) or 0

    completed = db.scalar(select(func.count()).select_from(Run).where(Run.status == "completed")) or 0
    failed = db.scalar(select(func.count()).select_from(Run).where(Run.status == "failed")) or 0

    return {
        "runs": {
            "total": run_count,
            "completed": completed,
            "failed": failed,
            "completion_rate": round(completed / run_count, 3) if run_count else 0,
            "failure_rate": round(failed / run_count, 3) if run_count else 0,
        },
        "users": user_count,
        "organizations": org_count,
        "webhooks": webhook_count,
        "benchmarks": benchmark_count,
        "audit_events": audit_count,
    }


@router.get("/users")
def list_users(
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    users = db.scalars(select(User).order_by(User.created_at.desc())).all()
    user_run_counts = dict(
        db.execute(
            select(Run.created_by_user_id, func.count(Run.id))
            .group_by(Run.created_by_user_id)
        ).all()
    )
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "is_active": u.is_active,
            "org_id": u.org_id,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "run_count": user_run_counts.get(u.id, 0),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "login_count": u.login_count or 0,
        }
        for u in users
    ]


@router.get("/organizations")
def list_organizations(
    identity: Identity = Depends(require_role("owner")),
    db: Session = Depends(get_db),
):
    orgs = db.scalars(select(Organization).order_by(Organization.created_at.desc())).all()
    return [
        {
            "id": o.id,
            "slug": o.slug,
            "name": o.name,
            "plan": o.plan,
            "created_at": o.created_at.isoformat(),
        }
        for o in orgs
    ]


@router.get("/users/{user_id}/activity")
def user_activity(
    user_id: int,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    run_count = db.scalar(select(func.count()).select_from(Run).where(Run.created_by_user_id == user_id)) or 0
    api_key_count = db.scalar(select(func.count()).select_from(APIKey).where(APIKey.user_id == user_id)) or 0
    logs = db.scalars(
        select(AuditLog).where(AuditLog.user_id == user_id)
        .order_by(AuditLog.created_at.desc()).limit(20)
    ).all()
    return {
        "user_id": user_id,
        "email": user.email,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "login_count": user.login_count or 0,
        "run_count": run_count,
        "api_key_count": api_key_count,
        "recent_actions": [
            {"action": lg.action, "resource_type": lg.resource_type, "created_at": lg.created_at.isoformat()}
            for lg in logs
        ],
    }


@router.delete("/users/{user_id}")
def remove_user(
    user_id: int,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == identity.user_id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account")
    if user.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can remove other owners")
    user.is_active = False
    db.commit()
    return {"message": f"User {user.email} has been deactivated"}


class RolePayload(BaseModel):
    role: str


@router.patch("/users/{user_id}/role")
def update_user_role(
    user_id: int,
    body: RolePayload,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == identity.user_id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    if body.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can grant owner role")
    if user.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can change an owner's role")
    user.role = body.role
    db.commit()
    return {"id": user.id, "email": user.email, "role": user.role}


@router.patch("/users/{user_id}/reactivate")
def reactivate_user(
    user_id: int,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "owner" and identity.role != "owner":
        raise HTTPException(status_code=403, detail="Only owners can reactivate an owner account")
    user.is_active = True
    db.commit()
    return {"message": f"User {user.email} has been reactivated"}


@router.delete("/users/{user_id}/purge")
def purge_user(
    user_id: int,
    identity: Identity = Depends(require_role("owner")),
    db: Session = Depends(get_db),
):
    """Permanently delete a user and all their data. Owner only."""
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == identity.user_id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    email = user.email
    # Unlink runs (preserve history but remove attribution)
    db.execute(
        Run.__table__.update()
        .where(Run.created_by_user_id == user_id)
        .values(created_by_user_id=None)
    )
    # Delete API keys
    db.execute(APIKey.__table__.delete().where(APIKey.user_id == user_id))
    db.delete(user)
    db.commit()
    return {"message": f"User {email} has been permanently deleted"}
