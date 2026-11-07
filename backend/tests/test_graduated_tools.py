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


# ── Hamiltonian studio ────────────────────────────────────────────────────────

def _ham(**body):
    return client.post("/api/v1/hamiltonian-studio", json=body)


def test_hamiltonian_spectrum_is_exact():
    r = _ham(pauli_terms=[{"pauli_string": "XX", "coefficient": 1}, {"pauli_string": "ZZ", "coefficient": 1}])
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["eigenvalues"] == [-2.0, 0.0, 0.0, 2.0] and out["spectral_gap"] == 2.0
    assert out["is_commuting"] is True and "Exact diagonalisation" in out["method"]
    singlet = _ham(preset="heisenberg", n_qubits=2).json()  # singlet -3, triplet +1
    assert singlet["ground_state_energy"] == -3.0 and singlet["first_excited_energy"] == 1.0
    tfim = _ham(preset="ising_1d", n_qubits=3).json()
    assert tfim["n_qubits"] == 3 and tfim["n_pauli_terms"] == 5 and tfim["is_commuting"] is False
    assert _ham(pauli_terms=[{"pauli_string": "XY", "coefficient": 1}]).json()["is_commuting"] is True


def test_hamiltonian_refuses_instead_of_inventing():
    assert _ham().status_code == 422
    assert _ham(preset="h2").status_code == 422
    assert _ham(terms=[{"pauli_string": "ZZ", "coefficient": 1}, {"pauli_string": "Z", "coefficient": 1}]).status_code == 422
    assert _ham(terms=[{"pauli_string": "ZQ", "coefficient": 1}]).status_code == 422


# ── Clifford simulator ────────────────────────────────────────────────────────

def test_clifford_stabilizers_come_from_the_tableau():
    r = client.post("/api/v1/clifford-sim", json={"qasm": BELL})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert sorted(out["stabilizer_generators"]) == ["+XX", "+ZZ"]
    assert out["pauli_expectation_z0"] == 0.0 and out["is_clifford_circuit"] is True
    flipped = client.post("/api/v1/clifford-sim", json={"qasm": HEAD + "x q[0];\nrz(pi/2) q[1];"}).json()
    assert flipped["pauli_expectation_z0"] == -1.0 and flipped["pauli_expectation_z1"] == 1.0
    assert flipped["n_gates_non_clifford"] == 0
    big = "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[60];\nh q[0];\n" + "".join(f"cx q[{i}],q[{i + 1}];\n" for i in range(59))
    assert client.post("/api/v1/clifford-sim", json={"qasm": big}).json()["n_qubits"] == 60


def test_non_clifford_circuit_reports_no_stabilizer_state():
    out = client.post("/api/v1/clifford-sim", json={"qasm": HEAD + "h q[0];\nt q[0];\ncx q[0],q[1];"}).json()
    assert out["is_clifford_circuit"] is False and out["magic_state_positions"] == [1]
    assert out["stabilizer_generators"] == [] and out["pauli_expectation_z0"] is None


# ── Tensor network ────────────────────────────────────────────────────────────

def test_tensor_network_uses_the_true_schmidt_decomposition():
    r = client.post("/api/v1/tensor-network", json={"qasm": BELL})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["bond_dimensions"] == [2] and out["schmidt_coefficients"] == [[0.5, 0.5]]
    assert abs(out["entanglement_entropies"][0] - math.log(2)) < 1e-6 and out["truncation_error"] == 0.0
    ghz = client.post("/api/v1/tensor-network", json={"qasm": HEAD + "h q[0];\ncx q[0],q[1];\ncx q[1],q[2];"}).json()
    assert ghz["exact_bond_dimensions"] == [2, 2]
    product = client.post("/api/v1/tensor-network", json={"qasm": HEAD + "h q[0];\nh q[1];\nx q[2];"}).json()
    assert product["exact_bond_dimensions"] == [1, 1] and product["entanglement_entropies"] == [0.0, 0.0]
    cut = client.post("/api/v1/tensor-network", json={"qasm": BELL, "max_bond_dim": 1}).json()
    assert cut["fits_bond_dim"] is False and abs(cut["truncation_error"] - 0.5) < 1e-9


