"""Sign-in without email: accounts made of a passkey and a name, discoverable sign-in, one-time
recovery codes, an optional email address, and the move of existing databases and accounts."""
from __future__ import annotations

import os
import re
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

from app.database import engine
from tests.helpers import PASSWORD, client
from tests.test_passkeys import (  # noqa: F401  (_hosted is an autouse fixture)
    ORIGIN,
    SoftAuthenticator,
    _hosted,
    add_passkey,
    bearer,
    password_hash,
    sign_in,
)

BACKEND = Path(__file__).resolve().parents[1]
CODE_RE = re.compile(r"^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$")


@pytest.fixture(autouse=True)
def _fresh_code_limiter():
    from app.routers import passkeys
    passkeys.recovery_code_limiter._windows.clear()
    yield
    passkeys.recovery_code_limiter._windows.clear()


def sign_up_named(auth: SoftAuthenticator, name: str = "Grace") -> dict:
    begin = client.post("/auth/passkeys/signup/begin", json={"name": name})
    assert begin.status_code == 200, begin.text
    finish = client.post("/auth/passkeys/signup/finish", json={
        "challenge_id": begin.json()["challenge_id"], "credential": auth.create(begin.json()["options"])})
    assert finish.status_code == 200, finish.text
    return finish.json()


def recover_with_code(code: str, auth: SoftAuthenticator, finish_code: str | None = None):
    begin = client.post("/auth/passkeys/recovery-code/begin", json={"code": code})
    if begin.status_code != 200:
        return begin
    return client.post("/auth/passkeys/recovery-code/finish", json={
        "code": finish_code or code, "challenge_id": begin.json()["challenge_id"],
        "credential": auth.create(begin.json()["options"])})


def email_of(user_id: int):
    with engine.begin() as conn:
        return conn.execute(text("SELECT email FROM users WHERE id = :i"), {"i": user_id}).scalar()


# ── Sign-up and sign-in with nothing typed but a name ────────────────────────

def test_sign_up_with_a_name_only_gives_a_passkey_account_and_ten_codes():
    begin = client.post("/auth/passkeys/signup/begin", json={"name": "Grace"})
    options = begin.json()["options"]
    assert options["user"]["name"] == "Grace" and options["user"]["displayName"] == "Grace"
    selection = options["authenticatorSelection"]
    assert selection["residentKey"] == "required" and selection["userVerification"] == "required"
    assert "authenticatorAttachment" not in selection  # phone (QR), security key or this device

    auth = SoftAuthenticator()
    resp = client.post("/auth/passkeys/signup/finish", json={
        "challenge_id": begin.json()["challenge_id"], "credential": auth.create(options)}).json()
    assert resp["user"]["email"] is None and resp["user"]["email_verified"] is False
    codes = resp["recovery_codes"]
    assert len(codes) == 10 and len(set(codes)) == 10 and all(CODE_RE.match(c) for c in codes)
    assert resp["api_key"].startswith("qlab_")
    assert email_of(resp["user"]["id"]) is None
    me = client.get("/auth/me", headers=bearer(resp["access_token"])).json()
    assert me["recovery_codes_remaining"] == 10 and me["passkeys"] == 1


def test_only_hashes_of_the_codes_are_stored():
    resp = sign_up_named(SoftAuthenticator())
    with engine.begin() as conn:
        stored = [r[0] for r in conn.execute(text("SELECT code_hash FROM recovery_codes WHERE user_id = :u"),
                                             {"u": resp["user"]["id"]})]
    assert len(stored) == 10
    for code in resp["recovery_codes"]:
        assert code not in stored and code.replace("-", "") not in stored
        assert all(re.fullmatch(r"[0-9a-f]{64}", h) for h in stored)


def test_sign_in_is_discoverable_and_names_nobody():
    auth = SoftAuthenticator()
    user = sign_up_named(auth)["user"]
    begin = client.post("/auth/passkeys/login/begin").json()
    assert begin["options"].get("allowCredentials", []) == []
    resp = client.post("/auth/passkeys/login/finish", json={
        "challenge_id": begin["challenge_id"], "credential": auth.get(begin["options"])})
    assert resp.status_code == 200 and resp.json()["user"]["id"] == user["id"]


