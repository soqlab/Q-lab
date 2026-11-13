"""Google and GitHub with QLAB_PASSKEYS_ONLY: no account is created and no session is given. An
account made with them before passkeys gets one way through, to its first passkey, and after that
they no longer sign it in. With the setting off they work as before."""
from __future__ import annotations

import types
import uuid
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import text

from app.database import engine
from tests.helpers import client
from tests.test_passkeys import ORIGIN, SoftAuthenticator, add_passkey, bearer, sign_in


@pytest.fixture(autouse=True)
def _hosted(monkeypatch):
    monkeypatch.setenv("QLAB_APP_URL", ORIGIN)
    monkeypatch.delenv("QLAB_WEBAUTHN_RP_ID", raising=False)
    monkeypatch.delenv("QLAB_WEBAUTHN_ORIGINS", raising=False)
    monkeypatch.delenv("QLAB_PASSKEYS_ONLY", raising=False)
    from app import rate_limit
    monkeypatch.setattr(rate_limit.auth_limiter, "max_calls", 1000)


def _fake_provider(monkeypatch, email: str):
    from app.routers import oauth

    def post(url, **kw):
        return httpx.Response(200, json={"access_token": "provider-token"}, request=httpx.Request("POST", url))

    def get(url, **kw):
        if url == "https://api.github.com/user":
            data = {"login": "octo", "email": email, "name": "Octo"}
        else:
            data = {"email": email, "name": "Gee", "verified_email": True}
        return httpx.Response(200, json=data, request=httpx.Request("GET", url))

    monkeypatch.setattr(oauth, "httpx", types.SimpleNamespace(post=post, get=get,
                                                              HTTPStatusError=httpx.HTTPStatusError))


def _query(location: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlparse(location).query).items()}


def _oauth(provider: str) -> str:
    """A full round trip through /auth/<provider>; returns where the callback sends the browser."""
    start = client.get(f"/auth/{provider}", follow_redirects=False)
    state = _query(start.headers["location"])["state"]
    done = client.get(f"/auth/{provider}/callback?code=c&state={state}", follow_redirects=False)
    return done.headers["location"]


def _user_count(email: str) -> int:
    with engine.begin() as conn:
        return conn.execute(text("SELECT COUNT(*) FROM users WHERE email = :e"), {"e": email}).scalar()


@pytest.mark.parametrize("provider", ["github", "google"])
def test_a_new_person_is_refused_and_no_account_is_made(monkeypatch, provider):
    email = f"new_{uuid.uuid4().hex[:10]}@example.com"
    _fake_provider(monkeypatch, email)
    monkeypatch.setenv("QLAB_PASSKEYS_ONLY", "true")
    location = _oauth(provider)
    assert location.endswith("/login?error=oauth_no_account")
    assert "token=" not in location and "enrol=" not in location
    assert _user_count(email) == 0


@pytest.mark.parametrize("provider", ["github", "google"])
def test_an_existing_oauth_account_only_gets_to_create_a_passkey_then_oauth_stops(monkeypatch, provider):
    email = f"old_{uuid.uuid4().hex[:10]}@example.com"
    _fake_provider(monkeypatch, email)
    made = _query(_oauth(provider))  # made before passkeys: setting off
    assert made["next"] == "/onboarding" and made["token"]

    monkeypatch.setenv("QLAB_PASSKEYS_ONLY", "true")
    q = _query(_oauth(provider))
    assert "token" not in q and q["enrol"]
    enrol = q["enrol"]
    # The enrolment token is not a session: it reads nothing and makes no API keys.
    assert client.get("/auth/me", headers=bearer(enrol)).status_code == 401
    assert client.get("/api/v1/runs", headers=bearer(enrol)).status_code == 401
    assert client.post("/api/v1/users/me/api-keys", headers=bearer(enrol), json={"name": "x"}).status_code == 401

    auth = SoftAuthenticator()
    added = add_passkey(auth, enrol)
    assert added.status_code == 200, added.text
    me = client.get("/auth/me", headers=bearer(added.json()["access_token"])).json()
    assert me["email"] == email and me["session"] == "passkey" and me["passkeys"] == 1

    # From now on Google and GitHub don't sign this account in; the passkey does.
    assert _oauth("github").endswith("/login?error=oauth_has_passkey")
    assert _oauth("google").endswith("/login?error=oauth_has_passkey")
    assert add_passkey(SoftAuthenticator(), enrol).status_code == 403  # the token was for one passkey
    assert sign_in(auth).status_code == 200
    assert _user_count(email) == 1


def test_without_the_setting_oauth_signs_in_and_signs_up_as_before(monkeypatch):
    email = f"off_{uuid.uuid4().hex[:10]}@example.com"
    _fake_provider(monkeypatch, email)
    first = _query(_oauth("github"))
    assert first["next"] == "/onboarding"
    me = client.get("/auth/me", headers=bearer(first["token"])).json()
    assert me["email"] == email and me["session"] == "oauth"
    again = _query(_oauth("google"))
    assert again["next"] == "/runs" and again["token"]
