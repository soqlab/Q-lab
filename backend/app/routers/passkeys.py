"""Passkey (WebAuthn) sign-up, sign-in, account recovery and passkey management.

Nothing is typed to sign in: the browser offers the passkeys it has for Q-Lab (on this device,
or on a phone through its QR code), and the passkey says which account it belongs to. Accounts
are created with a passkey and a display name; an email address is optional. The way back in
without email is a one-time recovery code (app/recovery_codes.py), or a second passkey.

Every ceremony is two calls: */begin returns WebAuthn options plus a challenge_id, and
*/finish sends back the authenticator's response with that challenge_id. Challenges live in the
database for five minutes and are deleted the moment a finish call uses them, so each works once.

Passkeys are discoverable (resident) credentials with user verification required. The relying
party ID is the host of QLAB_APP_URL (qlab.soqlab.com when hosted), overridable with
QLAB_WEBAUTHN_RP_ID; accepted origins are QLAB_APP_URL's origin plus QLAB_WEBAUTHN_ORIGINS.
"""
from __future__ import annotations

import json
import os
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from jwt import PyJWTError
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from ..auth import ENROL_SCOPE, create_access_token, decode_token, hash_link_token, passkeys_only
from ..database import get_db
from ..deps import Identity, log_audit, require_passkey_session, require_user_session
from .. import recovery_codes
from ..models import PasskeyCredential, User, WebAuthnChallenge
from ..rate_limit import RateLimiter, auth_limiter
from .auth_routes import _user_response, finish_signup, new_account

router = APIRouter(prefix="/auth/passkeys", tags=["passkeys"])

CHALLENGE_TTL_SECONDS = 5 * 60
RP_NAME = "Q-Lab"

# Recovery codes are 80 random bits, but every guess still costs: 5 tries per 15 minutes per address.
recovery_code_limiter = RateLimiter(max_calls=5, period=15 * 60)


def rp_config() -> tuple[str, list[str]]:
    """(rp_id, accepted origins), read on every call so a config change needs no code."""
    app_url = os.getenv("QLAB_APP_URL", "").strip() or "http://localhost:3000"
    parsed = urlparse(app_url)
    rp_id = os.getenv("QLAB_WEBAUTHN_RP_ID", "").strip() or (parsed.hostname or "localhost")
    origins = [f"{parsed.scheme}://{parsed.netloc}"]
    extra = os.getenv("QLAB_WEBAUTHN_ORIGINS", "")
    origins += [o.strip().rstrip("/") for o in extra.split(",") if o.strip()]
    return rp_id, origins


# ── Challenges ───────────────────────────────────────────────────────────────

@dataclass
class _Challenge:
    challenge: bytes
    user_id: int | None
    data: dict[str, Any]


def _new_challenge(db: Session, purpose: str, user_id: int | None = None,
                   data: dict[str, Any] | None = None) -> tuple[str, bytes]:
    now = time.time()
    db.execute(delete(WebAuthnChallenge).where(WebAuthnChallenge.expires_at < now))
    challenge = secrets.token_bytes(32)
    challenge_id = secrets.token_urlsafe(32)
    db.add(WebAuthnChallenge(id=challenge_id, challenge=bytes_to_base64url(challenge), purpose=purpose,
                             user_id=user_id, data=data or {}, expires_at=now + CHALLENGE_TTL_SECONDS))
    db.commit()
    return challenge_id, challenge


def _take_challenge(db: Session, challenge_id: str, purpose: str) -> _Challenge:
    """Use a challenge up: it is deleted here whether or not the response then verifies."""
    row = db.get(WebAuthnChallenge, challenge_id)
    if row is None or row.purpose != purpose:
        raise HTTPException(status_code=400, detail="Unknown or already used challenge. Start again.")
    taken = _Challenge(challenge=base64url_to_bytes(row.challenge), user_id=row.user_id, data=dict(row.data or {}))
    expired = row.expires_at < time.time()
    gone = db.execute(delete(WebAuthnChallenge).where(WebAuthnChallenge.id == challenge_id)).rowcount
    db.commit()
    if gone != 1:  # another request used it first
        raise HTTPException(status_code=400, detail="Unknown or already used challenge. Start again.")
    if expired:
        raise HTTPException(status_code=400, detail="The passkey request expired. Start again.")
    return taken


# ── Registration helpers ─────────────────────────────────────────────────────

def _user_handle(db: Session, user_id: int) -> str:
    """One random handle per user, shared by all their passkeys (never the email or the id)."""
    existing = db.scalar(select(PasskeyCredential.user_handle).where(PasskeyCredential.user_id == user_id))
    return existing or bytes_to_base64url(secrets.token_bytes(32))


