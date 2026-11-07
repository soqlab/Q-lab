"""The rest of the core tracking path in app/main.py: what a stored run turns into.

test_core_tracking.py covers run CRUD, compare, projects, search basics and API keys; this file
covers per-run views and downloads, sharing, metrics/analytics, exports, the HTML pages, the
live stream, search filters and the auth edge cases in app/deps.py. Every view is checked for
its computed values and for not leaking another user's run.
"""
from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import json
import uuid
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from app.database import engine
from sqlalchemy import text

from tests.helpers import BELL, GHZ3, client, make_user, push_run, run_payload, user_id

CAL = {"gate_errors": {"cx_0_1": 0.02}, "readout_errors": {"0": 0.01, "1": 0.03}}
FP = {"num_qubits": 2, "depth": 3, "size": 4, "non_clifford_ratio": 0.25, "gate_counts": {"h": 1, "cx": 1}}
# 0.4 * 90 (best outcome 900/1000) + 0.3 * 98 + 0.2 * 98 + 0.1 * 75
EXPECTED_HEALTH = 92.5


@pytest.fixture(scope="module")
def users():
    return make_user(prefix="corea"), make_user(prefix="coreb")


def _rich_run(headers, **kw) -> str:
    kw.setdefault("results", {"counts": {"00": 900, "11": 100}})
    kw.setdefault("calibration", CAL)
    kw.setdefault("fingerprint", FP)
    return push_run(headers, **kw)


# ── Health score ─────────────────────────────────────────────────────────────

def test_health_score_and_breakdown_are_computed_from_the_run(users):
    alice, bob = users
    run_id = _rich_run(alice)
    body = client.get(f"/api/v1/runs/{run_id}", headers=alice).json()
    assert body["health_score"] == EXPECTED_HEALTH
    hb = client.get(f"/api/v1/runs/{run_id}/health", headers=alice).json()
    assert hb == {
        "success_probability": 90.0, "gate_fidelity": 98.0, "avg_gate_error": 0.02,
        "readout_fidelity": 98.0, "avg_readout_error": 0.02, "circuit_efficiency": 75.0,
        "overall": EXPECTED_HEALTH,
    }
    assert body["health_breakdown"] == hb
    assert client.get(f"/api/v1/runs/{run_id}/health", headers=bob).status_code == 404


def test_explicit_success_probability_wins_over_counts(users):
    alice, _ = users
    run_id = push_run(alice, results={"success_probability": 0.5, "counts": {"0": 10}}, fingerprint={})
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).json()["health_score"] == 50.0
    bare = push_run(alice, results={}, fingerprint={})
    assert client.get(f"/api/v1/runs/{bare}", headers=alice).json()["health_score"] is None


# ── Downloads ────────────────────────────────────────────────────────────────

def test_qasm_and_rerun_script(users):
    alice, bob = users
    run_id = push_run(alice, qasm=GHZ3)
    r = client.get(f"/api/v1/runs/{run_id}/qasm", headers=alice)
    assert r.status_code == 200 and r.text == GHZ3
    assert client.get(f"/api/v1/runs/{run_id}/qasm", headers=bob).status_code == 404
    rerun = client.get(f"/api/v1/runs/{run_id}/rerun.py", headers=alice)
    assert f"/api/v1/runs/{run_id}/qasm" in rerun.text
    assert client.get("/api/v1/runs/nope/rerun.py", headers=alice).status_code == 404

    no_qasm = push_run(alice, qasm=None)
    assert client.get(f"/api/v1/runs/{no_qasm}/qasm", headers=alice).status_code == 404
    assert client.get(f"/api/v1/runs/{no_qasm}/circuit.svg", headers=alice).status_code == 404
    assert client.get(f"/api/v1/runs/{no_qasm}/circuit.txt", headers=alice).status_code == 404


