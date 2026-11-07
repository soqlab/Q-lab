"""API tests for kept routers, group B part 2: github_integration .. lab_inventory."""
from __future__ import annotations

import json
import sys
import time
import types
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from tests.helpers import client, make_user, push_run


@pytest.fixture(scope="module")
def alice():
    return make_user(prefix="b2a")


@pytest.fixture(scope="module")
def bob():
    return make_user(prefix="b2b")


def _backend(tag: str) -> str:
    return f"{tag}_{uuid.uuid4().hex[:8]}"


def _at(minutes: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=1) + timedelta(minutes=minutes)).isoformat()


class _Resp:
    def __init__(self, status_code=200, data=None):
        self.status_code, self._data = status_code, data or {}

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


# ── github_integration ───────────────────────────────────────────────────────

@pytest.fixture
def fake_github(monkeypatch):
    from app.routers import github_integration
    calls: list[tuple] = []

    class AsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url, headers=None):
            calls.append(("GET", url, headers))
            ok = headers and headers.get("Authorization") == "token ghp_valid_token"
            return _Resp(200 if ok else 401, {"login": "octocat"})

        async def post(self, url, json=None, headers=None):
            calls.append(("POST", url, json))
            return _Resp(201)

    monkeypatch.setattr(github_integration, "httpx", types.SimpleNamespace(AsyncClient=AsyncClient))
    return calls


def test_github_config_is_admin_only(fake_github, alice):
    """Regression: anyone, even without signing in, could replace the server's GitHub token and repo."""
    cfg = {"github_token": "ghp_valid_token", "repo_owner": "lab", "repo_name": "circuits"}
    assert client.post("/api/v1/github/config", json=cfg).status_code == 401
    assert client.post("/api/v1/github/config", headers=alice, json=cfg).status_code == 403
    assert client.get("/api/v1/github/config").status_code == 401
    assert client.get("/api/v1/github/config", headers=alice).status_code == 403

    admin = make_user(role="admin", prefix="b2gh")
    assert client.post("/api/v1/github/config", headers=admin,
                       json={**cfg, "github_token": "ghp_bad"}).status_code == 400
    saved = client.post("/api/v1/github/config", headers=admin, json=cfg)
    assert saved.status_code == 200 and saved.json()["github_user"] == "octocat"
    shown = client.get("/api/v1/github/config", headers=admin).json()
    assert shown["github_token"] == "ghp_vali***" and shown["repo_name"] == "circuits"


def test_github_pull_request_webhook_comments_on_tagged_runs(fake_github):
    admin = make_user(role="admin", prefix="b2gh2")
    client.post("/api/v1/github/config", headers=admin,
                json={"github_token": "ghp_valid_token", "repo_owner": "lab", "repo_name": "circuits"})
    sha = uuid.uuid4().hex
    push_run(None, tags=[sha], circuit_name="ci-bell")  # uploaded by CI without an account

    ignored = client.post("/api/v1/github/webhook", headers={"X-GitHub-Event": "push"}, json={"action": "x"})
    assert ignored.json()["processed"] is False
    r = client.post("/api/v1/github/webhook", headers={"X-GitHub-Event": "pull_request"},
                    json={"action": "opened", "number": 7, "pull_request": {"head": {"sha": sha}}})
    body = r.json()
    assert body["processed"] is True and body["runs_found"] == 1 and body["comment_posted"] is True
    posted = [c for c in fake_github if c[0] == "POST"]
    assert posted[-1][1] == "https://api.github.com/repos/lab/circuits/issues/7/comments"
    assert "ci-bell" in posted[-1][2]["body"]
    assert client.get(f"/api/v1/github/runs-by-commit/{sha}").json()["count"] == 1