def test_many_accounts_without_email_coexist_and_emails_stay_unique():
    a, b = sign_up_named(SoftAuthenticator(), "A"), sign_up_named(SoftAuthenticator(), "B")
    assert email_of(a["user"]["id"]) is None and email_of(b["user"]["id"]) is None
    email = f"u_{uuid.uuid4().hex[:8]}@example.com"
    assert client.put("/auth/me/email", json={"email": email}, headers=bearer(a["access_token"])).status_code == 200
    taken = client.put("/auth/me/email", json={"email": email}, headers=bearer(b["access_token"]))
    assert taken.status_code == 409


def test_a_name_is_required():
    assert client.post("/auth/passkeys/signup/begin", json={"name": "   "}).status_code == 422
    assert client.post("/auth/passkeys/signup/begin", json={}).status_code == 422


# ── Recovery codes ───────────────────────────────────────────────────────────

def test_a_recovery_code_adds_a_passkey_once():
    old = SoftAuthenticator()
    resp = sign_up_named(old)
    code = resp["recovery_codes"][3]
    new = SoftAuthenticator()
    recovered = recover_with_code(code, new)
    assert recovered.status_code == 200, recovered.text
    body = recovered.json()
    assert body["user"]["id"] == resp["user"]["id"] and body["recovery_codes_remaining"] == 9
    me = client.get("/auth/me", headers=bearer(body["access_token"])).json()
    assert me["passkeys"] == 2 and me["session"] == "passkey"
    assert sign_in(new).status_code == 200 and sign_in(old).status_code == 200
    # Used up.
    again = recover_with_code(code, SoftAuthenticator())
    assert again.status_code == 400 and "wrong or already used" in again.json()["detail"]


def test_codes_are_read_forgivingly_but_wrong_ones_fail():
    resp = sign_up_named(SoftAuthenticator())
    code = resp["recovery_codes"][0]
    assert recover_with_code(code.replace("-", " ").lower(), SoftAuthenticator()).status_code == 200
    assert recover_with_code("AAAA-BBBB-CCCC-DDDD", SoftAuthenticator()).status_code == 400
    assert recover_with_code("short", SoftAuthenticator()).status_code == 400


def test_a_challenge_for_one_code_cannot_be_finished_with_another():
    resp = sign_up_named(SoftAuthenticator())
    first, second = resp["recovery_codes"][:2]
    swapped = recover_with_code(first, SoftAuthenticator(), finish_code=second)
    assert swapped.status_code == 400
    # Neither code was spent by the refused attempt.
    assert client.get("/auth/passkeys/recovery-codes", headers=bearer(resp["access_token"])).json()["remaining"] == 10


def test_a_failed_passkey_does_not_spend_the_code():
    resp = sign_up_named(SoftAuthenticator())
    code = resp["recovery_codes"][0]
    begin = client.post("/auth/passkeys/recovery-code/begin", json={"code": code}).json()
    bad = client.post("/auth/passkeys/recovery-code/finish", json={
        "code": code, "challenge_id": begin["challenge_id"],
        "credential": SoftAuthenticator().create(begin["options"], uv=False)})
    assert bad.status_code == 400
    assert recover_with_code(code, SoftAuthenticator()).status_code == 200


def test_recovery_code_guesses_are_rate_limited():
    for _ in range(5):
        assert client.post("/auth/passkeys/recovery-code/begin",
                           json={"code": "AAAA-BBBB-CCCC-DDDD"}).status_code == 400
    assert client.post("/auth/passkeys/recovery-code/begin",
                       json={"code": "AAAA-BBBB-CCCC-DDDD"}).status_code == 429


def test_a_disabled_account_cannot_be_recovered_with_a_code():
    resp = sign_up_named(SoftAuthenticator())
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET is_active = 0 WHERE id = :i"), {"i": resp["user"]["id"]})
    assert recover_with_code(resp["recovery_codes"][0], SoftAuthenticator()).status_code == 400


