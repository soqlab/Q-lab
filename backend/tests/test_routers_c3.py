"""Accounts, sharing and integrations (group C): who may do what, and whose data each user sees."""
import hashlib
import hmac
import socket
import time
import types
import uuid
from urllib.parse import urlencode

import pytest
from sqlalchemy import text

from app import outbound
from app.database import engine
from app.routers import slack_bot
from tests.helpers import PASSWORD, client, make_user, push_run


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _me(headers) -> dict:
    return client.get("/auth/me", headers=headers).json()


def _org_user(org: str, role: str = "researcher", name: str | None = None) -> dict:
    """A user in organisation `org` (created on first use) with the given role."""
    email = f"c3_{_uid()}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": name or "c3", "org_name": org})
    assert r.status_code in (200, 201), r.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified = 1, role = :r WHERE email = :e"), {"r": role, "e": email})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def users():
    return make_user(prefix="c3a"), make_user(prefix="c3b")


# ── rbac ─────────────────────────────────────────────────────────────────────

def test_rbac_roles_and_permissions(users):
    alice, _ = users
    roles = client.get("/api/v1/rbac/roles").json()["roles"]
    assert [r["name"] for r in roles] == ["owner", "admin", "researcher", "viewer"]
    mine = client.get("/api/v1/rbac/permissions", headers=alice).json()
    assert mine["role"] == "researcher" and "submit_run" in mine["permissions"]
    assert "manage_users" not in mine["permissions"]
    assert client.get("/api/v1/rbac/permissions").status_code == 401
    assert client.get("/api/v1/rbac/users", headers=alice).status_code == 403
    viewer = make_user(role="viewer", prefix="c3v")
    assert client.get("/api/v1/rbac/audit-log", headers=viewer).status_code == 403


def test_rbac_audit_log_shows_only_your_own_entries(users):
    """Regression: for a user without an organisation the audit log listed every entry on the
    server (other users' run views, IP addresses), and `total` counted all of them."""
    alice, bob = users
    rid = push_run(alice)
    client.get(f"/api/v1/runs/{rid}", headers=alice)  # logs run.viewed for Alice
    alice_id, bob_id = _me(alice)["user_id"], _me(bob)["user_id"]

    mine = client.get("/api/v1/rbac/audit-log?action=run.viewed", headers=alice).json()
    assert rid in {i["resource_id"] for i in mine["items"]}
    assert {i["user_id"] for i in mine["items"]} == {alice_id}
    theirs = client.get("/api/v1/rbac/audit-log?limit=1000", headers=bob).json()
    assert {i["user_id"] for i in theirs["items"]} <= {bob_id}
    assert rid not in {i["resource_id"] for i in theirs["items"]}
    assert theirs["total"] == len(theirs["items"])


def test_rbac_role_changes(users):
    org = f"rbac-{_uid()}"
    owner = _org_user(org, "owner")
    member = _org_user(org, "researcher")
    member_id = _me(member)["user_id"]
    outsider_id = _me(users[0])["user_id"]

    r = client.patch(f"/api/v1/rbac/users/{member_id}/role", headers=owner, json={"role": "admin"})
    assert r.json() == {"user_id": member_id, "old_role": "researcher", "new_role": "admin"}
    assert _me(member)["role"] == "admin"
    assert client.patch(f"/api/v1/rbac/users/{member_id}/role", headers=owner, json={"role": "owner"}).status_code == 403
    assert client.patch(f"/api/v1/rbac/users/{member_id}/role", headers=owner, json={"role": "god"}).status_code == 422
    assert client.patch(f"/api/v1/rbac/users/{outsider_id}/role", headers=owner, json={"role": "viewer"}).status_code == 403
    assert client.patch(f"/api/v1/rbac/users/{member_id}/role", headers=member, json={"role": "viewer"}).status_code == 403
    listed = {u["id"] for u in client.get("/api/v1/rbac/users", headers=member).json()}
    assert member_id in listed and outsider_id not in listed  # admin sees their own organisation
    log = client.get("/api/v1/rbac/audit-log?action=rbac.role_changed", headers=owner).json()
    assert any(i["meta"] == {"old_role": "researcher", "new_role": "admin"} for i in log["items"])


