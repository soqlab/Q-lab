"""Google and GitHub OAuth2 login.

With QLAB_PASSKEYS_ONLY (the hosted service) Google and GitHub no longer sign anyone in. They are
kept only so an account made with them before passkeys can reach its first passkey: the callback
then gives no session, only the 15-minute enrolment token a password sign-in gives
(create_enrolment_token), good for registering one passkey. Once the account has a passkey,
Google and GitHub are refused for it, and no account is ever created through them.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets

import httpx
from fastapi import APIRouter, Cookie, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import SECRET_KEY, create_access_token, create_enrolment_token, passkeys_only
from ..database import get_db
from ..deps import log_audit
from ..email_service import send_welcome_email
from ..models import PasskeyCredential, User

router = APIRouter(prefix="/auth", tags=["oauth"])
log = logging.getLogger("qlab.oauth")

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GITHUB_CLIENT_ID     = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
FRONTEND_URL         = os.getenv("FRONTEND_URL", os.getenv("QLAB_APP_URL", ""))
BASE_URL             = os.getenv("API_BASE_URL", os.getenv("QLAB_APP_URL", "") + "/qlab-api")

GOOGLE_REDIRECT = f"{BASE_URL}/auth/google/callback"
GITHUB_REDIRECT = f"{BASE_URL}/auth/github/callback"


# ── Login CSRF protection: state + PKCE ───────────────────────────────────────
# The start of a sign-in sets a short-lived HttpOnly cookie holding a random state and a PKCE
# code verifier, signed with the server key. The callback only accepts a code whose state matches
# that cookie, so a code from someone else's sign-in cannot be planted in a victim's browser, and
# the provider only redeems the code with the matching verifier.

STATE_COOKIE = "qlab_oauth"
STATE_MAX_AGE = 600


def _sign(value: str) -> str:
    return hmac.new(SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()


def _start(provider: str, url: str, params: dict) -> RedirectResponse:
    from urllib.parse import urlencode
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    params = {**params, "state": state, "code_challenge": challenge, "code_challenge_method": "S256"}
    resp = RedirectResponse(f"{url}?{urlencode(params)}")
    payload = f"{provider}.{state}.{verifier}"
    resp.set_cookie(STATE_COOKIE, f"{payload}.{_sign(payload)}", max_age=STATE_MAX_AGE, httponly=True,
                    secure=BASE_URL.startswith("https://"), samesite="lax", path="/")
    return resp


def _verifier(provider: str, state: str | None, cookie: str | None) -> str | None:
    """The PKCE verifier when the callback's state matches the cookie, else None."""
    if not state or not cookie or cookie.count(".") != 3:
        return None
    c_provider, c_state, verifier, sig = cookie.split(".")
    if not hmac.compare_digest(sig, _sign(f"{c_provider}.{c_state}.{verifier}")):
        return None
    if c_provider != provider or not hmac.compare_digest(c_state, state):
        return None
    return verifier


def _finish(resp: RedirectResponse) -> RedirectResponse:
    resp.delete_cookie(STATE_COOKIE, path="/")
    return resp


# ── Google ────────────────────────────────────────────────────────────────────

@router.get("/google")
def google_login():
    return _start("google", "https://accounts.google.com/o/oauth2/v2/auth", {
        "response_type": "code",
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT,
        "scope": "openid email profile",
        "prompt": "select_account",
    })