# ── Circuit AI ────────────────────────────────────────────────────────────────

def test_circuit_optimizer_reports_what_the_transpiler_did():
    qasm = HEAD + "h q[0];\nh q[0];\ncx q[0],q[1];\ncx q[0],q[1];\nx q[2];"
    r = client.post("/api/v1/circuit-ai/optimize", json={"circuit_qasm": qasm})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["original_gates"] == 5 and out["optimized_gates"] == 1
    assert out["original_two_qubit_gates"] == 2 and out["optimized_two_qubit_gates"] == 0
    assert out["fidelity_improvement"] is None and "x q[2]" in out["optimized_qasm"]
    stats = client.post("/api/v1/circuit-ai/debug", json={"circuit_qasm": BELL}).json()["circuit_stats"]
    assert stats == {"n_qubits": 2, "depth": 3, "gate_count": 2, "two_qubit_gates": 1, "t_gates": 0}
    assert client.post("/api/v1/circuit-ai/optimize", json={"circuit_qasm": "nonsense"}).status_code == 422


# ── Run circuit optimizer (evo_optimizer) ─────────────────────────────────────

def test_run_optimizer_returns_real_transpiled_circuits():
    headers = _user()
    qasm = HEAD + "h q[0];\nh q[0];\ncx q[0],q[1];\ncx q[0],q[1];\nx q[2];"
    run_id = _run(headers, {"001": 10}, qasm)
    r = client.get(f"/api/v1/runs/{run_id}/evo-optimize", headers=headers)
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["baseline"]["size"] == 5 and out["baseline"]["cx_count"] == 2
    best = out["candidates"][0]
    assert best["fingerprint"]["size"] == 1 and best["deltas"]["cx_count"] == -2
    assert "x q[2]" in best["qasm"] and best["mutations_applied"][0].startswith("optimization_level=")
    assert client.get(f"/api/v1/runs/{run_id}/evo-optimize", headers=_user()).status_code == 404
    bare = _run(headers, {"0": 1})
    assert client.get(f"/api/v1/runs/{bare}/evo-optimize", headers=headers).status_code == 422


# ── Talent board privacy ──────────────────────────────────────────────────────

def test_talent_profiles_need_sign_in_and_hide_emails_from_others():
    owner, other = _user(), _user()
    body = {"name": "A", "email": "a-secret@example.com", "institution": "I", "role": "postdoc", "expertise": ["qec"],
            "publications": 1, "h_index": 1, "open_to_opportunities": True, "bio": "b"}
    pid = client.post("/api/v1/talent/profile", headers=owner, json=body).json()["profile_id"]
    assert client.get("/api/v1/talent/profiles").status_code == 401
    assert client.get(f"/api/v1/talent/profile/{pid}").status_code == 401
    seen = {p["profile_id"]: p for p in client.get("/api/v1/talent/profiles", headers=other).json()}
    assert seen[pid]["email"] is None
    assert client.get(f"/api/v1/talent/profile/{pid}", headers=other).json()["email"] is None
    assert client.get(f"/api/v1/talent/profile/{pid}", headers=owner).json()["email"] == "a-secret@example.com"


# ── Unitary synthesis (2 and 3 qubits) ───────────────────────────────────────

def _matrix(op) -> list:
    return [[[float(v.real), float(v.imag)] for v in row] for row in op]


def test_two_and_three_qubit_synthesis_reproduce_the_input():
    from qiskit.quantum_info import Operator, random_unitary

    for n in (2, 3):
        target = random_unitary(2 ** n, seed=7).data
        r = client.post("/api/v1/unitary-synth", json={"unitary": _matrix(target)})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["fidelity_to_target"] > 1 - 1e-6
        from app.local_sim import _parse
        circuit = _parse(out["qasm_output"]).remove_final_measurements(inplace=False)
        overlap = abs((Operator(target).adjoint() & Operator(circuit)).data.trace()) / 2 ** n
        assert overlap > 1 - 1e-4
    cnot = [[1, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 0], [0, 1, 0, 0]]
    assert client.post("/api/v1/unitary-synth", json={"unitary": [[[v, 0] for v in row] for row in cnot]}).json()["n_cx_gates"] <= 3  # KAK bound
    bad = [[[1, 0], [1, 0], [0, 0], [0, 0]]] + [[[0, 0]] * 4] * 3
    assert client.post("/api/v1/unitary-synth", json={"unitary": bad}).status_code == 422


