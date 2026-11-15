"""Sign in with SOQLAB (app/routers/soqlab_id.py) against a fake id.soqlab.com.

The fake issuer has a real ES256 key made here, a discovery document, a JWKS and a token endpoint
that checks PKCE and client authentication, as the real service does. Nothing leaves the process:
the router's one HTTP function is replaced.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
import uuid
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from tests.helpers import client
from tests.test_passkeys import ORIGIN, SoftAuthenticator, add_passkey, bearer, sign_up

ISSUER = "https://id.soqlab.example"
CLIENT_ID = "qlab"
SECRET = "client-secret-for-tests-" + "x" * 16


class FakeIssuer:
    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.kid = "k1"
        self.codes: dict[str, dict] = {}
        self.unlinked: list[str] = []
        self.calls: list[str] = []

    def jwk(self) -> dict:
        jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(self.key.public_key()))
        return {**jwk, "kid": self.kid, "alg": "ES256", "use": "sig"}

    def issue(self, sub: str, nonce: str, challenge: str, **override) -> str:
        """What /authorize (or /link) does once the person used their passkey: a one-time code."""
        code = secrets.token_urlsafe(16)
        now = int(time.time())
        claims = {"iss": ISSUER, "aud": CLIENT_ID, "sub": sub, "nonce": nonce, "iat": now, "exp": now + 300,
                  "amr": ["passkey"], **override}
        self.codes[code] = {"claims": claims, "challenge": challenge}
        return code

    def sign(self, claims: dict, alg: str = "ES256", key=None) -> str:
        return jwt.encode(claims, key or self.key, algorithm=alg, headers={"kid": self.kid})

    def http(self, method, url, *, data=None, headers=None):
        self.calls.append(url)
        if url == f"{ISSUER}/.well-known/openid-configuration":
            return 200, {"issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/authorize",
                         "token_endpoint": f"{ISSUER}/token", "jwks_uri": f"{ISSUER}/jwks"}
        if url == f"{ISSUER}/jwks":
            return 200, {"keys": [self.jwk()]}
        expected = "Basic " + base64.b64encode(f"{CLIENT_ID}:{SECRET}".encode()).decode()
        if url == f"{ISSUER}/unlink":
            assert (headers or {}).get("Authorization") == expected
            self.unlinked.append(data["sub"])
            return 200, {"ok": True}
        if url == f"{ISSUER}/token":
            if (headers or {}).get("Authorization") != expected:
                return 401, {"error": "invalid_client"}
            entry = self.codes.pop(data["code"], None)  # codes work once
            if entry is None or data["redirect_uri"] != f"{ORIGIN}/soqlab-callback":
                return 400, {"error": "invalid_grant"}
            digest = base64.urlsafe_b64encode(hashlib.sha256(data["code_verifier"].encode()).digest()).rstrip(b"=").decode()
            if digest != entry["challenge"]:
                return 400, {"error": "invalid_grant"}
            token = entry.get("raw") or self.sign(entry["claims"], **entry.get("sign", {}))
            return 200, {"id_token": token, "token_type": "Bearer"}
        return 404, None


@pytest.fixture(autouse=True)
def _hosted(monkeypatch):
    from app import rate_limit
    monkeypatch.setenv("QLAB_APP_URL", ORIGIN)
    for name in ("QLAB_WEBAUTHN_RP_ID", "QLAB_WEBAUTHN_ORIGINS", "QLAB_PASSKEYS_ONLY", "SMTP_HOST", "RESEND_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(rate_limit.auth_limiter, "max_calls", 1000)


@pytest.fixture
def issuer(monkeypatch):
    from app import rate_limit
    from app.routers import soqlab_id

    monkeypatch.setenv("QLAB_SOQLAB_ID_ISSUER", ISSUER)
    monkeypatch.setenv("QLAB_SOQLAB_ID_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("QLAB_SOQLAB_ID_CLIENT_SECRET", SECRET)
    monkeypatch.setattr(rate_limit.auth_limiter, "max_calls", 1000)
    fake = FakeIssuer()
    monkeypatch.setattr(soqlab_id, "_http", fake.http)
    soqlab_id._discovery.clear()
    soqlab_id._jwks.clear()
    soqlab_id._jwks_forced.clear()
    return fake


def _q(url: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def start(purpose="login", **body) -> dict:
    r = client.post("/auth/soqlab/start", json={"purpose": purpose, **body})
    assert r.status_code == 200, r.text
    return r.json()


def finish(begun: dict, code: str, flow: str | None = None):
    return client.post("/auth/soqlab/callback", json={"code": code, "state": begun["state"],
                                                       "flow": flow or begun["flow"]})


def soqlab_sign_in(fake: FakeIssuer, sub: str, purpose="login", **body):
    begun = start(purpose, **body)
    q = _q(begun["authorize_url"])
    return finish(begun, fake.issue(sub, q["nonce"], q["code_challenge"]))


def ticket(token: str | None = None, **body) -> dict:
    r = client.post("/auth/soqlab/link-ticket", json=body or {"purpose": "link"},
                    headers=bearer(token) if token else {})
    assert r.status_code == 200, r.text
    begun = r.json()
    raw = _q(begun["authorize_url"])["ticket"]
    claims = jwt.decode(raw, SECRET, algorithms=["HS256"], audience=ISSUER)
    return {**begun, "ticket": claims}


def link(fake: FakeIssuer, token: str, sub: str):
    t = ticket(token)
    return finish(t, fake.issue(sub, t["ticket"]["nonce"], t["ticket"]["code_challenge"]))


def passkey_account() -> dict:
    return sign_up(SoftAuthenticator())


# ── Off by default ───────────────────────────────────────────────────────────

def test_flag_off_routes_are_404_and_config_says_off(monkeypatch):
    for name in ("QLAB_SOQLAB_ID_ISSUER", "QLAB_SOQLAB_ID_CLIENT_ID", "QLAB_SOQLAB_ID_CLIENT_SECRET"):
        monkeypatch.delenv(name, raising=False)
    assert client.get("/auth/passkeys/config").json()["soqlab_id"] is False
    assert client.post("/auth/soqlab/start", json={"purpose": "login"}).status_code == 404
    assert client.post("/auth/soqlab/link-ticket", json={"purpose": "link"}).status_code == 404
    assert client.post("/auth/soqlab/callback", json={"code": "c", "state": "s" * 20, "flow": "f" * 20}).status_code == 404
    token = passkey_account()["access_token"]
    assert client.get("/auth/soqlab/status", headers=bearer(token)).status_code == 404
    assert client.delete("/auth/soqlab/link", headers=bearer(token)).status_code == 404
    # Two of three set is still off; an http issuer that isn't local is refused too.
    monkeypatch.setenv("QLAB_SOQLAB_ID_ISSUER", ISSUER)
    monkeypatch.setenv("QLAB_SOQLAB_ID_CLIENT_ID", CLIENT_ID)
    assert client.get("/auth/passkeys/config").json()["soqlab_id"] is False
    monkeypatch.setenv("QLAB_SOQLAB_ID_CLIENT_SECRET", SECRET)
    monkeypatch.setenv("QLAB_SOQLAB_ID_ISSUER", "http://id.soqlab.example")
    assert client.get("/auth/passkeys/config").json()["soqlab_id"] is False


def test_flag_on_config_says_on(issuer):
    assert client.get("/auth/passkeys/config").json()["soqlab_id"] is True


# ── Sign-up, sign-in, link, unlink ───────────────────────────────────────────

def test_signup_then_sign_in_with_the_same_soqlab_passkey(issuer):
    sub = "pairwise-" + uuid.uuid4().hex
    begun = start("signup", name="Ada")
    q = _q(begun["authorize_url"])
    assert q["prompt"] == "create" and q["code_challenge_method"] == "S256" and q["scope"] == "openid"
    assert q["redirect_uri"] == f"{ORIGIN}/soqlab-callback" and q["client_id"] == CLIENT_ID
    made = finish(begun, issuer.issue(sub, q["nonce"], q["code_challenge"]))
    assert made.status_code == 200, made.text
    body = made.json()
    assert len(body["recovery_codes"]) == 10 and body["api_key"] and body["user"]["email"] is None
    claims = jwt.decode(body["access_token"], options={"verify_signature": False})
    assert claims["amr"] == "passkey" and claims["idp"] == "soqlab"
    me = client.get("/auth/me", headers=bearer(body["access_token"])).json()
    assert me["soqlab_linked"] is True and me["passkeys"] == 0

    again = soqlab_sign_in(issuer, sub)
    assert again.status_code == 200, again.text
    assert again.json()["user"]["id"] == body["user"]["id"]


def test_an_unlinked_soqlab_passkey_signs_nobody_in(issuer):
    r = soqlab_sign_in(issuer, "never-linked-" + uuid.uuid4().hex)
    assert r.status_code == 404 and r.json()["detail"] == "soqlab_not_linked"


def test_link_a_passkey_account_then_unlink(issuer):
    acct = passkey_account()
    sub = "pw-" + uuid.uuid4().hex
    t = ticket(acct["access_token"])
    claims = t["ticket"]
    assert claims["iss"] == CLIENT_ID and claims["aud"] == ISSUER and claims["sub"] == str(acct["user"]["id"])
    assert claims["exp"] - claims["iat"] <= 300 and claims["jti"] and claims["purpose"] == "link"
    assert claims["redirect_uri"] == f"{ORIGIN}/soqlab-callback" and t["authorize_url"].startswith(f"{ISSUER}/link?")
    done = finish(t, issuer.issue(sub, claims["nonce"], claims["code_challenge"]))
    assert done.status_code == 200, done.text
    assert soqlab_sign_in(issuer, sub).json()["user"]["id"] == acct["user"]["id"]
    status = client.get("/auth/soqlab/status", headers=bearer(acct["access_token"])).json()
    assert status["linked"] is True

    # Linking again, or the same SOQLAB passkey to another account, is refused.
    assert client.post("/auth/soqlab/link-ticket", json={"purpose": "link"},
                       headers=bearer(acct["access_token"])).status_code == 409
    other = passkey_account()
    assert link(issuer, other["access_token"], sub).status_code == 409

    gone = client.delete("/auth/soqlab/link", headers=bearer(acct["access_token"]))
    assert gone.status_code == 200 and gone.json()["remote_unlinked"] is True
    assert issuer.unlinked == [sub]
    assert soqlab_sign_in(issuer, sub).status_code == 404


def test_unlink_refused_when_it_is_the_only_way_in(issuer):
    sub = "only-" + uuid.uuid4().hex
    body = soqlab_sign_in(issuer, sub, "signup", name="Solo").json()
    r = client.delete("/auth/soqlab/link", headers=bearer(body["access_token"]))
    assert r.status_code == 409


def test_link_needs_a_recent_passkey_sign_in(issuer, monkeypatch):
    acct = passkey_account()
    from app import auth
    old = auth.create_access_token(acct["user"]["id"], None, "researcher", amr="passkey",
                                   auth_time=int(time.time()) - 3600)
    r = client.post("/auth/soqlab/link-ticket", json={"purpose": "link"}, headers=bearer(old))
    assert r.status_code == 403 and r.json()["detail"] == "recent_sign_in_required"
    # A refresh keeps the old sign-in time.
    refreshed = client.post("/auth/refresh", headers=bearer(old)).json()["access_token"]
    assert client.post("/auth/soqlab/link-ticket", json={"purpose": "link"},
                       headers=bearer(refreshed)).status_code == 403
    pwd = auth.create_access_token(acct["user"]["id"], None, "researcher", amr="oauth")
    assert client.post("/auth/soqlab/link-ticket", json={"purpose": "link"}, headers=bearer(pwd)).json()["detail"] \
        == "passkey_session_required"
    assert client.post("/auth/soqlab/link-ticket", json={"purpose": "link"}).status_code == 401


def test_an_enrolment_token_can_end_in_a_soqlab_passkey(issuer):
    from app import auth
    from tests.test_passkeys import _password_user
    email = _password_user()
    from sqlalchemy import text
    from app.database import engine
    with engine.begin() as conn:
        uid = conn.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email}).scalar()
    enrol = auth.create_enrolment_token(uid)
    sub = "enrol-" + uuid.uuid4().hex
    done = link(issuer, enrol, sub)
    assert done.status_code == 200, done.text
    with engine.begin() as conn:
        assert conn.execute(text("SELECT password_hash FROM users WHERE id = :i"), {"i": uid}).scalar() == ""
    # Linked now: the enrolment route is closed to it.
    r = client.post("/auth/soqlab/link-ticket", json={"purpose": "link"}, headers=bearer(auth.create_enrolment_token(uid)))
    assert r.status_code == 403


def test_recovery_code_ends_in_a_soqlab_passkey_once(issuer):
    acct = passkey_account()
    code = acct["recovery_codes"][0]
    t = ticket(purpose="recover", code=code)
    assert t["ticket"]["purpose"] == "recover" and t["ticket"]["sub"] == str(acct["user"]["id"])
    sub = "rec-" + uuid.uuid4().hex
    done = finish(t, issuer.issue(sub, t["ticket"]["nonce"], t["ticket"]["code_challenge"]))
    assert done.status_code == 200, done.text
    assert done.json()["recovery_codes_remaining"] == 9
    # The code is used up.
    assert client.post("/auth/soqlab/link-ticket", json={"purpose": "recover", "code": code}).status_code == 400


# ── Refusals ─────────────────────────────────────────────────────────────────

def _linked_sub(issuer) -> str:
    sub = "s-" + uuid.uuid4().hex
    assert soqlab_sign_in(issuer, sub, "signup", name="Bo").status_code == 200
    return sub


def test_wrong_audience_is_refused(issuer):
    sub = _linked_sub(issuer)
    begun = start()
    q = _q(begun["authorize_url"])
    r = finish(begun, issuer.issue(sub, q["nonce"], q["code_challenge"], aud="morrow"))
    assert r.status_code == 401


def test_nonce_mismatch_is_refused(issuer):
    sub = _linked_sub(issuer)
    begun = start()
    q = _q(begun["authorize_url"])
    assert finish(begun, issuer.issue(sub, "another-nonce", q["code_challenge"])).status_code == 401


def test_expired_token_is_refused(issuer):
    sub = _linked_sub(issuer)
    begun = start()
    q = _q(begun["authorize_url"])
    old = int(time.time()) - 3600
    assert finish(begun, issuer.issue(sub, q["nonce"], q["code_challenge"], iat=old, exp=old + 300)).status_code == 401


def test_wrong_issuer_and_missing_passkey_amr_are_refused(issuer):
    sub = _linked_sub(issuer)
    for override in ({"iss": "https://evil.example"}, {"amr": ["pwd"]}, {"amr": "passkey"}):
        begun = start()
        q = _q(begun["authorize_url"])
        assert finish(begun, issuer.issue(sub, q["nonce"], q["code_challenge"], **override)).status_code == 401


def test_only_es256_from_the_issuer_key_is_accepted(issuer):
    sub = _linked_sub(issuer)
    other_key = ec.generate_private_key(ec.SECP256R1())
    for how in ({"alg": "HS256", "key": SECRET}, {"key": other_key}, {"alg": "none"}):
        begun = start()
        q = _q(begun["authorize_url"])
        code = issuer.issue(sub, q["nonce"], q["code_challenge"])
        entry = issuer.codes[code]
        if how.get("alg") == "none":
            entry["raw"] = jwt.encode(entry["claims"], None, algorithm="none")
        else:
            entry["sign"] = how
        assert finish(begun, code).status_code == 401, how


def test_replayed_callback_and_replayed_code_are_refused(issuer):
    sub = _linked_sub(issuer)
    begun = start()
    q = _q(begun["authorize_url"])
    code = issuer.issue(sub, q["nonce"], q["code_challenge"])
    assert finish(begun, code).status_code == 200
    assert finish(begun, code).status_code == 400  # the round trip (state) works once
    # The same code in a fresh round trip: the issuer refuses it (and PKCE wouldn't match anyway).
    assert finish(start(), code).status_code == 401


def test_replayed_link_ticket_flow_is_refused(issuer):
    acct = passkey_account()
    t = ticket(acct["access_token"])
    sub = "tk-" + uuid.uuid4().hex
    assert finish(t, issuer.issue(sub, t["ticket"]["nonce"], t["ticket"]["code_challenge"])).status_code == 200
    again = finish(t, issuer.issue(sub, t["ticket"]["nonce"], t["ticket"]["code_challenge"]))
    assert again.status_code == 400


def test_another_tab_cannot_finish_a_round_trip(issuer):
    sub = _linked_sub(issuer)
    begun = start()
    q = _q(begun["authorize_url"])
    code = issuer.issue(sub, q["nonce"], q["code_challenge"])
    assert finish(begun, code, flow="x" * 43).status_code == 400
    assert finish(begun, code).status_code == 200  # a wrong binding doesn't use the round trip up


def test_discovery_on_another_origin_is_refused(issuer, monkeypatch):
    from app.routers import soqlab_id

    def http(method, url, **kw):
        if url.endswith("/.well-known/openid-configuration"):
            return 200, {"issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/authorize",
                         "token_endpoint": "http://169.254.169.254/token", "jwks_uri": f"{ISSUER}/jwks"}
        raise AssertionError(f"should not fetch {url}")
    monkeypatch.setattr(soqlab_id, "_http", http)
    soqlab_id._discovery.clear()
    assert client.post("/auth/soqlab/start", json={"purpose": "login"}).status_code == 503
