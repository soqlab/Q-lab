"""API tests for kept routers, group B part 3: landscape .. paper_package."""
from __future__ import annotations

import hashlib
import hmac
import io
import json
import math
import random
import socket
import types
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from tests.helpers import GHZ3, client, make_user, push_run


@pytest.fixture(scope="module")
def alice():
    return make_user(prefix="b3a")


@pytest.fixture(scope="module")
def bob():
    return make_user(prefix="b3b")


def _backend(tag: str) -> str:
    return f"{tag}_{uuid.uuid4().hex[:8]}"


def _days_ago(days: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


# ── landscape ────────────────────────────────────────────────────────────────

def test_landscape_from_logged_metrics(alice, bob):
    run_id = push_run(alice)
    energies = [-1.0, -1.5, -1.2, -1.1]
    metrics = [{"name": "energy", "value": e, "step": i} for i, e in enumerate(energies)]
    metrics += [{"name": "theta", "value": 0.1 * i, "step": i} for i in range(4)]
    assert client.post(f"/api/v1/runs/{run_id}/metrics", headers=alice, json={"metrics": metrics}).status_code == 201
    body = client.get(f"/api/v1/runs/{run_id}/landscape", headers=alice).json()
    assert body["has_landscape_data"] is True
    series = body["series"][0]
    assert series["name"] == "energy" and series["min_value"] == -1.5 and series["min_at_step"] == 1.0
    assert body["param_names"] == ["theta"]
    assert len(body["grid_2d"]["points"]) == 4 and body["grid_2d"]["min_energy"] == -1.5
    # Regression: min_param compared parameters with the energy, so this request returned 500.
    assert body["grid_2d"]["min_param"] == pytest.approx(0.1)
    empty = push_run(alice)
    assert client.get(f"/api/v1/runs/{empty}/landscape", headers=alice).json()["has_landscape_data"] is False
    assert client.get(f"/api/v1/runs/{run_id}/landscape", headers=bob).status_code == 404


# ── literature ───────────────────────────────────────────────────────────────

_ATOM = """<feed xmlns="http://www.w3.org/2005/Atom"><entry>
<id>http://arxiv.org/abs/{id}</id><title>{title}</title><summary>About {term}.</summary>
<author><name>A. Author</name></author></entry></feed>"""


def test_literature_queries_arxiv_for_the_detected_algorithm(alice, bob, monkeypatch):
    from app.routers import literature
    queried = []

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(req, timeout=None):
        queried.append(req.full_url)
        term = parse_qs(urlparse(req.full_url).query)["search_query"][0]
        return Resp(_ATOM.format(id="2401.0000" + str(len(queried)), title=f"Paper {len(queried)}",
                                 term=term).encode())

    monkeypatch.setattr(literature.urllib.request, "urlopen", fake_urlopen)
    run_id = push_run(alice, circuit_name="bell_pair", backend="ibm_brisbane")
    body = client.get(f"/api/v1/runs/{run_id}/literature", headers=alice).json()
    assert body["detected_algorithms"][0] == "bell"
    assert body["search_terms"][0] == "bell" and "ibm superconducting" in body["search_terms"]
    assert "ti:bell AND cat:quant-ph" in parse_qs(urlparse(queried[0]).query)["search_query"][0]
    assert [p["arxiv_id"] for p in body["papers"]] == [f"2401.0000{i + 1}" for i in range(len(queried))]
    assert body["papers"][0]["relevance_reason"] == "Matches detected algorithm pattern: BELL"
    assert client.get(f"/api/v1/runs/{run_id}/literature", headers=bob).status_code == 404


# ── magic ────────────────────────────────────────────────────────────────────

def test_magic_counts_non_clifford_resources(alice):
    run_id = push_run(alice, fingerprint={"num_qubits": 3, "gate_counts": {"h": 2, "t": 10, "tdg": 2,
                                                                          "cx": 4, "rz": 2}})
    m = client.get(f"/api/v1/runs/{run_id}/magic", headers=alice).json()
    assert m["total_gates"] == 20 and m["t_count"] == 12 and m["nc_count"] == 14
    assert m["clifford_fraction"] == 0.3 and m["magic_score"] == 0.7
    assert m["stabilizer_rank_bound"] == 64
    assert m["classical_simulation_cost"] == "sub-exponential (t-sim)"
    assert m["quantum_advantage_regime"] is False
    assert client.get("/api/v1/runs/missing/magic", headers=alice).status_code == 404


# ── meta_analysis ────────────────────────────────────────────────────────────

def test_fixed_effects_meta_analysis():
    def study(effect, se):
        return client.post("/api/v1/meta-analysis/study", json={
            "title": f"s{effect}", "authors": ["x"], "year": 2024, "effect_size": effect, "std_error": se,
            "sample_size": 100, "backend": "b", "metric": "fidelity"}).json()["study_id"]

    a, b = study(1.0, 0.1), study(2.0, 0.2)
    assert client.post("/api/v1/meta-analysis/study", json={
        "title": "bad", "authors": [], "year": 2024, "effect_size": 1, "std_error": 0, "sample_size": 1,
        "backend": "b", "metric": "fidelity"}).status_code == 422
    r = client.post("/api/v1/meta-analysis/analyze", json={"name": "m", "metric": "fidelity",
                                                           "study_ids": [a, b], "model": "fixed"}).json()
    assert r["pooled_effect"] == pytest.approx(1.2)
    assert r["pooled_se"] == pytest.approx(math.sqrt(1 / 125), abs=1e-6)
    assert r["q_statistic"] == pytest.approx(20.0) and r["i_squared"] == pytest.approx(95.0)
    assert [p["weight"] for p in r["forest_plot_data"]] == [80.0, 20.0]
    assert client.get(f"/api/v1/meta-analysis/analysis/{r['analysis_id']}").json()["pooled_effect"] == r["pooled_effect"]
    assert client.post("/api/v1/meta-analysis/analyze", json={"name": "m", "metric": "fidelity",
                                                              "study_ids": [a]}).status_code == 422
    assert client.post("/api/v1/meta-analysis/analyze", json={"name": "m", "metric": "t1",
                                                              "study_ids": [a, b]}).status_code == 422


# ── milestone_predict ────────────────────────────────────────────────────────

def test_milestone_prediction_from_sdk_calibration(alice, bob):
    """Regression: only a flat avg_t1_us key was read, so SDK runs (t1_us maps) gave no T1 trend."""
    backend = _backend("ms")
    for day, t1 in zip(range(5), [100.0, 110.0, 120.0, 130.0, 140.0]):
        push_run(alice, backend=backend, created_at=_days_ago(10 - day),
                 calibration={"t1_us": {"0": t1 - 5, "1": t1 + 5}})
    r = client.get(f"/api/v1/backends/{backend}/milestone-predict", headers=alice)
    assert r.status_code == 200, r.text
    t1 = next(m for m in r.json()["metrics"] if m["key"] == "avg_t1_us")
    assert t1["slope_per_day"] == pytest.approx(10.0, abs=1e-3)
    assert t1["current_value"] == pytest.approx(140.0, abs=0.01)
    assert t1["trend"] == "improving"
    by_value = {m["value"]: m for m in t1["milestones"]}
    assert by_value[100.0]["note"] == "Already achieved"
    assert by_value[500.0]["days"] == 36
    assert client.get(f"/api/v1/backends/{backend}/milestone-predict", headers=bob).status_code == 422


# ── mitigation ───────────────────────────────────────────────────────────────

def test_mitigation_advice_follows_calibration(alice, bob):
    noisy = push_run(alice, fingerprint={"num_qubits": 2, "depth": 10, "size": 10, "gate_counts": {"cx": 3, "h": 7}},
                     calibration={"readout_errors": {"0": 0.06, "1": 0.06}, "gate_errors": {"cx_0_1": 0.01}})
    a = client.get(f"/api/v1/runs/{noisy}/mitigation-advice", headers=alice).json()
    methods = [r["method"] for r in a["recommendations"]]
    assert methods[0] == "MEM" and "ZNE" in methods and "Pauli-Twirling" in methods
    assert a["overall_severity"] == "high"
    assert a["context"]["avg_readout_error"] == 0.06 and a["context"]["n_2q_gates"] == 3

    clean = push_run(alice, calibration={})
    c = client.get(f"/api/v1/runs/{clean}/mitigation-advice", headers=alice).json()
    assert c["recommendation_count"] == 0 and c["top_recommendation"] is None and c["overall_severity"] == "low"
    assert client.get(f"/api/v1/runs/{noisy}/mitigation-advice", headers=bob).status_code == 404


# ── multi_comparisons ────────────────────────────────────────────────────────

def test_multiple_comparison_corrections():
    bonf = client.post("/api/v1/multi-comparisons/correct",
                       json={"p_values": [0.01, 0.04, 0.2], "method": "bonferroni"}).json()
    assert [r["corrected_p"] for r in bonf["results"]] == [0.03, 0.12, 0.6]
    assert bonf["n_significant"] == 1
    bh = client.post("/api/v1/multi-comparisons/correct", json={"p_values": [0.2, 0.01, 0.04]}).json()
    assert {r["label"]: r["corrected_p"] for r in bh["results"]} == {"test_2": 0.03, "test_3": 0.06, "test_1": 0.2}
    assert client.post("/api/v1/multi-comparisons/correct", json={"p_values": [1.5]}).status_code == 400
    assert client.post("/api/v1/multi-comparisons/correct",
                       json={"p_values": [0.1], "labels": ["a", "b"]}).status_code == 400
    assert client.post("/api/v1/multi-comparisons/correct",
                       json={"p_values": [0.1], "method": "magic"}).status_code == 400


# ── nl2qasm ──────────────────────────────────────────────────────────────────

def test_nl2qasm_templates_and_fallback():
    bell = client.post("/api/v1/nl2qasm", json={"description": "Make me a Bell pair"}).json()
    assert bell["circuit_name"] == "Bell State (Φ+)" and bell["n_gates"] == 2 and bell["is_exact_match"]
    fallback = client.post("/api/v1/nl2qasm", json={"description": "something odd", "n_qubits_hint": 3}).json()
    assert fallback["is_exact_match"] is False and fallback["qasm"].count("h q[") == 3


def test_nl2qasm_bounds_the_fallback_size():
    """Regression: n_qubits_hint was unbounded, so one request could build an arbitrarily large string."""
    r = client.post("/api/v1/nl2qasm", json={"description": "something odd", "n_qubits_hint": 1_000_000})
    assert r.status_code == 422


# ── nlq_retrieval ────────────────────────────────────────────────────────────

def test_natural_language_search_ranks_the_matching_run_first(alice, bob):
    """Regression: the endpoint shared GET /api/v1/circuits/search with circuit_search, which is
    registered first, so the /search/natural page never reached it."""
    ghz = push_run(alice, circuit_name="ghz_three", qasm=GHZ3,
                   fingerprint={"num_qubits": 3, "depth": 4, "size": 6, "gate_counts": {"h": 1, "cx": 2}})
    r = client.get("/api/v1/circuits/natural-search?q=3 qubit ghz circuit", headers=alice).json()
    assert r["parsed_features"]["num_qubits"] == 3
    assert r["results"][0]["run_id"] == ghz and "3 qubits" in r["results"][0]["match_reasons"]
    bobs = client.get("/api/v1/circuits/natural-search?q=3 qubit ghz circuit", headers=bob).json()
    assert ghz not in {x["run_id"] for x in bobs["results"]}
    assert client.get("/api/v1/circuits/natural-search").status_code == 422


# ── noise_model_builder ──────────────────────────────────────────────────────

def test_noise_model_from_coherence_times():
    """Regression: per-qubit readout errors had an invented +0.001·i spread, and the returned
    depth-10 fidelity had been overwritten by the quantum-volume loop."""
    r = client.post("/api/v1/noise-model", json={"n_qubits": 4, "t1_us": 100, "t2_us": 80,
                                                 "readout_fidelity": 0.98}).json()
    t1q, t2q = 0.025, 0.2
    p1 = (1 - math.exp(-t1q / 100)) + 0.5 * (1 - math.exp(-t1q / 80))
    p2 = (1 - math.exp(-t2q / 100)) + 0.5 * (1 - math.exp(-t2q / 80))
    assert r["gate_error_1q"]["p_total"] == pytest.approx(p1, abs=1e-8)
    assert r["gate_error_table"]["cx"]["error_rate"] == pytest.approx(p2, abs=1e-8)
    assert {m["p_meas_error"] for m in r["measurement_errors"]} == {0.02}
    expected_d10 = (1 - p1) ** 40 * (1 - p2) ** 15 * 0.98 ** 4
    assert r["estimated_circuit_fidelity_d10"] == pytest.approx(expected_d10, abs=1e-6)
    assert client.post("/api/v1/noise-model", json={"n_qubits": 0}).status_code == 422


# ── noise_router ─────────────────────────────────────────────────────────────

def test_noise_router_moves_to_the_best_qubits():
    qasm = ('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\n'
            'measure q[0] -> c[0];\nmeasure q[1] -> c[1];')
    r = client.post("/api/v1/noise-router", json={"qasm": qasm, "backend": "ibm_nairobi"}).json()
    assert r["optimized_assignment"] == {"0": 2, "1": 4}
    assert "cx q[2],q[4];" in r["optimized_qasm"]
    # Regression: indexed measurements kept the old qubit numbers, measuring the wrong qubits.
    assert "measure q[2] -> c[0];" in r["optimized_qasm"] and "measure q[4] -> c[1];" in r["optimized_qasm"]
    assert r["expected_error_reduction"] > 0


def test_noise_router_rejects_unknown_backend():
    """Regression: an unknown backend silently used ibm_nairobi's qubit table."""
    r = client.post("/api/v1/noise-router", json={"qasm": "qreg q[2];", "backend": "ibm_unknown"})
    assert r.status_code == 422


# ── noise_sim ────────────────────────────────────────────────────────────────

def test_noise_sim_uses_sdk_calibration(alice, bob):
    """Regression: the SDK's calibration shape was not read, so every run got default noise numbers."""
    run_id = push_run(alice, calibration={"t1_us": {"0": 100.0, "1": 200.0}, "t2_us": {"0": 80.0, "1": 90.0},
                                          "readout_errors": {"0": 0.02, "1": 0.04},
                                          "gate_errors": {"cx_0_1": 0.01, "sx_0": 0.001, "sx_1": 0.003}})
    r = client.get(f"/api/v1/runs/{run_id}/noise-sim", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    used = body["analytical"]["parameters_used"]
    assert used["avg_t1_us"] == 150.0 and used["avg_t2_us"] == 85.0
    assert used["avg_ro"] == 0.03 and used["avg_ge_2q"] == 0.01 and used["avg_ge_1q"] == 0.002
    assert body["has_calibration"] is True
    assert [q["qubit"] for q in body["qubit_noise_summary"]] == [0, 1]
    if body["aer_simulation"] is not None:  # qiskit-aer installed
        assert body["aer_simulation"]["shots"] == 2000
        assert body["comparison"]["noisy_sim_vs_real_tvd"] < 0.2
    assert client.get(f"/api/v1/runs/{run_id}/noise-sim", headers=bob).status_code == 404


# ── notes ────────────────────────────────────────────────────────────────────

def test_notes_on_a_run(alice, bob):
    run_id = push_run(alice)
    assert client.post(f"/api/v1/runs/{run_id}/notes", json={"content": "x"}).status_code == 401
    assert client.post(f"/api/v1/runs/{run_id}/notes", headers=alice, json={"content": "  "}).status_code == 422
    note = client.post(f"/api/v1/runs/{run_id}/notes", headers=alice, json={"content": " looks good "}).json()
    assert note["content"] == "looks good" and note["author_name"] == "b3a"
    assert client.patch(f"/api/v1/notes/{note['id']}", headers=bob, json={"content": "hijack"}).status_code == 403
    assert client.delete(f"/api/v1/notes/{note['id']}", headers=bob).status_code == 403
    edited = client.patch(f"/api/v1/notes/{note['id']}", headers=alice, json={"content": "rechecked"}).json()
    assert edited["content"] == "rechecked"
    assert [n["content"] for n in client.get(f"/api/v1/runs/{run_id}/notes", headers=alice).json()] == ["rechecked"]
    assert client.delete(f"/api/v1/notes/{note['id']}", headers=alice).json() == {"deleted": True}
    assert client.delete(f"/api/v1/notes/{note['id']}", headers=alice).status_code == 404


def test_notes_follow_run_visibility(alice, bob):
    """Regression: anyone could read the notes (with author emails) on any run, or add notes to it."""
    run_id = push_run(alice)
    client.post(f"/api/v1/runs/{run_id}/notes", headers=alice, json={"content": "private"})
    assert client.get(f"/api/v1/runs/{run_id}/notes", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{run_id}/notes").status_code == 404
    assert client.post(f"/api/v1/runs/{run_id}/notes", headers=bob, json={"content": "spam"}).status_code == 404


# ── notifications ────────────────────────────────────────────────────────────

def test_webhook_channel_masks_its_secret_and_signs_the_test_message(monkeypatch):
    """Regression: the webhook signing secret was returned in clear by the channel list."""
    from app import outbound
    from app.routers import notifications
    monkeypatch.delenv("QLAB_ALLOW_PRIVATE_URLS", raising=False)
    monkeypatch.setattr(outbound.socket, "getaddrinfo",
                        lambda host, port, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "",
                                                      ("93.184.215.14", port))])
    sent = []

    def fake_post(url, content=None, headers=None, timeout=None):
        sent.append((url, content, headers))
        return httpx.Response(200, request=httpx.Request("POST", url))

    monkeypatch.setattr(notifications.httpx, "post", fake_post)
    secret = "whsec_very_secret_value"
    ch = client.post("/api/v1/notifications/channels", json={
        "name": "ops", "channel_type": "webhook",
        "config": {"url": "https://hooks.example.com/qlab", "secret": secret}}).json()
    listed = next(c for c in client.get("/api/v1/notifications/channels").json() if c["channel_id"] == ch["channel_id"])
    assert secret not in json.dumps(listed) and listed["config"]["url"] == "https://..."

    res = client.post(f"/api/v1/notifications/channels/{ch['channel_id']}/test", json={"message": "ping"}).json()
    assert res["status"] == "sent"
    url, body, headers = sent[-1]
    assert url == "https://hooks.example.com/qlab" and json.loads(body)["data"]["message"] == "ping"
    assert headers["X-Qlab-Signature"] == "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    internal = client.post("/api/v1/notifications/channels", json={
        "name": "bad", "channel_type": "webhook", "config": {"url": "http://localhost:9/x"}}).json()
    monkeypatch.setattr(outbound.socket, "getaddrinfo",
                        lambda host, port, *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))])
    refused = client.post(f"/api/v1/notifications/channels/{internal['channel_id']}/test", json={}).json()
    assert refused["status"] == "failed"
    assert client.post("/api/v1/notifications/channels", json={"name": "x", "channel_type": "pigeon"}).status_code == 422
    assert client.delete(f"/api/v1/notifications/channels/{ch['channel_id']}").status_code == 204