def test_circuit_drawings(users):
    alice, bob = users
    run_id = push_run(alice, qasm=BELL)
    svg = client.get(f"/api/v1/runs/{run_id}/circuit.svg", headers=alice)
    assert svg.status_code == 200, svg.text
    assert svg.headers["content-type"].startswith("image/svg+xml") and b"<svg" in svg.content
    assert svg.headers["cache-control"].startswith("private")
    txt = client.get(f"/api/v1/runs/{run_id}/circuit.txt", headers=alice)
    assert txt.status_code == 200 and "H" in txt.text and "q_0" in txt.text
    assert client.get(f"/api/v1/runs/{run_id}/circuit.svg", headers=bob).status_code == 404

    broken = push_run(alice, qasm="this is not qasm")
    assert client.get(f"/api/v1/runs/{broken}/circuit.txt", headers=alice).status_code == 422
    assert client.get(f"/api/v1/runs/{broken}/circuit.svg", headers=alice).status_code == 422


def test_bundle_zip_contents(users):
    alice, bob = users
    run_id = _rich_run(alice, context={"pip_freeze": "qiskit==2.0"},
                       transpiler={"settings": {"optimization_level": 2}})
    assert client.get(f"/api/v1/runs/{run_id}/bundle.zip").status_code == 401
    assert client.get(f"/api/v1/runs/{run_id}/bundle.zip", headers=bob).status_code == 404
    r = client.get(f"/api/v1/runs/{run_id}/bundle.zip", headers=alice)
    assert r.status_code == 200
    assert f'filename="qlab-run-{run_id}.zip"' in r.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert set(z.namelist()) == {"metadata.json", "rerun.py", "circuit.qasm", "requirements.txt",
                                     "calibration.json", "transpiler.json"}
        assert z.read("circuit.qasm").decode() == BELL
        assert z.read("requirements.txt").decode() == "qiskit==2.0"
        assert json.loads(z.read("calibration.json")) == CAL
        assert json.loads(z.read("metadata.json"))["run_id"] == run_id


def test_capsule_manifest_matches_its_files(users):
    alice, bob = users
    run_id = _rich_run(alice, parameters={"theta": 0.3})
    assert client.get(f"/api/v1/runs/{run_id}/capsule.zip", headers=bob).status_code == 404
    r = client.get(f"/api/v1/runs/{run_id}/capsule.zip", headers=alice)
    assert r.status_code == 200
    prefix = f"qlab-capsule-{run_id[:8]}/"
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        files = {n[len(prefix):]: z.read(n) for n in z.namelist()}
    manifest = files.pop("MANIFEST.sha256").decode().splitlines()
    assert sorted(manifest) == manifest
    listed = {line.split("  ")[1]: line.split("  ")[0] for line in manifest}
    assert set(listed) == set(files)
    assert {"results.json", "parameters.json", "fingerprint.json", "calibration.json"} <= set(files)
    for name, content in files.items():
        assert listed[name] == hashlib.sha256(content).hexdigest()
    assert "qasm" not in json.loads(files["metadata.json"])


# ── Badge and provenance ─────────────────────────────────────────────────────

def test_badge_is_public_and_coloured_by_health(users):
    alice, _ = users
    good = _rich_run(alice)
    bad = push_run(alice, results={"counts": {"00": 1, "01": 1, "10": 1, "11": 1}}, fingerprint={})
    g = client.get(f"/api/v1/runs/{good}/badge.svg")  # README badges need no sign-in
    assert g.status_code == 200 and "health 92/100" in g.text and "#22c55e" in g.text
    b = client.get(f"/api/v1/runs/{bad}/badge.svg")
    assert "health 25/100" in b.text and "#ef4444" in b.text
    assert client.get("/api/v1/runs/no-such-run/badge.svg").status_code == 404