# ── team ─────────────────────────────────────────────────────────────────────

def test_team_invite_accept_and_manage(users):
    """Regression: re-inviting, validating or accepting compared SQLite's naive expiry time with an
    aware "now" and answered 500."""
    org = f"team-{_uid()}"
    owner = _org_user(org, "owner")
    joiner = make_user(prefix="c3j")
    inv = client.post("/api/v1/team/invite", headers=owner, json={"email": "new@example.com", "role": "researcher"})
    assert inv.status_code == 200, inv.text
    token = inv.json()["invite_token"]
    again = client.post("/api/v1/team/invite", headers=owner, json={"email": "new@example.com"}).json()
    assert again["invite_token"] == token  # a pending invite is reused
    assert client.get(f"/api/v1/team/invite/validate?token={token}").json()["org_name"] == org

    assert client.post(f"/api/v1/team/invite/accept?token={token}", headers=joiner).json()["joined"] is True
    assert client.post(f"/api/v1/team/invite/accept?token={token}", headers=joiner).status_code == 409
    joiner_id = _me(joiner)["user_id"]
    assert joiner_id in {m["id"] for m in client.get("/api/v1/team/members", headers=owner).json()}
    assert client.get("/api/v1/team/members", headers=users[0]).json() == []  # no organisation

    assert client.patch(f"/api/v1/team/members/{joiner_id}/role", headers=owner, json={"role": "admin"}).json()["role"] == "admin"
    assert client.patch(f"/api/v1/team/members/{joiner_id}/role", headers=owner, json={"role": "x"}).status_code == 422
    assert client.post("/api/v1/team/invite", headers=users[0], json={"email": "a@b.c"}).status_code == 403
    assert client.delete(f"/api/v1/team/members/{joiner_id}", headers=owner).json() == {"removed": True}
    assert _me(joiner)["org_id"] is None


def test_team_admin_cannot_grant_or_take_ownership():
    """Regression: an admin could invite someone (or their own second account) as owner, promote a
    member to owner, or demote and remove the owner."""
    org = f"own-{_uid()}"
    owner = _org_user(org, "owner")
    admin = _org_user(org, "admin")
    member = _org_user(org, "researcher")
    owner_id, member_id = _me(owner)["user_id"], _me(member)["user_id"]

    assert client.post("/api/v1/team/invite", headers=admin, json={"email": "x@example.com", "role": "owner"}).status_code == 403
    assert client.patch(f"/api/v1/team/members/{member_id}/role", headers=admin, json={"role": "owner"}).status_code == 403
    assert client.patch(f"/api/v1/team/members/{owner_id}/role", headers=admin, json={"role": "viewer"}).status_code == 403
    assert client.delete(f"/api/v1/team/members/{owner_id}", headers=admin).status_code == 403
    assert _me(owner)["role"] == "owner"
    # Admins still manage everyone else, and an owner may grant ownership.
    assert client.patch(f"/api/v1/team/members/{member_id}/role", headers=admin, json={"role": "viewer"}).status_code == 200
    assert client.patch(f"/api/v1/team/members/{member_id}/role", headers=owner, json={"role": "owner"}).status_code == 200


# ── slack_bot ────────────────────────────────────────────────────────────────

class _FakeAsyncClient:
    calls: list = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, headers=None):
        _FakeAsyncClient.calls.append(("GET", url, None))
        return types.SimpleNamespace(json=lambda: {"ok": True, "user": "qlab-bot", "team": "lab"}, status_code=200)

    async def post(self, url, json=None, headers=None):
        _FakeAsyncClient.calls.append(("POST", url, json))
        return types.SimpleNamespace(json=lambda: {"ok": True}, status_code=200)


@pytest.fixture
def slack(monkeypatch):
    _FakeAsyncClient.calls = []
    monkeypatch.setattr(slack_bot, "httpx", types.SimpleNamespace(AsyncClient=_FakeAsyncClient))
    monkeypatch.delenv("QLAB_ALLOW_PRIVATE_URLS", raising=False)
    monkeypatch.setattr(outbound.socket, "getaddrinfo",
                        lambda host, port, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "",
                                                      ("10.0.0.5" if "internal" in host else "93.184.215.14", port))])
    return _FakeAsyncClient.calls


