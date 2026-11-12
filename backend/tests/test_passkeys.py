"""Passkey sign-in: registration and authentication against a software authenticator, the move
of password users to passkeys, QLAB_PASSKEYS_ONLY enforcement, the emailed recovery link, and
API-key management needing a passkey session."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import struct
import time
import uuid

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import text

from app.database import engine
from tests.helpers import PASSWORD, client, make_user

RP_ID = "qlab.soqlab.com"
ORIGIN = "https://qlab.soqlab.com"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


class SoftAuthenticator:
    """A platform authenticator in software: P-256 keys, "none" attestation, a sign counter."""

    def __init__(self, origin: str = ORIGIN, rp_id: str = RP_ID):
        self.origin = origin
        self.rp_id = rp_id
        self.creds: dict[str, dict] = {}

    def create(self, options: dict, uv: bool = True, rp_id: str | None = None) -> dict:
        key = ec.generate_private_key(ec.SECP256R1())
        cred_id = os.urandom(32)
        nums = key.public_key().public_numbers()
        cose = {1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")}
        flags = 0x01 | 0x40 | (0x04 if uv else 0)  # user present, attested data, user verified
        auth_data = (sha256((rp_id or options["rp"]["id"]).encode()) + bytes([flags]) + struct.pack(">I", 0)
                     + b"\0" * 16 + struct.pack(">H", len(cred_id)) + cred_id + cbor2.dumps(cose))
        client_data = json.dumps({"type": "webauthn.create", "challenge": options["challenge"],
                                  "origin": self.origin, "crossOrigin": False}).encode()
        self.creds[b64u(cred_id)] = {"key": key, "handle": options["user"]["id"], "count": 0}
        return {
            "id": b64u(cred_id), "rawId": b64u(cred_id), "type": "public-key",
            "response": {"clientDataJSON": b64u(client_data),
                         "attestationObject": b64u(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})),
                         "transports": ["internal", "hybrid"]},
            "clientExtensionResults": {},
        }

    def get(self, options: dict, cred_id: str | None = None, uv: bool = True, step: int = 1,
            origin: str | None = None) -> dict:
        cred_id = cred_id or next(iter(self.creds))
        cred = self.creds[cred_id]
        cred["count"] += step
        auth_data = sha256(self.rp_id.encode()) + bytes([0x01 | (0x04 if uv else 0)]) + struct.pack(">I", cred["count"])
        client_data = json.dumps({"type": "webauthn.get", "challenge": options["challenge"],
                                  "origin": origin or self.origin, "crossOrigin": False}).encode()
        signature = cred["key"].sign(auth_data + sha256(client_data), ec.ECDSA(hashes.SHA256()))
        return {
            "id": cred_id, "rawId": cred_id, "type": "public-key",
            "response": {"clientDataJSON": b64u(client_data), "authenticatorData": b64u(auth_data),
                         "signature": b64u(signature), "userHandle": cred["handle"]},
            "clientExtensionResults": {},
        }


@pytest.fixture(autouse=True)
def _hosted(monkeypatch):
    monkeypatch.setenv("QLAB_APP_URL", ORIGIN)
    monkeypatch.delenv("QLAB_WEBAUTHN_RP_ID", raising=False)
    monkeypatch.delenv("QLAB_WEBAUTHN_ORIGINS", raising=False)
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("QLAB_PASSKEYS_ONLY", raising=False)
    # These tests make more sign-in calls per test than the per-IP limit allows a person.
    from app import rate_limit
    monkeypatch.setattr(rate_limit.auth_limiter, "max_calls", 1000)


@pytest.fixture
def passkeys_only(monkeypatch):
    monkeypatch.setenv("QLAB_PASSKEYS_ONLY", "true")


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def sign_up(auth: SoftAuthenticator, email: str | None = None) -> dict:
    email = email or f"pk_{uuid.uuid4().hex[:10]}@example.com"
    begin = client.post("/auth/passkeys/signup/begin", json={"email": email, "name": "Ada"})
    assert begin.status_code == 200, begin.text
    finish = client.post("/auth/passkeys/signup/finish", json={
        "challenge_id": begin.json()["challenge_id"], "credential": auth.create(begin.json()["options"])})
    assert finish.status_code == 200, finish.text
    return finish.json()


def sign_in(auth: SoftAuthenticator, **kw):
    begin = client.post("/auth/passkeys/login/begin").json()
    return client.post("/auth/passkeys/login/finish", json={
        "challenge_id": begin["challenge_id"], "credential": auth.get(begin["options"], **kw)})


def add_passkey(auth: SoftAuthenticator, token: str):
    begin = client.post("/auth/passkeys/register/begin", headers=bearer(token))
    if begin.status_code != 200:
        return begin
    return client.post("/auth/passkeys/register/finish", headers=bearer(token), json={
        "challenge_id": begin.json()["challenge_id"], "credential": auth.create(begin.json()["options"]),
        "passkey_name": "Laptop"})


def password_hash(email: str) -> str:
    with engine.begin() as conn:
        return conn.execute(text("SELECT password_hash FROM users WHERE email = :e"), {"e": email}).scalar()


# ── Registration and authentication ──────────────────────────────────────────

def test_sign_up_creates_a_passkey_account_without_a_password(passkeys_only):
    auth = SoftAuthenticator()
    resp = sign_up(auth)
    assert resp["api_key"].startswith("qlab_")
    assert password_hash(resp["user"]["email"]) == ""
    me = client.get("/auth/me", headers=bearer(resp["access_token"])).json()
    assert me["session"] == "passkey" and me["passkeys"] == 1 and me["has_password"] is False


def test_registration_options_are_discoverable_with_user_verification_and_rp_from_app_url():
    begin = client.post("/auth/passkeys/signup/begin", json={"email": f"o_{uuid.uuid4().hex[:8]}@x.org", "name": "O"})
    options = begin.json()["options"]
    assert options["rp"]["id"] == RP_ID
    assert options["authenticatorSelection"]["residentKey"] == "required"
    assert options["authenticatorSelection"]["userVerification"] == "required"
    assert "@" not in base64.urlsafe_b64decode(options["user"]["id"] + "==").decode("latin-1")
    config = client.get("/auth/passkeys/config").json()
    assert config == {"passkeys_only": False, "rp_id": RP_ID}


def test_sign_in_with_a_discoverable_passkey_counts_signatures():
    auth = SoftAuthenticator()
    signed_up = sign_up(auth)
    begin = client.post("/auth/passkeys/login/begin").json()
    assert begin["options"]["allowCredentials"] == [] and begin["options"]["userVerification"] == "required"
    first = client.post("/auth/passkeys/login/finish", json={
        "challenge_id": begin["challenge_id"], "credential": auth.get(begin["options"])})
    assert first.status_code == 200, first.text
    assert first.json()["user"]["id"] == signed_up["user"]["id"]
    assert sign_in(auth).status_code == 200
    # A counter that does not move forward means a cloned authenticator.
    assert sign_in(auth, step=0).status_code == 401
    assert sign_in(auth, step=-1).status_code == 401


def test_a_challenge_works_once_and_expires():
    auth = SoftAuthenticator()
    sign_up(auth)
    begin = client.post("/auth/passkeys/login/begin").json()
    cred = auth.get(begin["options"])
    ok = client.post("/auth/passkeys/login/finish", json={"challenge_id": begin["challenge_id"], "credential": cred})
    assert ok.status_code == 200
    replay = client.post("/auth/passkeys/login/finish", json={"challenge_id": begin["challenge_id"], "credential": cred})
    assert replay.status_code == 400

    stale = client.post("/auth/passkeys/login/begin").json()
    with engine.begin() as conn:
        conn.execute(text("UPDATE webauthn_challenges SET expires_at = :t WHERE id = :i"),
                     {"t": time.time() - 1, "i": stale["challenge_id"]})
    late = client.post("/auth/passkeys/login/finish", json={
        "challenge_id": stale["challenge_id"], "credential": auth.get(stale["options"])})
    assert late.status_code == 400 and "expired" in late.json()["detail"]
    # A sign-in challenge can't finish a registration either.
    other = client.post("/auth/passkeys/login/begin").json()
    assert client.post("/auth/passkeys/signup/finish", json={
        "challenge_id": other["challenge_id"], "credential": {}}).status_code == 400


def test_user_verification_wrong_origin_wrong_rp_and_unknown_passkeys_are_refused():
    auth = SoftAuthenticator()
    sign_up(auth)
    assert sign_in(auth, uv=False).status_code == 401
    assert sign_in(auth, origin="https://evil.example").status_code == 401

    stranger = SoftAuthenticator()
    stranger.create({"challenge": "x", "user": {"id": "eA"}, "rp": {"id": RP_ID}})
    assert sign_in(stranger).status_code == 401

    begin = client.post("/auth/passkeys/signup/begin", json={"email": f"uv_{uuid.uuid4().hex[:8]}@x.org", "name": "U"}).json()
    no_uv = client.post("/auth/passkeys/signup/finish", json={
        "challenge_id": begin["challenge_id"], "credential": SoftAuthenticator().create(begin["options"], uv=False)})
    assert no_uv.status_code == 400
    begin = client.post("/auth/passkeys/signup/begin", json={"email": f"rp_{uuid.uuid4().hex[:8]}@x.org", "name": "R"}).json()
    wrong_rp = client.post("/auth/passkeys/signup/finish", json={
        "challenge_id": begin["challenge_id"], "credential": SoftAuthenticator().create(begin["options"], rp_id="evil.example")})
    assert wrong_rp.status_code == 400


def test_sign_up_refuses_a_taken_email_and_a_bad_one():
    auth = SoftAuthenticator()
    taken = sign_up(auth)["user"]["email"]
    assert client.post("/auth/passkeys/signup/begin", json={"email": taken, "name": "A"}).status_code == 409
    assert client.post("/auth/passkeys/signup/begin", json={"email": "nope", "name": "A"}).status_code == 422


def test_unverified_email_blocks_passkey_sign_in_when_mail_is_configured(monkeypatch):
    import app.routers.auth_routes as auth_routes
    monkeypatch.setattr(auth_routes, "send_verification_email", lambda **kw: None)
    monkeypatch.setenv("SMTP_HOST", "mail.invalid")
    auth = SoftAuthenticator()
    sign_up(auth)
    resp = sign_in(auth)
    assert resp.status_code == 403 and resp.json()["detail"] == "email_not_verified"


# ── Password users move to passkeys ──────────────────────────────────────────

def _password_user() -> str:
    email = f"pw_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": "Pat"})
    assert r.status_code == 200, r.text
    return email


def test_password_user_must_add_a_passkey_then_the_password_is_gone(monkeypatch):
    email = _password_user()
    monkeypatch.setenv("QLAB_PASSKEYS_ONLY", "true")
    assert password_hash(email)

    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    body = login.json()
    assert body["passkey_enrolment_required"] is True and "access_token" not in body
    enrol = body["enrolment_token"]
    # The enrolment token is not a session.
    assert client.get("/auth/me", headers=bearer(enrol)).status_code == 401
    assert client.get("/api/v1/users/me/api-keys", headers=bearer(enrol)).status_code == 401

    auth = SoftAuthenticator()
    added = add_passkey(auth, enrol)
    assert added.status_code == 200, added.text
    assert added.json()["passkey"]["name"] == "Laptop"
    assert password_hash(email) == ""
    me = client.get("/auth/me", headers=bearer(added.json()["access_token"])).json()
    assert me["session"] == "passkey" and me["has_password"] is False

    # Password sign-in is over for this account, and the enrolment token can't add a second passkey.
    assert client.post("/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401
    assert add_passkey(SoftAuthenticator(), enrol).status_code == 403
    assert sign_in(auth).status_code == 200


def test_a_leftover_password_hash_is_not_a_way_in_once_a_passkey_exists():
    email = _password_user()
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()
    assert add_passkey(SoftAuthenticator(), login["access_token"]).status_code == 200
    from app.auth import hash_password
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET password_hash = :h WHERE email = :e"),
                     {"h": hash_password(PASSWORD), "e": email})
    assert client.post("/auth/login", json={"email": email, "password": PASSWORD}).status_code == 401


def test_without_the_setting_passwords_still_work():
    email = _password_user()
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200 and "access_token" in login.json()
    assert client.get("/auth/me", headers=bearer(login.json()["access_token"])).json()["session"] == "pwd"


# ── QLAB_PASSKEYS_ONLY enforcement ───────────────────────────────────────────

def test_no_new_passwords_anywhere(passkeys_only):
    r = client.post("/auth/register", json={"email": f"n_{uuid.uuid4().hex[:8]}@x.org", "password": PASSWORD, "name": "N"})
    assert r.status_code == 403
    assert client.post("/auth/reset-password", json={"token": "x", "new_password": "Another-Pass-1"}).status_code == 403
    session = sign_up(SoftAuthenticator())["access_token"]
    change = client.post("/api/v1/users/me/password", headers=bearer(session),
                         json={"current_password": "x", "new_password": "Another-Pass-1"})
    assert change.status_code == 403


def test_api_keys_need_a_passkey_session(monkeypatch):
    headers = make_user()  # a password session from before the switch
    monkeypatch.setenv("QLAB_PASSKEYS_ONLY", "true")
    r = client.post("/api/v1/users/me/api-keys", headers=headers, json={"name": "ci"})
    assert r.status_code == 403 and r.json()["detail"] == "passkey_session_required"
    assert client.get("/api/v1/users/me/api-keys", headers=headers).status_code == 200  # listing is fine

    # Its first passkey can come from that session, and turns it into a passkey session.
    auth = SoftAuthenticator()
    added = add_passkey(auth, headers["Authorization"][7:])
    assert added.status_code == 200, added.text
    pk = bearer(added.json()["access_token"])
    created = client.post("/api/v1/users/me/api-keys", headers=pk, json={"name": "ci"})
    assert created.status_code == 200, created.text
    key = created.json()["key"]

    # The SDK key still works for machine use, but can't manage keys.
    assert client.get("/api/v1/runs", headers={"X-QLab-Api-Key": key}).status_code == 200
    by_key = client.post("/api/v1/users/me/api-keys", headers={"X-QLab-Api-Key": key}, json={"name": "x"})
    assert by_key.status_code == 403
    assert client.delete(f"/api/v1/users/me/api-keys/{created.json()['id']}", headers=headers).status_code == 403
    assert client.delete(f"/api/v1/users/me/api-keys/{created.json()['id']}", headers=pk).status_code == 200

    # A refreshed passkey session is still a passkey session.
    refreshed = client.post("/auth/refresh", headers=pk).json()["access_token"]
    assert client.get("/auth/me", headers=bearer(refreshed)).json()["session"] == "passkey"


def test_a_second_passkey_needs_a_passkey_session():
    email = _password_user()
    pwd_session = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    first = add_passkey(SoftAuthenticator(), pwd_session)
    assert first.status_code == 200
    # The old password session can't plant another passkey now that one exists.
    again = add_passkey(SoftAuthenticator(), pwd_session)
    assert again.status_code == 403 and again.json()["detail"] == "passkey_session_required"
    assert add_passkey(SoftAuthenticator(), first.json()["access_token"]).status_code == 200
    assert client.post("/auth/passkeys/register/begin").status_code == 401
    assert client.post("/auth/passkeys/register/begin", headers=bearer("garbage")).status_code == 401


# ── Recovery link ────────────────────────────────────────────────────────────

@pytest.fixture
def recovery_mail(monkeypatch):
    import app.routers.auth_routes as auth_routes
    sent: list[str] = []
    monkeypatch.setattr(auth_routes, "send_account_recovery_email",
                        lambda to_email, recovery_url: sent.append(recovery_url))
    return sent


def _recover(token: str, auth: SoftAuthenticator):
    begin = client.post("/auth/passkeys/recovery/begin", json={"token": token})
    if begin.status_code != 200:
        return begin
    return client.post("/auth/passkeys/recovery/finish", json={
        "token": token, "challenge_id": begin.json()["challenge_id"], "credential": auth.create(begin.json()["options"])})


def test_recovery_link_registers_a_new_passkey_once(passkeys_only, recovery_mail):
    old = SoftAuthenticator()
    email = sign_up(old)["user"]["email"]
    assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200
    assert client.post("/auth/forgot-password", json={"email": "nobody@example.com"}).status_code == 200
    assert len(recovery_mail) == 1 and recovery_mail[0].startswith(f"{ORIGIN}/recover?token=")
    token = recovery_mail[0].split("token=")[1]

    new = SoftAuthenticator()
    recovered = _recover(token, new)
    assert recovered.status_code == 200, recovered.text
    assert client.get("/auth/me", headers=bearer(recovered.json()["access_token"])).json()["passkeys"] == 2
    assert sign_in(new).status_code == 200
    # Single use.
    assert _recover(token, SoftAuthenticator()).status_code == 400


def test_recovery_link_expires(passkeys_only, recovery_mail):
    email = sign_up(SoftAuthenticator())["user"]["email"]
    client.post("/auth/forgot-password", json={"email": email})
    token = recovery_mail[-1].split("token=")[1]
    begin = client.post("/auth/passkeys/recovery/begin", json={"token": token})
    assert begin.status_code == 200
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET reset_token_expires = :t WHERE email = :e"), {"t": time.time() - 1, "e": email})
    late = client.post("/auth/passkeys/recovery/finish", json={
        "token": token, "challenge_id": begin.json()["challenge_id"],
        "credential": SoftAuthenticator().create(begin.json()["options"])})
    assert late.status_code == 400
    assert client.post("/auth/passkeys/recovery/begin", json={"token": "made-up"}).status_code == 400


def test_recovery_moves_a_password_user_to_passkeys(monkeypatch, recovery_mail):
    email = _password_user()
    monkeypatch.setenv("QLAB_PASSKEYS_ONLY", "true")
    client.post("/auth/forgot-password", json={"email": email})
    assert _recover(recovery_mail[-1].split("token=")[1], SoftAuthenticator()).status_code == 200
    assert password_hash(email) == ""


def test_without_the_setting_the_link_still_resets_a_password_once(monkeypatch):
    import app.routers.auth_routes as auth_routes
    sent: list[str] = []
    monkeypatch.setattr(auth_routes, "send_password_reset_email", lambda to_email, reset_url: sent.append(reset_url))
    email = _password_user()
    client.post("/auth/forgot-password", json={"email": email})
    token = sent[-1].split("token=")[1]
    assert "/reset-password?token=" in sent[-1]
    assert client.post("/auth/reset-password", json={"token": token, "new_password": "Brand-New-Pass-9"}).status_code == 200
    assert client.post("/auth/reset-password", json={"token": token, "new_password": "Brand-New-Pass-9"}).status_code == 400
    assert client.post("/auth/login", json={"email": email, "password": "Brand-New-Pass-9"}).status_code == 200


# ── Managing passkeys ────────────────────────────────────────────────────────

def test_list_rename_and_remove_but_never_the_last(passkeys_only):
    auth = SoftAuthenticator()
    session = sign_up(auth)["access_token"]
    second = add_passkey(SoftAuthenticator(), session)
    assert second.status_code == 200
    session = second.json()["access_token"]
    listed = client.get("/auth/passkeys", headers=bearer(session)).json()
    assert [p["name"] for p in listed] == ["Passkey 1", "Laptop"]

    renamed = client.patch(f"/auth/passkeys/{listed[0]['id']}", headers=bearer(session), json={"name": "Phone"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Phone"

    other = sign_up(SoftAuthenticator())["access_token"]
    assert client.delete(f"/auth/passkeys/{listed[0]['id']}", headers=bearer(other)).status_code == 404
    assert client.patch(f"/auth/passkeys/{listed[0]['id']}", headers=bearer(other), json={"name": "x"}).status_code == 404

    assert client.delete(f"/auth/passkeys/{listed[0]['id']}", headers=bearer(session)).status_code == 200
    last = client.delete(f"/auth/passkeys/{listed[1]['id']}", headers=bearer(session))
    assert last.status_code == 409


def test_removing_a_passkey_needs_a_passkey_session():
    email = _password_user()
    pwd_session = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    pk_session = add_passkey(SoftAuthenticator(), pwd_session).json()["access_token"]
    assert add_passkey(SoftAuthenticator(), pk_session).status_code == 200
    first_id = client.get("/auth/passkeys", headers=bearer(pk_session)).json()[0]["id"]
    assert client.delete(f"/auth/passkeys/{first_id}", headers=bearer(pwd_session)).status_code == 403