def test_provenance_includes_metrics_and_assertions(users):
    alice, bob = users
    run_id = _rich_run(alice, parameters={"theta": 1.0})
    m = client.post(f"/api/v1/runs/{run_id}/metrics", headers=alice,
                    json={"metrics": [{"name": "energy", "value": -1.2, "step": 0}]})
    assert m.status_code == 201, m.text
    a = client.post(f"/api/v1/runs/{run_id}/assertions", headers=alice, json={"assertions": [
        {"label": "bell", "assertion_type": "min_prob", "state": "00", "expected_min": 0.4,
         "actual_value": 0.9, "passed": True}]})
    assert a.status_code in (200, 201), a.text

    p = client.get(f"/api/v1/runs/{run_id}/provenance", headers=alice)
    assert p.status_code == 200
    body = p.json()
    assert body["run"]["run_id"] == run_id and body["run"]["qasm"] == BELL
    assert body["parameters"] == {"theta": 1.0} and body["calibration"] == CAL
    assert body["metrics"] == [{"name": "energy", "value": -1.2, "step": 0}]
    assert body["assertions"] == [{"label": "bell", "type": "min_prob", "passed": True, "actual": 0.9}]
    assert body["reproducibility"]["verification_url"].endswith(f"/verify/{run_id}")
    assert client.get(f"/api/v1/runs/{run_id}/provenance", headers=bob).status_code == 404


# ── Sharing ──────────────────────────────────────────────────────────────────

def test_share_link_is_stable_public_and_hides_the_owner(users):
    alice, bob = users
    run_id = _rich_run(alice, qasm=BELL)
    assert client.post(f"/api/v1/runs/{run_id}/share").status_code == 401
    assert client.post(f"/api/v1/runs/{run_id}/share", headers=bob).status_code == 404

    first = client.post(f"/api/v1/runs/{run_id}/share", headers=alice).json()
    again = client.post(f"/api/v1/runs/{run_id}/share", headers=alice).json()
    assert first == again and first["share_url"].endswith(f"/share/{first['share_token']}")

    public = client.get(f"/api/v1/runs/public/{first['share_token']}")
    assert public.status_code == 200
    body = public.json()
    assert body["run_id"] == run_id and body["is_shared"] is True
    assert body["health_breakdown"]["overall"] == EXPECTED_HEALTH
    assert "created_by_user_id" not in body and "org_id" not in body

    svg = client.get(f"/api/v1/runs/public/{first['share_token']}/circuit.svg")
    assert svg.status_code == 200 and svg.headers["cache-control"].startswith("public")
    assert client.get("/api/v1/runs/public/not-a-token").status_code == 404
    assert client.get("/api/v1/runs/public/not-a-token/circuit.svg").status_code == 404
    # Unshared runs are not reachable through the public path.
    assert client.get(f"/api/v1/runs/public/{run_id}").status_code == 404


# ── Metrics and analytics ────────────────────────────────────────────────────

def test_run_metrics_aggregates_only_the_callers_runs():
    carol, dave = make_user(prefix="carol"), make_user(prefix="dave")
    project = f"agg-{uuid.uuid4().hex[:6]}"
    push_run(carol, project=project, status="completed", backend="ibm_a",
             fingerprint={"num_qubits": 2, "depth": 4, "non_clifford_ratio": 0.5, "gate_counts": {"cx": 2}},
             results={"success_probability": 0.8}, calibration=CAL)
    push_run(carol, project=project, status="failed", backend="ibm_b",
             fingerprint={"num_qubits": 5, "depth": 9, "gate_counts": {"cx": 3, "h": 1}}, results={})
    push_run(carol, project=project, status="submitted", backend="ibm_a",
             fingerprint={"num_qubits": 3, "depth": "bad"}, results={"success_probability": 0.4})
    push_run(dave, project=project, status="completed", fingerprint={"num_qubits": 99})

    m = client.get(f"/api/v1/metrics/runs?project={project}", headers=carol).json()
    assert m["total_runs"] == 3
    assert (m["completed_runs"], m["failed_runs"], m["submitted_runs"]) == (1, 1, 1)
    assert m["runs_with_results"] == 2 and m["runs_with_calibration"] == 1
    assert m["completion_rate"] == pytest.approx(1 / 3)
    assert m["max_qubits"] == 5 and m["max_depth"] == 9
    assert m["average_non_clifford_ratio"] == pytest.approx(0.5 / 3)
    assert m["average_success_probability"] == pytest.approx(0.6)
    assert m["by_backend"] == {"ibm_a": 2, "ibm_b": 1}
    assert m["by_status"] == {"completed": 1, "failed": 1, "submitted": 1}
    assert m["gate_counts"] == {"cx": 5, "h": 1}
    assert len(m["timeline"]) == 3

    only_a = client.get(f"/api/v1/metrics/runs?project={project}&backend=ibm_a", headers=carol).json()
    assert only_a["total_runs"] == 2
    empty = client.get(f"/api/v1/metrics/runs?project={project}-none", headers=carol).json()
    assert empty["total_runs"] == 0 and empty["average_success_probability"] is None


