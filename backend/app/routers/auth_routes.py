import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..auth import (
    create_access_token,
    create_enrolment_token,
    generate_api_key,
    hash_link_token,
    hash_password,
    passkeys_only,
    verify_password,
)
from ..database import get_db
from ..deps import Identity, log_audit, require_auth, require_passkey_session
from ..email_service import (
    send_account_recovery_email,
    send_password_reset_email,
    is_email_configured,
    send_verification_email,
    send_account_deletion_scheduled_email,
)
from ..models import APIKey, Organization, PasskeyCredential, User
from ..rate_limit import auth_limiter

_RESET_TTL_SECONDS = 15 * 60       # 15 minutes

_VERIFY_TTL_SECONDS = 24 * 60 * 60  # 24 hours

PASSWORDS_OFF = "Passwords are turned off on this server. Use a passkey."

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
            "email_verified": bool(user.email) and bool(getattr(user, "email_verified", False)),
        },
    }


def has_passkey(db: Session, user_id: int) -> bool:
    return (db.scalar(select(func.count()).select_from(PasskeyCredential)
                      .where(PasskeyCredential.user_id == user_id)) or 0) > 0


def is_owner_email(email: str | None) -> bool:
    owner = os.getenv("QLAB_OWNER_EMAIL", "").strip().lower()
    return bool(owner and email and email.strip().lower() == owner)


def new_account(db: Session, email: str | None, name: str, org_name: str | None, password_hash: str) -> User:
    """Create (not yet commit) a user. password_hash is "" for passkey and OAuth accounts.
    email is None for an account created with a passkey and a name only."""
    role = "owner" if is_owner_email(email) else "researcher"

    org: Organization | None = None
    if org_name:
        slug = org_name.lower().replace(" ", "-")[:120]
        org = db.scalar(select(Organization).where(Organization.slug == slug))
        if not org:
            org = Organization(slug=slug, name=org_name)
            db.add(org)
            db.flush()

    user = User(
        email=email,
        name=name,
        password_hash=password_hash,
        role=role,
        org_id=org.id if org else None,
        # A self-hosted install with no mail server (e.g. inside a network with no internet) can
        # never deliver the confirmation email, so there is nothing to wait for.
        email_verified=bool(email) and not is_email_configured(),
    )
    db.add(user)
    db.flush()
    return user


def finish_signup(db: Session, user: User, request: Request, amr: str) -> dict:
    """After a new account is committed: default API key, session, audit, confirmation email."""
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

    token = create_access_token(user.id, user.org_id, user.role, amr=amr)
    log_audit(db, "auth.register", "user", str(user.id), request=request, user_id=user.id, org_id=user.org_id)

    # Send verification email — token stored in DB so it survives redeploys
    if user.email and not user.email_verified:
        try:
            verify_token = secrets.token_urlsafe(32)
            user.verify_token = verify_token
            user.verify_token_expires = time.time() + _VERIFY_TTL_SECONDS
            db.commit()
            app_url = os.getenv("QLAB_APP_URL", "")
            verify_url = f"{app_url}/verify-email?token={verify_token}"
            send_verification_email(to_email=user.email, verify_url=verify_url)
        except Exception:
            pass

    resp = _user_response(user, token)
    resp["api_key"] = full_key  # returned once — shown on the onboarding screen
    return resp


@router.post("/register", dependencies=[Depends(auth_limiter)])
def register(payload: RegisterPayload, request: Request, db: Session = Depends(get_db)):
    """Password sign-up. Refused with QLAB_PASSKEYS_ONLY: new accounts use /auth/passkeys/signup."""
    if passkeys_only():
        raise HTTPException(status_code=403, detail=PASSWORDS_OFF)
    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = new_account(db, payload.email, payload.name, payload.org_name, hash_password(payload.password))
    db.commit()
    db.refresh(user)
    return finish_signup(db, user, request, amr="pwd")


