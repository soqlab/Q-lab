"""Run analytics routers (group C): each reads a stored run and computes from it.

Every test uploads real runs through POST /api/v1/runs and checks the computed values, plus that
another user cannot read the run through the router.
"""
import uuid

import pytest

from tests.helpers import client, make_user, push_run


@pytest.fixture(scope="module")
def users():
    return make_user(prefix="c1a"), make_user(prefix="c1b")


def _uid() -> str:
    return uuid.uuid4().hex[:8]


# ── run_metrics (SDK: qlab.log_metric) ───────────────────────────────────────

def test_run_metrics_logged_read_back_and_cleared(users):
    alice, _ = users
    rid = push_run(alice)
    r = client.post(f"/api/v1/runs/{rid}/metrics", headers=alice, json={"metrics": [
        {"name": "energy", "value": -1.0, "step": 0},
        {"name": "energy", "value": -1.5, "step": 1},
        {"name": "fidelity", "value": 0.93},
    ]})
    assert r.status_code == 201 and r.json() == {"logged": 3}
    got = client.get(f"/api/v1/runs/{rid}/metrics", headers=alice).json()
    assert got["total_points"] == 3
    assert [p["value"] for p in got["metrics"]["energy"]] == [-1.0, -1.5]
    assert got["summary"] == {"energy": -1.5, "fidelity": 0.93}

    assert client.delete(f"/api/v1/runs/{rid}/metrics?name=energy", headers=alice).json() == {"deleted": 2}
    assert client.get(f"/api/v1/runs/{rid}/metrics", headers=alice).json()["summary"] == {"fidelity": 0.93}


def test_run_metrics_validation(users):
    alice, _ = users
    rid = push_run(alice)
    assert client.post(f"/api/v1/runs/{rid}/metrics", headers=alice, json={"metrics": []}).status_code == 422
    assert client.post(f"/api/v1/runs/{rid}/metrics", headers=alice,
                       json={"metrics": [{"name": "", "value": 1}]}).status_code == 422
    assert client.post(f"/api/v1/runs/{rid}/metrics", headers=alice,
                       json={"metrics": [{"name": "x", "value": "high"}]}).status_code == 422