# ── nps ──────────────────────────────────────────────────────────────────────

def test_nps_scores_and_admin_report(alice):
    admin = make_user(role="admin", prefix="b3nps")
    before = client.get("/api/v1/nps", headers=admin).json()
    assert client.post("/api/v1/nps", json={"score": 11}).status_code == 422
    assert client.post("/api/v1/nps", headers=alice, json={"score": 10, "comment": "great"}).status_code == 200
    client.post("/api/v1/nps", json={"score": 3})
    after = client.get("/api/v1/nps", headers=admin).json()
    assert after["total"] == before["total"] + 2
    assert after["promoters"] == before["promoters"] + 1 and after["detractors"] == before["detractors"] + 1
    assert next(i for i in after["items"] if i["comment"] == "great")["user_email"].startswith("b3a_")
    assert client.get("/api/v1/nps", headers=alice).status_code == 403


# ── oauth ────────────────────────────────────────────────────────────────────

def _fake_oauth(monkeypatch, *, github_email=None, google_info=None):
    from app.routers import oauth

    def post(url, **kw):
        return httpx.Response(200, json={"access_token": "provider-token"}, request=httpx.Request("POST", url))

    def get(url, **kw):
        if url == "https://api.github.com/user":
            data = {"login": "octo", "email": None, "name": "Octo Cat"}
        elif url == "https://api.github.com/user/emails":
            data = [{"email": "other@example.com", "primary": False, "verified": True},
                    {"email": github_email, "primary": True, "verified": True}]
        else:
            data = google_info
        return httpx.Response(200, json=data, request=httpx.Request("GET", url))

    monkeypatch.setattr(oauth, "httpx", types.SimpleNamespace(post=post, get=get,
                                                              HTTPStatusError=httpx.HTTPStatusError))


