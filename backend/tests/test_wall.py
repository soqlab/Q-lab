"""Wall mode and display links (app/wall.py, app/routers/wall.py).

A display link reads the wall's sentence and number and nothing else; it is stored hashed, can be
revoked and can expire; it shows only what its creator may see; and the wall answers 304 when the
display already has the current data.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.database import engine
from app.routers.wall import BAD_LINK
from app.wall import is_simulator, reset_cache
from tests.helpers import PASSWORD, client, make_user, push_run, user_id


def _org_user(org: str, role: str = "admin", prefix: str = "wallorg") -> dict[str, str]:
    email = f"{prefix}_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": prefix, "org_name": org})
    assert r.status_code in (200, 201), r.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified = 1, role = :r WHERE email = :e"), {"r": role, "e": email})
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _link(headers: dict[str, str], **body) -> dict:
    r = client.post("/api/v1/display-links", headers=headers, json={"name": "Lab TV", **body})
    assert r.status_code == 200, r.text
    return r.json()


def _wall(token: str, **headers):
    reset_cache()
    return client.get("/api/v1/wall", headers={"X-Qlab-Display": token, **headers})


def _db_value(sql: str, **params):
    with engine.begin() as conn:
        return conn.execute(text(sql), params).scalar()


def test_link_is_shown_once_and_stored_hashed():
    alice = make_user(prefix="wallhash")
    created = _link(alice)
    token = created["token"]
    assert token.startswith("qdl_") and len(token) > 40
    assert created["path"] == f"/wall#{token}"
    stored = _db_value("SELECT token_hash FROM display_links WHERE id = :i", i=created["id"])
    assert stored == hashlib.sha256(token.encode()).hexdigest() and token not in stored
    listed = client.get("/api/v1/display-links", headers=alice).json()
    assert [x["id"] for x in listed] == [created["id"]]
    assert "token" not in listed[0] and token not in repr(listed)
    assert listed[0]["created_by"]["name"] == "wallhash" and listed[0]["last_used_at"] is None


def test_wall_shows_the_latest_run_and_marks_last_used():
    alice = make_user(prefix="wallrun")
    push_run(alice, backend="ibm_fez", circuit_name="bell", results={"counts": {"00": 455, "11": 455, "01": 90}})
    token = _link(alice)["token"]
    r = _wall(token)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["metric"] == "last_run" and body["display"] == "91%" and body["value"] == 0.91
    assert "ibm_fez" in body["sentence"] and "91%" in body["sentence"]
    assert body["data_as_of"] and body["state"] == "ok"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert "noindex" in r.headers["X-Robots-Tag"] and "no-store" in r.headers["Cache-Control"]
    listed = client.get("/api/v1/display-links", headers=alice).json()
    assert listed[0]["last_used_at"] is not None


def test_empty_wall_says_so_instead_of_a_number():
    alice = make_user(prefix="wallempty")
    for metric in ("last_run", "runs_week", "drift"):
        body = _wall(_link(alice, metric=metric)["token"]).json()
        if metric == "runs_week":
            assert body["value"] == 0 and body["sentence"] == "No runs were recorded in the last 7 days."
        else:
            assert body["value"] is None and body["display"] is None and body["state"] == "empty"


def test_runs_week_and_drift():
    alice = make_user(prefix="wallweek")
    push_run(alice, backend="ibm_fez", results={"counts": {"00": 500, "11": 500}})
    push_run(alice, backend="ibm_fez", results={"counts": {"00": 900, "01": 100}})
    push_run(alice, backend="ibm_torino")
    old = (datetime.now(timezone.utc) - timedelta(days=9)).isoformat()
    push_run(alice, backend="ibm_torino", created_at=old)
    week = _wall(_link(alice, metric="runs_week")["token"]).json()
    assert week["value"] == 3 and "3 runs on 2 machines" in week["sentence"] and "ibm_fez (2)" in week["sentence"]

    drift = _wall(_link(alice, metric="drift")["token"]).json()
    assert drift["value"] == 1 and drift["state"] == "alarm" and "ibm_fez" in drift["sentence"]
    # ibm_torino re-ran the same circuit 9 days apart and the result held: 1 of 2 machines moved.
    assert drift["label"].startswith("of 2 machines")
    assert is_simulator("aer_simulator") and is_simulator("fake_brisbane") and not is_simulator("ibm_fez")


def test_admin_can_change_what_a_link_shows():
    alice = make_user(prefix="wallpatch")
    link = _link(alice)
    r = client.patch(f"/api/v1/display-links/{link['id']}", headers=alice, json={"metric": "runs_week"})
    assert r.status_code == 200 and r.json()["metric"] == "runs_week"
    assert _wall(link["token"]).json()["metric"] == "runs_week"
    assert client.patch(f"/api/v1/display-links/{link['id']}", headers=alice, json={"metric": "everything"}).status_code == 422


def test_token_reads_nothing_else():
    alice = make_user(prefix="wallscope")
    run_id = push_run(alice)
    token = _link(alice)["token"]
    for h in ({"X-Qlab-Display": token}, {"X-QLab-Api-Key": token}, {"Authorization": f"Bearer {token}"}):
        assert client.get(f"/api/v1/runs/{run_id}", headers=h).status_code in (401, 403, 404)
        listed = client.get("/api/v1/runs", headers=h)
        assert listed.status_code != 200 or run_id not in repr(listed.json())
        assert client.get("/api/v1/display-links", headers=h).status_code in (401, 403)
        assert client.post("/api/v1/display-links", headers=h, json={"name": "x"}).status_code in (401, 403)
        assert client.get("/auth/me", headers=h).status_code in (401, 403)
    # Only the display header opens the wall; nothing else does.
    assert client.get("/api/v1/wall", headers={"Authorization": alice["Authorization"]}).status_code == 401
    assert client.get("/api/v1/wall", headers={"X-QLab-Api-Key": token}).status_code == 401
    assert client.post("/api/v1/wall", headers={"X-Qlab-Display": token}).status_code == 405
    assert _wall("qdl_" + "x" * 43).status_code == 401
    assert _wall("not-a-display-token").json()["detail"] == BAD_LINK


def test_revocation_stops_the_display_and_is_audited():
    alice = make_user(prefix="wallrevoke")
    link = _link(alice)
    assert _wall(link["token"]).status_code == 200
    r = client.delete(f"/api/v1/display-links/{link['id']}", headers=alice)
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    r = _wall(link["token"])
    assert r.status_code == 401 and r.json()["detail"] == BAD_LINK
    assert r.headers["Referrer-Policy"] == "no-referrer"
    uid = user_id(alice)
    with engine.begin() as conn:
        actions = [a for (a,) in conn.execute(text(
            "SELECT action FROM audit_logs WHERE user_id = :u AND action LIKE 'display_link.%' ORDER BY id"), {"u": uid})]
    assert actions == ["display_link.create", "display_link.revoke"]
    flat = repr(list(engine.connect().execute(text("SELECT meta FROM audit_logs WHERE user_id = :u"), {"u": uid})))
    assert link["token"] not in flat


def test_expiry():
    alice = make_user(prefix="wallexpiry")
    link = _link(alice, expires_days=1)
    assert link["expires_at"] and _wall(link["token"]).status_code == 200
    with engine.begin() as conn:
        conn.execute(text("UPDATE display_links SET expires_at = :t WHERE id = :i"),
                     {"t": datetime.now(timezone.utc) - timedelta(minutes=1), "i": link["id"]})
    assert _wall(link["token"]).status_code == 401
    assert client.get("/api/v1/display-links", headers=alice).json()[0]["status"] == "expired"
    assert client.post("/api/v1/display-links", headers=alice, json={"name": "x", "expires_days": 0}).status_code == 422


def test_org_isolation_and_admin_only():
    org_a, org_b = f"walla-{uuid.uuid4().hex[:6]}", f"wallb-{uuid.uuid4().hex[:6]}"
    admin_a = _org_user(org_a, "admin")
    member_a = _org_user(org_a, "researcher")
    admin_b = _org_user(org_b, "owner")
    push_run(member_a, backend="ibm_fez", results={"counts": {"00": 700, "11": 300}})
    push_run(admin_b, backend="ibm_kyiv", results={"counts": {"00": 100, "11": 100}})

    assert client.post("/api/v1/display-links", headers=member_a, json={"name": "x"}).status_code == 403
    link_a = _link(admin_a, metric="runs_week")
    # Org A's display counts the member's run, never org B's.
    body = _wall(link_a["token"]).json()
    assert body["value"] == 1 and "ibm_fez" in body["sentence"] and "ibm_kyiv" not in body["sentence"]
    # Org B can't see, change or revoke org A's link.
    assert link_a["id"] not in [x["id"] for x in client.get("/api/v1/display-links", headers=admin_b).json()]
    assert client.patch(f"/api/v1/display-links/{link_a['id']}", headers=admin_b, json={"metric": "drift"}).status_code == 404
    assert client.delete(f"/api/v1/display-links/{link_a['id']}", headers=admin_b).status_code == 404
    assert _wall(link_a["token"]).status_code == 200

    # When the creator is no longer an admin, the link stops.
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET role = 'researcher' WHERE id = :u"), {"u": user_id(admin_a)})
    assert _wall(link_a["token"]).status_code == 401


def test_etag_gives_304_until_the_data_changes():
    alice = make_user(prefix="walletag")
    push_run(alice, backend="ibm_fez")
    token = _link(alice)["token"]
    first = _wall(token)
    tag = first.headers["ETag"]
    assert tag.startswith('W/"')
    again = _wall(token, **{"If-None-Match": tag})
    assert again.status_code == 304 and again.headers["ETag"] == tag and again.content == b""
    push_run(alice, backend="ibm_torino", results={"counts": {"00": 800, "11": 200}})
    changed = _wall(token, **{"If-None-Match": tag})
    assert changed.status_code == 200 and changed.headers["ETag"] != tag and "ibm_torino" in changed.json()["sentence"]


def test_stale_data_is_dated_not_hidden():
    """The wall reports when its data is from, so the display can say how old it is."""
    alice = make_user(prefix="wallstale")
    old = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    push_run(alice, backend="ibm_fez", created_at=old)
    body = _wall(_link(alice)["token"]).json()
    newest = datetime.fromisoformat(body["newest_run_at"].replace("Z", "+00:00"))
    assert timedelta(hours=2, minutes=59) < datetime.now(timezone.utc) - newest < timedelta(hours=3, minutes=5)
    assert body["data_as_of"] == body["newest_run_at"]


def test_display_links_need_a_session_not_an_api_key():
    alice = make_user(prefix="wallkey")
    key = client.post("/api/v1/users/me/api-keys", headers=alice, json={"name": "k"}).json()["key"]
    assert client.post("/api/v1/display-links", headers={"X-QLab-Api-Key": key}, json={"name": "x"}).status_code == 403
    assert client.get("/api/v1/display-links").status_code == 401