def test_slack_config_requires_an_admin(slack, users):
    """Regression: anyone, even without signing in, could replace the server-wide Slack bot token,
    signing secret and Teams webhook, and send messages through them."""
    alice, _ = users
    cfg = {"slack_signing_secret": "sig", "slack_bot_token": "xoxb-1234567890abc", "channel_id": "C1",
           "teams_webhook_url": "https://teams.example.com/hook"}
    assert client.post("/api/v1/slack/config", json=cfg).status_code == 401
    assert client.post("/api/v1/slack/config", headers=alice, json=cfg).status_code == 403
    assert client.get("/api/v1/slack/config").status_code == 401
    assert client.post("/api/v1/slack/notify", json={"message": "hi"}).status_code == 401
    assert client.post("/api/v1/slack/teams-notify", json={"title": "t", "text": "x"}).status_code == 401
    assert client.get("/api/v1/slack/test").status_code == 401


def test_slack_config_notify_and_teams(slack, users):
    admin = make_user(role="admin", prefix="c3s")
    cfg = {"slack_signing_secret": "sig", "slack_bot_token": "xoxb-1234567890abc", "channel_id": "C1",
           "teams_webhook_url": "https://teams.example.com/hook"}
    saved = client.post("/api/v1/slack/config", headers=admin, json=cfg).json()
    assert saved["verified"] is True and saved["bot_name"] == "qlab-bot"
    assert saved["slack_bot_token"] == "xoxb-1234567***" and saved["slack_signing_secret"] == "***"
    assert client.get("/api/v1/slack/config", headers=users[0]).json()["slack_bot_token"] == "xoxb-1234567***"

    sent = client.post("/api/v1/slack/notify", headers=users[0], json={"message": "done", "run_id": "r1"}).json()
    assert sent == {"sent": True, "channel": "C1"}
    method, url, body = slack[-1]
    assert url == "https://slack.com/api/chat.postMessage" and body["channel"] == "C1"
    assert body["blocks"][1]["elements"][0]["url"].endswith("/runs/r1")

    teams = client.post("/api/v1/slack/teams-notify", headers=users[0], json={"title": "T", "text": "body"}).json()
    assert teams == {"sent": True, "status_code": 200}
    assert slack[-1][1] == "https://teams.example.com/hook" and slack[-1][2]["title"] == "T"
    assert client.get("/api/v1/slack/test", headers=users[0]).json()["sent"] is True

    # Teams address on an internal network is refused.
    bad = client.post("/api/v1/slack/config", headers=admin, json={**cfg, "teams_webhook_url": "http://internal.corp/x"})
    assert bad.status_code == 422


def test_slack_slash_command_checks_the_signature(slack, users):
    admin = make_user(role="admin", prefix="c3t")
    client.post("/api/v1/slack/config", headers=admin, json={"slack_signing_secret": "s3cret", "slack_bot_token": "xoxb-x"})
    body = urlencode({"text": "help"})
    ts = str(int(time.time()))
    sig = "v0=" + hmac.new(b"s3cret", f"v0:{ts}:{body}".encode(), hashlib.sha256).hexdigest()
    headers = {"Content-Type": "application/x-www-form-urlencoded",
               "X-Slack-Request-Timestamp": ts, "X-Slack-Signature": sig}
    ok = client.post("/api/v1/slack/slash-command", content=body, headers=headers).json()
    assert ok["blocks"][0]["text"]["text"] == "⚛️ Q-Lab Help"
    forged = client.post("/api/v1/slack/slash-command", content=body,
                         headers={**headers, "X-Slack-Signature": "v0=deadbeef"}).json()
    assert "Authentication failed" in forged["blocks"][1]["text"]["text"]
    stale = str(int(time.time()) - 3600)
    old_sig = "v0=" + hmac.new(b"s3cret", f"v0:{stale}:{body}".encode(), hashlib.sha256).hexdigest()
    replay = client.post("/api/v1/slack/slash-command", content=body,
                         headers={**headers, "X-Slack-Request-Timestamp": stale, "X-Slack-Signature": old_sig}).json()
    assert "Authentication failed" in replay["blocks"][1]["text"]["text"]


# ── webhooks ─────────────────────────────────────────────────────────────────