def _account_label(email: str | None, display_name: str) -> str:
    """The name a passkey manager lists the passkey under: the email if there is one."""
    return (email or "").strip() or (display_name or "").strip() or "Q-Lab account"


def _registration_options(db: Session, *, purpose: str, handle: str, email: str | None, display_name: str,
                          user_id: int | None = None, data: dict[str, Any] | None = None) -> dict:
    rp_id, _ = rp_config()
    existing = db.scalars(select(PasskeyCredential.credential_id)
                          .where(PasskeyCredential.user_id == user_id)).all() if user_id else []
    challenge_id, challenge = _new_challenge(db, purpose, user_id, {**(data or {}), "user_handle": handle})
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_id=base64url_to_bytes(handle),
        user_name=_account_label(email, display_name),
        user_display_name=(display_name or "").strip() or _account_label(email, display_name),
        challenge=challenge,
        timeout=CHALLENGE_TTL_SECONDS * 1000,
        attestation=AttestationConveyancePreference.NONE,
        # Discoverable, so sign-in needs no name typed. No authenticator attachment and no
        # transports are set: a passkey on this device, a security key, or a phone (QR) all work.
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c)) for c in existing],
    )
    return {"challenge_id": challenge_id, "options": json.loads(options_to_json(options))}


def _verify_registration(ch: _Challenge, credential: dict[str, Any]):
    rp_id, origins = rp_config()
    try:
        return verify_registration_response(
            credential=credential,
            expected_challenge=ch.challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            require_user_verification=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"The passkey could not be verified: {exc}") from exc


def _store_passkey(db: Session, user: User, verified: Any, handle: str, credential: dict[str, Any],
                   name: str | None) -> PasskeyCredential:
    """Save a verified credential. The account's password, if any, goes now: from here on the
    account signs in with passkeys only."""
    credential_id = bytes_to_base64url(verified.credential_id)
    if db.scalar(select(PasskeyCredential.id).where(PasskeyCredential.credential_id == credential_id)):
        raise HTTPException(status_code=409, detail="That passkey is already registered.")
    raw_transports = (credential.get("response") or {}).get("transports") or []
    transports = [t for t in raw_transports if isinstance(t, str)][:8] if isinstance(raw_transports, list) else []
    count = db.scalar(select(func.count()).select_from(PasskeyCredential)
                      .where(PasskeyCredential.user_id == user.id)) or 0
    row = PasskeyCredential(
        user_id=user.id,
        credential_id=credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        user_handle=handle,
        name=(name or "").strip()[:100] or f"Passkey {count + 1}",
        transports=transports,
        aaguid=str(verified.aaguid) if verified.aaguid else None,
        backed_up=bool(getattr(verified, "credential_backed_up", False)),
    )
    db.add(row)
    user.password_hash = ""
    return row


def _passkey_dict(row: PasskeyCredential) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "backed_up": row.backed_up,
        "transports": row.transports or [],
    }


def _session(db: Session, user: User, request: Request, action: str) -> dict:
    user.last_login_at = datetime.now(timezone.utc)
    user.login_count = (user.login_count or 0) + 1
    db.commit()
    log_audit(db, action, "user", str(user.id), request=request, user_id=user.id, org_id=user.org_id)
    return _user_response(user, create_access_token(user.id, user.org_id, user.role, amr="passkey"))


# ── Payloads ─────────────────────────────────────────────────────────────────