def test_github_comment_and_commit_links_respect_run_visibility(fake_github, alice, bob):
    """Regression: posting a comment with the server's GitHub token needed no sign-in."""
    run_id = push_run(alice)
    assert client.post(f"/api/v1/github/comment-run/{run_id}", json={"pr_number": 1}).status_code == 401
    assert client.post(f"/api/v1/github/comment-run/{run_id}", headers=bob, json={"pr_number": 1}).status_code == 404
    assert client.post(f"/api/v1/github/link-commit/{run_id}", headers=bob,
                       json={"commit_sha": "abc"}).status_code == 404
    linked = client.post(f"/api/v1/github/link-commit/{run_id}", headers=alice, json={"commit_sha": "c0ffee"})
    assert "c0ffee" in linked.json()["tags"]
    assert run_id in {r["run_id"] for r in client.get("/api/v1/github/runs-by-commit/c0ffee",
                                                      headers=alice).json()["runs"]}
    assert client.get("/api/v1/github/runs-by-commit/c0ffee", headers=bob).json()["count"] == 0


# ── grants ───────────────────────────────────────────────────────────────────

def test_grant_report_counts_only_runs_in_the_period(alice, bob):
    """Regression: the start/end dates were never parsed, so every run counted regardless of date."""
    project = f"grant-{uuid.uuid4().hex[:6]}"
    push_run(alice, project=project, created_at="2024-06-01T10:00:00+00:00", execution={"shots": 1000})
    push_run(alice, project=project, created_at="2024-12-31T12:00:00+00:00", execution={"shots": 500},
             status="failed")
    push_run(alice, project=project, created_at="2023-01-01T00:00:00+00:00", execution={"shots": 9999})
    push_run(bob, project=project, created_at="2024-06-02T00:00:00+00:00", execution={"shots": 7})

    bad = client.post("/api/v1/grants", headers=alice, json={"name": "g", "agency": "ACME", "grant_number": "1", "pi_name": "p",
                                              "institution": "i", "start_date": "2024-01-01",
                                              "end_date": "2024-12-31"})
    assert bad.status_code == 422
    grant = client.post("/api/v1/grants", headers=alice, json={"name": "Q", "agency": "NSF", "grant_number": "NSF-1",
                                                "pi_name": "A", "institution": "U", "start_date": "2024-01-01",
                                                "end_date": "2024-12-31", "project_slugs": [project]}).json()
    report = client.get(f"/api/v1/grants/{grant['grant_id']}/report", headers=alice).json()
    s = report["summary"]
    assert s["total_runs"] == 2 and s["successful_runs"] == 1 and s["success_rate"] == 0.5
    assert s["total_shots"] == 1500
    assert [m["month"] for m in report["by_month"]] == ["2024-06", "2024-12"]
    gid = grant["grant_id"]
    assert "owner" not in grant and "owner" not in report["grant"]
    # Regression: grants were global; anyone, signed out included, could list, read, report on,
    # tag runs to and delete anyone's grants.
    assert client.get("/api/v1/grants").status_code == 401
    assert client.get(f"/api/v1/grants/{gid}").status_code == 401
    assert gid not in {g["grant_id"] for g in client.get("/api/v1/grants", headers=bob).json()}
    for call in (client.get(f"/api/v1/grants/{gid}", headers=bob),
                 client.get(f"/api/v1/grants/{gid}/report", headers=bob),
                 client.get(f"/api/v1/grants/{gid}/report.pdf", headers=bob),
                 client.delete(f"/api/v1/grants/{gid}", headers=bob)):
        assert call.status_code == 404
    assert gid in {g["grant_id"] for g in client.get("/api/v1/grants", headers=alice).json()}
    assert client.delete(f"/api/v1/grants/{gid}", headers=alice).json()["deleted"] is True
    assert client.get(f"/api/v1/grants/{gid}", headers=alice).status_code == 404


# ── hamiltonian_learning ─────────────────────────────────────────────────────