def test_webhooks_crud_within_an_organisation():
    org_a, org_b = f"wh-{_uid()}", f"wh-{_uid()}"
    alice, bob = _org_user(org_a), _org_user(org_b)
    assert client.post("/api/v1/webhooks", json={"name": "x", "url": "https://h.example.com"}).status_code == 401
    assert client.post("/api/v1/webhooks", headers=alice,
                       json={"name": "x", "url": "https://h.example.com", "events": ["run.exploded"]}).status_code == 422
    created = client.post("/api/v1/webhooks", headers=alice,
                          json={"name": "ci", "url": "https://h.example.com/q", "events": ["run.completed"]}).json()
    wid = created["id"]
    assert len(created["secret"]) == 64 and created["events"] == ["run.completed"]
    listed = client.get("/api/v1/webhooks", headers=alice).json()
    assert [w["id"] for w in listed] == [wid] and "secret" not in listed[0]
    assert wid not in {w["id"] for w in client.get("/api/v1/webhooks", headers=bob).json()}
    assert client.patch(f"/api/v1/webhooks/{wid}", headers=bob, json={"is_active": False}).status_code == 404
    assert client.delete(f"/api/v1/webhooks/{wid}", headers=bob).status_code == 404
    upd = client.patch(f"/api/v1/webhooks/{wid}", headers=alice, json={"is_active": False, "name": "ci2"}).json()
    assert upd["is_active"] is False and upd["name"] == "ci2"
    assert client.delete(f"/api/v1/webhooks/{wid}", headers=alice).json() == {"deleted": True}
    assert client.delete(f"/api/v1/webhooks/{wid}", headers=alice).status_code == 404


# ── social ───────────────────────────────────────────────────────────────────

def test_social_follow_notifications_discover_and_unfollow():
    """Regression: the feed, notifications and discover read records as {"value": ...} wrappers that
    the store never returns, so they were always empty; unfollowing crashed with a 500."""
    a, b = f"ann_{_uid()}", f"ben_{_uid()}"
    client.post("/api/v1/social/profile", json={"username": a, "institution": "X", "research_areas": ["qec", "zx"]})
    client.post("/api/v1/social/profile", json={"username": b, "institution": "Y", "research_areas": ["qec"]})
    f = client.post("/api/v1/social/follow", json={"follower": a, "following": b}).json()
    assert f["follower_count"] == 1 and f["following_count"] == 1
    assert client.post("/api/v1/social/follow", json={"follower": a, "following": a}).status_code == 400
    assert client.post("/api/v1/social/follow", json={"follower": a, "following": "nobody-xyz"}).status_code == 404

    notes = client.get(f"/api/v1/social/notifications/{b}").json()
    assert notes["count"] == 1 and notes["notifications"][0]["message"] == f"{a} started following you."
    client.post("/api/v1/social/notify", json={"user": b, "type": "mention", "message": "hi"})
    assert client.get(f"/api/v1/social/notifications/{b}?unread_only=true").json()["count"] == 2

    feed = client.get(f"/api/v1/social/feed/{a}").json()  # the sample activity is gone; nothing is invented
    assert feed == {"username": a, "feed": [], "count": 0}
    disc = client.get(f"/api/v1/social/discover?username={a}&limit=100").json()["suggestions"]
    names = [s["username"] for s in disc]
    assert b not in names and a not in names  # already followed / self
    assert client.get(f"/api/v1/social/profile/{b}").json()["follower_count"] == 1

    un = client.request("DELETE", "/api/v1/social/follow", json={"follower": a, "following": b})
    assert un.status_code == 200 and un.json()["unfollowed"] is True
    assert client.get(f"/api/v1/social/profile/{b}").json()["follower_count"] == 0


# ── researcher_profiles ──────────────────────────────────────────────────────