class SignupBegin(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # Optional, and not asked for by the sign-up page: an address can be added later in settings.
    email: Optional[str] = Field(default=None, max_length=254)
    org_name: Optional[str] = Field(default=None, max_length=200)


class Finish(BaseModel):
    challenge_id: str = Field(max_length=64)
    credential: dict[str, Any]
    passkey_name: Optional[str] = Field(default=None, max_length=100)


class RecoveryBegin(BaseModel):
    token: str = Field(max_length=128)


class RecoveryFinish(Finish):
    token: str = Field(max_length=128)


class RecoveryCodeBegin(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class RecoveryCodeFinish(Finish):
    code: str = Field(min_length=1, max_length=64)


class Rename(BaseModel):
    name: str = Field(min_length=1, max_length=100)


# ── Config ───────────────────────────────────────────────────────────────────

@router.get("/config")
def passkey_config():
    """What the sign-in page needs to know: is password sign-in still offered at all."""
    rp_id, _ = rp_config()
    return {"passkeys_only": passkeys_only(), "rp_id": rp_id}


# ── Sign-up ──────────────────────────────────────────────────────────────────

@router.post("/signup/begin", dependencies=[Depends(auth_limiter)])
def signup_begin(payload: SignupBegin, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Enter a name")
    email = (payload.email or "").strip() or None
    if email is not None:
        if "@" not in email:
            raise HTTPException(status_code=422, detail="Enter a valid email address")
        if db.scalar(select(User.id).where(User.email == email)):
            raise HTTPException(status_code=409, detail="Email already registered")
    handle = bytes_to_base64url(secrets.token_bytes(32))
    return _registration_options(db, purpose="signup", handle=handle, email=email, display_name=name,
                                 data={"email": email, "name": name, "org_name": payload.org_name})


@router.post("/signup/finish", dependencies=[Depends(auth_limiter)])
def signup_finish(payload: Finish, request: Request, db: Session = Depends(get_db)):
    ch = _take_challenge(db, payload.challenge_id, "signup")
    verified = _verify_registration(ch, payload.credential)
    email = ch.data.get("email") or None
    if email and db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered")
    user = new_account(db, email, ch.data["name"], ch.data.get("org_name"), password_hash="")
    _store_passkey(db, user, verified, ch.data["user_handle"], payload.credential, payload.passkey_name)
    codes = recovery_codes.new_set(db, user.id)
    db.commit()
    db.refresh(user)
    resp = finish_signup(db, user, request, amr="passkey")
    resp["recovery_codes"] = codes  # shown once; only their hashes are kept
    return resp


# ── Sign-in ──────────────────────────────────────────────────────────────────

@router.post("/login/begin", dependencies=[Depends(auth_limiter)])
def login_begin(db: Session = Depends(get_db)):
    """Options for a discoverable sign-in: no email asked, the authenticator offers its passkeys
    (also what conditional UI / passkey autofill uses)."""
    rp_id, _ = rp_config()
    challenge_id, challenge = _new_challenge(db, "login")
    options = generate_authentication_options(
        rp_id=rp_id,
        challenge=challenge,
        timeout=CHALLENGE_TTL_SECONDS * 1000,
        allow_credentials=[],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    return {"challenge_id": challenge_id, "options": json.loads(options_to_json(options))}


@router.post("/login/finish", dependencies=[Depends(auth_limiter)])
def login_finish(payload: Finish, request: Request, db: Session = Depends(get_db)):
    ch = _take_challenge(db, payload.challenge_id, "login")
    credential_id = payload.credential.get("id") or payload.credential.get("rawId")
    row = db.scalar(select(PasskeyCredential).where(PasskeyCredential.credential_id == credential_id)) \
        if isinstance(credential_id, str) else None
    if row is None:
        raise HTTPException(status_code=401, detail="This passkey isn't registered with Q-Lab.")
    handle = (payload.credential.get("response") or {}).get("userHandle")
    if handle and handle != row.user_handle:
        raise HTTPException(status_code=401, detail="This passkey isn't registered with Q-Lab.")

    rp_id, origins = rp_config()
    try:
        verified = verify_authentication_response(
            credential=payload.credential,
            expected_challenge=ch.challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            credential_public_key=row.public_key,
            credential_current_sign_count=row.sign_count,
            require_user_verification=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="The passkey could not be verified.") from exc
    # A counter that fails to move forward means a cloned authenticator. Authenticators that
    # don't count (synced passkeys) always report 0, which is allowed.
    if (verified.new_sign_count or row.sign_count) and verified.new_sign_count <= row.sign_count:
        raise HTTPException(status_code=401, detail="The passkey could not be verified.")

    user = db.get(User, row.user_id)
    from .. import erasure
    erasure.cancel_if_pending(db, user)  # signing in cancels a scheduled account deletion
    if user is None or not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    # No email check: the passkey is the sign-in. An unconfirmed address only means Q-Lab
    # sends it nothing until it is confirmed.
    row.sign_count = verified.new_sign_count
    row.last_used_at = datetime.now(timezone.utc)
    if getattr(verified, "credential_backed_up", None) is not None:
        row.backed_up = bool(verified.credential_backed_up)
    return _session(db, user, request, "auth.login_passkey")


# ── Add a passkey to a signed-in account (or a password user's first) ────────

def _account_for_new_passkey(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> tuple[User, bool]:
    """(user, enrolling). Takes a session token, or the enrolment token a password sign-in gives.

    A user with a passkey adds another only from a passkey session, so a stolen OAuth or
    password session can't plant an attacker's passkey on an account that already has one."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        claims = decode_token(authorization[7:])
    except PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    user = db.scalar(select(User).where(User.id == int(claims["sub"]), User.is_active.is_(True)))
    if user is None:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    has_one = db.scalar(select(PasskeyCredential.id).where(PasskeyCredential.user_id == user.id)) is not None
    if claims.get("scope") == ENROL_SCOPE:
        if has_one:
            raise HTTPException(status_code=403, detail="This account already has a passkey. Sign in with it.")
        return user, True
    if claims.get("scope"):
        raise HTTPException(status_code=401, detail="Invalid token")
    if has_one and claims.get("amr") != "passkey":
        raise HTTPException(status_code=403, detail="passkey_session_required")
    return user, False


@router.post("/register/begin", dependencies=[Depends(auth_limiter)])
def register_begin(account: tuple[User, bool] = Depends(_account_for_new_passkey), db: Session = Depends(get_db)):
    user, _ = account
    return _registration_options(db, purpose="register", handle=_user_handle(db, user.id), email=user.email,
                                 display_name=user.name, user_id=user.id)


@router.post("/register/finish", dependencies=[Depends(auth_limiter)])
def register_finish(payload: Finish, request: Request,
                    account: tuple[User, bool] = Depends(_account_for_new_passkey),
                    db: Session = Depends(get_db)):
    """Saves the passkey and returns a passkey session (the user just verified on it)."""
    user, enrolling = account
    ch = _take_challenge(db, payload.challenge_id, "register")
    if ch.user_id != user.id:
        raise HTTPException(status_code=400, detail="Unknown or already used challenge. Start again.")
    verified = _verify_registration(ch, payload.credential)
    row = _store_passkey(db, user, verified, ch.data["user_handle"], payload.credential, payload.passkey_name)
    db.commit()
    log_audit(db, "auth.passkey_added", "passkey", str(row.id), request=request, user_id=user.id, org_id=user.org_id)
    resp = _session(db, user, request, "auth.login_passkey_enrolled" if enrolling else "auth.passkey_session")
    resp["passkey"] = _passkey_dict(row)
    return resp


# ── Account recovery (the emailed link replaces password reset) ──────────────

def _recovery_user(db: Session, token: str) -> User:
    user = db.scalar(select(User).where(User.reset_token == hash_link_token(token), User.is_active.is_(True)))
    if user is None or not user.reset_token_expires or time.time() > user.reset_token_expires:
        raise HTTPException(status_code=400, detail="This recovery link is invalid, used or expired. Request a new one.")
    return user


@router.post("/recovery/begin", dependencies=[Depends(auth_limiter)])
def recovery_begin(payload: RecoveryBegin, db: Session = Depends(get_db)):
    user = _recovery_user(db, payload.token)
    return _registration_options(db, purpose="recovery", handle=_user_handle(db, user.id), email=user.email,
                                 display_name=user.name, user_id=user.id)


@router.post("/recovery/finish", dependencies=[Depends(auth_limiter)])
def recovery_finish(payload: RecoveryFinish, request: Request, db: Session = Depends(get_db)):
    ch = _take_challenge(db, payload.challenge_id, "recovery")
    user = _recovery_user(db, payload.token)
    if ch.user_id != user.id:
        raise HTTPException(status_code=400, detail="Unknown or already used challenge. Start again.")
    verified = _verify_registration(ch, payload.credential)
    # Use the link up first and only if nobody else did: it works exactly once.
    token_hash = hash_link_token(payload.token)
    used = db.execute(update(User).where(User.id == user.id, User.reset_token == token_hash)
                      .values(reset_token=None, reset_token_expires=None)).rowcount
    if used != 1:
        db.rollback()
        raise HTTPException(status_code=400, detail="This recovery link is invalid, used or expired. Request a new one.")
    db.refresh(user)
    row = _store_passkey(db, user, verified, ch.data["user_handle"], payload.credential, payload.passkey_name)
    user.email_verified = True  # following the emailed link proves the address
    db.commit()
    log_audit(db, "auth.passkey_recovered", "passkey", str(row.id), request=request, user_id=user.id,
              org_id=user.org_id)
    resp = _session(db, user, request, "auth.login_passkey_recovery")
    resp["passkey"] = _passkey_dict(row)
    return resp


# ── Account recovery with a one-time code (no email needed) ──────────────────

@router.post("/recovery-code/begin", dependencies=[Depends(recovery_code_limiter)])
def recovery_code_begin(payload: RecoveryCodeBegin, db: Session = Depends(get_db)):
    """A recovery code in, options to register a new passkey on that account out. The code is
    only checked here; it is used up by /recovery-code/finish, once the new passkey verifies."""
    row = recovery_codes.find_unused(db, payload.code)
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="That recovery code is wrong or already used.")
    return _registration_options(db, purpose="recovery_code", handle=_user_handle(db, user.id), email=user.email,
                                 display_name=user.name, user_id=user.id, data={"code_id": row.id})


@router.post("/recovery-code/finish", dependencies=[Depends(auth_limiter)])
def recovery_code_finish(payload: RecoveryCodeFinish, request: Request, db: Session = Depends(get_db)):
    ch = _take_challenge(db, payload.challenge_id, "recovery_code")
    row = recovery_codes.find_unused(db, payload.code)
    if row is None or row.id != ch.data.get("code_id") or row.user_id != ch.user_id:
        raise HTTPException(status_code=400, detail="That recovery code is wrong or already used.")
    user = db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="That recovery code is wrong or already used.")
    verified = _verify_registration(ch, payload.credential)
    if not recovery_codes.use(db, row.id, payload.code):  # someone used it in the meantime
        db.rollback()
        raise HTTPException(status_code=400, detail="That recovery code is wrong or already used.")
    passkey = _store_passkey(db, user, verified, ch.data["user_handle"], payload.credential, payload.passkey_name)
    db.commit()
    log_audit(db, "auth.passkey_recovered_code", "passkey", str(passkey.id), request=request, user_id=user.id,
              org_id=user.org_id)
    resp = _session(db, user, request, "auth.login_passkey_recovery_code")
    resp["passkey"] = _passkey_dict(passkey)
    resp["recovery_codes_remaining"] = recovery_codes.remaining(db, user.id)
    return resp


# ── Recovery codes: how many are left, and a new set ─────────────────────────

@router.get("/recovery-codes")
def recovery_codes_status(identity: Identity = Depends(require_user_session), db: Session = Depends(get_db)):
    return recovery_codes.status(db, identity.user_id)


@router.post("/recovery-codes", dependencies=[Depends(auth_limiter)])
def recovery_codes_new(request: Request, identity: Identity = Depends(require_user_session),
                       db: Session = Depends(get_db)):
    """A new set of 10 codes, shown once; the old ones stop working. Needs a passkey session when
    the account has a passkey, so a stolen OAuth session can't mint a way back in."""
    has_passkey = db.scalar(select(PasskeyCredential.id).where(PasskeyCredential.user_id == identity.user_id))
    if has_passkey is not None and identity.amr != "passkey":
        raise HTTPException(status_code=403, detail="passkey_session_required")
    codes = recovery_codes.new_set(db, identity.user_id)
    db.commit()
    log_audit(db, "auth.recovery_codes_new", "user", str(identity.user_id), identity=identity, request=request)
    return {"codes": codes, **recovery_codes.status(db, identity.user_id)}


# ── Manage ───────────────────────────────────────────────────────────────────

@router.get("")
def list_passkeys(identity: Identity = Depends(require_user_session), db: Session = Depends(get_db)):
    rows = db.scalars(select(PasskeyCredential).where(PasskeyCredential.user_id == identity.user_id)
                      .order_by(PasskeyCredential.created_at, PasskeyCredential.id)).all()
    return [_passkey_dict(r) for r in rows]


def _own_passkey(db: Session, identity: Identity, passkey_id: int) -> PasskeyCredential:
    row = db.scalar(select(PasskeyCredential).where(PasskeyCredential.id == passkey_id,
                                                    PasskeyCredential.user_id == identity.user_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Passkey not found")
    return row


@router.patch("/{passkey_id}")
def rename_passkey(passkey_id: int, payload: Rename, identity: Identity = Depends(require_user_session),
                   db: Session = Depends(get_db)):
    row = _own_passkey(db, identity, passkey_id)
    row.name = payload.name.strip()[:100] or row.name
    db.commit()
    return _passkey_dict(row)


@router.delete("/{passkey_id}")
def remove_passkey(passkey_id: int, request: Request, identity: Identity = Depends(require_passkey_session),
                   db: Session = Depends(get_db)):
    if identity.amr != "passkey":  # whatever QLAB_PASSKEYS_ONLY says
        raise HTTPException(status_code=403, detail="passkey_session_required")
    row = _own_passkey(db, identity, passkey_id)
    count = db.scalar(select(func.count()).select_from(PasskeyCredential)
                      .where(PasskeyCredential.user_id == identity.user_id)) or 0
    if count <= 1:
        raise HTTPException(status_code=409, detail="You can't remove your only passkey. Add another one first.")
    db.delete(row)
    db.commit()
    log_audit(db, "auth.passkey_removed", "passkey", str(passkey_id), identity=identity, request=request)
    return {"removed": True}