def _token_from(location: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlparse(location).query).items()}


def test_github_sign_in_creates_then_signs_in_the_user(monkeypatch):
    email = f"gh_{uuid.uuid4().hex[:8]}@example.com"
    _fake_oauth(monkeypatch, github_email=email)
    assert "github.com/login/oauth/authorize" in client.get("/auth/github", follow_redirects=False).headers["location"]
    assert client.get("/auth/github/callback?error=denied", follow_redirects=False).headers["location"].endswith(
        "/login?error=oauth_failed")

    first = client.get("/auth/github/callback?code=abc", follow_redirects=False)
    q = _token_from(first.headers["location"])
    assert q["next"] == "/onboarding"
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {q['token']}"}).json()
    assert me["email"] == email and me["name"] == "Octo Cat"
    again = _token_from(client.get("/auth/github/callback?code=def", follow_redirects=False).headers["location"])
    assert again["next"] == "/runs"


def test_google_sign_in_requires_a_verified_email(monkeypatch):
    """Regression: a Google account whose email Google had not verified could sign in as that email."""
    email = f"gg_{uuid.uuid4().hex[:8]}@example.com"
    _fake_oauth(monkeypatch, google_info={"email": email, "name": "G", "verified_email": False})
    r = client.get("/auth/google/callback?code=abc", follow_redirects=False)
    assert r.headers["location"].endswith("/login?error=no_email")
    _fake_oauth(monkeypatch, google_info={"email": email, "name": "G", "verified_email": True})
    ok = _token_from(client.get("/auth/google/callback?code=abc", follow_redirects=False).headers["location"])
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {ok['token']}"}).json()["email"] == email