def test_researcher_profiles_of_two_people_with_the_same_name():
    """Regression: profiles were keyed by display name, so a second user with the same name
    read and overwrote the first user's profile through /profiles/me."""
    name = f"Same Name {_uid()}"
    first = _org_user(f"p-{_uid()}", name=name)
    second = _org_user(f"p-{_uid()}", name=name)
    assert client.get("/api/v1/profiles/me", headers=first).status_code == 404
    a = client.post("/api/v1/profiles/me", headers=first, json={"display_name": "First", "orcid_id": "0000-0001-2345-678X"}).json()
    b = client.post("/api/v1/profiles/me", headers=second, json={"display_name": "Second"}).json()
    assert a["profile_id"] != b["profile_id"] and a["username"] != b["username"]
    assert client.get("/api/v1/profiles/me", headers=first).json()["display_name"] == "First"
    assert client.get("/api/v1/profiles/me", headers=second).json()["display_name"] == "Second"
    upd = client.post("/api/v1/profiles/me", headers=first, json={"display_name": "First v2"}).json()
    assert upd["profile_id"] == a["profile_id"]
    assert client.get(f"/api/v1/profiles/{a['username']}").json()["display_name"] == "First v2"


def test_researcher_profile_validation(users):
    alice, _ = users
    assert client.post("/api/v1/profiles/me", json={"display_name": "x"}).status_code == 401
    assert client.post("/api/v1/profiles/me", headers=alice, json={"display_name": "x", "bio": "b" * 501}).status_code == 400
    assert client.post("/api/v1/profiles/me", headers=alice, json={"display_name": "x", "website_url": "ftp://x"}).status_code == 400
    assert client.post("/api/v1/profiles/me", headers=alice, json={"display_name": "x", "orcid_id": "123"}).status_code == 400
    assert client.get("/api/v1/profiles/nobody-at-all-xyz").status_code == 404


# ── user_feedback ────────────────────────────────────────────────────────────

def test_user_feedback_submit_and_triage(users):
    alice, _ = users
    admin = make_user(role="admin", prefix="c3f")
    r = client.post("/api/v1/user-feedback", headers=alice, json={
        "type": "bug_report", "title": "Chart blank", "description": "The chart on the run page is empty.",
        "severity": "high"})
    fid = r.json()["id"]
    assert client.post("/api/v1/user-feedback", json={"type": "rant", "title": "abc", "description": "0123456789"}).status_code == 422
    assert client.get("/api/v1/user-feedback", headers=alice).status_code == 403
    items = client.get("/api/v1/user-feedback?type=bug_report&limit=500", headers=admin).json()["items"]
    mine = next(i for i in items if i["id"] == fid)
    assert mine["user_id"] == _me(alice)["user_id"] and mine["status"] == "new"
    upd = client.patch(f"/api/v1/user-feedback/{fid}", headers=admin,
                       json={"status": "fixed", "admin_note": "ok", "user_id": 1}).json()
    assert upd["status"] == "fixed" and upd["user_id"] == mine["user_id"]  # only status/note change
    assert client.patch(f"/api/v1/user-feedback/{fid}", headers=alice, json={"status": "x"}).status_code == 403
    assert client.delete(f"/api/v1/user-feedback/{fid}", headers=admin).json() == {"deleted": fid}
    assert client.patch(f"/api/v1/user-feedback/{fid}", headers=admin, json={"status": "x"}).status_code == 404


# ── peer_review ──────────────────────────────────────────────────────────────

def _review_request() -> dict:
    return {"requester_name": "A", "requester_email": "a@example.com", "reviewer_name": "Rev",
            "reviewer_institution": "Uni", "review_type": "methodology"}


def test_peer_review_flow_and_signature(users):
    """Regression: the reviewer's link (no account) showed "run": null, because the run lookup was
    limited to the anonymous caller's runs."""
    alice, _ = users
    rid = push_run(alice)
    created = client.post(f"/api/v1/peer-review/request/{rid}", headers=alice, json=_review_request()).json()
    token = created["access_token"]
    view = client.get(f"/api/v1/peer-review/token/{token}").json()  # the reviewer has no account
    assert view["run"]["run_id"] == rid and "requester_email" not in view
    decided = client.post(f"/api/v1/peer-review/token/{token}/decide", json={
        "decision": "approved", "comments": "fine", "reviewer_name": "Rev", "reviewer_institution": "Uni"}).json()
    expected = hashlib.sha256(f"{rid}:Rev:approved:{token}".encode()).hexdigest()
    assert decided["signature"] == expected
    assert client.get(f"/api/v1/peer-review/verify/{expected}").json()["valid"] is True
    assert client.post(f"/api/v1/peer-review/token/{token}/decide", json={
        "decision": "rejected", "comments": "", "reviewer_name": "R", "reviewer_institution": "U"}).status_code == 400
    assert client.post(f"/api/v1/peer-review/request/{rid}", headers=alice,
                       json={**_review_request(), "review_type": "vibes"}).status_code == 422