# ── Trotter evolution ─────────────────────────────────────────────────────────

def test_trotter_uses_the_chosen_hamiltonian_and_measures_its_error():
    def run(**kw):
        r = client.post("/api/v1/trotter", json={"n_qubits": 2, "t_total": 1.0, "n_steps": 10, "initial_state": "all_up", **kw})
        assert r.status_code == 200, r.text
        return r.json()

    xy = run(hamiltonian="xy_model")
    assert xy["ground_state_energy_estimate"] == -2.0  # J(XX+YY) on two qubits: eigenvalues -2, 0, 0, 2
    assert xy["energy_evolution"][0] == 0.0  # |00> is an eigenstate with energy 0, and stays there
    ising = run(hamiltonian="ising_1d", J=1.0, h=0.5)
    assert ising["energy_evolution"] != xy["energy_evolution"]
    assert abs(ising["energy_evolution"][0] - (-1.0)) < 0.05  # <-ZZ - 0.5(X1+X2)> stays near -1 at small t
    assert ising["max_trotter_error"] > 0 and ising["recommended_n_steps"] is not None
    finer = run(hamiltonian="ising_1d", J=1.0, h=0.5, n_steps=100)
    assert finer["max_trotter_error"] < ising["max_trotter_error"]
    commuting = run(hamiltonian="ising_1d", J=1.0, h=0.0)
    assert commuting["max_trotter_error"] < 1e-12  # all terms commute: Trotter is exact


# ── Sample people are gone (social, researcher profiles) ─────────────────────

def test_no_sample_researchers_are_created_and_old_ones_are_removed():
    from app.database import SessionLocal
    from app.store import store_delete, store_put

    db = SessionLocal()
    try:  # what an earlier version left behind
        store_delete(db, "social_profile", "social_samples_removed_v1")
        store_put(db, "researcher_profiles", "profile_alice", {"profile_id": "profile_alice", "username": "alice_vqe"})
        store_put(db, "social_profile", "social_seeded_v1", {"done": True})
        store_put(db, "social_profile", "qyang_mit", {"username": "qyang_mit"})
    finally:
        db.close()
    names = {p.get("username") for p in client.get("/api/v1/profiles", headers=_user()).json()["profiles"]}
    assert "alice_vqe" not in names and "bob_qaoa" not in names
    assert client.get("/api/v1/social/profile/qyang_mit", headers=_user()).status_code == 404
    assert client.get("/api/v1/social/profile/chen_stanford", headers=_user()).status_code == 404


# ── FAIR record score and physics checks ─────────────────────────────────────

def test_fair_score_reflects_what_the_record_has():
    body = {"title": "T", "description": "D", "algorithm": "vqe", "backend": "ibm_x", "n_qubits": 2, "n_shots": 100}
    bare = client.post("/api/v1/fair-data/generate", json=body)
    assert bare.status_code == 200, bare.text
    assert "x-qlab-data" not in bare.headers
    s = bare.json()["fair_score"]
    assert (s["findable"], s["accessible"], s["interoperable"], s["reusable"]) == (0.333, 0.0, 1.0, 0.333)
    assert abs(s["total"] - 0.4165) < 0.001
    linked = client.post("/api/v1/fair-data/generate", json={**body, "run_id": "r1", "fidelity": 0.9}).json()
    assert linked["fair_score"]["reusable"] == 1.0
    assert client.post("/api/v1/fair-data/generate", json=body).json()["fair_score"] == s
    assert not next(c for c in linked["checklist"] if "DOI" in c["item"])["done"]


def test_physics_checks_are_rules_and_literature_ranking_is_gone():
    r = client.post("/api/v1/anomaly-physics/check", json={"t1_us": 100, "t2_us": 300, "fidelity": 1.2})
    assert r.status_code == 200 and "x-qlab-data" not in r.headers
    rules = {v["rule"] for v in r.json()["violations"]}
    assert rules == {"T2_leq_2T1", "fidelity_leq_1"}
    assert client.post("/api/v1/anomaly-physics/compare-literature", json={}).status_code in (404, 405)


