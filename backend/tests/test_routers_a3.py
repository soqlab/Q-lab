"""Kept routers, group A (3/3): circuit tools and calculators, and the records they keep.

These take their input in the request; the tests check the computed values against hand-worked
results and that what is stored can be read back.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import uuid

import pytest

from tests.helpers import BELL, client, make_user, push_run

HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n'


# ── calculators ──────────────────────────────────────────────────────────────

def test_advantage_timeline_for_factoring():
    r = client.post("/api/v1/advantage-timeline", json={"algorithm": "factoring", "problem_size": 1000}).json()
    # n_bits = int(log2(1000)) + 1 = 10 -> 2n + 3 = 23 logical qubits, 23^2 * 40 T gates
    assert r["qubits_needed_logical"] == 23 and r["physical_qubits_needed"] == 23000
    assert r["t_gates_needed"] == 23 * 23 * 40
    assert r["optimistic_year"] <= r["most_likely_year"] <= r["pessimistic_year"]
    assert [p["year"] for p in r["hardware_roadmap"]] == list(range(2025, 2056, 3))
    ready = [p for p in r["hardware_roadmap"] if p["can_run"]]
    assert all(p["logical_qubits"] >= 23 and p["error_rate"] <= 1e-4 for p in ready)
    search = client.post("/api/v1/advantage-timeline", json={"algorithm": "search", "problem_size": 1024}).json()
    assert search["qubits_needed_logical"] == 11
    assert client.post("/api/v1/advantage-timeline", json={"problem_size": 0}).status_code == 422
    keys = {a["key"] for a in client.get("/api/v1/advantage-timeline/algorithms").json()["algorithms"]}
    assert {"factoring", "search", "simulation", "linear_systems"} <= keys


def test_arxiv_feed_filters_and_sorts():
    full = client.post("/api/v1/arxiv-feed", json={}).json()
    cites = [p["citations"] for p in full["papers"]]
    assert cites == sorted(cites, reverse=True) and full["returned"] == min(10, full["total_found"])
    top2 = client.post("/api/v1/arxiv-feed", json={"max_results": 2}).json()
    assert top2["papers"] == full["papers"][:2]
    word = full["papers"][0]["title"].split()[0].lower()
    hit = client.post("/api/v1/arxiv-feed", json={"query": word}).json()
    assert hit["papers"] and all(word in (p["title"] + p["abstract"]).lower() for p in hit["papers"])
    assert client.post("/api/v1/arxiv-feed", json={"max_results": 0}).status_code == 422
    assert {"quant-ph", "cs.LG"} <= {c["id"] for c in client.get("/api/v1/arxiv-feed/categories").json()["categories"]}


def test_bayes_uncertainty_posteriors():
    """Regression: the Beta sampler (Johnk's method) never accepted a sample for a few hundred shots,
    so this request looped for ever and held a worker."""
    p = client.post("/api/v1/bayes-uncertainty/propagate", json={
        "counts": {"00": 900, "11": 100}, "n_shots": 1000, "n_qubits": 2}).json()
    assert p["successes"] == 900 and p["n_shots_used"] == 1000
    assert p["posterior_mean"] == pytest.approx(0.9, abs=0.01)
    lo, hi = p["credible_interval_95"]
    assert lo < 0.9 < hi and hi - lo < 0.06
    assert len(p["posterior_samples"]) == 100

    c = client.post("/api/v1/bayes-uncertainty/compare", json={
        "experiment_a": {"0": 950, "1": 50}, "experiment_b": {"0": 600, "1": 400}}).json()
    assert c["evidence_for_a"] > 0.99 and c["mean_a"] > c["mean_b"] and c["effect_size"] > 0

    u = client.post("/api/v1/bayes-uncertainty/update", json={
        "prior_posterior": {"alpha": 3, "beta": 2}, "new_counts": {"0": 8, "1": 2}, "n_shots": 10}).json()
    assert u["updated_alpha"] == 11 and u["updated_beta"] == 4
    assert client.post("/api/v1/bayes-uncertainty/propagate", json={"counts": {}}).status_code == 422


def test_bloch_sphere_path():
    r = client.post("/api/v1/bloch", json={"gate_sequence": ["h"], "n_frames": 5}).json()
    assert r["final_bloch_vector"] == {"bx": 1.0, "by": 0.0, "bz": 0.0}  # |+>
    assert r["prob_0"] == pytest.approx(0.5) and r["is_pure_state"] is True
    assert len(r["trajectory"]) == 1 + 5
    flip = client.post("/api/v1/bloch", json={"gate_sequence": ["x"], "initial_state": "0"}).json()
    assert flip["final_bloch_vector"]["bz"] == -1.0 and flip["prob_1"] == 1.0
    rot = client.post("/api/v1/bloch", json={"gate_sequence": ["ry(pi/2)"], "n_frames": 5}).json()
    assert rot["final_bloch_vector"]["bx"] == pytest.approx(1.0, abs=1e-6)
    assert client.post("/api/v1/bloch", json={"n_frames": 2}).status_code == 422


def test_channel_capacity_formulas():
    dep = client.post("/api/v1/channel-capacity", json={"channel": "depolarizing", "p_err": 0.1}).json()
    h = lambda p: -p * math.log2(p) - (1 - p) * math.log2(1 - p)  # noqa: E731
    assert dep["quantum_capacity_qubits_per_use"] == round(max(0.0, 1 - 2 * h(0.1)), 6)
    assert dep["error_rates"] == {"X": round(0.1 / 3, 6), "Y": round(0.1 / 3, 6), "Z": round(0.1 / 3, 6)}
    assert dep["threshold_error_rate"] == 0.25 and dep["above_threshold"] is True


def test_erasure_threshold_uses_the_erasure_probability():
    """Regression: the erasure channel compared p_err (a depolarizing parameter) with its threshold,
    so a channel erasing 60% of qubits was reported as below threshold."""
    r = client.post("/api/v1/channel-capacity", json={"channel": "erasure", "epsilon": 0.6}).json()
    assert r["classical_capacity_bits_per_use"] == 0.4 and r["quantum_capacity_qubits_per_use"] == 0.0
    assert r["error_correction_overhead"] is None
    assert r["threshold_error_rate"] == 0.5 and r["above_threshold"] is False
    ok = client.post("/api/v1/channel-capacity", json={"channel": "erasure", "epsilon": 0.2, "p_err": 0.9}).json()
    assert ok["above_threshold"] is True and ok["total_quantum_bits"] == round(0.6 * 100, 2)


def test_clifford_t_resource_count():
    qasm = HEADER + "qreg q[2];\nh q[0];\nt q[0];\ntdg q[1];\nrz(0.3) q[0];\ncx q[0],q[1];\nmeasure q -> c;"
    r = client.post("/api/v1/clifford-t", json={"qasm": qasm}).json()
    assert r["total_gates"] == 5 and r["t_count"] == 1 + 1 + 4  # rz costs 4 T gates to synthesise
    assert r["clifford_count"] == 2 and r["non_clifford_gate_types"] == ["rz"]
    assert r["estimated_magic_states"] == 6 * 15 and r["recommended_code_distance"] == 3
    clifford = client.post("/api/v1/clifford-t", json={"qasm": BELL}).json()
    assert clifford["is_clifford_only"] is True
    assert any("Gottesman-Knill" in rec for rec in clifford["recommendations"])


def test_complexity_fit_of_width():
    template = HEADER + "qreg q[{n}];\nh q[0];"
    r = client.post("/api/v1/complexity-analyzer", json={"qasm_template": template, "metric": "width",
                                                         "sizes": [2, 4, 6, 8]}).json()
    assert [m["value"] for m in r["measured_values"]] == [2.0, 4.0, 6.0, 8.0]
    assert r["best_fit_class"] == "linear" and r["best_fit_r_squared"] == 1.0
    assert r["predicted_at_100"] == 100.0 and r["is_polynomial"] is True


def test_complexity_depth_respects_gate_order():
    """Regression: a gate was placed in the first layer free of its qubits, even one before a gate it
    must follow, so h q[0]; cx q[0],q[1]; h q[1] came out with depth 2 instead of 3."""
    template = HEADER + "qreg q[{n}];\nh q[0];\ncx q[0],q[1];\nh q[1];"
    r = client.post("/api/v1/complexity-analyzer", json={"qasm_template": template, "metric": "depth",
                                                         "sizes": [2, 3]}).json()
    assert [m["value"] for m in r["measured_values"]] == [3.0, 3.0]


def test_circuit_analyzer_on_bell():
    r = client.post("/api/v1/analyze", json={"qasm": BELL, "circuit_name": "bell"}).json()
    assert r["circuit_name"] == "bell" and r["total_gates"] == 2 and r["circuit_depth"] == 2
    assert r["gate_counts"] == {"h": 1, "cx": 1} and r["multi_qubit_gates"] == 1
    assert r["per_qubit_risk"][0]["total_gate_time_ns"] == 350  # h 50 ns + cx 300 ns
    redundant = HEADER + "qreg q[1];\nh q[0];\nh q[0];"
    assert client.post("/api/v1/analyze", json={"qasm": redundant}).json()["optimization_suggestions"]
    assert client.post("/api/v1/analyze", json={"qasm": HEADER + "qreg q[1];"}).status_code == 422
    batch = client.post("/api/v1/analyze/batch", json=[{"qasm": BELL}] * 21)
    assert batch.status_code == 422


def test_circuit_analyzer_refuses_qubits_outside_the_register():
    """Regression: a gate on a qubit beyond qreg crashed the analyser with an IndexError (500)."""
    r = client.post("/api/v1/analyze", json={"qasm": HEADER + "qreg q[2];\ncx q[0],q[5];"})
    assert r.status_code == 422 and "qubit 5" in r.json()["detail"]


def test_circuit_compiler_targets_native_gates():
    r = client.post("/api/v1/circuits/compile", json={"qasm": BELL, "target_backend": "ibm_brisbane",
                                                      "optimization_level": 1}).json()
    assert r["provider"] == "ibm" and r["warnings"] == []
    gates = {ln.split()[0].split("(")[0] for ln in r["compiled_qasm"].splitlines()
             if ln and not ln.startswith(("OPENQASM", "include", "qreg", "creg", "barrier"))}
    assert gates <= {"cx", "rz", "sx", "x", "id", "measure"} and "cx" in gates
    assert set(r["native_gates_used"]) <= {"cx", "id", "rz", "sx", "x"}
    bad = client.post("/api/v1/circuits/compile", json={"qasm": "not qasm\nx q[0];\nx q[0];",
                                                        "target_backend": "simulator"}).json()
    assert bad["warnings"] and bad["compiled_gate_count"] < bad["original_gate_count"]  # X;X removed
    assert client.post("/api/v1/circuits/compile", json={"qasm": BELL, "optimization_level": 4}).status_code == 422


def test_circuit_debugger_steps_through_bell():
    r = client.post("/api/v1/circuit-debugger", json={"qasm": BELL, "n_shots": 500}).json()
    assert r["n_qubits"] == 2 and r["final_probabilities"] == [0.5, 0.0, 0.0, 0.5]
    assert set(r["measurement_outcomes"]) <= {"00", "11"} and sum(r["measurement_outcomes"].values()) == 500
    assert [s["gate_name"] for s in r["steps"]] == ["h", "cx"]
    assert r["steps"][0]["probabilities"] == [0.5, 0.5, 0.0, 0.0]
    big = HEADER + "qreg q[9];\nh q[0];"
    assert client.post("/api/v1/circuit-debugger", json={"qasm": big}).status_code == 400


def test_code_export_per_framework():
    q = client.post("/api/v1/code-export", json={"qasm": BELL, "framework": "qiskit", "n_shots": 2000}).json()
    assert q["n_qubits"] == 2 and q["n_gates"] == 3  # h, cx, measure
    assert "qc.h(qr[0])" in q["code"] and q["estimated_run_time_s"] == 0.02
    pl = client.post("/api/v1/code-export", json={"qasm": BELL, "framework": "pennylane"}).json()
    assert "qml.CNOT(wires=[0,1])" in pl["code"] and pl["install_command"] == "pip install pennylane"
    assert pl["notes"]
    assert client.post("/api/v1/code-export", json={"qasm": BELL, "framework": "basic"}).status_code == 400


def test_auto_mitigation_selects_and_applies():
    sel = client.post("/api/v1/auto-mitigation/select", json={"n_qubits": 2, "circuit_depth": 10,
                                                              "backend": "ionq_aria"}).json()
    assert sel["strategy"] == "light_readout_zne" and sel["noise_params"]["type"] == "ion_trap"
    assert [t["name"] for t in sel["techniques"]] == ["readout_correction", "ZNE"]
    assert sel["sim_qubits"] == 2 and sel["combined_overhead"] == 3.3
    big = client.post("/api/v1/auto-mitigation/select", json={"n_qubits": 30, "circuit_depth": 10,
                                                              "backend": "ibm_x", "budget_overhead": 2.0}).json()
    assert big["strategy"] == "full_stack_mitigation" and big["sim_qubits"] == 5 and big["combined_overhead"] == 2.0

    applied = client.post("/api/v1/auto-mitigation/apply", json={"recommendation_id": sel["recommendation_id"],
                                                                 "circuit_counts": {"00": 600, "11": 400}}).json()
    assert applied["shots_used"] == 1000 and applied["total_overhead"] == 3.3
    assert set(applied["technique_contributions"]) <= {"readout_correction", "ZNE"}
    history = {h["recommendation_id"] for h in client.get("/api/v1/auto-mitigation/history").json()["recommendations"]}
    assert sel["recommendation_id"] in history
    assert client.post("/api/v1/auto-mitigation/apply", json={"recommendation_id": "x",
                                                              "circuit_counts": {}}).status_code == 404


# ── records kept by the tools ────────────────────────────────────────────────

def test_arxiv_radar_watch_raises_alerts():
    watch = client.post("/api/v1/arxiv-radar/watch", json={"name": "qaoa", "keywords": ["QAOA"],
                                                          "min_relevance": 0.85}).json()
    alerts = client.get(f"/api/v1/arxiv-radar/alerts?watch_id={watch['watch_id']}").json()["alerts"]
    by_paper = {a["paper_arxiv_id"]: a["alert_type"] for a in alerts}
    # 2402.67890 contradicts (0.89 + 0.05 for the keyword); the two confirming papers score >= 0.91.
    assert by_paper == {"2402.67890": "contradiction", "2401.12345": "confirmation", "2405.33333": "confirmation"}
    stored = next(w for w in client.get("/api/v1/arxiv-radar/watches").json()["watches"]
                  if w["watch_id"] == watch["watch_id"])
    assert stored["alert_count"] == 3
    found = client.post("/api/v1/arxiv-radar/search", json={"keywords": ["ZNE"], "min_relevance": 0.85}).json()
    assert [p["arxiv_id"] for p in found["results"]][:1] == ["2401.12345"]
    assert "2403.11111" in {p["arxiv_id"] for p in found["results"]}  # 0.82 + 0.05 for ZNE
    assert client.delete(f"/api/v1/arxiv-radar/watch/{watch['watch_id']}").json() == {"deleted": watch["watch_id"]}
    assert client.delete(f"/api/v1/arxiv-radar/watch/{watch['watch_id']}").status_code == 404


def test_blind_analysis_register_reveal_cancel():
    reg = client.post("/api/v1/blind-analysis/register", json={
        "title": "ZNE helps", "hypothesis": "ZNE lowers error", "methods": "A/B", "primary_outcome": "error"}).json()
    expected = hashlib.sha256(f"ZNE helps|ZNE lowers error|A/B|{reg['registered_at']}".encode()).hexdigest()
    assert reg["status"] == "registered" and reg["blinded_data_hash"] == expected
    reveal = {"effect_size": 0.4, "p_value": 0.01, "confidence_interval": [0.1, 0.7], "result_summary": "yes"}
    assert client.post(f"/api/v1/blind-analysis/{reg['reg_id']}/reveal",
                       json={**reveal, "confidence_interval": [0.1]}).status_code == 422
    out = client.post(f"/api/v1/blind-analysis/{reg['reg_id']}/reveal", json=reveal).json()
    assert out["confirmed_hypothesis"] is True
    stored = client.get(f"/api/v1/blind-analysis/registration/{reg['reg_id']}").json()
    assert stored["status"] == "revealed" and stored["confirmed_hypothesis"] is True
    assert client.post(f"/api/v1/blind-analysis/{reg['reg_id']}/reveal", json=reveal).status_code == 409
    assert client.delete(f"/api/v1/blind-analysis/{reg['reg_id']}").status_code == 409

    other = client.post("/api/v1/blind-analysis/register", json={
        "title": "t", "hypothesis": "h", "methods": "m", "primary_outcome": "o"}).json()
    assert client.delete(f"/api/v1/blind-analysis/{other['reg_id']}").json()["status"] == "cancelled"
    weak = {**reveal, "p_value": 0.2}
    assert client.post(f"/api/v1/blind-analysis/{other['reg_id']}/reveal", json=weak).status_code == 409
    assert client.post("/api/v1/blind-analysis/register", json={
        "title": " ", "hypothesis": "h", "methods": "m", "primary_outcome": "o"}).status_code == 422


def test_cicd_webhook_requires_a_valid_signature():
    """Regression: a request without a signature header skipped verification, so anyone could post
    fake check results to any integration."""
    ci = client.post("/api/v1/cicd/integrations", json={"name": "repo", "repo_url": "https://git.example/r"}).json()
    url = f"/api/v1/cicd/webhook/{ci['integration_id']}"
    body = json.dumps({"after": "abc123", "ref": "refs/heads/main",
                       "commits": [{"added": ["bell.qasm"], "modified": ["README.md"]}]}).encode()
    assert client.post(url, content=body).status_code == 401
    assert client.post(url, content=body, headers={"X-Hub-Signature-256": "sha256=bad"}).status_code == 401
    assert client.post(url, content=body, headers={"X-Gitlab-Token": "wrong"}).status_code == 401
    sig = "sha256=" + hmac.new(ci["webhook_secret"].encode(), body, hashlib.sha256).hexdigest()
    ok = client.post(url, content=body, headers={"X-Hub-Signature-256": sig})
    assert ok.status_code == 200, ok.text
    check = client.get(f"/api/v1/cicd/checks/{ok.json()['check_id']}").json()
    assert check["commit_sha"] == "abc123" and check["branch"] == "main"
    assert check["results"]["qasm_files"] == ["bell.qasm"]
    gitlab = client.post(url, content=b'{"object_kind": "push"}', headers={"X-Gitlab-Token": ci["webhook_secret"]})
    assert gitlab.json()["status"] == "passed"  # no .qasm files: recorded as skipped


def test_cicd_manual_check_against_a_baseline_run():
    baseline = push_run(make_user(prefix="a3ci"), fingerprint={"num_qubits": 2, "depth": 2, "size": 2,
                                                               "non_clifford_ratio": 0.0})
    ci = client.post("/api/v1/cicd/integrations", json={"name": "r", "repo_url": "u",
                                                        "baseline_run_id": baseline}).json()
    deep = HEADER + "qreg q[2];\n" + "cx q[0],q[1];\n" * 40
    r = client.post(f"/api/v1/cicd/integrations/{ci['integration_id']}/check", json={"qasm": deep}).json()
    assert r["new_stats"]["depth"] == 40 and r["new_stats"]["cx_count"] == 40
    by_name = {c["name"]: c for c in r["checks"]}
    # The baseline run belongs to another account, so it is not readable here: no baseline comparison.
    assert "health_snapshot" in by_name
    own = client.post("/api/v1/cicd/integrations", json={"name": "r", "repo_url": "u"}).json()
    flat = client.post(f"/api/v1/cicd/integrations/{own['integration_id']}/check",
                       json={"qasm": HEADER + "qreg q[1];\n"}).json()
    assert flat["status"] == "failed" and flat["checks"][0]["name"] == "qasm_validity"
    assert client.post("/api/v1/cicd/integrations/ci-none/check", json={"qasm": "x"}).status_code == 404


def test_circuit_dna_identifies_equivalent_circuits():
    x_gate = HEADER + "qreg q[2];\ncreg c[2];\nx q[0];\nmeasure q -> c;"
    padded = HEADER + "qreg q[2];\ncreg c[2];\nx q[0];\nh q[1];\nh q[1];\nmeasure q -> c;"
    first = client.post("/api/v1/dna", json={"qasm": x_gate, "circuit_name": "x"}).json()
    assert [s["probability"] for s in first["distribution_signature"]] == [1.0]
    second = client.post("/api/v1/dna", json={"qasm": padded, "circuit_name": "x-padded"}).json()
    assert second["dna_hash"] == first["dna_hash"] and second["is_unique"] is False
    assert first["dna_id"] in {e["dna_id"] for e in second["functionally_equivalent"]}
    assert second["n_gates"] == 3
    looked = client.get(f"/api/v1/dna/lookup/{first['dna_hash']}").json()
    assert {"x", "x-padded"} <= {c["circuit_name"] for c in looked["circuits"]}
    cmp = client.post("/api/v1/dna/compare", json=[{"qasm": x_gate, "circuit_name": "a"},
                                                  {"qasm": padded, "circuit_name": "b"},
                                                  {"qasm": BELL, "circuit_name": "bell"}]).json()
    assert cmp["equivalent_groups"] == [{"dna_hash": first["dna_hash"], "circuits": ["a", "b"]}]
    assert client.post("/api/v1/dna/compare", json=[{"qasm": BELL}]).status_code == 422
    assert client.get("/api/v1/dna/lookup/nohash").status_code == 404


def test_circuit_embed_index_and_search():
    name = f"bell-{uuid.uuid4().hex[:6]}"
    idx = client.post("/api/v1/circuit-embed/index", json={"qasm": BELL, "circuit_name": name}).json()
    assert idx["embedding_dim"] == 26 and idx["description"].startswith("2-qubit")
    r = client.post("/api/v1/circuit-embed/search", json={"query_qasm": BELL, "min_similarity": 0.99}).json()
    match = next(x for x in r["results"] if x["embed_id"] == idx["embed_id"])
    assert match["similarity"] == 1.0 and match["circuit_name"] == name
    t_heavy = HEADER + "qreg q[1];\nt q[0];\nt q[0];\nt q[0];"
    far = client.post("/api/v1/circuit-embed/search", json={"query_qasm": t_heavy, "min_similarity": 0.99}).json()
    assert idx["embed_id"] not in {x["embed_id"] for x in far["results"]}


def test_circuit_evolver_reaches_a_target():
    qasm = HEADER + "qreg q[1];\ncreg c[1];\nh q[0];\nmeasure q -> c;"
    r = client.post("/api/v1/evolver", json={"qasm": qasm, "population_size": 4, "n_generations": 5,
                                              "shots": 64, "target_bitstring": "1", "seed": 3}).json()
    assert len(r["fitness_history"]) == 5
    assert r["best_fitness"] >= r["fitness_history"][0]["best"]
    assert r["best_fitness"] == max(h["best"] for h in r["fitness_history"])
    stored = client.get(f"/api/v1/evolver/{r['run_id']}").json()
    assert stored["evolved_qasm"] == r["evolved_qasm"] and stored["config"]["seed"] == 3
    assert client.post("/api/v1/evolver", json={"qasm": HEADER + "qreg q[1];"}).status_code == 422
    assert client.get("/api/v1/evolver/evo-missing").status_code == 404


def test_marketplace_listing_reviews_and_purchases():
    listing = client.post("/api/v1/circuit-marketplace/listing", json={
        "title": "My ansatz", "description": "d", "circuit_qasm": BELL, "category": "ansatze", "tags": ["vqe"],
        "price_usd": 5.0, "author": "me", "license": "MIT"}).json()
    lid = listing["listing_id"]
    for rating in (5, 3):
        client.post(f"/api/v1/circuit-marketplace/{lid}/review", json={"reviewer": "r", "rating": rating,
                                                                        "comment": "c"})
    got = client.get(f"/api/v1/circuit-marketplace/{lid}").json()
    assert got["rating"] == 4.0 and got["review_count"] == 2 and len(got["reviews"]) == 2
    bought = client.post(f"/api/v1/circuit-marketplace/{lid}/purchase", json={"buyer": "b"}).json()
    assert bought["price_paid_usd"] == 5.0 and bought["circuit_qasm"] == BELL
    assert client.get(f"/api/v1/circuit-marketplace/{lid}").json()["downloads"] == 1
    cheap = client.get("/api/v1/circuit-marketplace?category=ansatze&max_price=6").json()["listings"]
    assert lid in {x["listing_id"] for x in cheap} and all(x["price_usd"] <= 6 for x in cheap)
    assert client.post(f"/api/v1/circuit-marketplace/{lid}/review", json={"reviewer": "r", "rating": 6,
                                                                           "comment": "c"}).status_code == 400
    assert client.post("/api/v1/circuit-marketplace/listing", json={**{k: listing[k] for k in (
        "title", "description", "circuit_qasm", "tags", "price_usd", "author", "license")},
        "category": "magic"}).status_code == 400


def test_templates_only_their_creator_can_delete():
    """Regression: any caller could delete any user's custom template (the owner was never recorded)."""
    alice, bob = make_user(prefix="a3tpl"), make_user(prefix="a3tpl")
    builtin = client.get("/api/v1/templates?builtin_only=true").json()
    assert builtin and all(t["is_builtin"] for t in builtin)
    assert client.delete(f"/api/v1/templates/{builtin[0]['template_id']}", headers=alice).status_code == 403

    name = f"tpl-{uuid.uuid4().hex[:6]}"
    t = client.post("/api/v1/templates", headers=alice, json={"name": name, "qasm": BELL, "n_qubits": 2}).json()
    assert t["is_builtin"] is False and t["use_count"] == 0
    assert client.get(f"/api/v1/templates/{t['template_id']}").json()["use_count"] == 1
    assert [x["template_id"] for x in client.get(f"/api/v1/templates?q={name}").json()] == [t["template_id"]]
    assert client.delete(f"/api/v1/templates/{t['template_id']}", headers=bob).status_code == 403
    assert client.delete(f"/api/v1/templates/{t['template_id']}").status_code == 403
    assert client.delete(f"/api/v1/templates/{t['template_id']}", headers=alice).status_code == 204
    assert client.get(f"/api/v1/templates/{t['template_id']}").status_code == 404
    assert client.post("/api/v1/templates", json={"name": "x", "qasm": BELL, "n_qubits": 0}).status_code == 422


def test_circuit_versions_chain_and_diff():
    family = f"fam-{uuid.uuid4().hex[:6]}"
    v1 = client.post("/api/v1/circuits/versions", json={"circuit_family": family, "qasm": BELL,
                                                        "commit_message": "bell"}).json()
    assert v1["created"] is True and v1["semantic_version"] == "1.0.0"
    again = client.post("/api/v1/circuits/versions", json={"circuit_family": family, "qasm": BELL}).json()
    assert again["created"] is False and again["reason"] == "identical_to_head"
    ghz = BELL.replace("qreg q[2];", "qreg q[3];")
    v2 = client.post("/api/v1/circuits/versions", json={"circuit_family": family, "qasm": ghz}).json()
    assert v2["created"] is True and v2["semantic_version"] == "2.0.0"  # the qubit count changed

    history = client.get(f"/api/v1/circuits/versions/{v2['version_id']}/history").json()["history"]
    assert [h["version_id"] for h in history] == [v2["version_id"], v1["version_id"]]
    diff = client.get(f"/api/v1/circuits/versions/{v1['version_id']}/diff/{v2['version_id']}").json()
    assert diff["diff_stats"]["delta_qubits"] == 1 and "+qreg q[3];" in diff["text_diff"]
    assert diff["is_identical"] is False
    tagged = client.post(f"/api/v1/circuits/versions/{v2['version_id']}/tag", json={"tags": ["paper", "paper"]})
    assert tagged.json()["tags"] == ["paper"]
    fams = {f["circuit_family"]: f for f in client.get("/api/v1/circuits/versions/families").json()}
    assert fams[family]["version_count"] == 2 and fams[family]["head_version"]["version_id"] == v2["version_id"]
    assert client.get("/api/v1/circuits/versions/cv-missing").status_code == 404
