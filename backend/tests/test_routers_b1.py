"""API tests for kept routers, group B part 1: dispatch .. gdpr.

Every test goes through the TestClient against the in-memory database. Only outbound network
calls are replaced, at the boundary.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.helpers import client, make_user, push_run

ONE_QUBIT_X = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[1];\nx q[0];\nmeasure q[0] -> c[0];'


@pytest.fixture(scope="module")
def alice():
    return make_user(prefix="b1a")


@pytest.fixture(scope="module")
def bob():
    return make_user(prefix="b1b")


def _backend(tag: str) -> str:
    return f"{tag}_{uuid.uuid4().hex[:8]}"


def _at(minutes: int) -> str:
    base = datetime.now(timezone.utc) - timedelta(days=1)
    return (base + timedelta(minutes=minutes)).isoformat()


# ── dispatch ─────────────────────────────────────────────────────────────────

@pytest.fixture
def dispatch_queue(tmp_path, monkeypatch):
    from app.routers import dispatch
    monkeypatch.setattr(dispatch, "_QUEUE_FILE", tmp_path / "dispatch_queue.json")
    return dispatch


def test_dispatch_releases_when_sdk_calibration_meets_threshold(alice, bob, dispatch_queue):
    """Regression: thresholds looked for avg_t1_us only, so the SDK's per-qubit t1_us map never
    satisfied any threshold."""
    backend = _backend("disp")
    push_run(alice, backend=backend, calibration={"t1_us": {"0": 150.0, "1": 250.0}})

    met = client.post("/api/v1/dispatch/queue", headers=alice,
                      json={"circuit_name": "bell", "backend": backend, "thresholds": {"min_t1_us": 180}})
    assert met.status_code == 201, met.text
    assert met.json()["status"] == "released"
    assert met.json()["release_reason"] == "calibration_met_at_enqueue"

    unmet = client.post("/api/v1/dispatch/queue", headers=alice,
                        json={"circuit_name": "bell", "backend": backend, "thresholds": {"min_t1_us": 300}})
    body = unmet.json()
    assert body["status"] == "pending"
    assert body["calibration_failures"] == ["avg_t1_us=200.0 < required 300.0"]

    # Bob cannot see Alice's calibration, so for him the threshold has nothing to check against.
    bobs = client.post("/api/v1/dispatch/queue", headers=bob,
                       json={"circuit_name": "x", "backend": backend, "thresholds": {"min_t1_us": 1}}).json()
    assert bobs["calibration_failures"] == ["avg_t1_us not present in calibration"]

    entry = body["entry_id"]
    listed = client.get(f"/api/v1/dispatch/queue?backend={backend}&status=pending", headers=alice).json()
    assert entry in {e["id"] for e in listed["entries"]} and "owner" not in listed["entries"][0]
    # Regression: the queue was global and needed no sign-in; anyone could list, release or cancel
    # anyone's entries (and their webhook URLs).
    assert client.get("/api/v1/dispatch/queue").status_code == 401
    assert client.post("/api/v1/dispatch/queue", json={"circuit_name": "x", "backend": backend}).status_code == 401
    bob_view = client.get(f"/api/v1/dispatch/queue?backend={backend}", headers=bob).json()
    assert entry not in {e["id"] for e in bob_view["entries"]} and bob_view["total"] == 1
    assert client.post(f"/api/v1/dispatch/queue/{entry}/release", headers=bob).status_code == 404
    assert client.delete(f"/api/v1/dispatch/queue/{entry}", headers=bob).status_code == 404
    assert client.post("/api/v1/dispatch/check", headers=bob).json()["checked"] == 1  # only his own entry
    released = client.post(f"/api/v1/dispatch/queue/{entry}/release", headers=alice)
    assert released.json()["release_reason"] == "manual_release"
    assert client.post(f"/api/v1/dispatch/queue/{entry}/release", headers=alice).status_code == 409
    assert client.delete(f"/api/v1/dispatch/queue/{entry}", headers=alice).status_code == 409
    assert client.delete("/api/v1/dispatch/queue/dq_missing", headers=alice).status_code == 404
    assert client.get("/api/v1/dispatch/queue?status=bogus", headers=alice).status_code == 422


def test_dispatch_check_releases_once_calibration_improves(alice, dispatch_queue):
    backend = _backend("disp2")
    push_run(alice, backend=backend, calibration={"readout_errors": {"0": 0.2}}, created_at=_at(0))
    entry = client.post("/api/v1/dispatch/queue", headers=alice,
                        json={"circuit_name": "c", "backend": backend,
                              "thresholds": {"max_readout_error": 0.05}}).json()
    assert entry["status"] == "pending"
    assert client.post("/api/v1/dispatch/check", headers=alice).json()["released"] == 0
    push_run(alice, backend=backend, calibration={"readout_errors": {"0": 0.01}}, created_at=_at(5))
    check = client.post("/api/v1/dispatch/check", headers=alice).json()
    assert check["released_ids"] == [entry["entry_id"]]
    assert check["still_pending"] == 0


# ── drift_changepoint ────────────────────────────────────────────────────────

def test_drift_changepoint_finds_the_recalibration(alice, bob):
    backend = _backend("cp")
    for i in range(16):
        t1 = 100.0 if i < 8 else 50.0
        push_run(alice, backend=backend, created_at=_at(i),
                 calibration={"t1_us": {"0": t1, "1": t1}, "t2_us": {"0": t1 / 2}})
    r = client.get(f"/api/v1/backends/{backend}/drift-changepoints", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_runs_analysed"] == 16
    assert body["n_changepoints"] == 1
    cp = body["changepoints"][0]
    assert cp["index"] == 8 and cp["votes"] == 2
    assert cp["metric_shifts"]["avg_t1_us"]["pct_change"] == -50.0
    assert cp["metric_shifts"]["avg_t1_us"]["direction"] == "degradation"
    assert body["trust_window"]["from_index"] == 8 and body["trust_window"]["n_runs"] == 8
    # The calibration history is Alice's.
    assert client.get(f"/api/v1/backends/{backend}/drift-changepoints", headers=bob).status_code == 404


# ── entanglement_cert ────────────────────────────────────────────────────────

def test_entanglement_cert_bell_vs_product_state(alice, bob):
    bell = push_run(alice, results={"counts": {"00": 500, "11": 500}})
    product = push_run(alice, results={"counts": {"00": 250, "01": 250, "10": 250, "11": 250}})

    b = client.get(f"/api/v1/runs/{bell}/entanglement-cert", headers=alice).json()
    assert b["pairwise_mi"][0]["mi"] == 1.0
    assert b["correlation_matrix"][0][1] == 1.0
    assert b["entanglement_score"] == 1.0 and b["tier"] == "strongly entangled"
    assert b["total_entropy_bits"] == 1.0

    p = client.get(f"/api/v1/runs/{product}/entanglement-cert", headers=alice).json()
    assert p["pairwise_mi"][0]["mi"] == 0.0 and p["tier"] == "no detected correlations"
    assert p["total_entropy_bits"] == 2.0
    assert p["schmidt_rank_lb"] == 1  # regression: no correlations at all divided by zero (500)

    no_counts = push_run(alice, results={})
    assert client.get(f"/api/v1/runs/{no_counts}/entanglement-cert", headers=alice).status_code == 422
    assert client.get(f"/api/v1/runs/{bell}/entanglement-cert", headers=bob).status_code == 404


# ── estimator ────────────────────────────────────────────────────────────────

def test_estimate_from_fingerprint_and_calibration(alice, bob):
    run_id = push_run(alice, fingerprint={"num_qubits": 2, "depth": 3, "size": 4,
                                          "gate_counts": {"h": 1, "cx": 1, "measure": 2}},
                      calibration={"gate_errors": {"cx_0_1": 0.01, "sx_0": 0.001},
                                   "readout_errors": {"0": 0.02, "1": 0.04}})
    est = client.get(f"/api/v1/runs/{run_id}/estimate", headers=alice).json()
    fid = est["fidelity_estimate"]
    assert fid["gate_fidelity"] == pytest.approx((1 - 0.0055) ** 4, abs=1e-5)
    assert fid["readout_fidelity"] == pytest.approx(0.97 ** 2, abs=1e-5)
    assert fid["bottleneck_gate"] == "cx_0_1"
    assert fid["dominant_error_source"] == "readout_errors"
    assert est["circuit"]["two_qubit_gate_count"] == 1 and est["circuit"]["single_qubit_gate_count"] == 3
    assert est["timing_estimate"]["estimated_circuit_time_us"] == pytest.approx(6.45, abs=0.06)
    assert client.get(f"/api/v1/runs/{run_id}/estimate", headers=bob).status_code == 404


def test_backend_drift_series(alice):
    backend = _backend("est")
    for i, t1 in enumerate([300.0, 200.0, 100.0]):
        push_run(alice, backend=backend, created_at=_at(i), calibration={"t1_us": {"0": t1, "1": t1 + 10}})
    d = client.get(f"/api/v1/backends/{backend}/drift", headers=alice).json()
    assert [p["v"] for p in d["series"]["avg_t1_us"]] == [305.0, 205.0, 105.0]
    assert d["trends"]["avg_t1_us"] == -100.0
    assert d["latest"]["avg_t1_us"] == 105.0
    assert any("T1" in w for w in d["warnings"])


# ── experiment_design ────────────────────────────────────────────────────────

def test_suggest_experiment_needs_four_runs_and_uses_their_health(alice, bob):
    project = f"design-{uuid.uuid4().hex[:6]}"
    ids = [push_run(alice, project=project, fingerprint={"num_qubits": q, "depth": d, "size": d * 2,
                                                        "gate_counts": {"cx": d}},
                    parameters={"shots": s})
           for q, d, s in ((2, 3, 1024), (3, 10, 2048), (4, 20, 4096), (5, 40, 512))]
    healths = [client.get(f"/api/v1/runs/{i}", headers=alice).json()["health_score"] for i in ids]
    r = client.get(f"/api/v1/projects/{project}/suggest-experiment?n=3", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_training_runs"] == 4
    assert body["best_health_seen"] == round(max(healths), 1)
    assert len(body["suggestions"]) == 3
    eis = [s["expected_improvement"] for s in body["suggestions"]]
    assert eis == sorted(eis, reverse=True)
    assert client.get(f"/api/v1/projects/{project}/suggest-experiment", headers=bob).status_code == 422


# ── experiment_registry ──────────────────────────────────────────────────────

def test_registry_publish_star_fork_search(alice, bob):
    title = f"Readout study {uuid.uuid4().hex[:6]}"
    pub = client.post("/api/v1/registry/", headers=alice, json={"title": title, "description": "readout errors on 5 qubits",
                                                  "n_qubits": 5, "tags": ["readout"], "doi": "10.1/x"})
    assert pub.status_code == 200, pub.text
    rid = pub.json()["registry_id"]
    assert pub.json()["stars"] == 0 and pub.json()["reproducibility_badge"] is True

    assert client.post(f"/api/v1/registry/{rid}/star", headers=bob).json() == {"starred": True, "stars": 1}
    assert client.post(f"/api/v1/registry/{rid}/star", headers=bob).json() == {"starred": False, "stars": 1}
    # Regression: stars were counted per ?user= name, so one caller could add any number of them.
    assert client.post(f"/api/v1/registry/{rid}/star?user=someone-else", headers=bob).json()["stars"] == 1
    fork = client.post(f"/api/v1/registry/{rid}/fork?author=bo", headers=bob).json()
    assert fork["forked_from"] == rid and fork["title"] == f"Fork of {title}" and fork["stars"] == 0
    got = client.get(f"/api/v1/registry/{rid}", headers=alice).json()
    assert got["forks"] == 1 and got["views"] == 1

    found = client.post("/api/v1/registry/search", headers=bob, json={"query": title.lower()}).json()
    assert {r["registry_id"] for r in found["results"]} == {rid, fork["registry_id"]}
    assert client.get("/api/v1/registry/does-not-exist", headers=alice).status_code == 404

    # Signed-out callers get nothing; a private entry is its owner's alone (it used to be listed
    # for everyone by GET /registry).
    assert client.get("/api/v1/registry").status_code == 401
    assert client.post("/api/v1/registry/", json={"title": "x", "description": "y"}).status_code == 401
    secret = client.post("/api/v1/registry/", headers=alice, json={
        "title": f"Private {title}", "description": "d", "is_public": False}).json()["registry_id"]
    assert client.get(f"/api/v1/registry/{secret}", headers=alice).status_code == 200
    assert client.get(f"/api/v1/registry/{secret}", headers=bob).status_code == 404
    assert client.post(f"/api/v1/registry/{secret}/fork", headers=bob).status_code == 404
    assert secret not in {e["registry_id"] for e in
                          client.get("/api/v1/registry?limit=1000", headers=bob).json()["experiments"]}
    assert secret in {e["registry_id"] for e in
                      client.get("/api/v1/registry?limit=1000", headers=alice).json()["experiments"]}


# ── fair ─────────────────────────────────────────────────────────────────────

def test_fair_scores_follow_the_stored_metadata(alice, bob):
    project = f"fair-{uuid.uuid4().hex[:6]}"
    rich = push_run(alice, project=project, parameters={"theta": 0.1}, calibration={"t1_us": {"0": 100}},
                    transpiler={"settings": {"optimization_level": 1}}, timing={"submit_time": "x"},
                    tags=["arxiv:2401.00001"])
    bare = push_run(alice, project=project, qasm=None, parameters={}, results={})

    r = client.get(f"/api/v1/fair/check/{rich}", headers=alice).json()
    crit = {c["code"]: c for c in r["criteria"]}
    assert crit["F2"]["passed"] and crit["I1"]["passed"] and crit["I3"]["passed"] and crit["R1"]["passed"]
    assert not crit["F1"]["passed"]  # no DOI minted
    b = client.get(f"/api/v1/fair/check/{bare}", headers=alice).json()
    assert {c["code"]: c["passed"] for c in b["criteria"]}["I1"] is False
    assert b["overall_score"] < r["overall_score"]

    proj = client.get(f"/api/v1/fair/check/project/{project}", headers=alice).json()
    assert proj["run_count"] == 2
    assert proj["overall_score"] == pytest.approx((r["overall_score"] + b["overall_score"]) / 2, abs=0.1)
    assert client.get(f"/api/v1/fair/check/{rich}", headers=bob).status_code == 404
    assert client.get(f"/api/v1/fair/check/project/{project}", headers=bob).status_code == 404


# ── fault_injector ───────────────────────────────────────────────────────────

def test_chaos_phase_flips_do_not_change_z_counts_but_bit_flips_do():
    phase = client.post("/api/v1/chaos", json={"qasm": ONE_QUBIT_X, "fault_type": "phase_flip",
                                               "fault_rate": 0.5, "n_trials": 20, "shots": 64})
    assert phase.status_code == 200, phase.text
    p = phase.json()
    assert p["mean_tvd"] == 0.0 and p["resilience_score"] == 1.0 and p["grade"] == "A"

    bit = client.post("/api/v1/chaos", json={"qasm": ONE_QUBIT_X, "fault_type": "bit_flip",
                                             "fault_rate": 0.5, "n_trials": 20, "shots": 64}).json()
    assert bit["min_fidelity"] == 0.0  # a flipped X gives |0> every shot
    assert bit["resilience_score"] < 1.0
    assert bit["result_id"] in {x["result_id"] for x in client.get("/api/v1/chaos?fault_type=bit_flip").json()}

    assert client.post("/api/v1/chaos", json={"qasm": ONE_QUBIT_X, "fault_type": "gamma_ray"}).status_code == 422
    assert client.post("/api/v1/chaos", json={"qasm": ONE_QUBIT_X, "fault_rate": 0.9}).status_code == 422


# ── federated ────────────────────────────────────────────────────────────────

def test_federated_contribute_validates_and_counts(alice, bob):
    algo = f"algo-{uuid.uuid4().hex[:6]}"
    base = {"algorithm": algo, "backend": "ibm_x", "n_qubits": 4, "circuit_depth": 10, "n_shots": 1000,
            "success_probability": 0.9, "health_score": 80.0, "error_rate": 0.01}
    assert client.post("/api/v1/federated/contribute", headers=alice,
                       json={**base, "success_probability": 1.5}).status_code == 422
    ok = client.post("/api/v1/federated/contribute", headers=alice, json=base)
    assert ok.status_code == 200 and ok.json()["algorithm"] == algo
    # Regression: a hand-typed result was stored as verified=True.
    assert ok.json()["verified"] is False
    # The pool is shared between signed-in users and stays anonymous.
    found = client.get(f"/api/v1/federated/results?algorithm={algo}", headers=bob).json()
    assert found["total"] == 1 and "owner" not in found["results"][0]
    stats = client.get("/api/v1/federated/stats", headers=bob).json()
    assert stats["avg_health_score_by_algorithm"][algo] == 80.0
    # Regression: the registry needed no sign-in, so anyone could flood it.
    assert client.post("/api/v1/federated/contribute", json=base).status_code == 401
    for path in ("/api/v1/federated/results", "/api/v1/federated/stats", "/api/v1/federated/leaderboard"):
        assert client.get(path).status_code == 401


def test_federated_contribution_from_run_reads_sdk_t1(alice, bob):
    """Regression: T1/T2 were read from "t1"/"T1" only, so SDK runs (t1_us maps) contributed none."""
    run_id = push_run(alice, circuit_name="qaoa_maxcut", calibration={"t1_us": {"0": 100.0, "1": 200.0},
                                                                     "t2_us": {"0": 50.0}})
    r = client.post(f"/api/v1/federated/contribute-from-run/{run_id}", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["t1_at_runtime"] == 150.0 and body["t2_at_runtime"] == 50.0
    assert body["algorithm_category"] == "optimization" and body["n_qubits"] == 2
    assert client.post(f"/api/v1/federated/contribute-from-run/{run_id}", headers=bob).status_code == 404


# ── figure_gen ───────────────────────────────────────────────────────────────

def test_figure_generation_requires_sign_in_and_draws_the_data(alice):
    body = {"figure_type": "probability_histogram", "data": {"distribution": {"00": 0.9, "11": 0.1}},
            "title": "Bell"}
    assert client.post("/api/v1/figure-gen", json=body).status_code == 401
    r = client.post("/api/v1/figure-gen", headers=alice, json=body).json()
    svg = r["svg_content"]
    assert svg.startswith("<svg") and "0.900" in svg and "0.100" in svg
    assert r["latex_label"] == "fig:probability-histogram"
    assert "Bell" in r["latex_caption"]


def test_figure_generation_rejects_unknown_type(alice):
    """Regression: an unknown figure_type returned 200 with an SVG saying 'Unknown figure type'."""
    r = client.post("/api/v1/figure-gen", headers=alice, json={"figure_type": "pie_chart"})
    assert r.status_code == 422


# ── gate_char ────────────────────────────────────────────────────────────────

def test_gate_char_fits_t1_from_the_curve():
    backend = _backend("gc")
    curve = [{"x": t, "y": math.exp(-t / 50.0)} for t in range(0, 101, 10)]
    r = client.post("/api/v1/gate-char", json={"backend": backend, "char_type": "t1", "qubit": 0,
                                               "curve_data": curve})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["metric_value"] == pytest.approx(50.0, abs=0.01) and body["metric_unit"] == "us"
    assert body["fit_params"]["r2"] == pytest.approx(1.0, abs=1e-3)
    assert client.get(f"/api/v1/gate-char/{body['char_id']}").json()["metric_value"] == body["metric_value"]
    summary = client.get(f"/api/v1/gate-char/summary/{backend}").json()
    assert [q["char_id"] for q in summary["qubits"]] == [body["char_id"]]
    assert client.get("/api/v1/gate-char/gc-missing").status_code == 404


def test_gate_char_refuses_to_fit_one_point():
    """Regression: with fewer than 2 usable points the fit returned a made-up T1 of 100 µs."""
    r = client.post("/api/v1/gate-char", json={"backend": "b", "char_type": "t1",
                                               "curve_data": [{"x": 0, "y": 1.0}]})
    assert r.status_code == 422
    rb = client.post("/api/v1/gate-char", json={"backend": "b", "char_type": "rb_single",
                                                "curve_data": [{"x": 1, "y": 0.99}]})
    assert rb.status_code == 422
    assert client.post("/api/v1/gate-char", json={"backend": "b", "char_type": "t9",
                                                  "curve_data": []}).status_code == 422


# ── gdpr ─────────────────────────────────────────────────────────────────────

def test_gdpr_export_contains_only_the_callers_runs(alice, bob):
    mine = push_run(alice)
    theirs = push_run(bob)
    assert client.post("/api/v1/gdpr/export/request").status_code == 401
    req = client.post("/api/v1/gdpr/export/request", headers=alice).json()
    export = client.get(req["download_url"], headers=alice)
    assert export.status_code == 200
    run_ids = {r["run_id"] for r in export.json()["runs"]}
    assert mine in run_ids and theirs not in run_ids
    assert client.get(req["download_url"], headers=bob).status_code == 403


def test_gdpr_anonymize_and_deletion_request(alice, bob):
    run_id = push_run(alice, circuit_name="alice-secret",
                      parameters={"author": "Alice", "contact": "a@x.org", "theta": 0.5})
    assert client.post(f"/api/v1/gdpr/anonymize/{run_id}", headers=alice, json={"confirm": False}).status_code == 400
    assert client.post(f"/api/v1/gdpr/anonymize/{run_id}", headers=bob, json={"confirm": True}).status_code == 404
    assert client.post(f"/api/v1/gdpr/anonymize/{run_id}", headers=alice, json={"confirm": True}).status_code == 200
    run = client.get(f"/api/v1/runs/{run_id}", headers=alice).json()
    assert run["circuit_name"].startswith("[ANONYMIZED-") and "alice-secret" not in run["circuit_name"]
    assert run["parameters"] == {"author": "[ANONYMIZED]", "contact": "[ANONYMIZED]", "theta": 0.5}
    assert "anonymized" in run["tags"]

    leaving = make_user(prefix="b1del")  # deleting locks the account, so not the shared alice
    assert client.post("/api/v1/gdpr/delete/request", headers=leaving, json={"confirm": False}).status_code == 400
    assert client.get("/api/v1/gdpr/delete/requests", headers=leaving).status_code == 403
    assert client.post("/api/v1/gdpr/delete/request", headers=leaving,
                       json={"confirm": True}).json()["status"] == "scheduled"


def test_gdpr_retention_policy_deletes_only_old_runs():
    admin = make_user(role="admin", prefix="b1adm")
    researcher = make_user(prefix="b1res")
    project = f"ret-{uuid.uuid4().hex[:6]}"
    old = push_run(admin, project=project, created_at="2020-01-01T00:00:00+00:00")
    new = push_run(admin, project=project)
    assert client.post("/api/v1/gdpr/retention-policy", headers=researcher,
                       json={"name": "x"}).status_code == 403
    policy = client.post("/api/v1/gdpr/retention-policy", headers=admin,
                         json={"name": "30 days", "retain_runs_days": 30, "applies_to_projects": [project]}).json()
    dry = client.post(f"/api/v1/gdpr/retention-policy/{policy['policy_id']}/apply", headers=admin).json()
    assert dry["runs_to_delete"] == 1 and dry["applied"] is False
    assert client.get(f"/api/v1/runs/{old}", headers=admin).status_code == 200
    applied = client.post(f"/api/v1/gdpr/retention-policy/{policy['policy_id']}/apply?dry_run=false",
                          headers=admin).json()
    assert applied["applied"] is True
    assert client.get(f"/api/v1/runs/{old}", headers=admin).status_code == 404
    assert client.get(f"/api/v1/runs/{new}", headers=admin).status_code == 200
