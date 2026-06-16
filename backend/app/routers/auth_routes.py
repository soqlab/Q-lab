import secrets
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import create_access_token, hash_password, verify_password
from ..database import get_db
from ..deps import Identity, log_audit, require_auth
from ..email_service import send_password_reset_email, send_welcome_email
from ..models import Organization, User
from ..rate_limit import auth_limiter

# ---------------------------------------------------------------------------
# In-memory store for password reset tokens
# {token: (email, expires_timestamp)}
# ---------------------------------------------------------------------------
_RESET_TOKENS: dict[str, tuple[str, float]] = {}
_RESET_TTL_SECONDS = 15 * 60  # 15 minutes

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterPayload(BaseModel):
    email: str
    name: str
    password: str
    org_name: Optional[str] = None


class LoginPayload(BaseModel):
    email: str
    password: str


class ForgotPasswordPayload(BaseModel):
    email: str


class ResetPasswordPayload(BaseModel):
    token: str
    new_password: str


def _user_response(user: User, token: str) -> dict:
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "org_id": user.org_id,
        },
    }


@router.post("/register", dependencies=[Depends(auth_limiter)])
def register(payload: RegisterPayload, request: Request, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # First user becomes owner
    user_count = db.scalar(select(func.count()).select_from(User)) or 0
    role = "owner" if user_count == 0 else "researcher"

    org: Organization | None = None
    if payload.org_name:
        slug = payload.org_name.lower().replace(" ", "-")[:120]
        org = db.scalar(select(Organization).where(Organization.slug == slug))
        if not org:
            org = Organization(slug=slug, name=payload.org_name)
            db.add(org)
            db.flush()

    user = User(
        email=payload.email,
        name=payload.name,
        password_hash=hash_password(payload.password),
        role=role,
        org_id=org.id if org else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.org_id, user.role)
    log_audit(db, "auth.register", "user", str(user.id), request=request)

    # Send welcome email — fire-and-forget, never block registration
    try:
        send_welcome_email(to_email=user.email, user_name=user.name)
    except Exception:
        pass

    return _user_response(user, token)


@router.post("/login", dependencies=[Depends(auth_limiter)])
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(user.id, user.org_id, user.role)
    log_audit(db, "auth.login", "user", str(user.id), request=request)
    return _user_response(user, token)


@router.get("/me")
def me(identity: Identity = Depends(require_auth)):
    return identity.to_dict()


@router.post("/refresh")
def refresh_token(identity: Identity = Depends(require_auth)):
    if not identity.user:
        raise HTTPException(status_code=401, detail="Cannot refresh a non-user session")
    token = create_access_token(identity.user.id, identity.org_id, identity.role)
    return {"access_token": token, "token_type": "bearer"}


# ---------------------------------------------------------------------------
# Password Reset
# ---------------------------------------------------------------------------

@router.post("/forgot-password", dependencies=[Depends(auth_limiter)])
def forgot_password(payload: ForgotPasswordPayload, db: Session = Depends(get_db)):
    """
    Generate a password-reset token and email the link.
    Always returns 200 so callers cannot enumerate registered email addresses.
    """
    # Purge stale tokens opportunistically (simple housekeeping)
    now = time.time()
    expired_keys = [t for t, (_, exp) in _RESET_TOKENS.items() if exp < now]
    for k in expired_keys:
        _RESET_TOKENS.pop(k, None)

    user = db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if user:
        token = secrets.token_urlsafe(32)
        _RESET_TOKENS[token] = (user.email, now + _RESET_TTL_SECONDS)
        reset_url = f"http://localhost:3000/reset-password?token={token}"
        try:
            send_password_reset_email(to_email=user.email, reset_url=reset_url)
        except Exception:
            pass  # email is best-effort; token is stored regardless

    # Always return the same response to prevent email enumeration
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordPayload, db: Session = Depends(get_db)):
    """
    Validate a reset token and update the user's password.
    """
    entry = _RESET_TOKENS.get(payload.token)
    if not entry:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    email, expires_ts = entry
    if time.time() > expires_ts:
        _RESET_TOKENS.pop(payload.token, None)
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if not payload.new_password or len(payload.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")

    user = db.scalar(select(User).where(User.email == email, User.is_active.is_(True)))
    if not user:
        _RESET_TOKENS.pop(payload.token, None)
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(payload.new_password)
    db.commit()

    # Consume the token — single use only
    _RESET_TOKENS.pop(payload.token, None)

    return {"message": "Password updated successfully. You can now log in."}
