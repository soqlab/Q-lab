"""
FastAPI dependency injection for authentication, RBAC, and audit logging.

Auth precedence (all backwards-compatible):
  1. JWT Bearer token       → fully-typed user with role
  2. qlab_xxx API key       → user-scoped key stored in DB
  3. Legacy QLAB_API_KEYS   → anonymous researcher (env-var shared keys)
  4. Nothing + no keys set  → open dev mode (returns None, accepted)
"""
import os
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import Depends, Header, HTTPException, Request
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import decode_token, hash_api_key
from .database import get_db


class Identity:
    def __init__(
        self,
        user: Any = None,
        api_key_row: Any = None,
        legacy: bool = False,
    ):
        self.user = user
        self.api_key_row = api_key_row
        self.is_legacy = legacy
        self.org_id: int | None = (
            (user.org_id if user else None)
            or (api_key_row.org_id if api_key_row else None)
        )
        self.role: str = user.role if user else ("researcher" if legacy else "anonymous")

    @property
    def user_id(self) -> int | None:
        return self.user.id if self.user else None

    def to_dict(self) -> dict:
        if not self.user:
            return {"type": "legacy" if self.is_legacy else "anonymous"}
        return {
            "user_id": self.user.id,
            "email": self.user.email,
            "name": self.user.name,
            "role": self.user.role,
            "org_id": self.user.org_id,
        }


def _legacy_keys() -> set[str]:
    raw = os.getenv("QLAB_API_KEYS", "").strip()
    return {k.strip() for k in raw.split(",") if k.strip()} if raw else set()


def get_identity(
    authorization: Optional[str] = Header(default=None),
    x_qlab_api_key: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Optional[Identity]:
    from .models import APIKey, User

    # JWT Bearer
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
            user = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
            if not user:
                raise HTTPException(status_code=401, detail="User not found or inactive")
            return Identity(user=user)
        except HTTPException:
            raise
        except JWTError:
            raise HTTPException(status_code=401, detail="Invalid or expired token")

    # Per-user qlab_ API key
    if x_qlab_api_key and x_qlab_api_key.startswith("qlab_"):
        key_hash = hash_api_key(x_qlab_api_key)
        row = db.scalar(select(APIKey).where(APIKey.key_hash == key_hash, APIKey.is_active.is_(True)))
        if not row:
            raise HTTPException(status_code=401, detail="Invalid API key")
        if row.expires_at and row.expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="API key expired")
        row.last_used_at = datetime.now(timezone.utc)
        db.commit()
        user = db.scalar(select(User).where(User.id == row.user_id))
        return Identity(user=user, api_key_row=row)

    # Legacy shared keys
    legacy = _legacy_keys()
    if legacy:
        if x_qlab_api_key in legacy:
            return Identity(legacy=True)
        raise HTTPException(status_code=401, detail="Invalid or missing API key")

    # Open mode
    return None


def require_auth(identity: Optional[Identity] = Depends(get_identity)) -> Identity:
    if identity is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return identity


def require_role(*roles: str):
    def dep(identity: Identity = Depends(require_auth)) -> Identity:
        if identity.role not in roles:
            raise HTTPException(status_code=403, detail=f"Requires role: {' | '.join(roles)}")
        return identity
    return dep


def log_audit(
    db: Session,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    identity: Identity | None = None,
    request: Request | None = None,
    meta: dict | None = None,
) -> None:
    from .models import AuditLog
    try:
        entry = AuditLog(
            org_id=identity.org_id if identity else None,
            user_id=identity.user_id if identity else None,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
            meta=meta or {},
        )
        db.add(entry)
        db.commit()
    except Exception:
        pass
