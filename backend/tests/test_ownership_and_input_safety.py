"""Regressions for webhook ownership and for gate angles that came from user QASM through eval()."""
from __future__ import annotations

import time
import uuid

import pytest

from app import tasks
from app.routers.circuit_search import _safe_angle
from app.routers.job_executor import _angle_value, _simulate_qasm
from tests.helpers import client, make_user, push_run

HOOK = {"name": "ci", "url": "https://hooks.example.com/q", "events": ["run.created", "run.completed"]}


@pytest.fixture
def delivered(monkeypatch):
    """Webhook posts, recorded at the network boundary (tasks._post_webhook)."""
    sent: list[tuple[int, str, str]] = []
    monkeypatch.setattr(tasks, "_post_webhook",
                        lambda wh, event, data, db: sent.append((wh.id, event, data["run_id"])))
    return sent


def test_webhooks_of_users_without_an_organisation_are_private():
    """Regression: a webhook had no owner, so without an organisation every user could list,
    change and delete everyone's webhooks."""
    alice, bob = make_user(prefix="whA"), make_user(prefix="whB")
    wid = client.post("/api/v1/webhooks", headers=alice, json=HOOK).json()["id"]
    assert wid in {w["id"] for w in client.get("/api/v1/webhooks", headers=alice).json()}
    assert wid not in {w["id"] for w in client.get("/api/v1/webhooks", headers=bob).json()}
    assert client.patch(f"/api/v1/webhooks/{wid}", headers=bob, json={"url": "https://evil.example.com"}).status_code == 404
    assert client.delete(f"/api/v1/webhooks/{wid}", headers=bob).status_code == 404
    mine = next(w for w in client.get("/api/v1/webhooks", headers=alice).json() if w["id"] == wid)
    assert mine["url"] == HOOK["url"]
    assert client.patch(f"/api/v1/webhooks/{wid}", headers=alice, json={"name": "ci2"}).json()["name"] == "ci2"
    assert client.delete(f"/api/v1/webhooks/{wid}", headers=alice).json() == {"deleted": True}


def test_webhooks_receive_only_their_owners_runs(delivered):
    """Regression: every run event went to every active webhook, so a user's webhook received
    other users' runs (names, QASM, results)."""
    alice, bob = make_user(prefix="whC"), make_user(prefix="whD")
    project = f"wh-{uuid.uuid4().hex[:6]}"
    alice_hook = client.post("/api/v1/webhooks", headers=alice, json=HOOK).json()["id"]
    bob_hook = client.post("/api/v1/webhooks", headers=bob, json={**HOOK, "project_slug": project}).json()["id"]

    a_run = push_run(alice, project=project)
    b_run = push_run(bob, project=project)
    b_other = push_run(bob, project="elsewhere")
    client.patch(f"/api/v1/runs/{b_run}", headers=bob, json={"status": "completed"})

    to_alice = {(e, r) for h, e, r in delivered if h == alice_hook}
    to_bob = {(e, r) for h, e, r in delivered if h == bob_hook}
    assert to_alice == {("run.created", a_run)}
    assert to_bob == {("run.created", b_run), ("run.completed", b_run)}  # b_other is in another project


def test_webhook_receives_rule_for_older_organisation_hooks():
    class Hook:
        created_by_user_id, org_id = None, 7

    assert tasks.receives(Hook(), {"org_id": 7, "created_by_user_id": 3})
    assert not tasks.receives(Hook(), {"org_id": 8, "created_by_user_id": 3})

    class Anonymous:
        created_by_user_id, org_id = None, None

    # Open mode (no accounts): an unowned webhook gets the unowned runs only.
    assert tasks.receives(Anonymous(), {"org_id": None, "created_by_user_id": None})
    assert not tasks.receives(Anonymous(), {"org_id": None, "created_by_user_id": 3})


def test_gate_angles_are_arithmetic_not_code():
    """Regression: gate angles from user QASM went through eval() (the chaos/fault-injection
    endpoint accepts QASM without sign-in); eval with empty builtins can be escaped."""
    flip = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[1];\nrx({}) q[0];\nmeasure q[0] -> c[0];'
    assert set(_simulate_qasm(flip.format("pi"), 200)) == {"1"}
    assert set(_simulate_qasm(flip.format("2*pi/2"), 200)) == {"1"}
    # A Python expression that eval() would have run (a list subscript) is not an angle: rotation 0.
    assert set(_simulate_qasm(flip.format("[pi][0]"), 200)) == {"0"}

    assert _angle_value("-3*pi/4") == pytest.approx(-2.35619449)
    assert _angle_value("sqrt(4)**2") == pytest.approx(4.0)
    for bad in ("__import__('os')", "().__class__", "[1][0]", "pi if 1 else 0", "True", "x"):
        with pytest.raises(ValueError):
            _angle_value(bad)


def test_huge_exponents_are_refused_quickly():
    """Regression: circuit_search's angle parser let '9**9**9**9' through its regex to eval()."""
    start = time.monotonic()
    assert _safe_angle("9**9**9**9") == 0.0
    assert time.monotonic() - start < 1.0
    assert _safe_angle("pi/2") == pytest.approx(1.5707963)
    assert _safe_angle("1.5e0") == 1.5
