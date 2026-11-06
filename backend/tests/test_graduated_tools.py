"""Tools that used to return invented numbers and now compute from the user's own data."""
import math
import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app, raise_server_exceptions=False)
BELL = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'


def _user() -> dict:
    email = f"grad-{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": "testpassword", "name": "T"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _run(headers, counts=None, qasm=None, context=None):
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    r = client.post("/api/v1/runs", headers=headers, json={
        "run_id": run_id, "backend": "ibm_test", "qasm": qasm, "context": context or {},
        "results": {"counts": counts or {}}, "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    assert r.status_code == 200, r.text
    return run_id


# ── Fidelity certificate (certify) ────────────────────────────────────────────

def _certify(headers, run_ids):
    return client.post("/api/v1/certify/certify", headers=headers,
                       json={"name": "Bell", "evidence_run_ids": run_ids})


def test_certificate_is_computed_from_recorded_counts():
    headers = _user()
    perfect = _run(headers, {"00": 500, "11": 500}, BELL)
    noisy = _run(headers, {"00": 400, "11": 400, "01": 100, "10": 100}, BELL)
    r = _certify(headers, [perfect, noisy])
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    cert = r.json()
    by_run = {e["run_id"]: e for e in cert["runs"]}
    # F = 2^n * mean P_ideal(x) - 1: every shot of a perfect Bell pair has P = 1/2.
    assert by_run[perfect]["linear_xeb"] == 1.0
    assert abs(by_run[noisy]["linear_xeb"] - 0.6) < 1e-9
    # Null variance 2^n * sum P^2 - 1 = 1, so the standard error is 1/sqrt(shots).
    assert abs(by_run[perfect]["null_std_error"] - 1 / math.sqrt(1000)) < 1e-6
    assert abs(cert["linear_xeb"] - 0.8) < 1e-9
    assert cert["certified"] is True and cert["p_value"] < 1e-6
    assert "statevector" in cert["source"]
    again = _certify(headers, [perfect, noisy]).json()
    assert again["linear_xeb"] == cert["linear_xeb"] and again["p_value"] == cert["p_value"]


def test_uniform_noise_is_not_certified():
    headers = _user()
    noise = _run(headers, {"00": 250, "01": 250, "10": 250, "11": 250}, BELL)
    cert = _certify(headers, [noise]).json()
    assert cert["linear_xeb"] == 0.0
    assert cert["certified"] is False and cert["p_value"] == 0.5


def test_run_without_a_circuit_gives_no_numbers():
    headers = _user()
    run_id = _run(headers, {"00": 10})
    cert = _certify(headers, [run_id]).json()
    assert cert["runs"] == [] and cert["skipped"][0]["run_id"] == run_id
    assert cert["linear_xeb"] is None and cert["p_value"] is None and cert["certified"] is False


def test_certificates_are_private():
    alice, bob = _user(), _user()
    run_id = _run(alice, {"00": 5, "11": 5}, BELL)
    assert _certify(bob, [run_id]).status_code == 404
    cert_id = _certify(alice, [run_id]).json()["cert_id"]
    assert client.get(f"/api/v1/certify/certification/{cert_id}", headers=bob).status_code == 404
    assert cert_id not in {c["cert_id"] for c in client.get("/api/v1/certify/certifications", headers=bob).json()}
    assert cert_id in {c["cert_id"] for c in client.get("/api/v1/certify/certifications", headers=alice).json()}


# ── Environment snapshots ─────────────────────────────────────────────────────

CTX_A = {"python_version": "3.12.4 (main, Jun 2024) [GCC]", "platform": "Linux-6.8-x86_64",
         "git_commit": "a" * 40, "git_branch": "main",
         "library_versions": {"qiskit": "2.1.0", "numpy": "2.0.1"}}


def test_snapshot_is_what_the_sdk_recorded():
    headers = _user()
    run_id = _run(headers, context=CTX_A)
    r = client.get(f"/api/v1/environment/runs/{run_id}", headers=headers)
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    snap = r.json()
    assert snap["recorded"] is True
    assert snap["python_version"] == "3.12.4" and snap["platform"] == "Linux-6.8-x86_64"
    assert {p["name"]: p["version"] for p in snap["packages"]} == {"numpy": "2.0.1", "qiskit": "2.1.0"}
    assert "SDK" in snap["source"]


def test_run_without_context_has_no_invented_environment():
    headers = _user()
    run_id = _run(headers)
    snap = client.get(f"/api/v1/environment/runs/{run_id}", headers=headers).json()
    assert snap["recorded"] is False
    assert snap["packages"] == [] and snap["python_version"] is None and snap["env_hash"] is None
    assert run_id not in {s["run_id"] for s in client.get("/api/v1/environment", headers=headers).json()["snapshots"]}
    other = _run(headers, context=CTX_A)
    r = client.post("/api/v1/environment/diff", headers=headers, json={"run_id_a": run_id, "run_id_b": other})
    assert r.status_code == 422


def test_diff_compares_two_recorded_environments():
    headers = _user()
    ctx_b = {**CTX_A, "git_commit": "b" * 40,
             "library_versions": {"qiskit": "2.2.0", "numpy": "2.0.1", "qiskit-aer": "0.17.0"}}
    a, b = _run(headers, context=CTX_A), _run(headers, context=ctx_b)
    d = client.post("/api/v1/environment/diff", headers=headers, json={"run_id_a": a, "run_id_b": b}).json()
    assert d["changed"] == [{"name": "qiskit", "from": "2.1.0", "to": "2.2.0"}]
    assert [p["name"] for p in d["added"]] == ["qiskit-aer"] and d["removed"] == []
    assert d["git_commit_changed"] is True and d["python_changed"] is False and d["identical"] is False
    assert any("Qiskit version changed" in w for w in d["warnings"])
    same = client.post("/api/v1/environment/diff", headers=headers, json={"run_id_a": a, "run_id_b": a}).json()
    assert same["identical"] is True and same["warnings"] == []
    listed = {s["run_id"] for s in client.get("/api/v1/environment", headers=headers).json()["snapshots"]}
    assert {a, b} <= listed


def test_environment_of_another_users_run_is_hidden():
    alice, bob = _user(), _user()
    run_id = _run(alice, context=CTX_A)
    assert client.get(f"/api/v1/environment/runs/{run_id}", headers=bob).status_code == 404