# ── Templates ─────────────────────────────────────────────────────────────────

def test_builtin_templates_carry_no_invented_counts():
    r = client.get("/api/v1/experiment-templates", headers=_user())
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    body = r.json()
    items = body if isinstance(body, list) else body.get("templates", body.get("items", []))
    seeds = [t for t in items if str(t.get("template_id", "")).startswith("tpl_")]
    assert seeds and all(t["fork_count"] == 0 and t["run_count"] == 0 and t["star_count"] == 0 for t in seeds)
    bell = next(t for t in seeds if t["template_id"] == "tpl_bell_state")
    assert bell["is_verified"] is True


# ── No sample graph, circuits or replication claims ───────────────────────────

def test_research_graph_ancestry_and_replication_start_empty_of_samples():
    labels = {n["label"] for n in client.get("/api/v1/research-graph").json()["nodes"]}
    assert not labels & {"Run #4821 (N=4 GHZ)", "Our Draft (2026)", "GHZ Heisenberg Limit"}
    claims = client.get("/api/v1/replication").json()
    titles = {c["title"] for c in (claims if isinstance(claims, list) else claims.get("claims", []))}
    assert "GHZ Heisenberg Limit at N=8" not in titles
    circuits = client.get("/api/v1/circuit-ancestry").json()["circuits"]
    assert not any(c["name"] in {"Bell State", "GHZ State", "QFT-4"} and c["versions"] == 2 for c in circuits)


def test_circuit_ancestry_measures_the_committed_circuit():
    r = client.post("/api/v1/circuit-ancestry/", json={"name": "mine", "qasm": BELL})
    assert r.status_code == 200, r.text
    v = r.json()
    assert (v["n_qubits"], v["depth"], v["gate_count"]) == (2, 2, 2) and v["fidelity_at_commit"] is None
    assert client.post("/api/v1/circuit-ancestry/", json={"name": "bad", "qasm": "garbage"}).status_code == 422


# ── Advantage analysis ────────────────────────────────────────────────────────

def test_advantage_analysis_uses_the_runs_circuit_and_is_private():
    owner, other = _user(), _user()
    run_id = _run(owner, {"00": 5, "11": 5}, BELL)
    r = client.post(f"/api/v1/advantage/analyze/{run_id}", headers=owner)
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert (out["n_qubits"], out["circuit_depth"]) == (2, 2) and out["n_shots"] is None
    assert out["is_clifford_only"] is True and out["advantage_verdict"] == "no_advantage"
    assert client.get(f"/api/v1/advantage/cached/{run_id}", headers=other).status_code == 404
    assert client.get(f"/api/v1/advantage/cached/{run_id}", headers=owner).status_code == 200
    assert client.post("/api/v1/advantage", json={"problem_type": "maxcut"}).status_code in (404, 405)


# ── Causal analysis ───────────────────────────────────────────────────────────

def test_causal_analysis_refuses_thin_data_and_reports_only_real_confounders():
    thin = {"treatment": "dd", "outcome": "fidelity", "covariates": ["T1"], "data": [{"dd": 1, "fidelity": 0.9}]}
    r = client.post("/api/v1/causal/analyze", json=thin)
    assert r.status_code == 422 and "x-qlab-data" not in r.headers
    rows = [{"dd": i % 2, "fidelity": 0.80 + 0.1 * (i % 2) + 0.001 * i, "T1": 100 + i, "crosstalk": 5} for i in range(12)]
    out = client.post("/api/v1/causal/analyze", json={**thin, "covariates": ["T1", "crosstalk", "readout_error"], "data": rows}).json()
    assert abs(out["ate"] - 0.101) < 0.01 and out["p_value"] < 0.001
    assert out["confounders_detected"] == ["T1"]  # crosstalk is constant, readout_error is absent
    assert "noise_model" not in out["causal_graph_nodes"]
    conf = client.post("/api/v1/causal/identify-confounders",
                       json={"variables": ["readout_error"], "outcome": "fidelity", "experiment_log": rows}).json()
    assert conf["suspected_confounders"] == []


