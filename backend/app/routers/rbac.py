"""Role-Based Access Control (RBAC) management API.

Built on top of the existing User.role field (owner | admin | researcher | viewer).

Permission matrix
─────────────────
Action                  owner  admin  researcher  viewer
──────────────────────────────────────────────────────────
submit run               ✓      ✓       ✓          ✗
delete run               ✓      ✓       ✗          ✗
view runs                ✓      ✓       ✓          ✓
manage users             ✓      ✓       ✗          ✗
view audit log           ✓      ✓       ✓          ✗
change roles             ✓      ✗       ✗          ✗
manage webhooks          ✓      ✓       ✗          ✗
manage budgets           ✓      ✓       ✗          ✗
submit jobs              ✓      ✓       ✓          ✗
manage cicd              ✓      ✓       ✗          ✗
manage circuit versions  ✓      ✓       ✓          ✗
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_auth, get_identity
from ..models import AuditLog, User

router = APIRouter(prefix="/api/v1/rbac", tags=["rbac"])

# ─────────────────────────────────────────────────────────────────────────────
# Role definitions
# ─────────────────────────────────────────────────────────────────────────────

_ROLE_RANK = {"viewer": 0, "researcher": 1, "admin": 2, "owner": 3}

_PERMISSIONS: dict[str, list[str]] = {
    "owner":      ["submit_run", "delete_run", "view_runs", "manage_users", "view_audit",
                   "change_roles", "manage_webhooks", "manage_budgets", "submit_jobs",
                   "manage_cicd", "manage_circuit_versions", "manage_org"],
    "admin":      ["submit_run", "delete_run", "view_runs", "manage_users", "view_audit",
                   "manage_webhooks", "manage_budgets", "submit_jobs",
                   "manage_cicd", "manage_circuit_versions"],
    "researcher": ["submit_run", "view_runs", "view_audit", "submit_jobs", "manage_circuit_versions"],
    "viewer":     ["view_runs"],
}

_ROLE_DESCRIPTIONS = {
    "owner":      "Full platform access, including billing and org management",
    "admin":      "Can manage users, webhooks, and all experiment data",
    "researcher": "Can submit and view experiments, submit jobs",
    "viewer":     "Read-only access to experiment results",
}


def _can(identity: Identity, permission: str) -> bool:
    perms = _PERMISSIONS.get(identity.role or "viewer", [])
    return permission in perms


def require_permission(permission: str):
    """Dependency factory: raise 403 if the identity lacks the given permission."""
    def _check(identity: Identity = Depends(require_auth)):
        if not _can(identity, permission):
            raise HTTPException(403, f"Permission denied: '{permission}' requires role admin or higher.")
        return identity
    return _check


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class RoleChangeRequest(BaseModel):
    role: str


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/roles")
def list_roles():
    """Return all roles, their permissions, and descriptions."""
    return {
        "roles": [
            {
                "name": role,
                "rank": rank,
                "description": _ROLE_DESCRIPTIONS[role],
                "permissions": _PERMISSIONS[role],
            }
            for role, rank in sorted(_ROLE_RANK.items(), key=lambda x: x[1], reverse=True)
        ],
        "total_permissions": sorted(set(p for perms in _PERMISSIONS.values() for p in perms)),
    }


@router.get("/permissions")
def my_permissions(identity: Identity = Depends(require_auth)):
    """Return the current user's role and permissions."""
    role = identity.role or "viewer"
    return {
        "user_id": identity.user_id,
        "role": role,
        "rank": _ROLE_RANK.get(role, 0),
        "permissions": _PERMISSIONS.get(role, []),
        "description": _ROLE_DESCRIPTIONS.get(role, ""),
    }


@router.get("/users")
def list_users_with_roles(
    identity: Identity = Depends(require_permission("manage_users")),
    db: Session = Depends(get_db),
):
    """List all users with their roles (admin+ only)."""
    q = select(User)
    if identity.org_id:
        q = q.where(User.org_id == identity.org_id)
    users = db.scalars(q.order_by(User.created_at.desc())).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "rank": _ROLE_RANK.get(u.role, 0),
            "permissions": _PERMISSIONS.get(u.role, []),
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.patch("/users/{user_id}/role")
def change_user_role(
    user_id: int,
    req: RoleChangeRequest,
    identity: Identity = Depends(require_permission("change_roles")),
    db: Session = Depends(get_db),
):
    """Change a user's role (owner only)."""
    if req.role not in _ROLE_RANK:
        raise HTTPException(422, f"Invalid role '{req.role}'. Must be one of: {list(_ROLE_RANK)}")

    # Cannot promote anyone to owner rank (unless self-demotion)
    if req.role == "owner" and identity.user_id != user_id:
        raise HTTPException(403, "Cannot grant owner role to another user.")

    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise HTTPException(404, "User not found")
    if identity.org_id and user.org_id != identity.org_id:
        raise HTTPException(403, "Cannot modify users outside your organisation")

    old_role = user.role
    user.role = req.role
    db.commit()

    # Audit
    log = AuditLog(
        org_id=identity.org_id,
        user_id=identity.user_id,
        action="rbac.role_changed",
        resource_type="user",
        resource_id=str(user_id),
        meta={"old_role": old_role, "new_role": req.role},
    )
    db.add(log)
    db.commit()

    return {"user_id": user_id, "old_role": old_role, "new_role": req.role}


@router.get("/audit-log")
def audit_log(
    action: Optional[str] = None,
    resource_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    identity: Identity = Depends(require_permission("view_audit")),
    db: Session = Depends(get_db),
):
    """Paginated audit log (researcher+ only)."""
    q = select(AuditLog).order_by(AuditLog.created_at.desc())
    if identity.org_id:
        q = q.where(AuditLog.org_id == identity.org_id)
    if action:
        q = q.where(AuditLog.action == action)
    if resource_type:
        q = q.where(AuditLog.resource_type == resource_type)
    total = db.scalar(
        select(__import__('sqlalchemy', fromlist=['func']).func.count())
        .select_from(AuditLog)
    ) or 0
    logs = db.scalars(q.offset(offset).limit(limit)).all()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [_log_to_dict(l) for l in logs],
    }


def _log_to_dict(log: AuditLog) -> dict:
    return {
        "id": log.id,
        "action": log.action,
        "resource_type": log.resource_type,
        "resource_id": log.resource_id,
        "user_id": log.user_id,
        "ip_address": log.ip_address,
        "meta": log.meta,
        "created_at": log.created_at.isoformat(),
    }