def test_timeseries_buckets():
    erin = make_user(prefix="erin")
    project = f"ts-{uuid.uuid4().hex[:6]}"
    now = datetime.now(timezone.utc)
    push_run(erin, project=project, status="completed", created_at=now.isoformat())
    push_run(erin, project=project, status="failed", created_at=now.isoformat())
    push_run(erin, project=project, status="completed", created_at=(now - timedelta(days=3)).isoformat())
    push_run(erin, project=project, created_at=(now - timedelta(days=60)).isoformat())

    days = client.get(f"/api/v1/analytics/timeseries?project={project}&days=30", headers=erin).json()
    by_date = {d["date"]: d for d in days}
    today = by_date[now.strftime("%Y-%m-%d")]
    assert today["total"] == today["run_count"] == 2
    assert today["completed"] == 1 and today["failed"] == 1
    assert sum(d["total"] for d in days) == 3  # the 60-day-old run is outside the window
    assert today["avg_health"] == 50.0  # both runs: 500/1000 counts

    weeks = client.get(f"/api/v1/analytics/timeseries?project={project}&granularity=week", headers=erin).json()
    assert all("-W" in w["date"] for w in weeks) and sum(w["total"] for w in weeks) == 3
    hours = client.get(f"/api/v1/analytics/timeseries?project={project}&granularity=hour", headers=erin).json()
    assert all(h["date"].endswith(":00:00") for h in hours)
    assert client.get("/api/v1/analytics/timeseries?granularity=month", headers=erin).status_code == 422
    other = client.get(f"/api/v1/analytics/timeseries?project={project}", headers=make_user()).json()
    assert other == []


# ── Exports ──────────────────────────────────────────────────────────────────

def test_exports_require_sign_in_and_contain_only_the_callers_runs(users):
    alice, bob = users
    project = f"exp-{uuid.uuid4().hex[:6]}"
    mine = _rich_run(alice, project=project, tags=["a", "b"], circuit_name="exported")
    push_run(bob, project=project, circuit_name="bobs")

    for path in ("/api/v1/exports/runs.csv", "/api/v1/exports/runs.jsonl", "/api/v1/reports/runs.md"):
        assert client.get(f"{path}?project={project}").status_code == 401

    c = client.get(f"/api/v1/exports/runs.csv?project={project}", headers=alice)
    assert c.headers["content-type"].startswith("text/csv")
    assert ".csv" in c.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(c.text)))
    assert [r["run_id"] for r in rows] == [mine]
    assert rows[0]["num_qubits"] == "2" and rows[0]["tags"] == "a,b"
    assert rows[0]["health_score"] == str(EXPECTED_HEALTH) and rows[0]["has_qasm"] == "True"

    j = client.get(f"/api/v1/exports/runs.jsonl?project={project}", headers=alice)
    lines = [json.loads(line) for line in j.text.splitlines()]
    assert [r["run_id"] for r in lines] == [mine] and lines[0]["circuit_name"] == "exported"
    empty = client.get(f"/api/v1/exports/runs.jsonl?project={project}-none", headers=alice)
    assert empty.text == ""

    md = client.get(f"/api/v1/reports/runs.md?project={project}", headers=alice).text
    assert md.startswith("# Q-Lab Experiment Report")
    assert f"Filters: project={project}" in md
    assert "- Total runs: 1" in md and "- Completion rate: 100.0%" in md
    assert f"| {mine} | exported |" in md and "bobs" not in md