# ── Error budget ──────────────────────────────────────────────────────────────

def test_error_budget_counts_real_gates_and_uses_recorded_calibration():
    headers = _user()
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    assert client.post("/api/v1/runs", headers=headers, json={
        "run_id": run_id, "backend": "ibm_x", "qasm": BELL, "results": {"counts": {"00": 1}}, "status": "completed",
        "calibration": {"t1_us": {"0": 100.0, "1": 100.0}, "readout_errors": {"0": 0.01, "1": 0.03}},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).status_code == 200
    r = client.post("/api/v1/error-budget/analyze", headers=headers, json={
        "run_id": run_id, "single_q_error_rate": 0.001, "two_q_error_rate": 0.01, "gate_time_ns": 100})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert (out["n_1q_gates"], out["n_2q_gates"], out["circuit_depth"]) == (1, 1, 2)
    errs = {c["name"]: c["absolute_error"] for c in out["components"]}
    assert errs["Single-qubit gates"] == 0.001 and errs["Two-qubit gates"] == 0.01
    assert abs(errs["Readout errors"] - 0.04) < 1e-9
    assert abs(errs["T1 relaxation"] - 2 * (1 - math.exp(-0.002))) < 1e-7
    assert out["inputs_used"]["readout_error"] == "run calibration (average)" and out["missing_inputs"] == []
    bare = client.post("/api/v1/error-budget/analyze", headers=headers, json={"qasm": BELL}).json()
    assert bare["components"] == [] and "readout_error" in bare["missing_inputs"]
    assert client.post("/api/v1/error-budget/analyze", headers=headers, json={}).status_code == 422


# ── QAOA ──────────────────────────────────────────────────────────────────────

def test_qaoa_is_simulated_and_optimised_for_real():
    r = client.post("/api/v1/qaoa", json={"n_nodes": 4, "graph_type": "ring", "p_layers": 1, "n_shots": 2000, "seed": 3})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["classical_optimal"] == 4
    # p=1 QAOA on a ring reaches exactly 3/4 of every edge at the optimal angles.
    assert abs(out["approximation_ratio"] - 0.75) < 0.01 and abs(out["expected_cut_value"] - 3.0) < 0.04
    assert out["best_shot_cut"] == 4 and out["n_2q_gates"] == 8
    again = client.post("/api/v1/qaoa", json={"n_nodes": 4, "graph_type": "ring", "p_layers": 1, "n_shots": 2000, "seed": 3}).json()
    assert again["expected_cut_value"] == out["expected_cut_value"]
    assert client.post("/api/v1/qaoa", json={"problem": "tsp_small"}).status_code == 422


# ── Landscape explorer ────────────────────────────────────────────────────────

def test_landscape_energies_are_exact_expectation_values():
    r = client.post("/api/v1/landscape-explorer", json={"hamiltonian": "heisenberg", "n_qubits": 2, "grid_size": 5})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["grid"][2][2]["theta1"] == 0 and out["grid"][2][2]["energy"] == 1.0  # |00>: <ZZ> = 1
    assert out["exact_ground_energy"] == -3.0 and out["min_energy"] >= -3.0 - 1e-9
    again = client.post("/api/v1/landscape-explorer", json={"hamiltonian": "heisenberg", "n_qubits": 2, "grid_size": 5}).json()
    assert again["grid"] == out["grid"]
    assert client.post("/api/v1/landscape-explorer", json={"hamiltonian": "made_up"}).status_code == 422


# ── Optimizer hub ─────────────────────────────────────────────────────────────

def test_optimizer_hub_runs_real_optimizers_on_the_exact_energy():
    body = {"hamiltonian": "heisenberg", "n_qubits": 2, "max_iterations": 60, "optimizers": ["lbfgsb", "spsa"], "seed": 1}
    r = client.post("/api/v1/optimizer-hub", json=body)
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert out["true_minimum"] == -3.0  # singlet of XX + YY + ZZ
    for res in out["results"]:
        assert res["final_energy"] >= -3.0 - 1e-9 and res["n_function_evals"] > 0
        assert res["final_energy"] < out["initial_energy"]
    again = client.post("/api/v1/optimizer-hub", json=body).json()
    assert [x["final_energy"] for x in again["results"]] == [x["final_energy"] for x in out["results"]]
    assert client.post("/api/v1/optimizer-hub", json={**body, "hamiltonian": "generic"}).status_code == 422


# ── QKD protocol simulator ────────────────────────────────────────────────────

def _qkd(**body):
    r = client.post("/api/v1/protocol-sim", json={"n_bits": 20000, "seed": 5, **body})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    return r.json()


def test_bb84_qber_comes_from_the_simulated_attack():
    clean = _qkd(protocol="bb84", channel_error_rate=0.0)
    assert clean["qber"] == 0.0 and clean["n_secret_bits"] > 0 and not clean["eavesdropper_detected"]
    attacked = _qkd(protocol="bb84", channel_error_rate=0.0, eavesdropper=True, eavesdrop_fraction=1.0)
    assert 0.18 < attacked["qber"] < 0.32  # intercept-resend on every bit: 25%
    assert attacked["eavesdropper_detected"] and attacked["n_secret_bits"] == 0


def test_e91_chsh_is_estimated_from_the_samples():
    clean = _qkd(protocol="e91", channel_error_rate=0.0)
    assert abs(clean["chsh_s_value"] - 2 * math.sqrt(2)) < 0.15 and clean["bell_inequality_violated"]
    assert clean["qber"] == 0.0
    attacked = _qkd(protocol="e91", channel_error_rate=0.0, eavesdropper=True, eavesdrop_fraction=1.0)
    assert attacked["chsh_s_value"] < 2.1 and attacked["eavesdropper_detected"]
    assert client.post("/api/v1/protocol-sim", json={"protocol": "b92"}).status_code == 422


# ── Quantum finance ───────────────────────────────────────────────────────────

def test_finance_uses_only_supplied_market_data():
    r = client.post("/api/v1/quantum-finance", json={"n_qubits": 3, "n_paths": 2000, "seed": 1})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    assert abs(out["black_scholes_price"] - 8.0214) < 1e-3
    assert out["optimal_portfolio"] is None and out["asset_returns"] is None and out["portfolio_risk"] is None
    assert out["n_cnot_gates"] > 0 and out["circuit_depth"] > 0
    cov = [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]]
    port = client.post("/api/v1/quantum-finance", json={
        "n_qubits": 3, "n_paths": 200, "asset_returns": [0.1, 0.2, 0.15], "budget": 2, "covariance": cov}).json()
    assert port["optimal_portfolio"] == [0, 1, 1] and abs(port["expected_return"] - 0.35) < 1e-9
    assert abs(port["portfolio_risk"] - math.sqrt(0.005)) < 1e-6


