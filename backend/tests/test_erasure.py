"""Deleting an account erases it after a 7-day grace period; signing in cancels.

Regression: "Delete account" only switched the account off (while its email said the data had
been permanently deleted), and GDPR deletion requests were recorded but never carried out.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import erasure
from app.database import SessionLocal
from app.models import (
    APIKey, AuditLog, GenericRecord, NotificationChannel, PasskeyCredential, Project, Run, RunNote, User, Webhook,
)
from app.store import store_put
from tests.helpers import PASSWORD, client, make_user, push_run, user_id


def _email(headers) -> str:
    return client.get("/auth/me", headers=headers).json()["email"]


def _fill(headers) -> dict:
    """An account with a bit of everything."""
    uid = user_id(headers)
    project = f"erase-{uuid.uuid4().hex[:8]}"
    run = push_run(headers, project=project)
    assert client.post(f"/api/v1/runs/{run}/notes", headers=headers, json={"content": "my note"}).status_code in (200, 201)
    share = client.post(f"/api/v1/runs/{run}/share", headers=headers).json()["share_token"]
    key = client.post("/api/v1/users/me/api-keys", headers=headers, json={"name": "sdk"}).json()["key"]
    hook = client.post("/api/v1/webhooks", headers=headers, json={"name": "h", "url": "https://hooks.example.com/x"})
    assert hook.status_code in (200, 201), hook.text
    ch = client.post("/api/v1/notifications/channels", headers=headers, json={
        "name": "s", "channel_type": "slack", "config": {"webhook_url": "https://hooks.slack.com/services/T/B/SECRET"}})
    assert ch.status_code == 200
    with SessionLocal() as db:
        db.add(PasskeyCredential(user_id=uid, credential_id=f"cred-{uuid.uuid4().hex}", public_key=b"pk",
                                 user_handle="h", name="Laptop"))
        db.commit()
        store_put(db, "researcher_profiles", f"p-{uid}", {"user_id": uid, "username": f"u{uid}", "bio": "me"})
        store_put(db, "some_feature", f"r-{uuid.uuid4().hex[:8]}", {"owner": f"user:{uid}", "x": 1})
    return {"uid": uid, "run": run, "share": share, "key": key, "project": project}


def test_delete_locks_now_and_erases_after_seven_days():
    alice, bob = make_user(prefix="era"), make_user(prefix="erb")
    a = _fill(alice)
    bob_run = push_run(bob, project=a["project"])  # bob uses the same project name

    r = client.delete("/auth/me", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scheduled"] is True and body["grace_days"] == 7
    due = datetime.fromisoformat(body["erase_at"])
    assert timedelta(days=6, hours=23) < due - datetime.now(timezone.utc) <= timedelta(days=7)

    # Locked at once: no session, no API key, no public share.
    assert client.get("/auth/me", headers=alice).status_code == 401
    assert client.get("/api/v1/runs", headers={"X-QLab-Api-Key": a["key"]}).status_code == 401
    assert client.get(f"/api/v1/runs/public/{a['share']}").status_code == 404

    with SessionLocal() as db:
        assert erasure.pseudonym(a["uid"]) not in erasure.process_due(db)  # not yet
        assert db.get(User, a["uid"]) is not None
        erased = erasure.process_due(db, now=datetime.now(timezone.utc) + timedelta(days=8))
    code = erasure.pseudonym(a["uid"])
    assert code in erased and code.startswith("erased-")

    with SessionLocal() as db:
        uid = a["uid"]
        assert db.get(User, uid) is None
        assert db.scalar(select(Run).where(Run.run_id == a["run"])) is None
        assert db.scalar(select(RunNote).where(RunNote.run_id == a["run"])) is None
        assert db.scalar(select(APIKey).where(APIKey.user_id == uid)) is None
        assert db.scalar(select(PasskeyCredential).where(PasskeyCredential.user_id == uid)) is None
        assert db.scalar(select(Webhook).where(Webhook.created_by_user_id == uid)) is None
        assert db.scalar(select(NotificationChannel).where(NotificationChannel.created_by_user_id == uid)) is None
        leftovers = [r for r in db.scalars(select(GenericRecord)).all()
                     if (r.data or {}).get("owner") == f"user:{uid}" or (r.data or {}).get("user_id") == uid]
        assert leftovers == []
        # The security log stays, without the user.
        assert db.scalars(select(AuditLog).where(AuditLog.user_id == uid)).all() == []
        assert db.scalar(select(AuditLog).where(AuditLog.action == "account.erased",
                                                AuditLog.resource_id == code)) is not None
        # Bob's run, and the project he still uses, are untouched.
        bob_row = db.scalar(select(Run).where(Run.run_id == bob_run))
        assert bob_row is not None
        assert db.scalar(select(Project).where(Project.slug == a["project"])) is not None


def test_a_project_only_they_used_is_erased():
    alice = make_user(prefix="erp")
    project = f"solo-{uuid.uuid4().hex[:8]}"
    push_run(alice, project=project)
    uid = user_id(alice)
    with SessionLocal() as db:
        assert db.scalar(select(Project).where(Project.slug == project)) is not None
        erasure.erase(db, uid, notify=False)
        assert db.scalar(select(Project).where(Project.slug == project)) is None


def test_signing_in_cancels_the_deletion():
    alice = make_user(prefix="erc")
    email = _email(alice)
    uid = user_id(alice)
    assert client.delete("/auth/me", headers=alice).status_code == 200
    assert client.get("/auth/me", headers=alice).status_code == 401

    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    fresh = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/auth/me", headers=fresh).status_code == 200
    with SessionLocal() as db:
        assert erasure.pending(db, uid) is None
        assert erasure.process_due(db, now=datetime.now(timezone.utc) + timedelta(days=30)) == []
        assert db.get(User, uid).is_active is True


def test_an_api_key_cannot_delete_the_account():
    alice = make_user(prefix="erk")
    key = client.post("/api/v1/users/me/api-keys", headers=alice, json={"name": "sdk"}).json()["key"]
    assert client.delete("/auth/me", headers={"X-QLab-Api-Key": key}).status_code == 403
    assert client.post("/api/v1/gdpr/delete/request", headers={"X-QLab-Api-Key": key},
                       json={"confirm": True}).status_code == 403


def test_gdpr_delete_request_is_carried_out():
    alice = make_user(prefix="erg")
    uid = user_id(alice)
    r = client.post("/api/v1/gdpr/delete/request", headers=alice, json={"confirm": True, "reason": "bye"})
    assert r.status_code == 200 and r.json()["status"] == "scheduled"
    admin = make_user(role="admin", prefix="erga")
    listed = client.get("/api/v1/gdpr/delete/requests", headers=admin).json()
    assert any(s["user_id"] == uid for s in listed["scheduled"])
    with SessionLocal() as db:
        erasure.process_due(db, now=datetime.now(timezone.utc) + timedelta(days=8))
        assert db.get(User, uid) is None
        reqs = [r.data for r in db.scalars(select(GenericRecord).where(GenericRecord.namespace == "gdpr_requests"))
                if r.data.get("request_id") == r.data.get("request_id") and r.data.get("request_type") == "delete"]
        mine = [d for d in reqs if d.get("user_id") == erasure.pseudonym(uid)]
        assert mine and mine[0]["status"] == "completed" and mine[0]["reason"] is None


def test_old_pending_gdpr_requests_are_processed():
    """Requests made before erasure was automatic sat at "pending_confirmation" for ever."""
    alice = make_user(prefix="ero")
    uid = user_id(alice)
    old = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
    with SessionLocal() as db:
        store_put(db, "gdpr_requests", f"gdpr_del_{uuid.uuid4().hex[:12]}", {
            "user_id": uid, "request_type": "delete", "status": "pending_confirmation", "requested_at": old})
        erasure.process_due(db)
        assert db.get(User, uid) is None


def test_admin_can_run_due_erasures():
    admin = make_user(role="admin", prefix="erad")
    assert client.post("/api/v1/gdpr/delete/process", headers=make_user(prefix="erx")).status_code == 403
    assert client.post("/api/v1/gdpr/delete/process", headers=admin).status_code == 200
