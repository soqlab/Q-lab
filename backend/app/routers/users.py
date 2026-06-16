from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import generate_api_key, hash_password, verify_password
from ..database import get_db
from ..deps import Identity, require_auth, require_role
from ..models import APIKey, User

router = APIRouter(prefix="/api/v1/users", tags=["users"])


class CreateKeyPayload(BaseModel):
    name: str
    expires_days: Optional[int] = None


class UpdateProfilePayload(BaseModel):
    name: Optional[str] = None


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


@router.get("/me")
def get_me(identity: Identity = Depends(require_auth)):
    u = identity.user
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated as a user")
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "org_id": u.org_id,
        "created_at": u.created_at.isoformat(),
    }


@router.patch("/me")
def update_me(
    payload: UpdateProfilePayload,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    u = identity.user
    if not u:
        raise HTTPException(status_code=401)
    if payload.name:
        u.name = payload.name
    db.commit()
    db.refresh(u)
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role}


@router.post("/me/password")
def change_password(
    payload: ChangePasswordPayload,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    u = identity.user
    if not u:
        raise HTTPException(status_code=401)
    if not u.password_hash:
        raise HTTPException(status_code=400, detail="Account has no password set")
    if not verify_password(payload.current_password, u.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    u.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"changed": True}


@router.post("/me/api-keys")
def create_api_key(
    payload: CreateKeyPayload,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    u = identity.user
    if not u:
        raise HTTPException(status_code=401)

    full_key, key_hash, prefix = generate_api_key()
    expires_at: datetime | None = None
    if payload.expires_days:
        from datetime import timedelta
        expires_at = datetime.now(timezone.utc) + timedelta(days=payload.expires_days)

    row = APIKey(
        user_id=u.id,
        org_id=u.org_id,
        name=payload.name,
        key_hash=key_hash,
        key_prefix=prefix,
        expires_at=expires_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # Full key returned only once
    return {
        "id": row.id,
        "name": row.name,
        "key": full_key,
        "prefix": row.key_prefix,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "created_at": row.created_at.isoformat(),
    }


@router.get("/me/api-keys")
def list_api_keys(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    u = identity.user
    if not u:
        raise HTTPException(status_code=401)
    rows = db.scalars(select(APIKey).where(APIKey.user_id == u.id)).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "prefix": r.key_prefix,
            "is_active": r.is_active,
            "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.delete("/me/api-keys/{key_id}")
def revoke_api_key(
    key_id: int,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    u = identity.user
    if not u:
        raise HTTPException(status_code=401)
    row = db.scalar(select(APIKey).where(APIKey.id == key_id, APIKey.user_id == u.id))
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")
    row.is_active = False
    db.commit()
    return {"revoked": True}


@router.get("")
def list_users(
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    users = db.scalars(select(User).order_by(User.created_at.desc())).all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "is_active": u.is_active,
            "org_id": u.org_id,
            "created_at": u.created_at.isoformat(),
        }
        for u in users
    ]