def test_run_metrics_are_private_to_the_runs_owner(users):
    """Regression: metrics were keyed by run_id only, so anyone could read, add to or delete the
    metrics of any run."""
    alice, bob = users
    rid = push_run(alice)
    client.post(f"/api/v1/runs/{rid}/metrics", headers=alice, json={"metrics": [{"name": "e", "value": 1}]})

    assert client.get(f"/api/v1/runs/{rid}/metrics", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{rid}/metrics").status_code == 404
    assert client.post(f"/api/v1/runs/{rid}/metrics", headers=bob,
                       json={"metrics": [{"name": "e", "value": 99}]}).status_code == 404
    assert client.delete(f"/api/v1/runs/{rid}/metrics", headers=bob).status_code == 404
    got = client.get(f"/api/v1/runs/{rid}/metrics", headers=alice).json()
    assert got["summary"] == {"e": 1.0} and got["total_points"] == 1


def test_run_metrics_may_arrive_before_the_run(users):
    """The SDK sends the run and its first metrics from separate threads."""
    alice, _ = users
    rid = f"early-{_uid()}"
    assert client.post(f"/api/v1/runs/{rid}/metrics", headers=alice,
                       json={"metrics": [{"name": "e", "value": 2}]}).status_code == 201
    push_run(alice, run_id=rid)
    assert client.get(f"/api/v1/runs/{rid}/metrics", headers=alice).json()["summary"] == {"e": 2.0}


# ── shadow (SDK: noisy-simulation comparison) ────────────────────────────────

def test_shadow_store_and_read(users):
    alice, bob = users
    rid = push_run(alice)
    assert client.get(f"/api/v1/runs/{rid}/shadow", headers=alice).status_code == 404  # none yet
    body = {"sim_counts": {"00": 480, "11": 520}, "tvd": 0.0412345678, "shots": 1000,
            "noise_model_summary": {"gate_error": 0.01}}
    r = client.post(f"/api/v1/runs/{rid}/shadow", headers=alice, json=body)
    assert r.status_code == 200 and r.json()["stored"] is True
    got = client.get(f"/api/v1/runs/{rid}/shadow", headers=alice).json()
    assert got["tvd"] == 0.041235 and got["tvd_level"] == "ok"
    assert got["real_counts"] == {"00": 500, "11": 500}
    assert got["sim_counts"] == {"00": 480, "11": 520} and got["sim_backend"] == "AerSimulator"

    client.post(f"/api/v1/runs/{rid}/shadow", headers=alice, json={**body, "tvd": 0.3})
    assert client.get(f"/api/v1/runs/{rid}/shadow", headers=alice).json()["tvd_level"] == "danger"

    # Another user can neither read nor overwrite it.
    assert client.get(f"/api/v1/runs/{rid}/shadow", headers=bob).status_code == 404
    assert client.post(f"/api/v1/runs/{rid}/shadow", headers=bob, json=body).status_code == 404
    assert client.post(f"/api/v1/runs/{rid}/shadow", headers=alice, json={"tvd": 0.1}).status_code == 422


# ── sweeps ───────────────────────────────────────────────────────────────────

def test_sweep_analysis_uses_parameters_and_logged_metrics(users):
    alice, bob = users
    project = f"sweep-{_uid()}"
    ids = []
    for theta, energy in ((0.3, -0.9), (0.1, -1.1), (0.2, -1.3)):
        rid = push_run(alice, project=project, parameters={"theta": theta, "label": "x"})
        client.post(f"/api/v1/runs/{rid}/metrics", headers=alice,
                    json={"metrics": [{"name": "energy", "value": energy}]})
        ids.append(rid)
    push_run(bob, project=project, parameters={"theta": 9.9})  # not Alice's

    r = client.get(f"/api/v1/sweeps/analyze?project={project}&x_param=theta&y_metric=energy", headers=alice)
    body = r.json()
    assert body["total_runs"] == 3 and body["matched_points"] == 3
    assert [(p["x"], p["y"]) for p in body["points"]] == [(0.1, -1.1), (0.2, -1.3), (0.3, -0.9)]
    assert body["available_x_params"] == ["theta"]
    assert "energy" in body["available_y_metrics"]

    depth = client.get(f"/api/v1/sweeps/analyze?project={project}&x_param=theta&y_metric=depth",
                       headers=alice).json()
    assert {p["y"] for p in depth["points"]} == {3.0}
    params = client.get(f"/api/v1/sweeps/projects/{project}/params", headers=alice).json()
    assert params["run_count"] == 3 and params["available_x_params"] == ["theta"]
    assert client.get(f"/api/v1/sweeps/analyze?project={project}&x_param=theta",
                      headers=alice).status_code == 422


# ── pauli_noise ──────────────────────────────────────────────────────────────

def test_pauli_noise_of_a_bell_run(users):
    alice, bob = users
    backend = f"pn-{_uid()}"
    rid = push_run(alice, backend=backend, calibration={"avg_readout_error": 0.4})
    got = client.get(f"/api/v1/runs/{rid}/pauli-noise", headers=alice).json()
    # 50/50 over 00 and 11: each qubit flips half the time, Rényi-2 entropy 1 bit,
    # p_dep = 1 - (4 * 0.5 - 1) / 3 = 2/3.
    assert got["n_qubits"] == 2 and got["total_shots"] == 1000
    assert got["qubit_flip_rates"] == [0.5, 0.5]
    assert got["renyi2_entropy"] == 1.0
    assert got["effective_depolarizing_rate"] == pytest.approx(0.6667, abs=1e-4)
    assert got["noise_tier"] == "very_high"
    assert got["calibration_context"]["readout_vs_noise"] == "readout-dominated"

    clean = push_run(alice, backend=backend, results={"counts": {"00": 1000}})
    c = client.get(f"/api/v1/runs/{clean}/pauli-noise", headers=alice).json()
    assert c["effective_depolarizing_rate"] == 0.0 and c["noise_tier"] == "low"

    hist = client.get(f"/api/v1/backends/{backend}/pauli-noise-history", headers=alice).json()
    assert hist["n_runs_analyzed"] == 2
    assert client.get(f"/api/v1/backends/{backend}/pauli-noise-history", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{rid}/pauli-noise", headers=bob).status_code == 404
    empty = push_run(alice, results={})
    assert client.get(f"/api/v1/runs/{empty}/pauli-noise", headers=alice).status_code == 422


# ── passive_rb ───────────────────────────────────────────────────────────────

def test_passive_rb_fits_the_callers_runs(users):
    alice, bob = users
    backend = f"rb-{_uid()}"
    for d in range(2, 14):
        push_run(alice, backend=backend, fingerprint={"num_qubits": 1, "depth": d},
                 results={"success_probability": 0.5 * 0.95 ** d + 0.5})
    got = client.get(f"/api/v1/backends/{backend}/passive-rb?limit=20", headers=alice)
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["n_runs_used"] == 12 and body["avg_n_qubits"] == 1.0
    assert 0 < body["fit"]["p"] < 1
    assert body["epc"] == pytest.approx(0.5 * (1 - body["fit"]["p"]), abs=1e-5)
    assert body["gate_fidelity"] == pytest.approx(1 - body["epc"], abs=1e-6)
    assert body["trend"] == "degrading"  # deeper circuits were run later
    # Bob has no runs there.
    assert client.get(f"/api/v1/backends/{backend}/passive-rb", headers=bob).status_code == 422


# ── quantum_volume, robustness, rca, qubit_map ───────────────────────────────

def test_quantum_volume_from_calibration(users):
    alice, bob = users
    rid = push_run(alice, calibration={"gate_errors": {"cx_0_1": 0.01}, "readout_errors": {"0": 0.01}})
    body = client.get(f"/api/v1/runs/{rid}/quantum-volume", headers=alice).json()
    # Layer fidelity 0.99^(4d) stays above 2/3 up to d = 10.
    assert body["log2_qv"] == 10 and body["estimated_qv"] == 1024 and body["grade"] == "excellent"
    assert body["calibration_used"]["avg_gate_2q_error"] == 0.01
    assert body["has_calibration"] is True
    assert client.get(f"/api/v1/runs/{rid}/quantum-volume", headers=bob).status_code == 404


def test_robustness_sweep(users):
    alice, _ = users
    rid = push_run(alice)
    body = client.get(f"/api/v1/runs/{rid}/robustness", headers=alice).json()
    # Defaults without calibration: 1q error 0.001, 2q 0.01, readout 0.02; h + cx + 2 measurements.
    expected = 0.999 * 0.99 * 0.98 ** 2
    assert body["baseline_fidelity"] == pytest.approx(expected, abs=1e-4)
    assert body["has_calibration"] is False
    assert body["fidelity_at_half_noise"] > body["baseline_fidelity"]


def test_root_cause_analysis(users):
    alice, bob = users
    rid = push_run(alice, status="failed", execution={"error_type": "IBMBackendError", "error_message": "boom"},
                   fingerprint={"num_qubits": 2, "depth": 12, "size": 13,
                                "gate_counts": {"h": 1, "cx": 10, "measure": 2}},
                   calibration={"t1_us": {"0": 10.0, "1": 10.0}})
    body = client.get(f"/api/v1/runs/{rid}/rca", headers=alice).json()
    ids = {c["id"]: c for c in body["causes"]}
    assert ids["execution_failed"]["severity"] == "critical"
    # 1×50 ns + 10×300 ns + 2×3000 ns = 9.05 µs, 90.5 % of T1.
    assert body["circuit_time_us"] == 9.05 and body["two_qubit_gate_count"] == 10
    assert ids["t1_decoherence"]["severity"] == "high"
    assert client.get(f"/api/v1/runs/{rid}/rca", headers=bob).status_code == 404


def test_qubit_map_uses_calibration_of_the_physical_qubits(users):
    """Regression: qubit quality was looked up only for indices below num_qubits, so a layout onto
    physical qubits 5 and 3 never showed their T1 or readout error."""
    alice, _ = users
    rid = push_run(alice,
                   transpiler={"initial_layout": [5, 3], "depth_before": 3, "depth_after": 6, "swap_count": 2},
                   calibration={"coupling_map": [[3, 5], [5, 6]],
                                "5": {"T1": 120.0, "readout_error": 0.02},
                                "3": {"T1": 80.0, "readout_error": 0.05}})
    body = client.get(f"/api/v1/runs/{rid}/qubit-map", headers=alice).json()
    assert body["has_layout"] is True and body["layout"] == {"0": 5, "1": 3}
    assert body["mapped_pairs"] == [
        {"logical": 0, "physical": 5, "T1_us": 120.0, "readout_error": 0.02},
        {"logical": 1, "physical": 3, "T1_us": 80.0, "readout_error": 0.05},
    ]
    assert body["coupling_edges"] == [[3, 5], [5, 6]]
    assert body["routing_overhead"]["depth_overhead_pct"] == 100.0
    assert body["routing_overhead"]["swap_count"] == 2


# ── shadow_tomo, state_tomo, zx_simplify ─────────────────────────────────────

def test_shadow_tomography_of_a_bell_state(users):
    alice, bob = users
    rid = push_run(alice)
    body = client.get(f"/api/v1/runs/{rid}/shadow-tomo", headers=alice).json()
    assert body["z_expectations"] == [0.0, 0.0]
    assert body["zz_correlations"] == {"Z0Z1": 1.0}
    assert body["global_parity"] == 1.0 and body["renyi2_entropy"] == 1.0
    assert body["entanglement_indicator"] == 1.0 and body["success_probability"] == 0.5
    assert client.get(f"/api/v1/runs/{rid}/shadow-tomo", headers=bob).status_code == 404
    empty = push_run(alice, results={"note": "none"})
    assert client.get(f"/api/v1/runs/{empty}/shadow-tomo", headers=alice).status_code == 422


def test_state_tomography_reconstructs_plus_state(users):
    alice, bob = users
    rid = push_run(alice)
    meas = {"X": {"0": 1000}, "Y": {"0": 500, "1": 500}, "Z": {"0": 500, "1": 500}}
    r = client.post(f"/api/v1/runs/{rid}/tomography", headers=alice, json={"basis_measurements": meas})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["bloch_vector"] == {"x": 1.0, "y": 0.0, "z": 0.0}
    assert body["purity"] == pytest.approx(1.0, abs=1e-6) and body["state_type"] == "pure"
    assert body["fidelity_to_ideal"] == pytest.approx(0.5, abs=1e-6)  # |<0|+>|^2
    assert client.get(f"/api/v1/runs/{rid}/tomography", headers=alice).json()["tomo_id"] == body["tomo_id"]
    assert client.post(f"/api/v1/runs/{rid}/tomography", headers=alice,
                       json={"basis_measurements": {}}).status_code == 422
    assert client.post(f"/api/v1/runs/{rid}/tomography", headers=alice,
                       json={"basis_measurements": {"XXXX": {"0000": 1}}}).status_code == 422


def test_state_tomography_is_private(users):
    """Regression: GET /tomography looked results up by run_id alone, so anyone could read them."""
    alice, bob = users
    rid = push_run(alice)
    client.post(f"/api/v1/runs/{rid}/tomography", headers=alice,
                json={"basis_measurements": {"Z": {"0": 10}}})
    assert client.get(f"/api/v1/runs/{rid}/tomography", headers=bob).status_code == 404
    assert client.post(f"/api/v1/runs/{rid}/tomography", headers=bob,
                       json={"basis_measurements": {"Z": {"0": 10}}}).status_code == 404


def test_zx_simplify(users):
    alice, bob = users
    qasm = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nh q[0];\nt q[0];\nt q[0];\n'
    rid = push_run(alice, qasm=qasm)
    r = client.post(f"/api/v1/runs/{rid}/zx-simplify", headers=alice)
    if r.status_code == 501:
        pytest.skip("neither pyzx nor qiskit installed")
    body = r.json()
    assert body["has_qasm"] is True and body["original_t_count"] == 2
    assert body["t_count_reduction"] == max(0, body["original_t_count"] - body["simplified_t_count"])
    no_qasm = push_run(alice, qasm=None)
    assert client.post(f"/api/v1/runs/{no_qasm}/zx-simplify", headers=alice).json()["has_qasm"] is False
    assert client.post(f"/api/v1/runs/{rid}/zx-simplify", headers=bob).status_code == 404


# ── repro_score, pub_report ──────────────────────────────────────────────────

def test_repro_score_and_duplicate_detection(users):
    alice, bob = users
    backend = f"repro-{_uid()}"
    name = f"dup-{_uid()}"
    first = push_run(alice, backend=backend, circuit_name=name)
    second = push_run(alice, backend=backend, circuit_name=name)
    push_run(bob, backend=backend, circuit_name=name)  # Bob's copy is not visible to Alice
    body = client.get(f"/api/v1/runs/{second}/repro-score", headers=alice).json()
    codes = {f["code"]: f for f in body["fraud_flags"]}
    assert codes["F1"]["evidence"]["other_run_id"] == first
    assert codes["F5"]["evidence"]["duplicate_run_id"] == first
    assert body["fraud_severity"] == "warning"
    dims = body["dimensions"]
    # QASM stored (0.6) + 3 of 5 fingerprint fields (0.4 × 0.6).
    assert dims["circuit_traceability"]["score"] == 0.84
    expected = round(sum(d["score"] * d["weight"] for d in dims.values()), 3)
    assert body["overall_score"] == expected
    assert client.get(f"/api/v1/runs/{second}/repro-score", headers=bob).status_code == 404


def test_publication_reports(users):
    alice, bob = users
    rid = push_run(alice, backend="ibm_report", tags=["paper", "bell_state"])
    md = client.get(f"/api/v1/runs/{rid}/report.md", headers=alice)
    assert md.status_code == 200 and f"`{rid}`" in md.text and "ibm_report" in md.text
    tex = client.get(f"/api/v1/runs/{rid}/report.tex", headers=alice)
    assert tex.status_code == 200 and "bell\\_state" in tex.text  # LaTeX-escaped underscore
    js = client.get(f"/api/v1/runs/{rid}/report.json", headers=alice).json()
    assert js["run_id"] == rid and js["tags"] == ["paper", "bell_state"]
    for ext in ("md", "tex", "json"):
        assert client.get(f"/api/v1/runs/{rid}/report.{ext}", headers=bob).status_code == 404


# ── recommender, transfer_prediction, timing_advisor, stats_compare ──────────

def test_similar_runs_and_recommendations(users):
    alice, bob = users
    backend = f"sim-{_uid()}"
    focus = push_run(alice, backend=backend, circuit_name="bell sweep a")
    same = push_run(alice, backend=backend, circuit_name="bell sweep b")
    other = push_run(alice, backend=f"other-{_uid()}", circuit_name="qaoa")
    push_run(bob, backend=backend, circuit_name="bell sweep b")
    sims = client.get(f"/api/v1/recommend/similar/{focus}?limit=50", headers=alice).json()
    scores = {s["run_id"]: s["similarity_score"] for s in sims}
    # same backend 0.4 + two shared words 0.1 + similar shots 0.2
    assert scores[same] == 0.7
    assert scores[same] > scores[other]
    assert focus not in scores
    assert client.get(f"/api/v1/recommend/similar/{focus}", headers=bob).status_code == 404

    rec = client.get("/api/v1/recommend", headers=alice).json()
    assert rec["context"]["recent_runs_analyzed"] >= 3
    assert backend in rec["context"]["backends_seen"]


def test_transfer_prediction_compares_against_the_callers_backends(users):
    alice, bob = users
    src, tgt = f"tp-src-{_uid()}", f"tp-tgt-{_uid()}"
    rid = push_run(alice, backend=src)
    push_run(alice, backend=tgt)
    push_run(bob, backend=f"tp-bob-{_uid()}")
    body = client.get(f"/api/v1/runs/{rid}/transfer-prediction", headers=alice).json()
    targets = {p["target_backend"] for p in body["predictions"]}
    assert tgt in targets and src not in targets
    assert not any(t.startswith("tp-bob-") for t in targets)
    for p in body["predictions"]:
        assert 0 <= p["transfer_score"] <= 1
    nofp = push_run(alice, fingerprint={})
    assert client.get(f"/api/v1/runs/{nofp}/transfer-prediction", headers=alice).status_code == 422


def test_timing_advisor_best_and_worst_hours(users):
    alice, _ = users
    backend = f"tm-{_uid()}"
    # 2026-11-02 is a Monday, 2026-11-04 a Wednesday.
    push_run(alice, backend=backend, created_at="2026-11-02T10:15:00+00:00", results={"health_score": 90})
    push_run(alice, backend=backend, created_at="2026-11-02T10:45:00+00:00", results={"health_score": 80})
    push_run(alice, backend=backend, created_at="2026-11-04T15:00:00+00:00", results={"health_score": 40})
    body = client.get(f"/api/v1/timing/best-time/{backend}", headers=alice).json()
    assert body["analysis_runs"] == 3
    assert body["best_times"][0] == {"day": "Monday", "hour_utc": 10, "avg_health": 85.0, "n_runs": 2}
    assert body["worst_times"][0]["day"] == "Wednesday" and body["worst_times"][0]["avg_health"] == 40.0
    assert body["heatmap"][0][10] == 85.0 and body["heatmap"][2][15] == 40.0
    none = client.get(f"/api/v1/timing/best-time/nothing-{_uid()}", headers=alice).json()
    assert none["analysis_runs"] == 0


def test_stats_compare_two_groups(users):
    alice, bob = users
    a = [push_run(alice, fingerprint={"num_qubits": 2, "depth": d}) for d in (3, 4, 5)]
    b = [push_run(alice, fingerprint={"num_qubits": 2, "depth": d}) for d in (20, 21, 22)]
    hidden = push_run(bob, fingerprint={"num_qubits": 2, "depth": 100})
    r = client.post("/api/v1/stats/compare", headers=alice,
                    json={"group_a": a + [hidden], "group_b": b, "metric": "depth"})
    body = r.json()
    assert body["group_a"]["missing"] == [hidden] and body["group_a"]["usable_n"] == 3
    assert body["descriptive"]["mean_difference"] == -17.0
    assert body["descriptive"]["direction"] == "A < B"
    assert body["descriptive"]["group_a"]["median"] == 4.0
    assert body["welch_t_test"]["p_value"] < 0.001
    assert body["verdict"] == "statistically_significant_meaningful_effect"
    assert client.post("/api/v1/stats/compare", headers=alice,
                       json={"group_a": a, "group_b": b, "metric": "colour"}).status_code == 422
    assert client.post("/api/v1/stats/compare", headers=alice,
                       json={"group_a": a[:1], "group_b": b}).status_code == 422
    assert client.post("/api/v1/stats/compare", headers=bob,
                       json={"group_a": a, "group_b": b, "metric": "depth"}).status_code == 422