def test_hamiltonian_learns_the_zz_coupling(alice, bob):
    backend = _backend("ham")
    for i in range(5):
        push_run(alice, backend=backend, created_at=_at(i),
                 results={"counts": {"00": 450, "11": 450, "01": 50, "10": 50}})
    r = client.get(f"/api/v1/backends/{backend}/hamiltonian", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_qubits"] == 2 and body["n_runs_used"] == 5
    assert body["magnetisation"] == [0.0, 0.0]
    assert body["couplings"] == [{"i": 0, "j": 1, "J": -0.8, "strength": "strong", "type": "ferromagnetic"}]
    assert client.get(f"/api/v1/backends/{backend}/hamiltonian", headers=bob).status_code == 422

    flat = _backend("ham0")
    for i in range(5):
        push_run(alice, backend=flat, created_at=_at(i),
                 results={"counts": {"00": 25, "01": 25, "10": 25, "11": 25}})
    assert client.get(f"/api/v1/backends/{flat}/hamiltonian", headers=alice).json()["couplings"] == []


# ── hardware_drift ───────────────────────────────────────────────────────────

def test_hardware_drift_reads_sdk_calibration_and_t1_decline_is_degrading(alice):
    """Regression: per-qubit t1_us maps (the SDK's shape) were dropped, and a falling T1 was
    reported as 'improving' because the trend ignored that higher T1 is better."""
    backend = _backend("hd")
    for i, t1 in enumerate([100.0, 95.0, 90.0, 80.0, 70.0, 60.0]):
        push_run(alice, backend=backend, created_at=_at(i),
                 calibration={"t1_us": {"0": t1, "1": t1}, "gate_errors": {"cx_0_1": 0.01, "sx_0": 0.5}})
    ts = client.get(f"/api/v1/hardware-drift/timeseries/{backend}?metric=t1_us", headers=alice).json()
    assert [p["value"] for p in ts["points"]] == [100.0, 95.0, 90.0, 80.0, 70.0, 60.0]
    assert ts["stats"]["trend"] == "degrading"
    gate = client.get(f"/api/v1/hardware-drift/timeseries/{backend}?metric=gate_error_2q", headers=alice).json()
    assert {p["value"] for p in gate["points"]} == {0.01}  # only the two-qubit gate counts

    alerts = client.get(f"/api/v1/hardware-drift/alerts/{backend}", headers=alice).json()["alerts"]
    t1_alert = next(a for a in alerts if a["metric"] == "t1_us")
    assert t1_alert["direction"] == "degraded" and t1_alert["severity"] == "critical"
    assert t1_alert["baseline_value"] == 97.5 and t1_alert["current_value"] == 60.0
    assert client.get(f"/api/v1/hardware-drift/timeseries/{backend}?metric=bogus").status_code == 400


def test_hardware_drift_rising_t1_is_improving(alice):
    backend = _backend("hd2")
    for i, t1 in enumerate([60.0, 70.0, 80.0, 90.0]):
        push_run(alice, backend=backend, created_at=_at(i), calibration={"t1_us": {"0": t1}})
    ts = client.get(f"/api/v1/hardware-drift/timeseries/{backend}?metric=t1_us", headers=alice).json()
    assert ts["stats"]["trend"] == "improving"


# ── hardware_intel ───────────────────────────────────────────────────────────

def test_hardware_status_from_statuspages(monkeypatch):
    from app.routers import hardware_intel

    class AsyncClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url):
            if url.startswith("https://status.quantum.ibm.com"):
                if url.endswith("status.json"):
                    return _Resp(200, {"status": {"indicator": "minor", "description": "Partial outage"}})
                return _Resp(200, {"incidents": [{"name": "Queue delays", "status": "investigating",
                                                  "impact": "minor"}]})
            raise ConnectionError("unreachable")

    monkeypatch.setattr(hardware_intel, "httpx", types.SimpleNamespace(AsyncClient=AsyncClient))
    assert client.delete("/api/v1/intel/hardware-status/cache").json() == {"cleared": True}
    ibm = client.get("/api/v1/intel/hardware-status/ibm").json()
    assert ibm["status"] == "degraded" and ibm["description"] == "Partial outage"
    assert ibm["incidents"][0]["name"] == "Queue delays"
    everyone = {p["id"]: p for p in client.get("/api/v1/intel/hardware-status").json()}
    assert set(everyone) == {"ibm", "ionq", "rigetti", "braket", "quantinuum"}
    assert everyone["ionq"]["status"] == "unknown" and "unreachable" in everyone["ionq"]["error"]
    assert client.get("/api/v1/intel/hardware-status/dwave").status_code == 404
    client.delete("/api/v1/intel/hardware-status/cache")


