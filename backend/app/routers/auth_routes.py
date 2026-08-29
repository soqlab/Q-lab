import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import create_access_token, generate_api_key, hash_password, verify_password
from ..database import get_db
from ..deps import Identity, log_audit, require_auth
from ..email_service import (
    send_password_reset_email,
    send_welcome_email,
    send_verification_email,
    send_account_deleted_email,
)

OAUTH_HINT = "oauth_account"  # returned when an OAuth-only account tries password login
from ..models import APIKey, Organization, User
from ..rate_limit import auth_limiter

_RESET_TTL_SECONDS = 15 * 60       # 15 minutes

_VERIFY_TTL_SECONDS = 24 * 60 * 60  # 24 hours

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterPayload(BaseModel):
    email: str
    name: str
    password: str
    org_name: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginPayload(BaseModel):
    email: str
    password: str


class ForgotPasswordPayload(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def email_max_length(cls, v: str) -> str:
        if len(v) > 254:
            raise ValueError("Email address must be 254 characters or fewer")
        return v





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
            "email_verified": getattr(user, "email_verified", False),
        },
    }


@router.post("/register", dependencies=[Depends(auth_limiter)])
def register(payload: RegisterPayload, request: Request, db: Session = Depends(get_db)):
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    _owner_email = os.getenv("QLAB_OWNER_EMAIL", "").strip().lower()
    role = "owner" if (_owner_email and payload.email.lower() == _owner_email) else "researcher"

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

    # Auto-create a default API key so the user can start immediately
    full_key, key_hash, key_prefix = generate_api_key()
    db.add(APIKey(
        user_id=user.id,
        org_id=user.org_id,
        name="Default key",
        key_hash=key_hash,
        key_prefix=key_prefix,
    ))
    db.commit()

    from datetime import datetime, timezone
    user.last_login_at = datetime.now(timezone.utc)
    user.login_count = 1
    db.commit()

    token = create_access_token(user.id, user.org_id, user.role)
    log_audit(db, "auth.register", "user", str(user.id), request=request, user_id=user.id, org_id=user.org_id)

    # Send verification email — token stored in DB so it survives redeploys
    try:
        verify_token = secrets.token_urlsafe(32)
        user.verify_token = verify_token
        user.verify_token_expires = time.time() + _VERIFY_TTL_SECONDS
        db.commit()
        app_url = os.getenv("QLAB_APP_URL", "https://www.soqlab.com")
        verify_url = f"{app_url}/verify-email?token={verify_token}"
        send_verification_email(to_email=user.email, verify_url=verify_url)
    except Exception:
        pass

    resp = _user_response(user, token)
    resp["api_key"] = full_key  # returned once — shown on the onboarding screen
    return resp


@router.post("/login", dependencies=[Depends(auth_limiter)])
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == payload.email))
    # Unified error for all invalid-credential cases to prevent account enumeration
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if not getattr(user, "email_verified", True):
        raise HTTPException(status_code=403, detail="email_not_verified")

    from datetime import datetime, timezone
    user.last_login_at = datetime.now(timezone.utc)
    user.login_count = (user.login_count or 0) + 1
    db.commit()
    token = create_access_token(user.id, user.org_id, user.role)
    log_audit(db, "auth.login", "user", str(user.id), request=request, user_id=user.id, org_id=user.org_id)
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
    user = db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if user:
        token = secrets.token_urlsafe(32)
        user.reset_token = token
        user.reset_token_expires = time.time() + _RESET_TTL_SECONDS
        db.commit()
        app_url = os.getenv("QLAB_APP_URL", "https://www.soqlab.com")
        reset_url = f"{app_url}/reset-password?token={token}"
        try:
            send_password_reset_email(to_email=user.email, reset_url=reset_url)
        except Exception:
            pass
    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordPayload, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.reset_token == payload.token))
    if not user or not user.reset_token_expires or time.time() > user.reset_token_expires:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    if not payload.new_password or len(payload.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    user.password_hash = hash_password(payload.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    db.commit()
    return {"message": "Password updated successfully. You can now log in."}


# ---------------------------------------------------------------------------
# Email Verification
# ---------------------------------------------------------------------------

@router.get("/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    """Confirm an email address using the token sent during registration."""
    user = db.scalar(select(User).where(User.verify_token == token))
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")
    if not user.verify_token_expires or time.time() > user.verify_token_expires:
        raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

    user.email_verified = True
    user.verify_token = None
    user.verify_token_expires = None
    db.commit()

    return {"message": "Email verified successfully. You can now use all features."}


class ResendByEmailPayload(BaseModel):
    email: str


@router.post("/resend-verification-email", dependencies=[Depends(auth_limiter)])
def resend_verification_by_email(payload: ResendByEmailPayload, db: Session = Depends(get_db)):
    """Send a new verification email given just an email address (no auth required)."""
    user = db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if not user or getattr(user, "email_verified", True):
        return {"message": "If that email exists and is unverified, a link has been sent."}
    try:
        verify_token = secrets.token_urlsafe(32)
        user.verify_token = verify_token
        user.verify_token_expires = time.time() + _VERIFY_TTL_SECONDS
        db.commit()
        app_url = os.getenv("QLAB_APP_URL", "https://www.soqlab.com")
        verify_url = f"{app_url}/verify-email?token={verify_token}"
        send_verification_email(to_email=user.email, verify_url=verify_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please try again later.")
    return {"message": "Verification email sent"}


@router.post("/resend-verification", dependencies=[Depends(auth_limiter)])
def resend_verification(identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    """Resend the email verification link to the logged-in user."""
    user = db.scalar(select(User).where(User.id == identity.user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email_verified:
        return {"message": "Email is already verified"}

    try:
        verify_token = secrets.token_urlsafe(32)
        user.verify_token = verify_token
        user.verify_token_expires = time.time() + _VERIFY_TTL_SECONDS
        db.commit()
        app_url = os.getenv("QLAB_APP_URL", "https://www.soqlab.com")
        verify_url = f"{app_url}/verify-email?token={verify_token}"
        send_verification_email(to_email=user.email, verify_url=verify_url)
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please try again later.")

    return {"message": "Verification email sent"}


# ---------------------------------------------------------------------------
# Delete Account
# ---------------------------------------------------------------------------

@router.delete("/me")
def delete_account(identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    """Permanently deactivate the logged-in user's account."""
    user = db.scalar(select(User).where(User.id == identity.user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_email = user.email
    user_name = user.name

    # Deactivate rather than hard-delete to preserve run history integrity
    user.is_active = False
    db.commit()

    try:
        send_account_deleted_email(to_email=user_email, user_name=user_name)
    except Exception:
        pass

    return {"message": "Account deleted successfully"}