def test_peer_review_listings_hide_tokens_and_other_peoples_reviews(users):
    """Regression: GET /run/{id} and /my-requests returned every review on the server with its
    access token, so anyone could approve (and sign) a review meant for someone else."""
    alice, bob = users
    rid = push_run(alice)
    client.post(f"/api/v1/peer-review/request/{rid}", headers=alice, json=_review_request())
    assert client.post(f"/api/v1/peer-review/request/{rid}", headers=bob, json=_review_request()).status_code == 404

    own = client.get(f"/api/v1/peer-review/run/{rid}", headers=alice).json()
    assert own["count"] == 1 and "access_token" not in own["reviews"][0]
    assert client.get(f"/api/v1/peer-review/run/{rid}", headers=bob).status_code == 404
    listed = client.get("/api/v1/peer-review/my-requests", headers=bob).json()["reviews"]
    assert rid not in {r["run_id"] for r in listed}
    assert all("access_token" not in r for r in client.get("/api/v1/peer-review/my-requests", headers=alice).json()["reviews"])


# ── preregistration ──────────────────────────────────────────────────────────

def _prereg() -> dict:
    return {"title": "Bell fidelity", "description": "d", "researcher_name": f"R {_uid()}", "circuit_description": "bell",
            "backend": "aer", "n_qubits": 2, "n_shots": 1000, "algorithm": "bell",
            "hypotheses": [{"metric": "success_probability", "operator": ">=", "expected_value": 0.45,
                            "confidence": 0.9, "rationale": "ideal is 0.5"}]}


def test_preregistration_lock_link_and_verify(users):
    """Regression: linking a run changed the stored record, so verify reported the locked
    pre-registration as tampered (valid: false) right after its run was linked."""
    alice, bob = users
    p = client.post("/api/v1/prereg", headers=alice, json=_prereg()).json()
    pid = p["prereg_id"]
    assert "owner" not in p
    assert client.get(f"/api/v1/prereg/{pid}/verify", headers=alice).status_code == 400  # draft
    # Regression: pre-registrations needed no sign-in, and anyone could edit, lock, link or abandon
    # anyone's. Drafts are private; a locked one can be shown and verified by anyone signed in.
    assert client.post("/api/v1/prereg", json=_prereg()).status_code == 401
    assert client.get(f"/api/v1/prereg/{pid}", headers=bob).status_code == 404
    assert client.put(f"/api/v1/prereg/{pid}", headers=bob, json={"n_shots": 1}).status_code == 404
    assert client.post(f"/api/v1/prereg/{pid}/lock", headers=bob).status_code == 404
    assert pid not in {x["prereg_id"] for x in client.get("/api/v1/prereg", headers=bob).json()}
    assert pid in {x["prereg_id"] for x in client.get("/api/v1/prereg", headers=alice).json()}
    assert client.put(f"/api/v1/prereg/{pid}", headers=alice, json={"n_shots": 2000}).json()["n_shots"] == 2000
    locked = client.post(f"/api/v1/prereg/{pid}/lock", headers=alice).json()
    assert locked["status"] == "locked" and len(locked["fingerprint"]) == 64
    assert client.put(f"/api/v1/prereg/{pid}", headers=alice, json={"n_shots": 1}).status_code == 400
    assert client.get(f"/api/v1/prereg/{pid}/verify", headers=alice).json()["valid"] is True
    assert client.get(f"/api/v1/prereg/{pid}/verify", headers=bob).json()["valid"] is True
    assert client.get(f"/api/v1/prereg/{pid}", headers=bob).json()["status"] == "locked"

    rid = push_run(alice)  # counts 500/500 → success_probability 0.5
    assert client.post(f"/api/v1/prereg/{pid}/link-run/{rid}", headers=bob).status_code == 404
    linked = client.post(f"/api/v1/prereg/{pid}/link-run/{rid}", headers=alice).json()
    assert linked["verdict"] == "confirmed"
    assert linked["outcome"]["hypothesis_results"][0]["actual_value"] == 0.5
    assert client.get(f"/api/v1/prereg/{pid}/verify", headers=alice).json()["valid"] is True
    assert client.post(f"/api/v1/prereg/{pid}/abandon", headers=alice, json={"reason": "x"}).status_code == 400


