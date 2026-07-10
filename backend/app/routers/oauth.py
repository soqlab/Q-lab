"""Google and GitHub OAuth2 login."""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import create_access_token
from ..database import get_db
from ..email_service import send_welcome_email
from ..models import User

router = APIRouter(prefix="/auth", tags=["oauth"])

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GITHUB_CLIENT_ID     = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
FRONTEND_URL         = os.getenv("FRONTEND_URL", "https://www.soqlab.com")
BASE_URL             = os.getenv("API_BASE_URL", "https://www.soqlab.com/qlab-api")

GOOGLE_REDIRECT = f"{BASE_URL}/auth/google/callback"
GITHUB_REDIRECT = f"{BASE_URL}/auth/github/callback"


# ── Google ────────────────────────────────────────────────────────────────────

@router.get("/google")
def google_login():
    from urllib.parse import urlencode
    params = urlencode({
        "response_type": "code",
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT,
        "scope": "openid email profile",
        "prompt": "select_account",
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@router.get("/google/callback")
def google_callback(code: str, db: Session = Depends(get_db)):
    # Exchange code for access token
    token_res = httpx.post("https://oauth2.googleapis.com/token", data={
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": GOOGLE_REDIRECT,
        "grant_type": "authorization_code",
    }, timeout=10)
    token_res.raise_for_status()
    access_token = token_res.json()["access_token"]

    # Fetch user info
    info_res = httpx.get("https://www.googleapis.com/oauth2/v2/userinfo",
                         headers={"Authorization": f"Bearer {access_token}"}, timeout=10)
    info_res.raise_for_status()
    info = info_res.json()

    user, is_new = _upsert_user(db, email=info["email"], name=info.get("name") or info["email"])
    jwt = create_access_token(user.id, user.org_id, user.role)
    dest = "/onboarding" if is_new else "/runs"
    return RedirectResponse(f"{FRONTEND_URL}/oauth-callback?token={jwt}&next={dest}")


# ── GitHub ────────────────────────────────────────────────────────────────────

@router.get("/github")
def github_login():
    from urllib.parse import urlencode
    params = urlencode({
        "client_id": GITHUB_CLIENT_ID,
        "redirect_uri": GITHUB_REDIRECT,
        "scope": "user:email",
    })
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@router.get("/github/callback")
def github_callback(code: str, db: Session = Depends(get_db)):
    # Exchange code for access token
    token_res = httpx.post("https://github.com/login/oauth/access_token", json={
        "client_id": GITHUB_CLIENT_ID,
        "client_secret": GITHUB_CLIENT_SECRET,
        "code": code,
        "redirect_uri": GITHUB_REDIRECT,
    }, headers={"Accept": "application/json"}, timeout=10)
    token_res.raise_for_status()
    gh_token = token_res.json().get("access_token")

    headers = {"Authorization": f"Bearer {gh_token}"}

    # Fetch user profile
    profile = httpx.get("https://api.github.com/user", headers=headers, timeout=10).json()

    # GitHub can hide the primary email — fetch it explicitly
    email: str | None = profile.get("email")
    if not email:
        emails = httpx.get("https://api.github.com/user/emails", headers=headers, timeout=10).json()
        primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
        email = primary["email"] if primary else None

    if not email:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=no_email")

    name = profile.get("name") or profile.get("login") or email
    user, is_new = _upsert_user(db, email=email, name=name)
    jwt = create_access_token(user.id, user.org_id, user.role)
    dest = "/onboarding" if is_new else "/runs"
    return RedirectResponse(f"{FRONTEND_URL}/oauth-callback?token={jwt}&next={dest}")


# ── Shared helper ─────────────────────────────────────────────────────────────

def _upsert_user(db: Session, email: str, name: str) -> tuple[User, bool]:
    """Returns (user, is_new)."""
    user = db.scalar(select(User).where(User.email == email))
    if not user:
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
        db.commit()
        db.refresh(user)
        try:
            send_welcome_email(to_email=email, user_name=name)
        except Exception:
            pass
        return user, True
    elif not user.email_verified:
        user.email_verified = True
        db.commit()
    return user, False