# ── HTML pages ───────────────────────────────────────────────────────────────

def test_run_page_escapes_user_text(users):
    alice, bob = users
    run_id = push_run(alice, circuit_name="<script>alert(1)</script>", backend="<b>dev</b>")
    page = client.get(f"/runs/{run_id}", headers=alice)
    assert page.status_code == 200
    assert "<script>alert(1)</script>" not in page.text
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in page.text
    assert client.get(f"/runs/{run_id}", headers=bob).status_code == 404
    assert "<html" in client.get("/").text.lower()


# ── Search filters ───────────────────────────────────────────────────────────

def test_search_filters_sorting_and_paging():
    frank = make_user(prefix="frank")
    p = f"srch-{uuid.uuid4().hex[:6]}"
    small = push_run(frank, project=p, fingerprint={"num_qubits": 2, "depth": 5}, tags=["x"], calibration=CAL)
    big = push_run(frank, project=p, fingerprint={"num_qubits": 8, "depth": 2}, tags=["y"], results={})
    mid = push_run(frank, project=p, fingerprint={"num_qubits": 4, "depth": 9}, tags=["x", "z"],
                   benchmark_id="bench-1")

    def ids(query):
        r = client.get(f"/api/v1/search/runs?project={p}&{query}", headers=frank)
        assert r.status_code == 200, r.text
        return [i["run_id"] for i in r.json()["items"]]

    assert ids("sort_by=num_qubits&sort_order=asc") == [small, mid, big]
    assert ids("sort_by=depth&sort_order=desc") == [mid, small, big]
    assert set(ids("min_qubits=3&max_qubits=8")) == {mid, big}
    assert set(ids("min_depth=3&max_depth=6")) == {small}
    assert set(ids("has_results=false")) == {big}
    assert set(ids("has_results=true")) == {small, mid}
    assert set(ids("has_calibration=true")) == {small}
    assert set(ids("has_calibration=false")) == {big, mid}
    assert set(ids("tags=z,nothing")) == {mid}
    assert ids("benchmark_id=bench-1") == [mid]
    assert set(ids("status=completed&backend=aer_simulator")) == {small, big, mid}
    future = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    assert ids(f"created_after={future}") == []
    assert len(ids(f"created_before={future}")) == 3

    page = client.get(f"/api/v1/search/runs?project={p}&page_size=2&page=2&sort_by=num_qubits",
                      headers=frank).json()
    assert page["total"] == 3 and page["pages"] == 2 and len(page["items"]) == 1
    assert client.get("/api/v1/search/runs?page=0", headers=frank).status_code == 422
    # Another user's search sees none of these runs.
    assert client.get(f"/api/v1/search/runs?project={p}", headers=make_user()).json()["total"] == 0


def test_list_runs_qubit_and_benchmark_filters(users):
    alice, _ = users
    p = f"lst-{uuid.uuid4().hex[:6]}"
    two = push_run(alice, project=p, fingerprint={"num_qubits": 2})
    six = push_run(alice, project=p, fingerprint={"num_qubits": 6}, benchmark_id="b-lst")
    assert [r["run_id"] for r in client.get(f"/api/v1/runs?project={p}&max_qubits=3", headers=alice).json()] == [two]
    assert [r["run_id"] for r in client.get(f"/api/v1/runs?project={p}&benchmark_id=b-lst",
                                            headers=alice).json()] == [six]
    assert client.get("/api/v1/runs?limit=0", headers=alice).status_code == 422


# ── Ingest validation and anonymous (open-mode) runs ─────────────────────────

