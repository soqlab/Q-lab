"""Kept routers, group A (2/3): analyses computed from uploaded runs.

Each test uploads runs through POST /api/v1/runs, calls the analysis, checks the computed values,
and checks that another user's runs are neither readable nor mixed in.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.helpers import BELL, GHZ3, client, make_user, push_run

HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n'


@pytest.fixture(scope="module")
def alice():
    return make_user(prefix="a2alice")


@pytest.fixture(scope="module")
def bob():
    return make_user(prefix="a2bob")


def _fp(n=2, depth=3, **gate_counts):
    return {"num_qubits": n, "depth": depth, "gate_counts": gate_counts}


def test_advantage_oracle_counts_gates_from_the_fingerprint(alice, bob):
    run_id = push_run(alice, fingerprint=_fp(3, 5, h=1, cx=2, t=3, tdg=1),
                      results={"counts": {"000": 70, "111": 20, "010": 10}})
    r = client.get(f"/api/v1/runs/{run_id}/advantage-oracle", headers=alice).json()
    assert (r["n_qubits"], r["depth"], r["t_count"], r["cx_count"]) == (3, 5, 4, 2)
    assert r["entanglement_width"] == 2  # min(3, int(2/5*2)+2)
    costs = {k: v["log10_flops"] for k, v in r["strategies"].items()}
    assert set(costs) == {"stabilizer_rank", "tensor_network", "mps_simulation", "statevector", "clifford_t"}
    assert r["best_classical_strategy"] == min(costs, key=costs.get)
    assert r["heavy_output_fraction"] == round(1 / 3, 4)  # only "000" is above the median probability
    assert client.get(f"/api/v1/runs/{run_id}/advantage-oracle", headers=bob).status_code == 404
    empty = push_run(alice, fingerprint={})
    assert client.get(f"/api/v1/runs/{empty}/advantage-oracle", headers=alice).status_code == 422


def test_ansatz_discovery_classifies_the_circuit(alice, bob):
    bell = push_run(alice, fingerprint=_fp(2, 2, h=1, cx=1))
    r = client.get(f"/api/v1/runs/{bell}/ansatz-discovery", headers=alice).json()
    assert r["circuit_family"] == "problem_inspired"
    scores = [x["score"] for x in r["all_recommendations"]]
    assert scores == sorted(scores, reverse=True) and r["top_recommendation"]["score"] == scores[0]
    assert all(x["recommended_reps"] == 3 for x in r["all_recommendations"])  # 2 qubits -> 3 reps
    hea = push_run(alice, fingerprint={**_fp(4, 6, ry=4, cx=3), "non_clifford_ratio": 0.1})
    assert client.get(f"/api/v1/runs/{hea}/ansatz-discovery", headers=alice).json()["circuit_family"] == \
        "hardware_efficient"
    assert client.get(f"/api/v1/runs/{bell}/ansatz-discovery", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{push_run(alice, fingerprint={})}/ansatz-discovery",
                      headers=alice).status_code == 422


def test_bug_database_matches_the_rules(alice, bob):
    bad = push_run(alice, fingerprint={**_fp(2, 3, t=4, h=1), "non_clifford_ratio": 0.3},
                   results={"success_probability": 0.2})
    r = client.get(f"/api/v1/runs/{bad}/bug-database", headers=alice).json()
    match = next(m for m in r["matches"] if m["id"] == "coherent-001")
    assert match["severity"] == "critical" and r["verdict"] == "critical" and r["n_critical"] >= 1
    assert {(x["path"], x["actual"]) for x in match["matched_rules"]} == {
        ("fingerprint.non_clifford_ratio", 0.3), ("results.success_probability", 0.2)}
    good = push_run(alice, results={"success_probability": 0.95})
    assert "coherent-001" not in {m["id"] for m in
                                  client.get(f"/api/v1/runs/{good}/bug-database", headers=alice).json()["matches"]}
    assert client.get(f"/api/v1/runs/{bad}/bug-database", headers=bob).status_code == 404
    patterns = client.get("/api/v1/bug-database/patterns").json()
    assert "coherent-001" in {p["id"] for p in patterns} and "rules" not in patterns[0]


def test_carbon_estimate_from_qpu_time_and_region(alice, bob):
    run_id = push_run(alice, backend="ibm_carbon", timing={"qpu_time": 36})
    r = client.get(f"/api/v1/carbon/run/{run_id}", headers=alice).json()
    # 45 kW for 36 s = 0.45 kWh; x 386 gCO2/kWh x PUE 1.6
    assert r["energy_kwh"] == 0.45 and r["co2_grams_raw"] == 173.7 and r["co2_grams"] == 277.92
    nordic = client.get(f"/api/v1/carbon/run/{run_id}?region=eu-north", headers=alice).json()
    assert nordic["carbon_intensity_gco2_kwh"] == 45 and nordic["co2_grams"] == round(0.45 * 45 * 1.6, 4)
    sim = push_run(alice, backend="aer_simulator", execution={"shots": 1000})  # 1000 shots -> 0.1 s
    assert client.get(f"/api/v1/carbon/run/{sim}", headers=alice).json()["qpu_time_seconds"] == 0.1
    assert client.get(f"/api/v1/carbon/run/{run_id}", headers=bob).status_code == 404

    project = f"carbon-{uuid.uuid4().hex[:6]}"
    client.post("/api/v1/projects", headers=alice, json={"slug": project})
    push_run(alice, project=project, backend="ibm_carbon", timing={"qpu_time": 36})
    push_run(alice, project=project, backend="ibm_carbon", timing={"qpu_time": 36})
    total = client.get(f"/api/v1/carbon/project/{project}", headers=alice).json()
    assert total["runs_counted"] == 2 and total["total_co2_grams"] == round(2 * 277.92, 4)


def test_causal_graph_keeps_a_perfect_correlation(alice, bob):
    """Regression: a correlation of exactly 1 was given p = 1 and its edge removed as independent."""
    project = f"causal-{uuid.uuid4().hex[:6]}"
    for i in range(1, 13):
        push_run(alice, project=project, parameters={"shots": i, "optimization_level": 2 * i})
    push_run(bob, project=project, parameters={"shots": 999, "optimization_level": 0})
    r = client.get(f"/api/v1/projects/{project}/causal-graph", headers=alice).json()
    assert r["n_runs"] == 12  # Bob's run is not part of Alice's analysis
    edge = next(e for e in r["edges"] if {e["source"], e["target"]} == {"shots", "optimization_level"})
    assert edge["partial_corr"] == 1.0 and edge["p_value"] == 0.0 and edge["direction"] == "positive"
    # Constant variables carry no information and get no edges.
    assert all("num_qubits" not in (e["source"], e["target"]) for e in r["edges"])

    small = f"causal-small-{uuid.uuid4().hex[:6]}"
    push_run(alice, project=small)
    assert client.get(f"/api/v1/projects/{small}/causal-graph", headers=alice).status_code == 422


def test_unitary_fidelity_ignores_final_measurements(alice, bob):
    """Regression: stored circuits end in measurements, so the comparison always failed with 500."""
    bell = push_run(alice, qasm=BELL)
    same = push_run(alice, qasm=HEADER + "qreg q[2];\ncreg c[2];\nh q[0];\nx q[1];\nx q[1];\ncx q[0],q[1];\n"
                                         "measure q -> c;")
    other = push_run(alice, qasm=HEADER + "qreg q[2];\ncreg c[2];\nx q[0];\ncx q[0],q[1];\nmeasure q -> c;")
    ghz = push_run(alice, qasm=GHZ3)
    r = client.get(f"/api/v1/runs/{bell}/unitary-fidelity/{same}", headers=alice)
    assert r.status_code == 200, r.text
    assert r.json()["fidelity"] == 1.0 and r.json()["equivalent"] is True
    diff = client.get(f"/api/v1/runs/{bell}/unitary-fidelity/{other}", headers=alice).json()
    assert diff["equivalent"] is False and diff["fidelity"] < 0.9
    mismatch = client.get(f"/api/v1/runs/{bell}/unitary-fidelity/{ghz}", headers=alice).json()
    assert mismatch["note"] == "Qubit count mismatch: 2 vs 3"
    assert client.get(f"/api/v1/runs/{bell}/unitary-fidelity/{same}", headers=bob).status_code == 404
    no_qasm = push_run(alice, qasm=None)
    assert client.get(f"/api/v1/runs/{bell}/unitary-fidelity/{no_qasm}", headers=alice).status_code == 422


def test_similar_circuits_come_from_the_callers_runs(alice, bob):
    backend = f"ibm_sim_{uuid.uuid4().hex[:6]}"
    anchor = push_run(alice, backend=backend, qasm=BELL)
    twin = push_run(alice, backend=backend, qasm=BELL)
    foreign = push_run(bob, backend=backend, qasm=BELL)
    embedded = client.post(f"/api/v1/runs/{anchor}/embed", headers=alice).json()
    assert embedded["run_id"] == anchor and embedded["cached"] is True

    r = client.get(f"/api/v1/runs/{anchor}/similar?backend={backend}&min_sim=0", headers=alice).json()
    ids = [x["run_id"] for x in r["results"]]
    assert ids == [twin] and foreign not in ids
    assert r["results"][0]["similarity"] == pytest.approx(1.0, abs=1e-3)
    assert r["results"][0]["fingerprint_delta"]["depth"] == 0
    assert client.get(f"/api/v1/runs/{anchor}/similar", headers=bob).status_code == 404

    found = client.get(f"/api/v1/circuits/search?backend={backend}&num_qubits=2", headers=alice).json()
    assert {x["run_id"] for x in found["results"]} == {anchor, twin}
    assert client.get(f"/api/v1/circuits/search?backend={backend}&num_qubits=3", headers=alice).json()["count"] == 0


def test_topology_of_the_interaction_graph(alice, bob):
    chain = push_run(alice, qasm=GHZ3, fingerprint=_fp(3, 3))
    r = client.get(f"/api/v1/runs/{chain}/topology", headers=alice).json()
    assert r["source"] == "qasm" and r["n_interactions"] == 2
    assert r["connected_components"] == 1 and r["independent_cycles"] == 0 and r["most_connected_qubit"] == 1
    triangle = push_run(alice, fingerprint=_fp(3, 3), qasm=HEADER + "qreg q[3];\ncx q[0],q[1];\ncx q[1],q[2];\n"
                                                                    "cx q[0],q[2];")
    assert client.get(f"/api/v1/runs/{triangle}/topology", headers=alice).json()["independent_cycles"] == 1
    bare = push_run(alice, qasm=None, fingerprint=_fp(4, 3))
    assert client.get(f"/api/v1/runs/{bare}/topology", headers=alice).json()["source"] == \
        "fingerprint_chain_approximation"
    assert client.get(f"/api/v1/runs/{chain}/topology", headers=bob).status_code == 404


def test_convergence_detects_a_plateau(alice, bob):
    run_id = push_run(alice, circuit_name="vqe")
    energies = [-1 + 1 / (i + 1) for i in range(10)] + [-1.0] * 10
    metrics = [{"name": "energy", "value": v, "step": i} for i, v in enumerate(energies)]
    metrics += [{"name": "accuracy", "value": i / 20, "step": i} for i in range(20)]
    assert client.post(f"/api/v1/runs/{run_id}/metrics", headers=alice, json={"metrics": metrics}).status_code == 201

    r = client.get(f"/api/v1/runs/{run_id}/convergence", headers=alice).json()
    assert r["has_convergence_data"] is True and r["total_steps"] == 20
    energy = r["series"][0]
    assert energy["name"] == "energy" and energy["is_energy"] is True
    assert energy["convergence"]["verdict"] == "converged" and energy["convergence"]["plateau_step"] == 10
    assert r["prognosis"] == "converged" and r["best_energy"] == -1.0 and r["total_improvement"] == 1.0
    accuracy = r["series"][1]
    assert accuracy["convergence"]["verdict"] == "diverging"  # still rising
    fresh = push_run(alice)
    assert client.get(f"/api/v1/runs/{fresh}/convergence", headers=alice).json()["has_convergence_data"] is False
    assert client.get(f"/api/v1/runs/{run_id}/convergence", headers=bob).status_code == 404


def test_decoherence_alert_fires_on_latest_calibration(alice):
    backend = f"ibm_deco_{uuid.uuid4().hex[:6]}"
    push_run(alice, backend=backend, calibration={"avg_t1_us": 40.0, "avg_readout_error": 0.02})
    assert client.post("/api/v1/decoherence-alerts", json={"backend": backend, "metric": "mood",
                                                          "threshold": 1}).status_code == 422
    assert client.post("/api/v1/decoherence-alerts", json={"backend": backend, "metric": "t1", "threshold": 1,
                                                          "condition": "sideways"}).status_code == 422
    low = client.post("/api/v1/decoherence-alerts", json={"backend": backend, "metric": "t1",
                                                         "threshold": 50}).json()
    high = client.post("/api/v1/decoherence-alerts", json={"backend": backend, "metric": "readout_error",
                                                          "threshold": 0.05, "condition": "above"}).json()
    fired = client.post(f"/api/v1/decoherence-alerts/{low['alert_id']}/check", headers=alice).json()
    assert fired["fired"] is True and fired["current_value"] == 40.0 and fired["triggered"] is True
    assert fired["message"] == "t1 = 40.0000 is below threshold 50.0"
    quiet = client.post(f"/api/v1/decoherence-alerts/{high['alert_id']}/check", headers=alice).json()
    assert quiet["fired"] is False and quiet["current_value"] == 0.02
    listed = client.get(f"/api/v1/decoherence-alerts?backend={backend}&triggered=true").json()
    assert [a["alert_id"] for a in listed] == [low["alert_id"]]
    assert client.delete(f"/api/v1/decoherence-alerts/{low['alert_id']}").status_code == 204
    assert client.get(f"/api/v1/decoherence-alerts/{low['alert_id']}").status_code == 404


def test_device_fingerprint_detects_drift(alice, bob):
    backend = f"ibm_dev_{uuid.uuid4().hex[:6]}"
    start = datetime.now(timezone.utc) - timedelta(days=3)
    for i, t1 in enumerate((100.0, 100.0, 50.0, 50.0)):
        push_run(alice, backend=backend, calibration={"avg_t1_us": t1},
                 created_at=(start + timedelta(hours=i)).isoformat())
    r = client.get(f"/api/v1/backends/{backend}/device-fingerprint", headers=alice).json()
    assert r["n_runs"] == 4 and r["feature_vector"][0] == 75.0
    t1 = next(f for f in r["features"] if f["name"] == "mean_T1_us")
    assert (t1["early"], t1["recent"], t1["pct_change"], t1["flag"]) == (100.0, 50.0, -50.0, True)
    assert len(r["fingerprint_id"]) == 16
    assert client.get(f"/api/v1/backends/{backend}/device-fingerprint", headers=bob).status_code == 422