# ── hardware_jobs ────────────────────────────────────────────────────────────

def test_hardware_jobs_belong_to_the_submitter(alice, bob):
    """Regression: every caller, signed in or not, could list and cancel everyone's jobs."""
    from app.database import SessionLocal
    from app.store import store_get, store_put

    job = client.post("/api/v1/hardware-jobs", headers=alice,
                      json={"qasm": 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\n'
                                    'h q[0];\ncx q[0],q[1];\nmeasure q -> c;', "n_shots": 200}).json()
    assert job["status"] == "queued" and job["is_real"] is False and "_qasm" not in job
    jid = job["job_id"]
    assert jid in {j["job_id"] for j in client.get("/api/v1/hardware-jobs", headers=alice).json()["jobs"]}
    assert jid not in {j["job_id"] for j in client.get("/api/v1/hardware-jobs", headers=bob).json()["jobs"]}
    assert jid not in {j["job_id"] for j in client.get("/api/v1/hardware-jobs").json()["jobs"]}
    assert client.get(f"/api/v1/hardware-jobs/{jid}", headers=bob).status_code == 404
    assert client.delete(f"/api/v1/hardware-jobs/{jid}", headers=bob).status_code == 404

    # Let the simulated queue time pass: the job then runs the circuit locally.
    with SessionLocal() as db:
        stored = store_get(db, "hardware_jobs", jid)
        stored["_submitted_ts"] = time.time() - 60
        store_put(db, "hardware_jobs", jid, stored)
    done = client.get(f"/api/v1/hardware-jobs/{jid}", headers=alice).json()
    assert done["status"] == "completed" and done["total_shots"] == 200
    assert set(done["counts"]) <= {"00", "11"}
    assert client.delete(f"/api/v1/hardware-jobs/{jid}", headers=alice).status_code == 400
    assert client.post("/api/v1/hardware-jobs", json={"qasm": "x", "backend": "nope"}).status_code == 400


# ── hardware_rec ─────────────────────────────────────────────────────────────

def test_hardware_recommendation_scores_the_latest_calibration(alice, bob):
    """Regression: a backend with two calibrated runs crashed (naive vs aware datetime compare)."""
    backend = _backend("rec")
    old = {"q0": {"T1": 10, "cx_error": 0.2, "readout_error": 0.3}, "q1": {"T1": 10, "cx_error": 0.2}}
    new = {"q0": {"T1": 100, "cx_error": 0.01, "readout_error": 0.02},
           "q1": {"T1": 100, "cx_error": 0.01, "readout_error": 0.02}}
    push_run(alice, backend=backend, created_at=_at(0), calibration=old)
    push_run(alice, backend=backend, created_at=_at(5), calibration=new)

    r = client.post("/api/v1/hardware/recommend", headers=alice,
                    json={"num_qubits": 2, "depth": 10, "two_qubit_gate_count": 10, "circuit_time_us": 1.0})
    assert r.status_code == 200, r.text
    rec = next(b for b in r.json()["backends"] if b["backend"] == backend)
    expected = 100 - min(50, (1 - 0.99 ** 10) * 200) - min(15, (1 - 0.98 ** 2) * 60)
    assert rec["score"] == round(expected, 1) and rec["grade"] == "B+"
    assert rec["calibration_summary"]["num_qubits_calibrated"] == 2

    too_big = client.post("/api/v1/hardware/recommend", headers=alice, json={"num_qubits": 3, "depth": 1}).json()
    assert next(b for b in too_big["backends"] if b["backend"] == backend)["ineligible"] is True
    bobs = client.post("/api/v1/hardware/recommend", headers=bob, json={"num_qubits": 2, "depth": 1}).json()
    assert backend not in {b["backend"] for b in bobs["backends"]}
    listed = {b["backend"]: b for b in client.get("/api/v1/hardware/backends", headers=alice).json()["backends"]}
    assert listed[backend]["run_count"] == 2