def test_a_new_set_cancels_the_old_one_and_needs_a_passkey_session():
    resp = sign_up_named(SoftAuthenticator())
    token = resp["access_token"]
    new = client.post("/auth/passkeys/recovery-codes", headers=bearer(token))
    assert new.status_code == 200
    body = new.json()
    assert len(body["codes"]) == 10 and body["remaining"] == 10
    assert not set(body["codes"]) & set(resp["recovery_codes"])
    assert recover_with_code(resp["recovery_codes"][0], SoftAuthenticator()).status_code == 400
    assert recover_with_code(body["codes"][0], SoftAuthenticator()).status_code == 200

    # A session that didn't sign in with a passkey can't mint codes for an account that has one.
    from app.auth import create_access_token
    pwd_token = create_access_token(resp["user"]["id"], None, "researcher", amr="oauth")
    assert client.post("/auth/passkeys/recovery-codes", headers=bearer(pwd_token)).status_code == 403
    assert client.post("/auth/passkeys/recovery-codes").status_code == 401


# ── Another device ───────────────────────────────────────────────────────────

def test_a_passkey_on_another_device_signs_in_to_the_same_account():
    laptop, phone = SoftAuthenticator(), SoftAuthenticator()
    resp = sign_up_named(laptop)
    begin = client.post("/auth/passkeys/register/begin", headers=bearer(resp["access_token"])).json()
    assert begin["options"]["authenticatorSelection"].get("authenticatorAttachment") is None
    assert add_passkey(phone, resp["access_token"]).status_code == 200
    assert sign_in(phone).json()["user"]["id"] == resp["user"]["id"]
    assert sign_in(laptop).json()["user"]["id"] == resp["user"]["id"]


# ── Optional email ───────────────────────────────────────────────────────────

@pytest.fixture
def mail(monkeypatch):
    import app.routers.auth_routes as auth_routes
    sent: dict[str, list[str]] = {"verify": [], "recovery": []}
    monkeypatch.setenv("SMTP_HOST", "mail.invalid")
    monkeypatch.setattr(auth_routes, "send_verification_email",
                        lambda to_email, verify_url: sent["verify"].append(to_email))
    monkeypatch.setattr(auth_routes, "send_account_recovery_email",
                        lambda to_email, recovery_url: sent["recovery"].append(recovery_url))
    return sent


def test_emailed_recovery_only_for_accounts_with_an_address(passkeys_only, mail):
    resp = sign_up_named(SoftAuthenticator())
    token = resp["access_token"]
    email = f"later_{uuid.uuid4().hex[:8]}@example.com"
    # No address on the account: nothing to send to, and the reply doesn't say so.
    assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200
    assert mail["recovery"] == []

    added = client.put("/auth/me/email", json={"email": email}, headers=bearer(token)).json()
    assert added == {"email": email, "email_verified": False, "verification_sent": True, "role": "researcher"}
    assert mail["verify"] == [email]
    client.post("/auth/forgot-password", json={"email": email})
    assert len(mail["recovery"]) == 1

    # Removing the address cancels a link already sent to it.
    link_token = mail["recovery"][0].split("token=")[1]
    assert client.put("/auth/me/email", json={"email": None}, headers=bearer(token)).json()["email"] is None
    assert client.post("/auth/passkeys/recovery/begin", json={"token": link_token}).status_code == 400


@pytest.fixture
def passkeys_only(monkeypatch):
    monkeypatch.setenv("QLAB_PASSKEYS_ONLY", "true")


def test_changing_the_email_needs_a_passkey_session_and_a_valid_address():
    resp = sign_up_named(SoftAuthenticator())
    from app.auth import create_access_token
    oauth = create_access_token(resp["user"]["id"], None, "researcher", amr="oauth")
    assert client.put("/auth/me/email", json={"email": "x@example.com"}, headers=bearer(oauth)).status_code == 403
    assert client.put("/auth/me/email", json={"email": "not-an-address"},
                      headers=bearer(resp["access_token"])).status_code == 422


