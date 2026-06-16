import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_auth, require_role
from ..email_service import send_invite_email
from ..models import OrgInvite, Organization, User

router = APIRouter(prefix="/api/v1/team", tags=["team"])

VALID_ROLES = {"owner", "admin", "researcher", "viewer"}
INVITE_EXPIRY_DAYS = 7


class InvitePayload(BaseModel):
    email: str
    role: str = "researcher"


class ChangeRolePayload(BaseModel):
    role: str


# ------------------------------------------------------------------
# Members
# ------------------------------------------------------------------

@router.get("/members")
def list_members(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    if not identity.org_id:
        return []
    users = db.scalars(
        select(User)
        .where(User.org_id == identity.org_id, User.is_active.is_(True))
        .order_by(User.created_at.asc())
    ).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]


@router.patch("/members/{user_id}/role")
def change_member_role(
    user_id: int,
    payload: ChangeRolePayload,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(sorted(VALID_ROLES))}")
    u = db.scalar(select(User).where(User.id == user_id, User.org_id == identity.org_id))
    if not u:
        raise HTTPException(status_code=404, detail="User not found in this org")
    if u.id == identity.user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    u.role = payload.role
    db.commit()
    return {"id": u.id, "role": u.role}


@router.delete("/members/{user_id}")
def remove_member(
    user_id: int,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    u = db.scalar(select(User).where(User.id == user_id, User.org_id == identity.org_id))
    if not u:
        raise HTTPException(status_code=404, detail="User not found in this org")
    if u.id == identity.user_id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
    u.org_id = None
    u.role = "researcher"
    db.commit()
    return {"removed": True}


# ------------------------------------------------------------------
# Invites
# ------------------------------------------------------------------

@router.post("/invite")
def invite_member(
    payload: InvitePayload,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    if not identity.org_id:
        raise HTTPException(status_code=400, detail="You are not part of an organization")
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role. Must be one of: {', '.join(sorted(VALID_ROLES))}")

    # Re-use existing pending invite for same email
    existing = db.scalar(
        select(OrgInvite).where(
            OrgInvite.org_id == identity.org_id,
            OrgInvite.email == payload.email,
            OrgInvite.accepted_at.is_(None),
        )
    )
    if existing and existing.expires_at > datetime.now(timezone.utc):
        return {
            "invite_token": existing.token,
            "invite_url": f"http://localhost:3000/join?token={existing.token}",
            "email": existing.email,
            "role": existing.role,
            "expires_at": existing.expires_at.isoformat(),
        }

    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=INVITE_EXPIRY_DAYS)
    invite = OrgInvite(
        org_id=identity.org_id,
        email=payload.email,
        role=payload.role,
        token=token,
        invited_by_user_id=identity.user_id,
        expires_at=expires,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    # Fire-and-forget invite email — never let email failure break the invite flow
    try:
        org = db.get(Organization, identity.org_id)
        send_invite_email(
            to_email=payload.email,
            invite_url=f"http://localhost:3000/join?token={token}",
            org_name=org.name if org else "Q-Lab",
            invited_by=(identity.user.email if identity.user else None) or "a teammate",
        )
    except Exception:
        pass  # email is best-effort; invite was already committed

    return {
        "invite_token": token,
        "invite_url": f"http://localhost:3000/join?token={token}",
        "email": payload.email,
        "role": payload.role,
        "expires_at": expires.isoformat(),
    }


@router.get("/invites")
def list_invites(
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    if not identity.org_id:
        return []
    invites = db.scalars(
        select(OrgInvite)
        .where(OrgInvite.org_id == identity.org_id)
        .order_by(OrgInvite.created_at.desc())
    ).all()
    return [
        {
            "id": i.id,
            "email": i.email,
            "role": i.role,
            "accepted_at": i.accepted_at.isoformat() if i.accepted_at else None,
            "expires_at": i.expires_at.isoformat(),
            "created_at": i.created_at.isoformat(),
            "invite_url": f"http://localhost:3000/join?token={i.token}" if not i.accepted_at else None,
            "token": i.token if not i.accepted_at else None,
        }
        for i in invites
    ]


@router.delete("/invites/{invite_id}")
def revoke_invite(
    invite_id: int,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    invite = db.scalar(
        select(OrgInvite).where(OrgInvite.id == invite_id, OrgInvite.org_id == identity.org_id)
    )
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    db.delete(invite)
    db.commit()
    return {"revoked": True}


# ------------------------------------------------------------------
# Public invite validation + accept (no auth required for validate)
# ------------------------------------------------------------------

@router.get("/invite/validate")
def validate_invite(token: str = Query(...), db: Session = Depends(get_db)):
    invite = db.scalar(select(OrgInvite).where(OrgInvite.token == token))
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.accepted_at:
        raise HTTPException(status_code=409, detail="Invite already accepted")
    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Invite has expired")
    org = db.scalar(select(Organization).where(Organization.id == invite.org_id))
    return {
        "email": invite.email,
        "role": invite.role,
        "org_name": org.name if org else "Unknown",
        "expires_at": invite.expires_at.isoformat(),
    }


@router.post("/invite/accept")
def accept_invite(
    token: str = Query(...),
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    invite = db.scalar(select(OrgInvite).where(OrgInvite.token == token))
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.accepted_at:
        raise HTTPException(status_code=409, detail="Invite already accepted")
    if invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Invite has expired")

    u = identity.user
    if not u:
        raise HTTPException(status_code=401)

    u.org_id = invite.org_id
    u.role = invite.role
    invite.accepted_at = datetime.now(timezone.utc)
    db.commit()

    return {"joined": True, "org_id": invite.org_id, "role": invite.role}