# ── orcid ────────────────────────────────────────────────────────────────────

def _orcid() -> str:
    digits = "".join(random.choice("0123456789") for _ in range(15))
    total = 0
    for ch in digits:
        total = (total + int(ch)) * 2
    check = (12 - total % 11) % 11
    d = digits + ("X" if check == 10 else str(check))
    return "-".join(d[i:i + 4] for i in range(0, 16, 4))


def test_orcid_connect_and_claim(alice, bob, monkeypatch):
    """Regression: setting ORCID_CLIENT_ID marked every typed-in iD as verified, the check digit was
    not checked, and any run id could be claimed."""
    monkeypatch.setenv("ORCID_CLIENT_ID", "app-id")
    assert client.post("/api/v1/orcid/connect", json={"orcid_id": "0000-0002-1825-0098",
                                                      "display_name": "Bad"}).status_code == 422
    assert client.post("/api/v1/orcid/connect", json={"orcid_id": "0000-0002-1825-0097",
                                                      "display_name": "Josiah"}).status_code == 200
    orcid = _orcid()
    prof = client.post("/api/v1/orcid/connect", json={"orcid_id": orcid, "display_name": "Ann"}).json()
    assert prof["verified"] is False and prof["run_ids"] == []

    run_id = push_run(alice, circuit_name="claimed")
    assert client.post(f"/api/v1/orcid/claim/{run_id}", headers=bob, json={"orcid_id": orcid}).status_code == 404
    claimed = client.post(f"/api/v1/orcid/claim/{run_id}", headers=alice, json={"orcid_id": orcid}).json()
    assert claimed["run_ids"] == [run_id]
    runs = client.get(f"/api/v1/orcid/researcher/{orcid}/runs", headers=alice).json()
    assert runs["run_count"] == 1 and runs["runs"][0]["circuit_name"] == "claimed"
    assert client.get(f"/api/v1/orcid/profile/{_orcid()}").status_code == 404


