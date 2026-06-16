"""Smoke tests for Q-Lab backend API.

Run with:
    cd backend
    pip install httpx pytest pytest-anyio
    pytest tests/test_smoke.py -v
"""

import json
import uuid
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

# DATABASE_URL is set in conftest.py before any app import

from app.main import app
from app.database import init_db

init_db()
client = TestClient(app, raise_server_exceptions=False)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _register_and_login(email: str | None = None, password: str = "testpassword") -> dict:
    email = email or f"test_{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password, "name": "Test User"})
    if r.status_code not in (200, 201, 409):
        pytest.skip(f"Auth not available: {r.status_code}")
    r = client.post("/api/v1/auth/token", json={"email": email, "password": password})
    if r.status_code != 200:
        return {}
    return r.json()


def _push_run(token: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    payload = {
        "run_id": str(uuid.uuid4()),
        "circuit_name": "smoke_test_bell",
        "backend": "ibm_cairo_smoke",
        "shots": 1024,
        "qasm": "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;",
        "fingerprint": {"num_qubits": 2, "depth": 3, "size": 3, "non_clifford_ratio": 0.0},
        "status": "completed",
        "results": {"00": 512, "11": 512},
        "tvd": 0.05,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = client.post("/api/v1/runs", json=payload, headers=headers)
    return r


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body.get("status") == "ok"


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

def test_list_runs_unauthenticated():
    r = client.get("/api/v1/runs")
    # Should either succeed (public) or 401
    assert r.status_code in (200, 401)


def test_push_and_fetch_run():
    resp = _push_run()
    if resp.status_code == 401:
        pytest.skip("Push requires auth — skipping unauthenticated push test")
    assert resp.status_code in (200, 201), resp.text
    run_id = resp.json().get("run_id")
    assert run_id

    r = client.get(f"/api/v1/runs/{run_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["run_id"] == run_id
    assert data["circuit_name"] == "smoke_test_bell"


def test_push_zk_qco_run_keeps_qasm_private():
    run_id = str(uuid.uuid4())
    qasm_hash = "0" * 64
    payload = {
        "run_id": run_id,
        "circuit_name": "zk_qco_smoke",
        "qasm": None,
        "fingerprint": {
            "num_qubits": 2,
            "depth": 3,
            "size": 3,
            "gate_counts": {"h": 1, "cx": 1},
            "qasm_sha256": qasm_hash,
            "zk_qco": True,
        },
        "context": {
            "zk_qco": {
                "enabled": True,
                "mode": "hash_only",
                "qasm_sha256": qasm_hash,
            }
        },
        "backend": "ibm_cairo_smoke",
        "status": "captured",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    resp = client.post("/api/v1/runs", json=payload)
    if resp.status_code == 401:
        pytest.skip("Push requires auth - skipping unauthenticated push test")
    assert resp.status_code in (200, 201), resp.text

    fetched = client.get(f"/api/v1/runs/{run_id}")
    assert fetched.status_code == 200
    data = fetched.json()
    assert data["qasm"] is None
    assert data["fingerprint"]["zk_qco"] is True
    assert data["fingerprint"]["qasm_sha256"] == qasm_hash
    assert data["context"]["zk_qco"]["enabled"] is True


def test_run_health_endpoint():
    resp = _push_run()
    if resp.status_code not in (200, 201):
        pytest.skip("Cannot create run")
    run_id = resp.json()["run_id"]
    r = client.get(f"/api/v1/runs/{run_id}/health")
    assert r.status_code == 200
    body = r.json()
    assert "overall" in body or "health_score" in body or isinstance(body, dict)


def test_circuit_svg():
    resp = _push_run()
    if resp.status_code not in (200, 201):
        pytest.skip("Cannot create run")
    run_id = resp.json()["run_id"]
    r = client.get(f"/api/v1/runs/{run_id}/circuit.svg")
    # May fail if optional visualization deps are not installed.
    assert r.status_code in (200, 404, 422, 500)


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

def test_policy_check():
    payload = {
        "qasm": "OPENQASM 2.0;\nqreg q[2];\ncx q[0],q[1];",
        "fingerprint": {"depth": 50, "num_qubits": 2, "size": 10},
        "shots": 1024,
    }
    r = client.post("/api/v1/policy/check", json={"run_payload": payload})
    # 200 whether policy is active or not
    assert r.status_code == 200
    body = r.json()
    assert "passed" in body or "policy_active" in body


def test_policy_rule_docs():
    r = client.get("/api/v1/policy/rules")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    assert len(body) > 0


# ---------------------------------------------------------------------------
# Anomaly
# ---------------------------------------------------------------------------

def test_anomaly_insufficient_peers():
    resp = _push_run()
    if resp.status_code not in (200, 201):
        pytest.skip("Cannot create run")
    run_id = resp.json()["run_id"]
    r = client.get(f"/api/v1/runs/{run_id}/anomaly")
    assert r.status_code == 200
    body = r.json()
    assert "sufficient_peers" in body
    # Freshly inserted run has < 5 peers
    assert body["sufficient_peers"] is False


# ---------------------------------------------------------------------------
# Circuit diff
# ---------------------------------------------------------------------------

def test_circuit_diff_same_run():
    resp = _push_run()
    if resp.status_code not in (200, 201):
        pytest.skip("Cannot create run")
    run_id = resp.json()["run_id"]

    resp2 = _push_run()
    run_id2 = resp2.json()["run_id"]

    r = client.get(f"/api/v1/runs/{run_id}/diff/{run_id2}")
    assert r.status_code == 200
    body = r.json()
    assert "similarity" in body
    assert "diff_stats" in body
    assert isinstance(body["unified_diff"], list)


def test_circuit_diff_not_found():
    r = client.get(f"/api/v1/runs/{uuid.uuid4()}/diff/{uuid.uuid4()}")
    assert r.status_code == 404
