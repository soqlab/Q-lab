from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_role
from ..models import AuditLog, Benchmark, Organization, Run, User, Webhook

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
        },
        "users": user_count,
        "organizations": org_count,
        "webhooks": webhook_count,
        "benchmarks": benchmark_count,
        "audit_events": audit_count,
    }


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