def test_ingest_validates_the_payload(users):
    alice, _ = users
    body = run_payload()
    del body["created_at"]
    assert client.post("/api/v1/runs", headers=alice, json=body).status_code == 422
    assert client.post("/api/v1/runs", headers=alice, json={**run_payload(), "tags": "notalist"}).status_code == 422
    assert client.post("/api/v1/runs", headers=alice, json={**run_payload(), "created_at": "yesterday"}).status_code == 422


def test_anonymous_runs_are_invisible_to_signed_in_users_and_vice_versa(users):
    alice, _ = users
    anon = push_run(None, circuit_name="anon-run")
    assert client.get(f"/api/v1/runs/{anon}").json()["circuit_name"] == "anon-run"
    assert client.get(f"/api/v1/runs/{anon}", headers=alice).status_code == 404
    mine = push_run(alice)
    assert client.get(f"/api/v1/runs/{mine}").status_code == 404
    # Writes always need an account, even on an anonymous run.
    assert client.patch(f"/api/v1/runs/{anon}", json={"status": "failed"}).status_code == 401


def test_update_merges_every_section(users):
    alice, _ = users
    run_id = push_run(alice, parameters={"a": 1}, execution={"shots": 10}, context={"git": "x"})
    r = client.patch(f"/api/v1/runs/{run_id}", headers=alice, json={
        "status": "failed", "parameters": {"b": 2}, "execution": {"job_id": "j"},
        "context": {"host": "h"}, "timing": {"result_time": "t"}})
    body = r.json()
    assert body["parameters"] == {"a": 1, "b": 2}
    assert body["execution"] == {"shots": 10, "job_id": "j"}
    assert body["context"] == {"git": "x", "host": "h"}
    assert body["timing"] == {"result_time": "t"} and body["status"] == "failed"


# ── Auth edge cases (app/deps.py) ────────────────────────────────────────────

def test_bad_credentials_are_rejected(users):
    alice, _ = users
    run_id = push_run(alice)
    assert client.get(f"/api/v1/runs/{run_id}", headers={"Authorization": "Bearer garbage"}).status_code == 401
    assert client.get(f"/api/v1/runs/{run_id}", headers={"X-QLab-Api-Key": "qlab_unknown"}).status_code == 401
    assert client.get("/api/v1/ai-usage").status_code == 401


def test_deactivated_users_lose_access():
    grace = make_user(prefix="grace")
    run_id = push_run(grace)
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET is_active = 0 WHERE id = :i"), {"i": user_id(grace)})
    assert client.get(f"/api/v1/runs/{run_id}", headers=grace).status_code == 401


def test_api_key_with_an_expiry(users):
    """Regression: a key created with expires_days gave HTTP 500 on every use with SQLite (naive
    stored datetime compared with an aware one), so expiring keys never worked."""
    alice, _ = users
    created = client.post("/api/v1/users/me/api-keys", headers=alice, json={"name": "old", "expires_days": 30}).json()
    assert created["expires_at"]
    fresh = client.get("/api/v1/runs", headers={"X-QLab-Api-Key": created["key"]})
    assert fresh.status_code == 200, fresh.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE api_keys SET expires_at = :t WHERE id = :i"),
                     {"t": datetime(2000, 1, 1), "i": created["id"]})
    r = client.get("/api/v1/runs", headers={"X-QLab-Api-Key": created["key"]})
    assert r.status_code == 401 and "expired" in r.json()["detail"]


def test_legacy_shared_keys(monkeypatch):
    monkeypatch.setenv("QLAB_API_KEYS", "shared-one, shared-two")
    assert client.post("/api/v1/runs", json=run_payload()).status_code == 401
    assert client.post("/api/v1/runs", headers={"X-QLab-Api-Key": "wrong"}, json=run_payload()).status_code == 401
    ok = client.post("/api/v1/runs", headers={"X-QLab-Api-Key": "shared-two"}, json=run_payload())
    assert ok.status_code == 200


def test_ai_usage_for_a_signed_in_user(users):
    alice, _ = users
    r = client.get("/api/v1/ai-usage", headers=alice)
    assert r.status_code == 200 and isinstance(r.json(), dict)


