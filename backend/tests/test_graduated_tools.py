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


# ── Cross-backend comparison ──────────────────────────────────────────────────

def _backend_run(headers, backend, counts, qasm=BELL):
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    r = client.post("/api/v1/runs", headers=headers, json={
        "run_id": run_id, "backend": backend, "qasm": qasm, "results": {"counts": counts},
        "status": "completed", "created_at": datetime.now(timezone.utc).isoformat(),
    })
    assert r.status_code == 200, r.text
    return run_id


def test_cross_backend_compares_recorded_counts():
    headers = _user()
    a = _backend_run(headers, "ibm_alpha", {"00": 500, "11": 500})
    b = _backend_run(headers, "ibm_beta", {"00": 400, "11": 400, "01": 200})
    r = client.post("/api/v1/cross-backend", headers=headers, json={"run_ids": [a, b]})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    rows = {x["run_id"]: x for x in out["runs"]}
    assert rows[a]["tvd_to_ideal"] == 0.0 and rows[a]["hellinger_fidelity_to_ideal"] == 1.0
    assert abs(rows[b]["tvd_to_ideal"] - 0.2) < 1e-9
    assert abs(rows[b]["hellinger_fidelity_to_ideal"] - 0.8) < 1e-9  # (2 * sqrt(0.4 * 0.5))^2
    assert out["pairwise_tvd"] == [{"run_a": a, "run_b": b, "tvd": 0.2}]
    assert out["best_by_fidelity"] == {"run_id": a, "backend": "ibm_alpha"}
    assert out["same_circuit"] is True and out["warnings"] == []
    groups = client.get("/api/v1/cross-backend", headers=headers).json()["groups"]
    assert any({a, b} <= set(g["run_ids"]) and sorted(g["backends"]) == ["ibm_alpha", "ibm_beta"] for g in groups)


def test_cross_backend_without_counts_or_other_backends_is_empty():
    headers = _user()
    only = _backend_run(headers, "ibm_alpha", {"00": 1})
    assert client.get("/api/v1/cross-backend", headers=headers).json()["groups"] == []
    empty = _backend_run(headers, "ibm_beta", {})
    out = client.post("/api/v1/cross-backend", headers=headers, json={"run_ids": [only, empty]}).json()
    assert [s["run_id"] for s in out["skipped"]] == [empty] and out["pairwise_tvd"] == []


def test_cross_backend_cannot_read_another_users_runs():
    alice, bob = _user(), _user()
    a = _backend_run(alice, "ibm_alpha", {"00": 1})
    b = _backend_run(alice, "ibm_beta", {"11": 1})
    assert client.post("/api/v1/cross-backend", headers=bob, json={"run_ids": [a, b]}).status_code == 404


# ── Exact-state tools: entanglement map and ideal state analysis ──────────────

HEAD = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\n'


def test_entanglement_map_follows_the_exact_state():
    r = client.post("/api/v1/entanglement-map", json={"qasm": BELL})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["n_qubits"] == 2 and out["n_layers"] == 2
    after_h, after_cx = out["layers"]
    assert [q["entropy"] for q in after_h["qubit_entanglement"]] == [0.0, 0.0]
    assert [q["entropy"] for q in after_cx["qubit_entanglement"]] == [1.0, 1.0]
    assert out["final_entangled_pairs"] == [{"q1": 0, "q2": 1}] and out["is_fully_entangled"] is True
    assert "not a measurement" in out["source"].lower()
    product = client.post("/api/v1/entanglement-map", json={"qasm": HEAD + "h q[0];\nx q[1];\nh q[2];"}).json()
    assert product["max_entropy_observed"] == 0.0 and product["final_entangled_pairs"] == []
    # GHZ on three qubits: every qubit carries one bit, and every pair is correlated.
    ghz = client.post("/api/v1/entanglement-map", json={"qasm": HEAD + "h q[0];\ncx q[0],q[1];\ncx q[1],q[2];"}).json()
    assert ghz["n_entangled_pairs"] == 3


def test_entanglement_map_refuses_what_it_cannot_compute_exactly():
    mid = HEAD + "h q[0];\nmeasure q[0] -> c[0];\ncx q[0],q[1];"
    assert client.post("/api/v1/entanglement-map", json={"qasm": mid}).status_code == 422
    assert client.post("/api/v1/entanglement-map", json={"qasm": "not qasm"}).status_code == 422


def test_ideal_state_analysis_is_exact():
    r = client.post("/api/v1/tomography", json={"qasm": BELL, "target_state": "bell"})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["fidelity_to_target"] == 1.0
    assert out["purity"] == 0.5 and out["von_neumann_entropy"] == 1.0 and out["global_state_entropy"] == 0.0
    assert out["total_shots"] is None and "not a reconstruction" in out["method"]
    flipped = client.post("/api/v1/tomography", json={"qasm": HEAD + "x q[0];\nh q[1];"}).json()
    q0, q1, q2 = flipped["bloch_vectors"]
    assert (q0["x"], q0["z"]) == (0.0, -1.0) and (q1["x"], q1["z"]) == (1.0, 0.0) and q2["z"] == 1.0
    assert flipped["pauli_expectations"]["Z0"] == -1.0
    uniform = client.post("/api/v1/tomography", json={"qasm": HEAD + "h q[0];\nh q[1];\nh q[2];", "target_state": "uniform"})
    assert uniform.json()["fidelity_to_target"] == 1.0
    assert client.post("/api/v1/tomography", json={"qasm": HEAD + "h q[0];", "target_state": "bell"}).status_code == 422


# ── XEB ───────────────────────────────────────────────────────────────────────

def test_xeb_scores_recorded_counts():
    headers = _user()
    perfect = _run(headers, {"00": 500, "11": 500}, BELL)
    noisy = _run(headers, {"00": 400, "11": 400, "01": 200}, BELL)
    bare = _run(headers, {"00": 3})
    r = client.post("/api/v1/xeb", headers=headers, json={"run_ids": [perfect, noisy, bare]})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    rows = {x["run_id"]: x for x in out["runs"]}
    assert rows[perfect]["linear_xeb"] == 1.0 and rows[perfect]["heavy_output_probability"] == 1.0
    assert abs(rows[noisy]["linear_xeb"] - 0.6) < 1e-9 and abs(rows[noisy]["heavy_output_probability"] - 0.8) < 1e-9
    assert rows[noisy]["ideal_heavy_output_probability"] == 1.0
    assert [s["run_id"] for s in out["skipped"]] == [bare]
    assert abs(out["linear_xeb"] - 0.8) < 1e-9


def test_xeb_without_usable_runs_gives_no_numbers():
    headers = _user()
    bare = _run(headers, {"00": 3})
    out = client.post("/api/v1/xeb", headers=headers, json={"run_ids": [bare]}).json()
    assert out["runs"] == [] and out["linear_xeb"] is None and out["heavy_output_probability"] is None
    assert client.post("/api/v1/xeb", headers=_user(), json={"run_ids": [bare]}).status_code == 404


def test_heavy_outputs_use_the_median_over_all_outcomes():
    from app.xeb_stats import heavy_outputs

    assert heavy_outputs({"00": 0.5, "11": 0.5}, 2) == {"00", "11"}
    assert heavy_outputs({"00": 0.4, "01": 0.3, "10": 0.2, "11": 0.1}, 2) == {"00", "01"}
