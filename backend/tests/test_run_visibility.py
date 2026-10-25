"""Users see their own runs; anonymous callers see only runs uploaded without an account."""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import engine, init_db
from app.main import app

init_db()
client = TestClient(app, raise_server_exceptions=False)
PASSWORD = "Visibility-Test-Password-1!"


def _user() -> dict:
    email = f"vis_{uuid.uuid4().hex[:10]}@example.com"
    assert client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": "V"}).status_code in (200, 201)
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified = 1 WHERE email = :e"), {"e": email})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def users() -> tuple[dict, dict]:
    """Two accounts shared by the tests (sign-up is rate limited)."""
    return _user(), _user()


def _push(headers: dict | None) -> str:
    run_id = f"vis-{uuid.uuid4().hex[:12]}"
    r = client.post("/api/v1/runs", headers=headers or {}, json={
        "run_id": run_id, "circuit_name": "bell", "backend": "aer_simulator",
        "qasm": "OPENQASM 3.0; qubit[2] q; h q[0]; cx q[0], q[1];",
        "fingerprint": {"num_qubits": 2, "depth": 2}, "execution": {"shots": 1000},
        "results": {"counts": {"00": 500, "11": 500}}, "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    assert r.status_code == 200, r.text
    return run_id


def _ids(resp) -> set[str]:
    body = resp.json()
    items = body["items"] if isinstance(body, dict) else body
    return {r["run_id"] for r in items}


def test_users_only_see_their_own_runs(users):
    alice, bob = users
    a_run, b_run = _push(alice), _push(bob)

    for path in ("/api/v1/runs?limit=1000", "/api/v1/search/runs?page_size=500"):
        seen_by_alice = _ids(client.get(path, headers=alice))
        assert a_run in seen_by_alice and b_run not in seen_by_alice, path

    assert client.get(f"/api/v1/runs/{a_run}", headers=alice).status_code == 200
    assert client.get(f"/api/v1/runs/{a_run}", headers=bob).status_code == 404
    assert client.get(f"/api/v1/export/runs/{a_run}", headers=bob).status_code == 404
    assert a_run not in client.get("/api/v1/export/runs/csv", headers=bob).text


def test_anonymous_callers_see_only_ownerless_runs(users):
    owned = _push(users[0])
    ownerless = _push(None)
    seen = _ids(client.get("/api/v1/search/runs?page_size=500"))
    assert ownerless in seen
    assert owned not in seen
    assert client.get(f"/api/v1/runs/{owned}").status_code == 404


def test_shared_link_still_works_without_signing_in(users):
    alice = users[0]
    run_id = _push(alice)
    share = client.post(f"/api/v1/runs/{run_id}/share", headers=alice)
    assert share.status_code == 200, share.text
    token = share.json().get("share_token") or share.json()["share_url"].rstrip("/").rsplit("/", 1)[-1]
    public = client.get(f"/api/v1/runs/public/{token}")
    assert public.status_code == 200
    assert public.json()["run_id"] == run_id

    # The share page draws the circuit through the share token, not the private run id.
    assert client.get(f"/api/v1/runs/{run_id}/circuit.svg").status_code == 404
    svg = client.get(f"/api/v1/runs/public/{token}/circuit.svg")
    assert svg.status_code in (200, 422), svg.text  # 422 only if the renderer is unavailable
    if svg.status_code == 200:
        assert svg.headers["content-type"].startswith("image/svg")


def test_search_and_analytics_only_count_own_runs(users):
    """These endpoints use hand-written SQL or aggregate queries; they must apply the same rule."""
    alice, bob = users
    marker = f"zz{uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/runs", headers=alice, json={
        "run_id": f"vis-{marker}", "circuit_name": marker, "backend": "aer_simulator",
        "fingerprint": {"num_qubits": 1}, "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    assert r.status_code == 200, r.text

    found_by_alice = client.get(f"/api/v1/search/fulltext?q={marker}", headers=alice).json()["results"]
    found_by_bob = client.get(f"/api/v1/search/fulltext?q={marker}", headers=bob).json()["results"]
    assert [x["run_id"] for x in found_by_alice] == [f"vis-{marker}"]
    assert found_by_bob == []

    bob_runs = len(client.get("/api/v1/runs?limit=1000", headers=bob).json())
    bob_points = client.get("/api/v1/analytics/timeseries?days=2", headers=bob).json()
    assert sum(p["total"] for p in bob_points) == bob_runs  # only Bob's own runs are counted
    alice_points = client.get("/api/v1/analytics/timeseries?days=2", headers=alice).json()
    assert sum(p["total"] for p in alice_points) >= 1 and all("date" in p for p in alice_points)