@router.get("/google/callback")
def google_callback(
    db: Session = Depends(get_db),
    code: str | None = None,
    error: str | None = None,
    state: str | None = None,
    qlab_oauth: str | None = Cookie(default=None),
):
    if error or not code:
        return _finish(RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_failed"))
    verifier = _verifier("google", state, qlab_oauth)
    if verifier is None:
        return _finish(RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_state"))
    return _finish(_google_sign_in(db, code, verifier))


def _google_sign_in(db: Session, code: str, verifier: str) -> RedirectResponse:
    try:
        token_res = httpx.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT,
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        }, timeout=10)
        token_res.raise_for_status()
        access_token = token_res.json()["access_token"]

        info_res = httpx.get("https://www.googleapis.com/oauth2/v2/userinfo",
                             headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
        info_res.raise_for_status()
        info = info_res.json()
        if info.get("verified_email") is False:
            return RedirectResponse(f"{FRONTEND_URL}/login?error=no_email")

        return _signed_in(db, "google", email=info["email"], name=info.get("name") or info["email"])
    except Exception as exc:
        _log_failure("google", exc)
        return RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_failed")


# ── GitHub ────────────────────────────────────────────────────────────────────

@router.get("/github")
def github_login():
    return _start("github", "https://github.com/login/oauth/authorize", {
        "client_id": GITHUB_CLIENT_ID,
        "redirect_uri": GITHUB_REDIRECT,
        "scope": "user:email",
    })


@router.get("/github/callback")
def github_callback(
    db: Session = Depends(get_db),
    code: str | None = None,
    error: str | None = None,
    state: str | None = None,
    qlab_oauth: str | None = Cookie(default=None),
):
    if error or not code:
        return _finish(RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_failed"))
    verifier = _verifier("github", state, qlab_oauth)
    if verifier is None:
        return _finish(RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_state"))
    return _finish(_github_sign_in(db, code, verifier))


def _github_sign_in(db: Session, code: str, verifier: str) -> RedirectResponse:
    try:
        token_res = httpx.post("https://github.com/login/oauth/access_token", json={
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
            "redirect_uri": GITHUB_REDIRECT,
            "code_verifier": verifier,
        }, headers={"Accept": "application/json"}, timeout=10)
        token_res.raise_for_status()
        gh_token = token_res.json().get("access_token")
        if not gh_token:
            return RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_failed")

        gh_headers = {"Authorization": f"Bearer {gh_token}"}

        profile = httpx.get("https://api.github.com/user", headers=gh_headers, timeout=10).json()

        email: str | None = profile.get("email")
        if not email:
            emails = httpx.get("https://api.github.com/user/emails", headers=gh_headers, timeout=10).json()
            primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
            email = primary["email"] if primary else None

        if not email:
            return RedirectResponse(f"{FRONTEND_URL}/login?error=no_email")

        name = profile.get("name") or profile.get("login") or email
        return _signed_in(db, "github", email=email, name=name)
    except Exception as exc:
        _log_failure("github", exc)
        return RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_failed")


def _log_failure(provider: str, exc: Exception) -> None:
    # Provider error bodies are short JSON like {"error": "invalid_grant"}; no codes or tokens.
    detail = ""
    if isinstance(exc, httpx.HTTPStatusError):
        detail = f" status={exc.response.status_code} body={exc.response.text[:200]!r}"
    log.warning("[oauth] %s sign-in failed: %s%s", provider, type(exc).__name__, detail)


# ── Shared helper ─────────────────────────────────────────────────────────────

def _signed_in(db: Session, provider: str, email: str, name: str) -> RedirectResponse:
    """Where the browser goes once the provider has vouched for this email address."""
    if passkeys_only():
        return _passkey_migration(db, provider, email)
    user, is_new = _upsert_user(db, email=email, name=name)
    jwt = create_access_token(user.id, user.org_id, user.role, amr="oauth")
    dest = "/onboarding" if is_new else "/runs"
    return RedirectResponse(f"{FRONTEND_URL}/oauth-callback?token={jwt}&next={dest}")


def _passkey_migration(db: Session, provider: str, email: str) -> RedirectResponse:
    """QLAB_PASSKEYS_ONLY: no new account, no session. An existing account without a passkey gets
    the enrolment token (one passkey registration, 15 minutes); one with a passkey is refused."""
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_no_account")
    if not user.is_active:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_failed")
    if db.scalar(select(PasskeyCredential.id).where(PasskeyCredential.user_id == user.id)) is not None:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=oauth_has_passkey")
    log_audit(db, "auth.login_oauth_enrol", "user", str(user.id), meta={"provider": provider},
              user_id=user.id, org_id=user.org_id)
    return RedirectResponse(f"{FRONTEND_URL}/oauth-callback?enrol={create_enrolment_token(user.id)}")

def _upsert_user(db: Session, email: str, name: str) -> tuple[User, bool]:
    """Returns (user, is_new)."""
    from datetime import datetime, timezone
    user = db.scalar(select(User).where(User.email == email))
    is_new = user is None
    if is_new:
        user = User(
            email=email,
            name=name,
            role="researcher",
            is_active=True,
            email_verified=True,
            password_hash="",
        )
        db.add(user)
        db.flush()
        # Auto-create a default API key for new OAuth users
        from ..auth import generate_api_key
        from ..models import APIKey
        _, key_hash, key_prefix = generate_api_key()
        db.add(APIKey(user_id=user.id, org_id=None, name="Default key",
                      key_hash=key_hash, key_prefix=key_prefix))
    else:
        if not user.email_verified:
            user.email_verified = True
    # Track every login (new and returning)
    user.last_login_at = datetime.now(timezone.utc)
    user.login_count = (user.login_count or 0) + 1
    db.commit()
    db.refresh(user)
    if is_new:
        try:
            send_welcome_email(to_email=email, user_name=name)
        except Exception:
            pass
    return user, is_new