# ── Misc endpoints ───────────────────────────────────────────────────────────

def test_health_backends_and_ping():
    assert client.get("/health").json()["status"] == "ok"
    backends = client.get("/api/v1/backends").json()
    assert backends and all("id" in b for b in backends)
    assert client.post("/ping", json={"sdk_version": "1" * 50, "python": "3.12"}).json() == {"ok": True}
    assert client.post("/ping", content=b"not json").json() == {"ok": True}
    with engine.begin() as conn:
        meta = conn.execute(text("SELECT meta FROM audit_logs WHERE action = 'sdk.ping' ORDER BY id DESC")).first()[0]
    meta = json.loads(meta) if isinstance(meta, str) else meta
    assert meta == {"sdk_version": "1" * 20, "python": "3.12"}  # truncated, nothing else stored


def test_contact_form_keeps_visitor_text_as_text(monkeypatch):
    """Regression: the contact form put the visitor's name and message into the owner's email as raw
    HTML (and the name, newlines included, into the subject)."""
    from app import email_service
    sent = []
    monkeypatch.setattr(email_service, "send_email", lambda **kw: sent.append(kw) or True)
    r = client.post("/contact", json={"name": "Eve\r\nBcc: x@evil.test", "email": "e@x.org",
                                      "message": '<a href="http://evil.test">click</a>'})
    assert r.json() == {"ok": True}
    [mail] = sent
    assert "\n" not in mail["subject"] and "\r" not in mail["subject"]
    assert '<a href="http://evil.test">' not in mail["html"]
    assert "&lt;a href=&quot;http://evil.test&quot;&gt;click&lt;/a&gt;" in mail["html"]
    assert client.post("/contact", json={"name": "x"}).status_code == 422


def test_legacy_runs_file_is_migrated_once(tmp_path, monkeypatch):
    import app.main as main
    legacy = tmp_path / "runs.json"
    rid = f"legacy-{uuid.uuid4().hex[:8]}"
    legacy.write_text(json.dumps([run_payload(run_id=rid), {"broken": True}]), encoding="utf-8")
    monkeypatch.setattr(main, "LEGACY_RUNS_FILE", legacy)
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    with main.SessionLocal() as db:
        main._migrate_legacy_runs(db)
    assert (tmp_path / "runs.json.migrated").exists()
    assert client.get(f"/api/v1/runs/{rid}").status_code == 200  # an anonymous run
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM runs WHERE run_id = :r"), {"r": rid})
    with main.SessionLocal() as db:
        main._migrate_legacy_runs(db)  # the marker stops a second import
    assert client.get(f"/api/v1/runs/{rid}").status_code == 404


# ── Live stream (app/events.py) ──────────────────────────────────────────────

def test_event_stream_filters_by_project_and_owner():
    from app import events
    from app.run_scope import scope_of

    async def scenario():
        events.set_event_loop(asyncio.get_running_loop())
        stream = events.event_stream(filter_project="p1", scope=scope_of(7, None))
        assert "connected" in await stream.__anext__()
        events.publish_sync("run.created", {"run_id": "other-project", "project": "p2", "created_by_user_id": 7})
        events.publish_sync("run.created", {"run_id": "someone-else", "project": "p1", "created_by_user_id": 8})
        events.publish_sync("run.created", {"run_id": "mine", "project": "p1", "created_by_user_id": 7})
        events.publish_sync("run.deleted", {"run_id": "gone", "project": "p1"})
        got = [json.loads((await asyncio.wait_for(stream.__anext__(), 5))[6:]) for _ in range(2)]
        await stream.aclose()
        return got

    try:
        got = asyncio.run(scenario())
    finally:
        events.set_event_loop(None)
    assert [g["data"]["run_id"] for g in got] == ["mine", "gone"]
    assert events._subscribers == []


def test_publish_without_a_loop_is_a_no_op():
    from app import events
    events.set_event_loop(None)
    events.publish_sync("run.created", {"run_id": "x"})  # must not raise