# ── Methods section ───────────────────────────────────────────────────────────

def test_methods_text_states_only_recorded_facts():
    headers = _user()
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    assert client.post("/api/v1/runs", headers=headers, json={
        "run_id": run_id, "backend": "ibm_torino", "qasm": BELL, "results": {"counts": {"00": 1}}, "status": "completed",
        "execution": {"shots": 4000}, "calibration": {"t1_us": {"0": 150.0, "1": 250.0}},
        "context": {"library_versions": {"qiskit": "2.1.0"}}, "created_at": datetime.now(timezone.utc).isoformat(),
    }).status_code == 200
    bare = _run(headers, {"0": 1})
    r = client.post("/api/v1/methods-gen/generate", headers=headers, json={"run_ids": [run_id, bare]})
    assert r.status_code == 200, r.text
    assert "x-qlab-data" not in r.headers
    out = r.json()
    text = out["methods_text"]
    assert "ibm_torino" in text and "mean T1 200 us" in text and "Qiskit 2.1.0" in text and "4000 shots" in text
    assert "heavy-hexagonal" not in text and "COBYLA" not in text and "bootstrap" not in text
    assert "not recorded" in out["calibration_table_md"]
    checklist = {c["item"]: c["done"] for c in out["reproducibility_checklist"]}
    assert checklist["Shot count recorded"] is False  # the bare run recorded none
    assert client.post("/api/v1/methods-gen/generate", headers=_user(), json={"run_ids": [run_id]}).status_code == 404
