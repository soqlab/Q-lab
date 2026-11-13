"""The core tracking API the product promises: runs, projects, compare, search and API keys.

test_run_visibility.py already covers list/get/search/export visibility; this file covers
the write paths (update, delete, re-upload), compare, projects and API keys, and checks
that another user cannot touch a run through any of them.
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import engine, init_db
from app.main import app

init_db()
client = TestClient(app, raise_server_exceptions=False)
PASSWORD = "Core-Tracking-Password-1!"

BELL = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'
GHZ = BELL.replace("qreg q[2];", "qreg q[3];").replace("creg c[2];", "creg c[3];").replace(
    "cx q[0],q[1];", "cx q[0],q[1];\ncx q[1],q[2];")


def _user() -> dict:
    email = f"core_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": "C"})
    assert r.status_code in (200, 201), r.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified = 1 WHERE email = :e"), {"e": email})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def users() -> tuple[dict, dict]:
    return _user(), _user()


def _payload(run_id: str | None = None, *, project: str = "core-tests", qasm: str = BELL,
             name: str = "bell", status: str = "running") -> dict:
    return {
        "run_id": run_id or f"core-{uuid.uuid4().hex[:12]}",
        "circuit_name": name,
        "backend": "aer_simulator",
        "qasm": qasm,
        "fingerprint": {"num_qubits": 2, "depth": 3, "gate_counts": {"h": 1, "cx": 1}},
        "parameters": {"theta": 0.1},
        "execution": {"shots": 1000},
        "results": {"counts": {"00": 500, "11": 500}},
        "project": project,
        "tags": ["core"],
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _push(headers: dict, **kw) -> str:
    body = _payload(**kw)
    r = client.post("/api/v1/runs", headers=headers, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["run_id"] == body["run_id"]
    return body["run_id"]


# ── Runs: create, get, update, list, delete ──────────────────────────────────

def test_run_lifecycle(users):
    alice, _ = users
    run_id = _push(alice, name="lifecycle")

    got = client.get(f"/api/v1/runs/{run_id}", headers=alice)
    assert got.status_code == 200
    body = got.json()
    assert body["circuit_name"] == "lifecycle"
    assert body["status"] == "running"
    assert body["fingerprint"]["num_qubits"] == 2

    upd = client.patch(f"/api/v1/runs/{run_id}", headers=alice, json={
        "status": "completed", "tags": ["core", "done"], "results": {"fidelity": 0.97},
    })
    assert upd.status_code == 200, upd.text
    assert upd.json()["status"] == "completed"
    assert upd.json()["tags"] == ["core", "done"]
    # Updates merge into results instead of replacing them.
    assert upd.json()["results"]["counts"] == {"00": 500, "11": 500}
    assert upd.json()["results"]["fidelity"] == 0.97

    listed = client.get("/api/v1/runs?status=completed&limit=1000", headers=alice).json()
    assert run_id in {r["run_id"] for r in listed}
    running = client.get("/api/v1/runs?status=running&limit=1000", headers=alice).json()
    assert run_id not in {r["run_id"] for r in running}

    deleted = client.delete(f"/api/v1/runs/{run_id}", headers=alice)
    assert deleted.status_code == 200 and deleted.json()["deleted"] is True
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).status_code == 404
    assert client.delete(f"/api/v1/runs/{run_id}", headers=alice).status_code == 404


def test_reupload_updates_the_same_run(users):
    alice, _ = users
    run_id = _push(alice, name="first")
    _push(alice, run_id=run_id, name="second", status="completed")
    body = client.get(f"/api/v1/runs/{run_id}", headers=alice).json()
    assert body["circuit_name"] == "second" and body["status"] == "completed"
    ids = [r["run_id"] for r in client.get("/api/v1/runs?limit=1000", headers=alice).json()]
    assert ids.count(run_id) == 1


def test_list_filters(users):
    alice, _ = users
    project = f"filters-{uuid.uuid4().hex[:6]}"
    a = _push(alice, project=project)
    b = _push(alice, project=project)
    _push(alice, project="elsewhere")
    listed = client.get(f"/api/v1/runs?project={project}", headers=alice).json()
    assert {r["run_id"] for r in listed} == {a, b}
    assert len(client.get(f"/api/v1/runs?project={project}&limit=1", headers=alice).json()) == 1
    assert client.get(f"/api/v1/runs?project={project}&min_qubits=3", headers=alice).json() == []


def test_writes_require_sign_in(users):
    alice, _ = users
    run_id = _push(alice)
    assert client.patch(f"/api/v1/runs/{run_id}", json={"status": "failed"}).status_code == 401
    assert client.delete(f"/api/v1/runs/{run_id}").status_code == 401
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).json()["status"] == "running"


def test_other_users_cannot_change_or_delete_a_run(users):
    alice, bob = users
    run_id = _push(alice, name="alice-only")
    assert client.patch(f"/api/v1/runs/{run_id}", headers=bob, json={"status": "failed"}).status_code == 404
    assert client.delete(f"/api/v1/runs/{run_id}", headers=bob).status_code == 404
    body = client.get(f"/api/v1/runs/{run_id}", headers=alice).json()
    assert body["status"] == "running" and body["circuit_name"] == "alice-only"


def test_other_users_cannot_overwrite_a_run_by_reusing_its_id(users):
    alice, bob = users
    run_id = _push(alice, name="original")
    client.post("/api/v1/runs", headers=bob, json=_payload(run_id=run_id, name="hijacked"))
    body = client.get(f"/api/v1/runs/{run_id}", headers=alice).json()
    assert body["circuit_name"] == "original"
    assert client.get(f"/api/v1/runs/{run_id}", headers=bob).status_code == 404


# ── Compare ──────────────────────────────────────────────────────────────────

def test_compare_two_runs(users):
    alice, _ = users
    left = _push(alice, qasm=BELL)
    right = _push(alice, qasm=GHZ)
    same = _push(alice, qasm=BELL)

    diff = client.get(f"/api/v1/runs/compare/{left}/{right}/json", headers=alice)
    assert diff.status_code == 200, diff.text
    body = diff.json()
    assert body["summary"]["same_qasm"] is False and body["summary"]["same_backend"] is True
    assert "+cx q[1],q[2];" in body["qasm_diff"]

    assert client.get(f"/api/v1/runs/compare/{left}/{same}/json", headers=alice).json()["summary"]["same_qasm"] is True
    text_diff = client.get(f"/api/v1/runs/compare/{left}/{right}", headers=alice)
    assert text_diff.status_code == 200 and "+qreg q[3];" in text_diff.text
    assert client.get(f"/api/v1/runs/compare/{left}/does-not-exist/json", headers=alice).status_code == 404


def test_compare_cannot_read_another_users_run(users):
    alice, bob = users
    secret = _push(alice, qasm=GHZ)
    mine = _push(bob, qasm=BELL)
    assert client.get(f"/api/v1/runs/compare/{mine}/{secret}/json", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/compare/{mine}/{secret}", headers=bob).status_code == 404


# ── Projects ─────────────────────────────────────────────────────────────────

def test_projects_create_list_and_stats(users):
    alice, _ = users
    slug = f"proj-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/projects", headers=alice, json={"slug": slug, "name": "Core project", "description": "d"})
    assert r.status_code == 200, r.text
    assert r.json()["slug"] == slug and r.json()["name"] == "Core project"
    assert client.post("/api/v1/projects", json={"slug": slug + "x", "name": "anon"}).status_code == 401

    _push(alice, project=slug, status="completed")
    _push(alice, project=slug, status="failed")

    listed = {p["slug"]: p for p in client.get("/api/v1/projects", headers=alice).json()}
    assert listed[slug]["run_count"] == 2

    stats = client.get(f"/api/v1/projects/{slug}/stats", headers=alice)
    assert stats.status_code == 200, stats.text
    s = stats.json()
    assert s["total_runs"] == 2
    assert s["by_status"] == {"completed": 1, "failed": 1}
    assert s["completion_rate"] == 0.5
    assert client.get("/api/v1/projects/no-such-project-xyz/stats", headers=alice).status_code == 404


def test_project_run_counts_only_include_the_callers_runs(users):
    alice, bob = users
    slug = f"shared-{uuid.uuid4().hex[:8]}"
    _push(alice, project=slug)
    _push(alice, project=slug)
    _push(bob, project=slug)
    by_bob = {p["slug"]: p for p in client.get("/api/v1/projects", headers=bob).json()}
    assert by_bob[slug]["run_count"] == 1
    assert client.get(f"/api/v1/projects/{slug}/stats", headers=bob).json()["total_runs"] == 1


# ── Search ───────────────────────────────────────────────────────────────────

def test_search_runs_by_name_and_backend(users):
    alice, _ = users
    marker = f"srch{uuid.uuid4().hex[:8]}"
    run_id = _push(alice, name=marker)
    res = client.get(f"/api/v1/search/runs?q={marker}", headers=alice)
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert [i["run_id"] for i in items] == [run_id]
    assert res.json()["total"] == 1
    none = client.get(f"/api/v1/search/runs?q={marker}&backend=ibm_nowhere", headers=alice).json()
    assert none["items"] == [] and none["total"] == 0


# ── API keys ─────────────────────────────────────────────────────────────────

def test_api_key_create_use_list_and_revoke(users):
    alice, bob = users
    created = client.post("/api/v1/users/me/api-keys", headers=alice, json={"name": "ci"})
    assert created.status_code == 200, created.text
    key = created.json()["key"]
    key_id = created.json()["id"]
    assert key.startswith("qlab_")

    listed = client.get("/api/v1/users/me/api-keys", headers=alice).json()
    row = next(r for r in listed if r["id"] == key_id)
    assert row["is_active"] is True and "key" not in row  # the full key is shown only once
    assert key_id not in {r["id"] for r in client.get("/api/v1/users/me/api-keys", headers=bob).json()}

    # A run uploaded with the key belongs to Alice.
    via_key = {"X-QLab-Api-Key": key}
    run_id = _push(via_key, name="via-key")
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).status_code == 200
    assert client.get(f"/api/v1/runs/{run_id}", headers=bob).status_code == 404

    # Bob cannot revoke Alice's key.
    assert client.delete(f"/api/v1/users/me/api-keys/{key_id}", headers=bob).status_code == 404
    assert client.delete(f"/api/v1/users/me/api-keys/{key_id}", headers=alice).json() == {"revoked": True}
    assert client.patch(f"/api/v1/runs/{run_id}", headers=via_key, json={"status": "failed"}).status_code == 401
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).json()["status"] == "running"


def test_api_keys_require_sign_in():
    assert client.get("/api/v1/users/me/api-keys").status_code == 401
    assert client.post("/api/v1/users/me/api-keys", json={"name": "x"}).status_code == 401


def test_a_deleted_accounts_api_keys_stop_working():
    """Regression: deleting an account switched off its sessions but its SDK keys still uploaded runs."""
    from tests.helpers import make_user
    owner = make_user(prefix="del")
    key = client.post("/api/v1/users/me/api-keys", headers=owner, json={"name": "sdk"}).json()["key"]
    via_key = {"X-QLab-Api-Key": key}
    assert client.get("/api/v1/runs", headers=via_key).status_code == 200
    assert client.delete("/auth/me", headers=owner).status_code == 200
    assert client.get("/api/v1/runs", headers=via_key).status_code == 401