# ── health_trend ─────────────────────────────────────────────────────────────

def test_health_trend_buckets_completed_runs(alice, bob):
    project = f"ht-{uuid.uuid4().hex[:6]}"
    for _ in range(3):
        push_run(alice, project=project)
    push_run(alice, project=project, status="failed")
    r = client.get(f"/api/v1/analytics/health-trend?project={project}", headers=alice).json()
    assert r["total_runs"] == 3  # failed runs are left out
    assert sum(p["run_count"] for p in r["points"]) == 3
    for p in r["points"]:
        assert p["min_health"] <= p["avg_health"] <= p["max_health"]
    assert client.get(f"/api/v1/analytics/health-trend?project={project}", headers=bob).json()["total_runs"] == 0
    assert client.get("/api/v1/analytics/health-trend?granularity=minute").status_code == 422


# ── hypotheses ───────────────────────────────────────────────────────────────

def test_hypothesis_links_runs_without_duplicates(alice, bob):
    """Regression: linking the same run twice added the evidence twice, and any run id was accepted."""
    hyp = client.post("/api/v1/hypotheses/", json={"title": "T1 limits fidelity",
                                                   "statement": "Fidelity falls with depth"}).json()
    assert hyp["status"] == "draft" and hyp["confidence"] == 0.5
    hid = hyp["hyp_id"]
    run_id = push_run(alice)
    for _ in range(2):
        linked = client.post(f"/api/v1/hypotheses/{hid}/link-run", headers=alice, json={"run_id": run_id})
        assert linked.status_code == 200, linked.text
    assert linked.json()["linked_run_ids"] == [run_id]
    assert linked.json()["evidence_for"] == [f"Run {run_id[:8]}"]
    assert client.post(f"/api/v1/hypotheses/{hid}/link-run", headers=bob, json={"run_id": run_id}).status_code == 404
    assert client.post(f"/api/v1/hypotheses/{hid}/link-run", headers=alice,
                       json={"run_id": "no-such-run"}).status_code == 404

    upd = client.patch(f"/api/v1/hypotheses/{hid}", json={"status": "confirmed", "p_value": 0.01}).json()
    assert upd["status"] == "confirmed" and upd["p_value"] == 0.01
    assert hid in {h["hyp_id"] for h in client.get("/api/v1/hypotheses/?status=confirmed").json()["hypotheses"]}
    assert client.delete(f"/api/v1/hypotheses/{hid}").json() == {"deleted": hid}
    assert client.get(f"/api/v1/hypotheses/{hid}").status_code == 404


# ── hypothesis_engine ────────────────────────────────────────────────────────

def test_chi_squared_statistic():
    same = client.post("/api/v1/hypothesis", json={"test": "chi_squared", "observed": [500, 500],
                                                   "expected": [500, 500]}).json()
    assert same["test_statistic"] == 0.0 and same["reject_null"] is False
    skewed = client.post("/api/v1/hypothesis", json={"test": "chi_squared", "observed": [900, 100],
                                                     "expected": [500, 500]}).json()
    assert skewed["test_statistic"] == pytest.approx(640.0)
    assert skewed["reject_null"] is True and skewed["p_value"] < 1e-6


def test_chi_squared_p_value_for_large_statistics():
    """Regression: the incomplete-gamma series stopped after 100 terms, so a large chi-squared
    (here 640, or 320 per bin) came out with p close to 1 and the null was not rejected."""
    mid = client.post("/api/v1/hypothesis", json={"test": "chi_squared", "observed": [600, 400],
                                                  "expected": [500, 500]}).json()
    assert mid["test_statistic"] == pytest.approx(40.0)
    assert mid["p_value"] == 0.0 and mid["reject_null"] is True  # the API rounds p to 6 places
    from app.routers.hypothesis_engine import _chi2_p_value
    assert _chi2_p_value(40.0, 1) == pytest.approx(2.5396e-10, rel=1e-3)  # scipy.stats.chi2.sf(40, 1)
    assert _chi2_p_value(11.07, 5) == pytest.approx(0.05, abs=1e-4)
    assert mid["critical_value"] == pytest.approx(3.8415, abs=1e-3)