@router.post("/login", dependencies=[Depends(auth_limiter)])
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    """Password sign-in, kept so existing password users can move to a passkey.

    Registering a passkey removes an account's password, so this only signs in accounts that
    have none. With QLAB_PASSKEYS_ONLY it returns no session, only a 15-minute enrolment token
    that can do one thing: register the account's first passkey (/auth/passkeys/register).
    """
    user = db.scalar(select(User).where(User.email == payload.email))
    # Unified error for all invalid-credential cases to prevent account enumeration
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if has_passkey(db, user.id):
        # The password went when the passkey came; a hash left behind is still not a way in.
        raise HTTPException(status_code=401, detail="Invalid email or password")
    from .. import erasure
    erasure.cancel_if_pending(db, user)  # signing in cancels a scheduled account deletion
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if not getattr(user, "email_verified", True) and is_email_configured():
        raise HTTPException(status_code=403, detail="email_not_verified")

    if passkeys_only():
        log_audit(db, "auth.login_password_enrol", "user", str(user.id), request=request,
                  user_id=user.id, org_id=user.org_id)
        return {
            "passkey_enrolment_required": True,
            "enrolment_token": create_enrolment_token(user.id),
            "user": {"email": user.email, "name": user.name},
        }

    from datetime import datetime, timezone
    user.last_login_at = datetime.now(timezone.utc)
    user.login_count = (user.login_count or 0) + 1
    db.commit()
    token = create_access_token(user.id, user.org_id, user.role, amr="pwd")
    log_audit(db, "auth.login", "user", str(user.id), request=request, user_id=user.id, org_id=user.org_id)
    return _user_response(user, token)