# ── outcome_predictor ────────────────────────────────────────────────────────

def test_predicted_health_is_not_invented_without_history(alice):
    """Regression: with fewer than 5 runs the endpoint answered predicted_health=50.0."""
    r = client.post("/api/v1/predict/health-score", headers=alice,
                    json={"backend": _backend("empty"), "n_qubits": 2, "circuit_depth": 3}).json()
    assert r["predicted_health"] is None and r["n_training_runs"] == 0


def test_prediction_and_readiness_use_the_backends_history(alice, bob):
    """Regression: the readiness query averaged the default T1/T2/errors into the recent values."""
    backend = _backend("pred")
    for i in range(2):
        push_run(alice, backend=backend, created_at=_days_ago(5 - i), calibration={"t1_us": 50.0},
                 results={"health_score": 30.0})
    for i in range(3):
        push_run(alice, backend=backend, created_at=_days_ago(1 - i * 0.1), calibration={"t1_us": 300.0},
                 results={"health_score": 90.0})
    p = client.post("/api/v1/predict/health-score", headers=alice,
                    json={"backend": backend, "n_qubits": 2, "circuit_depth": 10, "t1_us": 300.0}).json()
    assert p["n_training_runs"] == 5 and p["predicted_health"] == 90.0
    assert {s["health_score"] for s in p["similar_runs"]} == {90.0}
    ready = {b["backend"]: b for b in client.get("/api/v1/predict/backends/readiness", headers=alice).json()["backends"]}
    assert ready[backend]["predicted_health"] == 90.0 and ready[backend]["trend"] == "improving"
    assert backend not in {b["backend"] for b in client.get("/api/v1/predict/backends/readiness",
                                                            headers=bob).json()["backends"]}


# ── paper_package ────────────────────────────────────────────────────────────

def test_paper_package_escapes_latex(alice, bob):
    """Regression: a backslash became \\textbackslash\\{\\}, which does not compile."""
    run_id = push_run(alice, circuit_name="a\\b_c&d")
    r = client.get(f"/api/v1/runs/{run_id}/paper-package", headers=alice)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"methods.tex", "results.tex", "calibration.tex", "bibliography.bib", "main.tex", "circuit.qasm"} <= set(
        zf.namelist())
    methods = zf.read("methods.tex").decode()
    assert r"a\textbackslash{}b\_c\&d" in methods
    link = client.get(f"/api/v1/runs/{run_id}/overleaf-link", headers=alice).json()
    assert link["zip_url"].endswith(f"/api/v1/runs/{run_id}/paper-package")
    assert link["overleaf_url"].startswith("https://www.overleaf.com/docs?snip_uri=http")
    assert client.get(f"/api/v1/runs/{run_id}/paper-package", headers=bob).status_code == 404