def test_hypothesis_engine_rejects_unknown_tests_and_bad_input():
    """Regression: an unknown test name silently ran chi-squared, and one bin gave a 500."""
    assert client.post("/api/v1/hypothesis", json={"test": "anova", "observed": [1, 2]}).status_code == 422
    assert client.post("/api/v1/hypothesis", json={"test": "chi_squared", "observed": [5]}).status_code == 422


# ── insights ─────────────────────────────────────────────────────────────────

def _add_ai_key(headers):
    r = client.post("/api/v1/credentials", headers=headers,
                    json={"provider": "anthropic", "label": "test", "api_key": "sk-ant-test-0000"})
    assert r.status_code == 200, r.text


def test_insights_need_a_key_then_are_generated_and_cached(alice, bob, monkeypatch):
    from app import ai_provider
    run_id = push_run(alice, circuit_name="insight-bell")
    user = make_user(prefix="b2ai")
    own = push_run(user, circuit_name="insight-bell")
    assert client.post(f"/api/v1/runs/{own}/insights/generate", headers=user).status_code == 503

    prompts = []

    def fake_complete(prompt, api_key, system, max_tokens, model):
        prompts.append((prompt, api_key))
        return '```json\n{"summary": "Bell state looks clean", "score": 9}\n```'

    monkeypatch.setattr(ai_provider, "_anthropic_complete", fake_complete)
    _add_ai_key(user)
    gen = client.post(f"/api/v1/runs/{own}/insights/generate", headers=user)
    assert gen.status_code == 200, gen.text
    assert gen.json()["summary"] == "Bell state looks clean" and gen.json()["cached"] is False
    assert prompts[0][1] == "sk-ant-test-0000"  # the user's own key
    cached = client.get(f"/api/v1/runs/{own}/insights", headers=user).json()
    assert cached["cached"] is True and cached["score"] == 9
    again = client.post(f"/api/v1/runs/{own}/insights/generate", headers=user).json()
    assert again["cached"] is True and len(prompts) == 1

    assert client.post(f"/api/v1/runs/{run_id}/insights/generate").status_code == 401
    assert client.post(f"/api/v1/runs/{own}/insights/generate", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{own}/insights", headers=bob).status_code == 404


# ── institute_admin ──────────────────────────────────────────────────────────

def test_institute_overview_counts_the_callers_runs():
    user = make_user(prefix="b2inst")
    push_run(user, execution={"shots": 1000})
    push_run(user, execution={"shots": 1000})
    push_run(user, execution={"shots": 1000}, status="failed")
    o = client.get("/api/v1/institute-admin/overview", headers=user).json()
    assert o["total_runs"] == 3 and o["completed_runs"] == 2
    assert o["success_rate"] == pytest.approx(0.6667, abs=1e-4)
    assert o["total_qpu_seconds"] == 0.03 and o["runs_this_month"] == 3
    fresh = make_user(prefix="b2inst2")
    assert client.get("/api/v1/institute-admin/overview", headers=fresh).json()["total_runs"] == 0


# ── lab_assistant ────────────────────────────────────────────────────────────

def test_lab_assistant_chat_and_private_conversations(monkeypatch, bob):
    """Regression: conversations were global: anyone could list, read, continue or delete them."""
    seen: list[dict] = []

    class Messages:
        def create(self, **kw):
            seen.append(kw)
            text = types.SimpleNamespace(type="text", text="Your best run is [Run abcdef12].")
            return types.SimpleNamespace(content=[text], stop_reason="end_turn")

    fake = types.ModuleType("anthropic")
    fake.Anthropic = lambda api_key=None: types.SimpleNamespace(messages=Messages())
    monkeypatch.setitem(sys.modules, "anthropic", fake)

    user = make_user(prefix="b2lab")
    push_run(user, circuit_name="labassist_ghz")
    assert client.post("/api/v1/assistant/chat", json={"message": "hi"}).status_code == 401
    assert client.post("/api/v1/assistant/chat", headers=user, json={"message": "hi"}).status_code == 503
    _add_ai_key(user)
    assert client.post("/api/v1/assistant/chat", headers=user, json={"message": "  "}).status_code == 400

    r = client.post("/api/v1/assistant/chat", headers=user, json={"message": "how did labassist_ghz do?"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cited_runs"] == ["abcdef12"] and body["relevant_run_count"] >= 1
    assert "labassist_ghz" in json.dumps(seen[0]["messages"])
    cid = body["conversation_id"]

    conv = client.get(f"/api/v1/assistant/conversation/{cid}", headers=user).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]
    assert cid in {c["conversation_id"] for c in client.get("/api/v1/assistant/conversations", headers=user).json()}
    assert cid not in {c["conversation_id"] for c in client.get("/api/v1/assistant/conversations",
                                                                headers=bob).json()}
    assert client.get(f"/api/v1/assistant/conversation/{cid}", headers=bob).status_code == 404
    assert client.get(f"/api/v1/assistant/conversation/{cid}").status_code == 404
    assert client.delete(f"/api/v1/assistant/conversation/{cid}", headers=bob).status_code == 404
    _add_ai_key(bob)
    assert client.post("/api/v1/assistant/chat", headers=bob,
                       json={"message": "continue", "conversation_id": cid}).status_code == 404
    assert client.delete(f"/api/v1/assistant/conversation/{cid}", headers=user).json()["deleted"] is True


# ── lab_inventory ────────────────────────────────────────────────────────────

def test_lab_inventory_maintenance_schedule(alice, bob):
    item = {"name": "Dilution fridge", "category": "cryostat", "model": "BF-LD400", "serial_number": "123",
            "location": "Lab 2", "status": "operational", "purchase_date": "2022-01-01"}
    assert client.post("/api/v1/lab-inventory/item", headers=alice, json={**item, "category": "toaster"}).status_code == 422
    created = client.post("/api/v1/lab-inventory/item", headers=alice, json=item).json()
    iid = created["item_id"]
    assert client.post("/api/v1/lab-inventory/maintenance",
                       headers=alice, json={"item_id": iid, "type": "magic", "description": "d", "performed_by": "p",
                             "duration_hours": 1}).status_code == 422
    log = client.post("/api/v1/lab-inventory/maintenance",
                      headers=alice, json={"item_id": iid, "type": "calibration", "description": "recal", "performed_by": "ann",
                            "duration_hours": 2.5, "next_due": "2020-01-01T00:00:00+00:00"}).json()
    assert log["item_id"] == iid
    got = client.get(f"/api/v1/lab-inventory/item/{iid}", headers=alice).json()
    assert got["last_maintenance"] == log["logged_at"] and got["next_maintenance"] == "2020-01-01T00:00:00+00:00"
    entry = next(s for s in client.get("/api/v1/lab-inventory/schedule", headers=alice).json() if s["item_id"] == iid)
    assert entry["overdue"] is True and entry["type"] == "calibration"
    assert iid in {i["item_id"] for i in client.get("/api/v1/lab-inventory/items?category=cryostat", headers=alice).json()}
    assert client.get("/api/v1/lab-inventory/item/nope", headers=alice).status_code == 404
    # Regression: the inventory was global and needed no sign-in.
    assert client.get("/api/v1/lab-inventory/items").status_code == 401
    assert client.get(f"/api/v1/lab-inventory/item/{iid}", headers=bob).status_code == 404
    assert iid not in {i["item_id"] for i in client.get("/api/v1/lab-inventory/items", headers=bob).json()}
    assert iid not in {s["item_id"] for s in client.get("/api/v1/lab-inventory/schedule", headers=bob).json()}
    assert client.post("/api/v1/lab-inventory/maintenance", headers=bob, json={
        "item_id": iid, "type": "repair", "description": "x", "performed_by": "b", "duration_hours": 1}).status_code == 404