def test_without_mail_the_owner_email_claims_only_an_ownerless_server(monkeypatch):
    owner = f"owner_{uuid.uuid4().hex[:8]}@example.com"
    monkeypatch.setenv("QLAB_OWNER_EMAIL", owner)
    with engine.begin() as conn:
        had_owner = conn.execute(text("SELECT id FROM users WHERE role = 'owner' AND is_active = 1")).fetchall()
        conn.execute(text("UPDATE users SET role = 'researcher' WHERE role = 'owner'"))
    try:
        first = sign_up_named(SoftAuthenticator())
        out = client.put("/auth/me/email", json={"email": owner}, headers=bearer(first["access_token"])).json()
        assert out["role"] == "owner" and out["email_verified"] is True
        client.put("/auth/me/email", json={"email": None}, headers=bearer(first["access_token"]))
        second = sign_up_named(SoftAuthenticator())
        out2 = client.put("/auth/me/email", json={"email": owner}, headers=bearer(second["access_token"])).json()
        assert out2["role"] == "researcher"  # the server has an owner already
    finally:
        with engine.begin() as conn:
            for (uid,) in had_owner:
                conn.execute(text("UPDATE users SET role = 'owner' WHERE id = :i"), {"i": uid})


# ── Existing accounts keep working ───────────────────────────────────────────

def test_an_account_made_with_an_email_and_passkey_still_signs_in():
    auth = SoftAuthenticator()
    email = f"old_{uuid.uuid4().hex[:8]}@example.com"
    begin = client.post("/auth/passkeys/signup/begin", json={"email": email, "name": "Old"}).json()
    client.post("/auth/passkeys/signup/finish", json={"challenge_id": begin["challenge_id"],
                                                     "credential": auth.create(begin["options"])})
    resp = sign_in(auth)
    assert resp.status_code == 200 and resp.json()["user"]["email"] == email


def test_a_password_account_moves_to_a_passkey_and_then_needs_no_email(passkeys_only):
    email = f"pw_{uuid.uuid4().hex[:8]}@example.com"
    os.environ.pop("QLAB_PASSKEYS_ONLY", None)
    assert client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": "Pat"}).status_code == 200
    os.environ["QLAB_PASSKEYS_ONLY"] = "true"
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()
    assert login["passkey_enrolment_required"] is True
    auth = SoftAuthenticator()
    added = add_passkey(auth, login["enrolment_token"])
    assert added.status_code == 200
    assert password_hash(email) == ""
    resp = sign_in(auth)
    assert resp.status_code == 200 and resp.json()["user"]["email"] == email
    # No codes yet: the dashboard asks for them, it doesn't force them.
    me = client.get("/auth/me", headers=bearer(resp.json()["access_token"])).json()
    assert me["recovery_codes_remaining"] == 0
    assert client.post("/auth/passkeys/recovery-codes", headers=bearer(resp.json()["access_token"])).status_code == 200


# ── Existing databases: startup step and Alembic 005 ─────────────────────────

LEGACY_USERS = {
    "sqlalchemy": """CREATE TABLE users (
        id INTEGER NOT NULL, org_id INTEGER, email VARCHAR(320) NOT NULL, name VARCHAR(200) NOT NULL,
        password_hash VARCHAR(256) NOT NULL, role VARCHAR(64) NOT NULL, is_active BOOLEAN NOT NULL,
        PRIMARY KEY (id))""",
    "alembic_001": """CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER, email VARCHAR(320) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL, password_hash VARCHAR(256) NOT NULL,
        role VARCHAR(64) NOT NULL DEFAULT 'researcher', is_active BOOLEAN NOT NULL DEFAULT 1)""",
}


