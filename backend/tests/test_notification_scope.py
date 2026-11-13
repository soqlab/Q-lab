"""Notification channels receive only events about runs their owner may see.

Regression: dispatch_event sent every event to every active channel on the server, so one
user's run events would have reached another user's Slack, webhook or email channel.
"""
import uuid

import pytest

from app.database import SessionLocal
from app.models import NotificationChannel, NotificationLog
from app.routers import notifications
from tests.helpers import client, make_user, user_id


@pytest.fixture
def sent(monkeypatch):
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(notifications, "_send_slack", lambda url, ev, p: calls.append(("slack", url)))
    monkeypatch.setattr(notifications, "_send_webhook", lambda url, ev, p, s="": calls.append(("webhook", url)))
    monkeypatch.setattr(notifications, "_send_email", lambda to, ev, p: calls.append(("email", to)))
    return calls


def _channel(headers, kind: str, config: dict) -> str:
    r = client.post("/api/v1/notifications/channels", headers=headers,
                    json={"name": kind, "channel_type": kind, "config": config, "events": ["job.completed"]})
    assert r.status_code == 200, r.text
    return r.json()["channel_id"]


def test_an_event_reaches_only_its_owners_channels(sent):
    alice, bob = make_user(prefix="nsa"), make_user(prefix="nsb")
    tag = uuid.uuid4().hex[:8]
    a_hook = f"https://hooks.example.com/alice-{tag}"
    b_hook = f"https://hooks.example.com/bob-{tag}"
    b_mail = f"bob-{tag}@example.com"
    a_ch = _channel(alice, "slack", {"webhook_url": a_hook})
    b_slack = _channel(bob, "slack", {"webhook_url": b_hook})
    b_email = _channel(bob, "email", {"to": b_mail})
    b_web = _channel(bob, "webhook", {"url": b_hook + "/w"})

    notifications.dispatch_event("job.completed", {"run_id": "r-alice"},
                                 owner_user_id=user_id(alice), owner_org_id=None)

    targets = {t for _, t in sent}
    assert a_hook in targets
    assert not targets & {b_hook, b_mail, b_hook + "/w"}

    with SessionLocal() as db:
        logged = {lg.channel_id for lg in db.query(NotificationLog).filter(NotificationLog.payload.isnot(None)).all()}
    assert a_ch in logged and not logged & {b_slack, b_email, b_web}


def test_a_channel_made_without_an_account_gets_only_anonymous_events(sent):
    alice = make_user(prefix="nso")
    with SessionLocal() as db:
        ch = NotificationChannel(channel_id=f"nc-{uuid.uuid4().hex[:12]}", name="org", channel_type="slack",
                                 org_id=None, created_by_user_id=None,
                                 config={"webhook_url": "https://hooks.example.com/anon"},
                                 events=["job.completed"], is_active=True)
        db.add(ch)
        db.commit()
    notifications.dispatch_event("job.completed", {"run_id": "r"}, owner_user_id=user_id(alice), owner_org_id=None)
    # A channel made without an account does not receive a signed-in user's events...
    assert ("slack", "https://hooks.example.com/anon") not in sent
    # ...only events about runs uploaded without an account.
    notifications.dispatch_event("job.completed", {"run_id": "r"}, owner_user_id=None, owner_org_id=None)
    assert ("slack", "https://hooks.example.com/anon") in sent


def test_dispatch_needs_an_owner():
    with pytest.raises(TypeError):
        notifications.dispatch_event("job.completed", {})  # type: ignore[call-arg]