def test_preregistration_detects_tampering_and_validates(users):
    alice, _ = users
    p = client.post("/api/v1/prereg", headers=alice, json=_prereg()).json()
    pid = p["prereg_id"]
    client.post(f"/api/v1/prereg/{pid}/lock", headers=alice)
    with engine.begin() as conn:
        row = conn.execute(text("SELECT id, data FROM generic_records WHERE record_id = :r"), {"r": pid}).first()
        assert '"n_shots": 1000' in row.data
        conn.execute(text("UPDATE generic_records SET data = :d WHERE id = :i"),
                     {"d": row.data.replace('"n_shots": 1000', '"n_shots": 5000'), "i": row.id})
    assert client.get(f"/api/v1/prereg/{pid}/verify", headers=alice).json()["valid"] is False
    bad = {**_prereg(), "hypotheses": []}
    assert client.post("/api/v1/prereg", headers=alice, json=bad).status_code == 422
    assert client.post(f"/api/v1/prereg/{pid}/link-run/does-not-exist", headers=alice).status_code == 404
    assert client.get("/api/v1/prereg/prereg-missing", headers=alice).status_code == 404


# ── plugins, talent ──────────────────────────────────────────────────────────

def test_plugin_publish_filter_and_rate():
    slug = f"zne-{_uid()}"
    body = {"name": "ZNE", "slug": slug, "version": "1.0", "description": "d", "author": "me",
            "category": "analysis", "tags": [slug], "install_command": "pip install x"}
    created = client.post("/api/v1/plugins", json=body)
    assert created.status_code == 201
    pid = created.json()["plugin_id"]
    assert client.post("/api/v1/plugins", json={**body, "category": "magic"}).status_code == 422
    assert client.post("/api/v1/plugins", json={**body, "slug": "Bad Slug"}).status_code == 422
    assert [p["plugin_id"] for p in client.get(f"/api/v1/plugins?tag={slug}").json()] == [pid]
    client.post(f"/api/v1/plugins/{pid}/rate", json={"rating": 4})
    rated = client.post(f"/api/v1/plugins/{pid}/rate", json={"rating": 2}).json()
    assert rated == {"plugin_id": pid, "rating": 3.0, "rating_count": 2}
    assert client.post(f"/api/v1/plugins/{pid}/rate", json={"rating": 6}).status_code == 422
    assert client.get("/api/v1/plugins/plugin_missing").status_code == 404
    cats = {c["category"]: c["count"] for c in client.get("/api/v1/plugins/categories").json()}
    assert cats["analysis"] >= 1


def test_talent_matching_score(users):
    me, _ = users
    prof = client.post("/api/v1/talent/profile", headers=me, json={
        "name": "P", "email": "p@example.com", "institution": "U", "role": "postdoc",
        "expertise": ["QAOA", "Error Mitigation"], "publications": 3, "h_index": 2,
        "open_to_opportunities": True, "bio": "b"}).json()
    job = client.post("/api/v1/talent/job", headers=me, json={
        "title": f"Postdoc {_uid()}", "institution": "L", "location": "Delft", "type": "postdoc",
        "description": "d", "required_skills": ["QAOA", "VQE"], "preferred_skills": ["Error Mitigation"],
        "contact_email": "j@example.com"}).json()
    matches = {m["job_id"]: m for m in client.get(f"/api/v1/talent/matches/{prof['profile_id']}", headers=me).json()}
    # 0.65 · 1/2 required + 0.25 · 1/1 preferred + 0.1 role bonus
    assert matches[job["job_id"]]["match_score"] == 0.675
    assert set(matches[job["job_id"]]["matching_skills"]) == {"QAOA", "Error Mitigation"}
    assert job["job_id"] in {j["job_id"] for j in client.get("/api/v1/talent/jobs?location=delft", headers=me).json()}
    assert client.get("/api/v1/talent/matches/missing", headers=me).status_code == 404
    assert client.post("/api/v1/talent/profile", headers=me, json={"name": "x"}).status_code == 422