@pytest.mark.parametrize("shape", sorted(LEGACY_USERS))
def test_startup_step_relaxes_email_and_keeps_every_row(tmp_path, shape):
    from app.auth_schema import email_is_required, relax_users_email
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript(LEGACY_USERS[shape] + """;
        CREATE UNIQUE INDEX ix_users_email_u ON users (email);
        CREATE INDEX ix_users_org_id ON users (org_id);
        CREATE TABLE passkey_credentials (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id),
                                          credential_id VARCHAR(512));
        INSERT INTO users (id, email, name, password_hash, role, is_active)
            VALUES (7, 'a@example.com', 'A', '', 'owner', 1), (9, 'b@example.com', 'B', 'x', 'researcher', 1);
        INSERT INTO passkey_credentials VALUES (1, 7, 'cred-a');""")
    con.commit()
    con.close()

    eng = create_engine(f"sqlite:///{path}")
    assert email_is_required(eng)
    assert relax_users_email(eng) is True
    assert not email_is_required(eng)
    assert relax_users_email(eng) is False  # second start: nothing to do

    with eng.begin() as conn:
        rows = conn.execute(text("SELECT id, email, role FROM users ORDER BY id")).fetchall()
        assert [tuple(r) for r in rows] == [(7, "a@example.com", "owner"), (9, "b@example.com", "researcher")]
        assert conn.execute(text("SELECT u.email FROM passkey_credentials p JOIN users u ON u.id = p.user_id"))\
            .scalar() == "a@example.com"
        conn.execute(text("INSERT INTO users (id, email, name, password_hash, role, is_active) "
                          "VALUES (10, NULL, 'C', '', 'researcher', 1), (11, NULL, 'D', '', 'researcher', 1)"))
        with pytest.raises(Exception):
            conn.execute(text("INSERT INTO users (id, email, name, password_hash, role, is_active) "
                              "VALUES (12, 'a@example.com', 'E', '', 'researcher', 1)"))
    names = {i["name"] for i in inspect(eng).get_indexes("users")}
    assert {"ix_users_email_u", "ix_users_org_id"} <= names
    eng.dispose()


def _alembic(db: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db.as_posix()}"}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env,
                          capture_output=True, text=True, timeout=300)


def test_alembic_005_upgrade_and_downgrade_keep_accounts_and_passkeys(tmp_path):
    db = tmp_path / "chain.db"
    up = _alembic(db, "upgrade", "004_passkeys")
    assert up.returncode == 0, up.stderr[-2000:]
    con = sqlite3.connect(db)
    con.execute("INSERT INTO users (id, email, name, password_hash, role, is_active) "
                "VALUES (1, 'kept@example.com', 'Kept', '', 'owner', 1)")
    con.execute("INSERT INTO passkey_credentials (user_id, credential_id, public_key, sign_count, user_handle, "
                "name, transports, backed_up, created_at) VALUES (1, 'cred-1', x'00', 3, 'h', 'Laptop', '[]', 0, "
                "'2026-11-12 00:00:00')")
    con.commit()
    con.close()

    up = _alembic(db, "upgrade", "005_usernameless_accounts")
    assert up.returncode == 0, up.stderr[-2000:]
    eng = create_engine(f"sqlite:///{db}")
    cols = {c["name"]: c for c in inspect(eng).get_columns("users")}
    assert cols["email"]["nullable"] is True
    assert "recovery_codes" in inspect(eng).get_table_names()
    with eng.begin() as conn:
        assert conn.execute(text("SELECT email FROM users WHERE id = 1")).scalar() == "kept@example.com"
        assert conn.execute(text("SELECT sign_count FROM passkey_credentials WHERE credential_id = 'cred-1'"))\
            .scalar() == 3
        conn.execute(text("INSERT INTO users (id, email, name, password_hash, role, is_active) "
                          "VALUES (2, NULL, 'No mail', '', 'researcher', 1)"))
    eng.dispose()

    down = _alembic(db, "downgrade", "004_passkeys")
    assert down.returncode == 0, down.stderr[-2000:]
    eng = create_engine(f"sqlite:///{db}")
    cols = {c["name"]: c for c in inspect(eng).get_columns("users")}
    assert cols["email"]["nullable"] is False
    assert "recovery_codes" not in inspect(eng).get_table_names()
    with eng.begin() as conn:
        emails = dict(conn.execute(text("SELECT id, email FROM users")).fetchall())
        assert emails == {1: "kept@example.com", 2: "user-2@no-email.invalid"}
        assert conn.execute(text("SELECT count(*) FROM passkey_credentials")).scalar() == 1
    eng.dispose()

    again = _alembic(db, "upgrade", "head")
    assert again.returncode == 0, again.stderr[-2000:]