@router.get("/me")
def me(identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    out = identity.to_dict()
    if identity.user:
        out["passkeys"] = db.scalar(select(func.count()).select_from(PasskeyCredential)
                                    .where(PasskeyCredential.user_id == identity.user.id)) or 0
        out["has_password"] = bool(identity.user.password_hash)
        out["passkeys_only"] = passkeys_only()
        from ..recovery_codes import remaining
        out["recovery_codes_remaining"] = remaining(db, identity.user.id)
        out["email_verified"] = bool(identity.user.email) and bool(identity.user.email_verified)
    return out


class EmailPayload(BaseModel):
    email: Optional[str] = None

    @field_validator("email")
    @classmethod
    def email_shape(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        if not v:
            return None
        if len(v) > 254 or "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("Enter a valid email address")
        return v


@router.put("/me/email", dependencies=[Depends(auth_limiter)])
def set_email(payload: EmailPayload, request: Request, identity: Identity = Depends(require_auth),
              db: Session = Depends(get_db)):
    """Add, change or remove the account's optional email address (null removes it).

    The address is for notifications, and for emailed recovery if the user asks for a link. It is
    never needed to sign in. When the server sends mail, a new address is confirmed by a link
    before anything else is sent to it. Changing it needs a passkey session on an account that
    has a passkey, as adding a passkey does: an address is a way back into the account.
    """
    user = identity.user
    if user is None or identity.api_key_row is not None:
        raise HTTPException(status_code=403, detail="session_required")
    if has_passkey(db, user.id) and identity.amr != "passkey":
        raise HTTPException(status_code=403, detail="passkey_session_required")
    email = payload.email
    if email and email != user.email and db.scalar(select(User.id).where(User.email == email, User.id != user.id)):
        raise HTTPException(status_code=409, detail="That email address is used by another account")
    if email != user.email:
        user.email = email
        user.verify_token = None
        user.verify_token_expires = None
        user.reset_token = None  # a recovery link sent to the old address stops working
        user.reset_token_expires = None
        mail = is_email_configured()
        user.email_verified = bool(email) and not mail
        # Without mail an address can't be confirmed; QLAB_OWNER_EMAIL then makes its owner the
        # server owner only while the server has no owner yet (as signing up with it always did).
        if email and not mail and is_owner_email(email) and user.role != "owner" and not db.scalar(
                select(User.id).where(User.role == "owner", User.is_active.is_(True))):
            user.role = "owner"
        db.commit()
        if email and mail:
            try:
                verify_token = secrets.token_urlsafe(32)
                user.verify_token = verify_token
                user.verify_token_expires = time.time() + _VERIFY_TTL_SECONDS
                db.commit()
                app_url = os.getenv("QLAB_APP_URL", "")
                send_verification_email(to_email=email, verify_url=f"{app_url}/verify-email?token={verify_token}")
            except Exception:
                pass
        log_audit(db, "auth.email_changed" if email else "auth.email_removed", "user", str(user.id),
                  identity=identity, request=request)
    return {"email": user.email, "email_verified": bool(user.email) and bool(user.email_verified),
            "verification_sent": bool(user.email) and not user.email_verified and is_email_configured(),
            "role": user.role}


@router.post("/refresh")
def refresh_token(identity: Identity = Depends(require_auth)):
    if not identity.user or identity.api_key_row is not None:
        raise HTTPException(status_code=401, detail="Cannot refresh a non-user session")
    token = create_access_token(identity.user.id, identity.org_id, identity.role, amr=identity.amr or "pwd")
    return {"access_token": token, "token_type": "bearer"}


# ---------------------------------------------------------------------------
# Password reset / account recovery
# ---------------------------------------------------------------------------

@router.post("/forgot-password", dependencies=[Depends(auth_limiter)])
def forgot_password(payload: ForgotPasswordPayload, db: Session = Depends(get_db)):
    """Email a single-use 15-minute link.

    With QLAB_PASSKEYS_ONLY the link is account recovery: it registers a new passkey
    (/recover → /auth/passkeys/recovery). Otherwise it sets a new password (/reset-password).
    """
    user = db.scalar(select(User).where(User.email == payload.email, User.is_active.is_(True)))
    if user:
        token = secrets.token_urlsafe(32)
        user.reset_token = hash_link_token(token)
        user.reset_token_expires = time.time() + _RESET_TTL_SECONDS
        db.commit()
        app_url = os.getenv("QLAB_APP_URL", "")
        try:
            if passkeys_only():
                send_account_recovery_email(to_email=user.email, recovery_url=f"{app_url}/recover?token={token}")
            else:
                send_password_reset_email(to_email=user.email, reset_url=f"{app_url}/reset-password?token={token}")
        except Exception:
            pass
    return {"message": "If that email is registered, a link has been sent."}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordPayload, db: Session = Depends(get_db)):
    if passkeys_only():
        raise HTTPException(status_code=403, detail=PASSWORDS_OFF)
    token_hash = hash_link_token(payload.token)
    user = db.scalar(select(User).where(User.reset_token == token_hash))
    if not user or not user.reset_token_expires or time.time() > user.reset_token_expires:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    if has_passkey(db, user.id):
        raise HTTPException(status_code=400, detail="This account signs in with a passkey; it has no password.")
    if not payload.new_password or len(payload.new_password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    # Clear the token only if it is still this one, so the link works once.
    used = db.execute(update(User).where(User.id == user.id, User.reset_token == token_hash)
                      .values(reset_token=None, reset_token_expires=None,
                              password_hash=hash_password(payload.new_password)))
    db.commit()
    if used.rowcount != 1:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
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
    if is_owner_email(user.email):  # a confirmed QLAB_OWNER_EMAIL is the server owner
        user.role = "owner"
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
        app_url = os.getenv("QLAB_APP_URL", "")
        verify_url = f"{app_url}/verify-email?token={verify_token}"
        send_verification_email(to_email=user.email, verify_url=verify_url)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please try again later.")
    return {"message": "Verification email sent"}


@router.post("/resend-verification", dependencies=[Depends(auth_limiter)])
def resend_verification(identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    """Resend the email verification link to the logged-in user."""
    user = db.scalar(select(User).where(User.id == identity.user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.email:
        raise HTTPException(status_code=400, detail="This account has no email address. Add one in settings.")
    if user.email_verified:
        return {"message": "Email is already verified"}

    try:
        verify_token = secrets.token_urlsafe(32)
        user.verify_token = verify_token
        user.verify_token_expires = time.time() + _VERIFY_TTL_SECONDS
        db.commit()
        app_url = os.getenv("QLAB_APP_URL", "")
        verify_url = f"{app_url}/verify-email?token={verify_token}"
        send_verification_email(to_email=user.email, verify_url=verify_url)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please try again later.")

    return {"message": "Verification email sent"}


# ---------------------------------------------------------------------------
# Delete Account
# ---------------------------------------------------------------------------

@router.delete("/me")
def delete_account(identity: Identity = Depends(require_passkey_session), db: Session = Depends(get_db)):
    """Delete the signed-in account: it is locked now and erased after a grace period
    (app/erasure.py). Signing in again before then cancels the deletion.

    A browser session only (and, with QLAB_PASSKEYS_ONLY, a passkey one): an SDK API key
    can't delete the account it belongs to."""
    from .. import erasure

    user = db.scalar(select(User).where(User.id == identity.user_id))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    due = erasure.schedule(db, user, via="settings")
    erase_on = f"{due.day} {due:%B %Y}"
    if user.email:
        try:
            send_account_deletion_scheduled_email(to_email=user.email, user_name=user.name, erase_on=erase_on)
        except Exception:
            pass
    return {
        "scheduled": True,
        "erase_at": due.isoformat(),
        "grace_days": erasure.GRACE_DAYS,
        "message": (f"Your account is locked and will be erased on {erase_on}. "
                    "Sign in with your passkey before then to cancel."),
    }