# ── public_reach ─────────────────────────────────────────────────────────────

def test_public_gallery_lists_only_shared_runs(users):
    """Regression: the gallery returned the run's Project object as "project", which cannot be
    serialised, so the gallery failed as soon as a shared run belonged to a project."""
    alice, _ = users
    shared = push_run(alice, circuit_name=f"shared-{_uid()}", project=f"gal-{_uid()}")
    hidden = push_run(alice, circuit_name=f"hidden-{_uid()}")
    token = client.post(f"/api/v1/runs/{shared}/share", headers=alice).json()["share_token"]
    r = client.get("/api/v1/public/gallery?limit=100")
    assert r.status_code == 200, r.text
    items = {i["share_token"]: i for i in r.json()["items"]}
    assert token in items and items[token]["qubits"] == 2
    assert items[token]["project"].startswith("gal-")
    assert hidden not in {i["circuit_name"] for i in items.values()}
    # Regression: the run-count badge read .rowcount from a SELECT result and always answered 500.
    badge = client.get("/api/v1/badge/runs.svg")
    assert badge.status_code == 200 and badge.headers["content-type"].startswith("image/svg+xml")
    assert " runs<" in badge.text or "1 run<" in badge.text
    assert "Q-Lab" in client.get("/api/v1/badge/status.svg").text
    assert client.get("/feed.xml").headers["content-type"].startswith("application/rss+xml")


# ── provider_ingest ──────────────────────────────────────────────────────────

def test_provider_ingest_normalises_and_owns_the_run(users):
    """Regression: ingested runs were saved without an owner, so the uploader could not see them
    (and on an open server everyone could)."""
    alice, bob = users
    cirq = client.post("/api/v1/ingest/cirq", headers=alice, json={"result": {
        "measurements": {"m": [[0, 0], [1, 1], [1, 1], [0, 0]]}, "device": "rainbow"}}).json()
    assert cirq["shots"] == 4 and cirq["n_outcomes"] == 2 and cirq["backend"] == "rainbow"
    run = client.get(f"/api/v1/runs/{cirq['run_id']}", headers=alice)
    assert run.status_code == 200
    assert run.json()["results"]["counts"] == {"00": 2, "11": 2}
    assert client.get(f"/api/v1/runs/{cirq['run_id']}", headers=bob).status_code == 404

    ionq = client.post("/api/v1/ingest/ionq", headers=alice, json={"result": {
        "shots": 1000, "target": "qpu.aria-1", "data": {"histogram": {"0": 0.25, "3": 0.75}}}}).json()
    assert client.get(f"/api/v1/runs/{ionq['run_id']}", headers=alice).json()["results"]["counts"] == {"0": 250, "3": 750}
    braket = client.post("/api/v1/ingest/braket", headers=alice, json={"result": {
        "taskMetadata": {"shots": 100, "deviceId": "arn:aws:braket:::device/qpu/ionq/Harmony"},
        "measurementProbabilities": {"00": 0.5, "11": 0.5}}}).json()
    assert braket["backend"] == "Harmony" and braket["shots"] == 100
    q3 = client.post("/api/v1/ingest/openqasm3", headers=alice, json={
        "qasm": "OPENQASM 2.0;\nqreg q[3];\nh q[0];\ncx q[0],q[1];", "counts": {"000": 7, "111": 3}}).json()
    fp = client.get(f"/api/v1/runs/{q3['run_id']}", headers=alice).json()["fingerprint"]
    assert fp["num_qubits"] == 3 and fp["gate_counts"] == {"h": 1, "cx": 1} and q3["shots"] == 10
    auto = client.post("/api/v1/ingest/auto", headers=alice, json={"payload": {"histogram": {"1": 1.0}, "shots": 10}}).json()
    assert auto["detected_format"] == "ionq"
    assert client.post("/api/v1/ingest/auto", headers=alice, json={"payload": {"foo": 1}}).status_code == 422
    assert "cirq" in {f["name"] for f in client.get("/api/v1/ingest/formats").json()["formats"]}
