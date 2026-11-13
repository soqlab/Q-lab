"""Kept routers, group A (1/3): accounts, admin, alerts, AI features and objects that belong to a user.

Every test goes through the API with real database state. Only external services are replaced:
the AI provider (ai_complete), webhooks/peers (httpx) and arXiv (urllib).
"""
from __future__ import annotations

import io
import json
import uuid

import pytest

from app.ai_provider import NoAIProviderError
from app.routers import alerts as alerts_router
from app.routers import arxiv_search as arxiv_search_router
from app.routers import ask as ask_router
from app.routers import cal_network as cal_network_router
from app.routers import circuit_designer as designer_router
from app.routers import conference as conference_router
from tests.helpers import client, make_user, push_run


def _uid(headers: dict) -> int:
    return client.get("/auth/me", headers=headers).json()["user_id"]


@pytest.fixture(scope="module")
def alice():
    return make_user(prefix="a1alice")


@pytest.fixture(scope="module")
def bob():
    return make_user(prefix="a1bob")


@pytest.fixture(scope="module")
def admin():
    return make_user(role="admin", prefix="a1admin")


class _Resp:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


# ── activity + admin ─────────────────────────────────────────────────────────

def test_frontend_events_are_accepted_but_never_recorded(alice, admin):
    action = f"page.viewed.{uuid.uuid4().hex[:6]}"
    assert client.post("/api/v1/events", json={"event": action, "page": "/runs"}).json() == {"ok": True, "recorded": False}
    assert client.post("/api/v1/events", headers=alice, json={"event": action, "page": "/runs",
                                                             "meta": {"tab": "list"}}).json() == {"ok": True, "recorded": False}
    assert client.post("/api/v1/events", json={"event": "x" * 121}).status_code == 422

    logs = client.get(f"/api/v1/admin/audit-logs?action={action}", headers=admin).json()
    assert logs["total"] == 0  # no tracking: nothing is stored, signed in or not


def test_admin_endpoints_need_an_admin(alice):
    assert client.get("/api/v1/admin/stats").status_code == 401
    assert client.get("/api/v1/admin/stats", headers=alice).status_code == 403
    assert client.get("/api/v1/admin/users", headers=alice).status_code == 403
    assert client.delete("/api/v1/admin/audit-logs/purge", headers=alice).status_code == 403


def test_admin_stats_count_every_tenant(admin, alice, bob):
    before = client.get("/api/v1/admin/stats", headers=admin).json()
    push_run(alice, status="failed")
    push_run(bob, status="completed")
    after = client.get("/api/v1/admin/stats", headers=admin).json()
    assert after["runs"]["total"] == before["runs"]["total"] + 2
    assert after["runs"]["failed"] == before["runs"]["failed"] + 1
    assert after["runs"]["completed"] == before["runs"]["completed"] + 1
    users = {u["id"]: u for u in client.get("/api/v1/admin/users", headers=admin).json()}
    assert users[_uid(alice)]["run_count"] >= 1


def test_admin_role_changes_and_deactivation(admin):
    target = make_user(prefix="a1target")
    tid = _uid(target)
    assert client.patch(f"/api/v1/admin/users/{tid}/role", headers=admin, json={"role": "wizard"}).status_code == 422
    assert client.patch(f"/api/v1/admin/users/{tid}/role", headers=admin, json={"role": "owner"}).status_code == 403
    assert client.patch(f"/api/v1/admin/users/{_uid(admin)}/role", headers=admin,
                        json={"role": "viewer"}).status_code == 400
    r = client.patch(f"/api/v1/admin/users/{tid}/role", headers=admin, json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["role"] == "viewer"
    assert client.patch("/api/v1/admin/users/999999/role", headers=admin, json={"role": "viewer"}).status_code == 404

    assert client.delete(f"/api/v1/admin/users/{tid}", headers=admin).status_code == 200
    assert client.get("/auth/me", headers=target).status_code == 401  # deactivated accounts are locked out
    assert client.patch(f"/api/v1/admin/users/{tid}/reactivate", headers=admin).status_code == 200
    assert client.get("/auth/me", headers=target).json()["role"] == "viewer"
    assert client.delete(f"/api/v1/admin/users/{_uid(admin)}", headers=admin).status_code == 400


# ── AI provider preference ───────────────────────────────────────────────────

def test_ai_provider_preference_is_per_user(alice, bob):
    assert client.get("/api/v1/settings/ai-provider").status_code == 401
    assert client.put("/api/v1/settings/ai-provider", headers=alice, json={"provider": "skynet"}).status_code == 422
    assert client.put("/api/v1/settings/ai-provider", headers=alice, json={"provider": "groq"}).json() == {
        "preferred_provider": "groq"}
    got = client.get("/api/v1/settings/ai-provider", headers=alice).json()
    assert got["preferred_provider"] == "groq"
    assert "anthropic" in {p["provider"] for p in got["available_providers"]}
    assert client.get("/api/v1/settings/ai-provider", headers=bob).json()["preferred_provider"] is None


# ── alert rules ──────────────────────────────────────────────────────────────

@pytest.fixture
def rules_file(tmp_path, monkeypatch):
    monkeypatch.setattr(alerts_router, "_RULES_FILE", tmp_path / "alert_rules.json")
    posted: list[tuple[str, dict]] = []
    monkeypatch.setattr(alerts_router, "is_safe_url", lambda url: True)
    monkeypatch.setattr(alerts_router.httpx, "post",
                        lambda url, json=None, timeout=None: posted.append((url, json)) or _Resp(200))
    return posted


def test_alert_rules_validate_and_need_sign_in(rules_file, alice):
    rule = {"name": "deep", "metric": "depth", "operator": "gt", "threshold": 2}
    assert client.post("/api/v1/alerts/rules", json=rule).status_code == 401
    assert client.post("/api/v1/alerts/rules", headers=alice, json={**rule, "metric": "mood"}).status_code == 422
    assert client.post("/api/v1/alerts/rules", headers=alice, json={**rule, "operator": "about"}).status_code == 422


def test_alert_rules_fire_and_stay_private(rules_file, alice, bob):
    """Regression: rules were global. Anyone could list them (with their webhook URLs), delete or
    toggle them, and a run was checked against every user's rules, sending it to their webhooks."""
    mine = client.post("/api/v1/alerts/rules", headers=alice, json={
        "name": "too deep", "metric": "depth", "operator": "gt", "threshold": 2,
        "webhook_url": "https://hooks.example.org/alice", "is_slack": True}).json()
    theirs = client.post("/api/v1/alerts/rules", headers=bob, json={
        "name": "bob deep", "metric": "depth", "operator": "gt", "threshold": 2,
        "webhook_url": "https://hooks.example.org/bob"}).json()

    assert [r["id"] for r in client.get("/api/v1/alerts/rules", headers=alice).json()] == [mine["id"]]
    assert [r["id"] for r in client.get("/api/v1/alerts/rules", headers=bob).json()] == [theirs["id"]]
    assert client.get("/api/v1/alerts/rules").json() == []

    run_id = push_run(alice)  # depth 3
    fired = client.post(f"/api/v1/alerts/check/{run_id}", headers=alice).json()
    assert fired == {"run_id": run_id, "fired_rules": ["too deep"], "fired_count": 1}
    assert [url for url, _ in rules_file] == ["https://hooks.example.org/alice"]
    blocks = rules_file[0][1]["blocks"]
    assert blocks[0]["text"]["text"].endswith("too deep")
    assert client.post(f"/api/v1/alerts/check/{run_id}", headers=bob).status_code == 404

    assert client.delete(f"/api/v1/alerts/rules/{mine['id']}", headers=bob).status_code == 404
    assert client.patch(f"/api/v1/alerts/rules/{mine['id']}/toggle", headers=bob).status_code == 404
    toggled = client.patch(f"/api/v1/alerts/rules/{mine['id']}/toggle", headers=alice).json()
    assert toggled["active"] is False
    assert client.post(f"/api/v1/alerts/check/{run_id}", headers=alice).json()["fired_count"] == 0
    assert client.delete(f"/api/v1/alerts/rules/{mine['id']}", headers=alice).json() == {"deleted": True}


def test_alert_digest_counts_the_callers_runs(alice, bob):
    project = f"digest-{uuid.uuid4().hex[:6]}"
    push_run(alice, project=project, status="completed")
    push_run(alice, project=project, status="failed", backend="ibm_digest")
    push_run(bob, project=project, status="completed")
    d = client.get(f"/api/v1/alerts/digest?project={project}", headers=alice).json()
    assert d["total_runs"] == 2 and d["completed_runs"] == 1 and d["failed_runs"] == 1
    assert d["completion_rate"] == 0.5
    assert d["by_backend"] == {"aer_simulator": 1, "ibm_digest": 1}
    assert client.get("/api/v1/alerts/digest?days=0", headers=alice).status_code == 422


# ── ask (AI over your runs) ──────────────────────────────────────────────────

def test_ask_sends_only_the_callers_runs_to_the_ai(monkeypatch, alice, bob):
    project = f"ask-{uuid.uuid4().hex[:6]}"
    a1 = push_run(alice, project=project, circuit_name="alice-circuit")
    b1 = push_run(bob, project=project, circuit_name="bob-circuit")
    prompts: list[str] = []

    def fake_ai(prompt, **kw):
        prompts.append(prompt)
        return f"The best run is run_id `{a1}`."

    monkeypatch.setattr(ask_router, "ai_complete", fake_ai)
    assert client.post("/api/v1/ask", json={"question": "which run is best?"}).status_code == 401
    r = client.post("/api/v1/ask", headers=alice, json={"question": "which run is best?", "project": project})
    assert r.status_code == 200, r.text
    assert r.json() == {"answer": f"The best run is run_id `{a1}`.", "cited_run_ids": [a1], "run_count": 1}
    assert a1 in prompts[0] and b1 not in prompts[0] and "bob-circuit" not in prompts[0]

    empty = client.post("/api/v1/ask", headers=alice, json={"question": "anything?", "project": "nope-x"}).json()
    assert empty["run_count"] == 0 and empty["cited_run_ids"] == []
    assert client.post("/api/v1/ask", headers=alice, json={"question": "hi"}).status_code == 422

    def no_provider(prompt, **kw):
        raise NoAIProviderError("none")

    monkeypatch.setattr(ask_router, "ai_complete", no_provider)
    assert client.post("/api/v1/ask", headers=alice,
                       json={"question": "which run is best?", "project": project}).status_code == 503


# ── assertions ───────────────────────────────────────────────────────────────

def test_assertions_are_stored_summarised_and_private(alice, bob):
    run_id = push_run(alice)
    assert client.get(f"/api/v1/runs/{run_id}/assertions", headers=alice).json()["overall"] == "none"
    batch = {"assertions": [
        {"label": "00", "assertion_type": "min_prob", "state": "00", "expected_min": 0.4, "actual_value": 0.5,
         "passed": True},
        {"label": "01", "assertion_type": "max_prob", "state": "01", "expected_max": 0.05, "actual_value": 0.2,
         "passed": False},
        {"label": "later", "assertion_type": "custom"},
    ]}
    r = client.post(f"/api/v1/runs/{run_id}/assertions", headers=alice, json=batch).json()
    assert (r["submitted"], r["passed"], r["failed"], r["pending"], r["overall"]) == (3, 1, 1, 1, "failed")
    got = client.get(f"/api/v1/runs/{run_id}/assertions", headers=alice).json()
    assert got["total"] == 3 and [a["label"] for a in got["assertions"]] == ["00", "01", "later"]

    assert client.get(f"/api/v1/runs/{run_id}/assertions", headers=bob).status_code == 404
    assert client.post(f"/api/v1/runs/{run_id}/assertions", headers=bob, json=batch).status_code == 404
    assert client.delete(f"/api/v1/runs/{run_id}/assertions", headers=bob).status_code == 404
    assert client.delete(f"/api/v1/runs/{run_id}/assertions", headers=alice).json() == {"deleted": 3,
                                                                                        "run_id": run_id}
    ok = client.post(f"/api/v1/runs/{run_id}/assertions", headers=alice,
                     json={"assertions": [{"passed": True}]}).json()
    assert ok["overall"] == "passed"


# ── benchmarks ───────────────────────────────────────────────────────────────

def test_benchmark_compares_its_runs_and_is_private(alice, bob):
    """Regression: any caller could list everyone's benchmarks and open them by id."""
    r1 = push_run(alice, backend="ibm_bm_a", status="completed",
                  calibration={"t1_us": {"0": 100.0, "1": 200.0}}, results={"success_probability": 0.9})
    r2 = push_run(alice, backend="ibm_bm_b", status="failed")
    bid = f"bm-{uuid.uuid4().hex[:10]}"
    created = client.post("/api/v1/benchmarks", headers=alice, json={
        "benchmark_id": bid, "name": "a vs b", "backends": ["ibm_bm_a", "ibm_bm_b"], "run_ids": [r1, r2],
        "project": "bm"}).json()
    assert created["status"] == "running" and created["run_ids"] == [r1, r2]

    got = client.get(f"/api/v1/benchmarks/{bid}", headers=alice).json()
    assert got["status"] == "partial"  # every run finished, one failed
    assert got["comparison"]["ibm_bm_a"]["avg_t1_us"] == 150.0
    assert got["comparison"]["ibm_bm_a"]["success_probability"] == 0.9
    assert got["comparison"]["ibm_bm_b"]["status"] == "failed"

    assert client.get(f"/api/v1/benchmarks/{bid}", headers=bob).status_code == 404
    assert bid not in {b["benchmark_id"] for b in client.get("/api/v1/benchmarks", headers=bob).json()}
    assert bid in {b["benchmark_id"] for b in client.get("/api/v1/benchmarks?project=bm", headers=alice).json()}
    assert client.post("/api/v1/benchmarks", headers=bob, json={"benchmark_id": bid}).status_code == 409
    assert client.get("/api/v1/benchmarks/nope", headers=alice).status_code == 404


# ── campaigns ────────────────────────────────────────────────────────────────

def test_campaign_sweep_tracks_runs_and_is_private(alice, bob):
    """Regression: campaigns were visible to and changeable by every user."""
    grid = {"name": "shots sweep", "grid": [{"name": "shots", "values": [100, 200]}], "project": "cmp"}
    assert client.post("/api/v1/campaigns", json=grid).status_code == 401
    assert client.post("/api/v1/campaigns", headers=alice, json={**grid, "grid": []}).status_code == 422
    created = client.post("/api/v1/campaigns", headers=alice, json=grid).json()
    cid = created["campaign_id"]
    assert created["total_combinations"] == 2
    assert created["combinations"] == [{"shots": 100}, {"shots": 200}]

    push_run(alice, benchmark_id=cid, parameters={"shots": 100}, status="completed")
    pending = client.get(f"/api/v1/campaigns/{cid}", headers=alice).json()
    assert pending["combinations_done"] == 1 and pending["status"] == "running"
    push_run(alice, benchmark_id=cid, parameters={"shots": 200}, status="completed")
    done = client.get(f"/api/v1/campaigns/{cid}", headers=alice).json()
    assert done["combinations_done"] == 2 and done["status"] == "completed" and done["run_count"] == 2
    assert [row["run_count"] for row in done["sweep_rows"]] == [1, 1]

    assert client.get(f"/api/v1/campaigns/{cid}", headers=bob).status_code == 404
    assert client.get(f"/api/v1/campaigns/{cid}/combinations", headers=bob).status_code == 404
    assert client.patch(f"/api/v1/campaigns/{cid}/status?status=cancelled", headers=bob).status_code == 404
    assert cid not in {c["campaign_id"] for c in client.get("/api/v1/campaigns", headers=bob).json()}
    assert cid in {c["campaign_id"] for c in client.get("/api/v1/campaigns", headers=alice).json()}
    assert client.get(f"/api/v1/campaigns/{cid}/combinations", headers=alice).json()["total_combinations"] == 2
    assert client.patch(f"/api/v1/campaigns/{cid}/status?status=bogus", headers=alice).status_code == 422
    assert client.patch(f"/api/v1/campaigns/{cid}/status?status=paused", headers=alice).json()["status"] == "paused"


# ── calibration network ──────────────────────────────────────────────────────

@pytest.fixture
def network_files(tmp_path, monkeypatch):
    monkeypatch.setattr(cal_network_router, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(cal_network_router, "_PEERS_FILE", tmp_path / "peers.json")
    monkeypatch.setattr(cal_network_router, "_CFG_FILE", tmp_path / "config.json")


def test_network_config_needs_an_admin(network_files, alice, admin):
    """Regression: anyone, signed in or not, could switch on public sharing and add peers."""
    assert client.patch("/api/v1/network/config", json={"opt_in": True}).status_code == 401
    assert client.patch("/api/v1/network/config", headers=alice, json={"opt_in": True}).status_code == 403
    assert client.post("/api/v1/network/peers", headers=alice, json={"url": "https://x.example"}).status_code == 403
    assert client.get("/api/v1/network/peers").status_code == 401
    assert client.get("/api/v1/network/status").status_code == 403  # not opted in
    cfg = client.patch("/api/v1/network/config", headers=admin, json={"opt_in": True, "node_label": "lab-1"}).json()
    assert cfg["opt_in"] is True and cfg["joined_at"] and cfg["instance_id"].startswith("node_")
    status = client.get("/api/v1/network/status").json()
    assert status["instance_id"] == cfg["instance_id"] and status["node_label"] == "lab-1"


def test_network_aggregates_local_and_peer_calibration(network_files, monkeypatch, admin):
    backend = f"ibm_net_{uuid.uuid4().hex[:6]}"
    for t1 in (100.0, 100.0):
        push_run(admin, backend=backend, calibration={"avg_t1_us": t1, "avg_gate_error": 0.01})
    peer_snapshot = {"instance_id": "node_peer", "n_snapshots": 2, "last_updated": "2026-01-01",
                     "metrics": {"avg_t1_us": {"n": 2, "mean": 50.0}}}

    def fake_get(url, timeout=None):
        if url.endswith("/api/v1/network/status"):
            return _Resp(200, {"backends": [{"backend": backend, "n_snapshots": 2}]})
        if url.endswith(f"/api/v1/network/calibration/{backend}"):
            return _Resp(200, peer_snapshot)
        return _Resp(404)

    monkeypatch.setattr(cal_network_router, "is_safe_url", lambda url: True)
    monkeypatch.setattr(cal_network_router.httpx, "get", fake_get)
    assert client.post("/api/v1/network/peers", headers=admin, json={"url": "ftp://peer"}).status_code == 400
    added = client.post("/api/v1/network/peers", headers=admin, json={"url": "https://peer.example.org/"}).json()
    assert added["reachable"] is True and added["peer"]["url"] == "https://peer.example.org"
    assert client.post("/api/v1/network/peers", headers=admin,
                       json={"url": "https://peer.example.org"}).status_code == 409

    agg = client.get(f"/api/v1/network/aggregate/{backend}", headers=admin).json()
    assert agg["sources"] == 2 and agg["total_snapshots"] == 4
    assert agg["global_metrics"]["avg_t1_us"]["mean"] == 75.0
    assert agg["global_metrics"]["avg_t1_us"]["n"] == 4
    assert backend in client.get("/api/v1/network/backends", headers=admin).json()["backends"]

    peer_id = added["peer"]["id"]
    assert client.delete(f"/api/v1/network/peers/{peer_id}", headers=admin).json() == {"removed": peer_id}
    assert client.delete(f"/api/v1/network/peers/{peer_id}", headers=admin).status_code == 404


def test_public_calibration_shares_only_statistics(network_files, admin):
    client.patch("/api/v1/network/config", headers=admin, json={"opt_in": True})
    backend = f"ibm_pub_{uuid.uuid4().hex[:6]}"
    for t1 in (40.0, 60.0):
        push_run(None, backend=backend, calibration={"avg_t1_us": t1})  # an open-mode upload
    snap = client.get(f"/api/v1/network/calibration/{backend}").json()
    assert snap["n_snapshots"] == 2
    assert snap["metrics"]["avg_t1_us"] == {"n": 2, "mean": 50.0, "std": 10.0, "min": 40.0, "max": 60.0}
    assert "runs" not in snap
    assert client.get("/api/v1/network/calibration/ibm_nothing_here").status_code == 404


# ── citations ────────────────────────────────────────────────────────────────

def test_citations_attach_export_and_stay_with_the_owner(alice, bob):
    """Regression: the run_citations table was never created, so adding a citation always failed
    with 500; and deleting one did not check who owns the run."""
    run_id = push_run(alice)
    assert client.post(f"/api/v1/runs/{run_id}/citations", headers=alice, json={"note": "x"}).status_code == 422
    c = client.post(f"/api/v1/runs/{run_id}/citations", headers=alice, json={
        "arxiv_id": "2305.14832", "title": "A paper", "authors": "A. Author", "year": 2023})
    assert c.status_code == 200, c.text
    cit = c.json()
    assert cit["arxiv_url"] == "https://arxiv.org/abs/2305.14832" and cit["doi_url"] is None

    listed = client.get(f"/api/v1/runs/{run_id}/citations", headers=alice).json()
    assert listed["count"] == 1 and listed["citations"][0]["title"] == "A paper"
    bib = client.get(f"/api/v1/runs/{run_id}/citations/export.bib", headers=alice).text
    assert "eprint = {2305.14832}" in bib and "year = {2023}" in bib

    assert client.get(f"/api/v1/runs/{run_id}/citations", headers=bob).status_code == 404
    assert client.post(f"/api/v1/runs/{run_id}/citations", headers=bob, json={"title": "spam"}).status_code == 404
    assert client.delete(f"/api/v1/runs/{run_id}/citations/{cit['id']}", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{run_id}/citations", headers=alice).json()["count"] == 1

    assert client.delete(f"/api/v1/runs/{run_id}/citations/{cit['id']}", headers=alice).json()["deleted"] is True
    assert client.delete(f"/api/v1/runs/{run_id}/citations/{cit['id']}", headers=alice).status_code == 404


# ── conference assets ────────────────────────────────────────────────────────

def test_conference_poster_uses_the_callers_run_data(monkeypatch, alice, bob):
    """Regression: experiment ids were looked up in an unused key-value namespace instead of the
    runs table, so the AI never saw the experiments it was asked to write about."""
    run_id = push_run(alice, circuit_name="conf-circuit", backend="ibm_conf")
    prompts: list[str] = []
    sections = [{"title": t, "content": f"{t} text", "figures": []} for t in ("Intro", "Methods", "Results")]

    def fake_ai(prompt, **kw):
        prompts.append(prompt)
        return "Here: " + json.dumps(sections)

    monkeypatch.setattr(conference_router, "ai_complete", fake_ai)
    body = {"title": "Bell states", "venue": "QIP", "authors": ["A"], "experiment_ids": [run_id]}
    poster = client.post("/api/v1/conference/generate-poster", headers=alice, json=body).json()
    assert poster["ai_generated"] is True and poster["sections"] == sections and poster["format"] == "pdf"
    assert "circuit='conf-circuit'" in prompts[0] and "backend=ibm_conf" in prompts[0]
    assert client.get(f"/api/v1/conference/asset/{poster['asset_id']}").json()["title"] == "Bell states"

    client.post("/api/v1/conference/generate-poster", headers=bob, json=body)
    assert "conf-circuit" not in prompts[1]  # someone else's run is not readable

    def failing(prompt, **kw):
        raise NoAIProviderError("none")

    monkeypatch.setattr(conference_router, "ai_complete", failing)
    abstract = client.post("/api/v1/conference/generate-abstract", headers=alice, json={
        "title": "T", "authors": ["A"], "experiment_ids": [run_id], "venue": "QIP"}).json()
    assert abstract["ai_generated"] is False and abstract["sections"][0]["title"] == "Abstract"
    slides = client.post("/api/v1/conference/generate-slides", headers=alice, json={
        "title": "T", "venue": "QIP", "authors": ["A"], "experiment_ids": [], "n_slides": 3}).json()
    assert [s["title"] for s in slides["sections"]] == ["Introduction & Motivation", "Quantum Background",
                                                        "Experimental Setup"]
    assert client.get("/api/v1/conference/asset/missing").status_code == 404


# ── departments ──────────────────────────────────────────────────────────────

def test_departments_need_a_signed_in_admin(alice, admin):
    """Regression: callers without credentials were treated as admins ("open dev mode")."""
    body = {"name": "Theory", "parent_org_id": "org_x"}
    assert client.post("/api/v1/departments", json=body).status_code == 401
    assert client.post("/api/v1/departments", headers=alice, json=body).status_code == 403
    dept = client.post("/api/v1/departments", headers=admin, json=body)
    assert dept.status_code == 201
    dept_id = dept.json()["id"]
    assert client.delete(f"/api/v1/departments/{dept_id}").status_code == 401
    assert client.delete(f"/api/v1/departments/{dept_id}", headers=admin).status_code == 403  # owner only


def test_department_members_and_tree(alice, admin):
    owner = make_user(role="owner", prefix="a1owner")
    parent = client.post("/api/v1/departments", headers=admin, json={"name": "Physics", "parent_org_id": "o"}).json()
    child = client.post("/api/v1/departments", headers=admin, json={
        "name": "Qubits", "parent_org_id": "o", "parent_dept_id": parent["id"]}).json()
    alice_id = str(_uid(alice))

    assert client.post(f"/api/v1/departments/{child['id']}/members", headers=admin,
                       json={"user_id": alice_id}).status_code == 201
    assert client.post(f"/api/v1/departments/{child['id']}/members", headers=admin,
                       json={"user_id": alice_id}).status_code == 409
    members = client.get(f"/api/v1/departments/{child['id']}/members", headers=alice).json()
    assert members["count"] == 1 and members["members"][0]["email"].startswith("a1alice_")

    upd = client.put(f"/api/v1/departments/{child['id']}", headers=admin, json={"name": "Qubit Lab"}).json()
    assert upd["name"] == "Qubit Lab"
    assert client.get(f"/api/v1/departments/{child['id']}").json()["name"] == "Qubit Lab"

    tree = client.get("/api/v1/departments/tree").json()
    node = next(d for d in tree["departments"] if d["id"] == parent["id"])
    assert [c["id"] for c in node["children"]] == [child["id"]]

    assert client.delete(f"/api/v1/departments/{child['id']}/members/{alice_id}", headers=admin).json()["removed"]
    assert client.delete(f"/api/v1/departments/{child['id']}/members/{alice_id}",
                         headers=admin).status_code == 404
    assert client.delete(f"/api/v1/departments/{child['id']}", headers=owner).json()["deleted"] is True
    assert client.get(f"/api/v1/departments/{child['id']}").status_code == 404


# ── circuit designer (AI) ────────────────────────────────────────────────────

def test_circuit_designer_stores_the_ai_design(monkeypatch, alice):
    reply = {"qasm_circuit": "OPENQASM 2.0;", "python_code": "qc = 1", "n_qubits": 3, "estimated_depth": 4,
             "gate_counts": {"h": 1, "cx": 2}, "explanation": "GHZ", "usage_tips": ["t"],
             "suggested_backends": ["ibm_x"]}
    monkeypatch.setattr(designer_router, "ai_complete_json", lambda *a, **k: reply)
    assert client.post("/api/v1/circuit-designer/design", json={"description": "GHZ"}).status_code == 401
    d = client.post("/api/v1/circuit-designer/design", headers=alice,
                    json={"description": "A three qubit GHZ state for a benchmark run"}).json()
    assert d["circuit_info"] == {"n_qubits": 3, "depth": 4, "gate_counts": {"h": 1, "cx": 2}, "total_gates": 3,
                                 "estimated_depth": 4}
    stored = client.get(f"/api/v1/circuit-designer/design/{d['design_id']}").json()
    assert stored["qasm_circuit"] == "OPENQASM 2.0;"
    sub = client.post(f"/api/v1/circuit-designer/design/{d['design_id']}/submit-run").json()
    assert sub["qasm"] == "OPENQASM 2.0;" and sub["circuit_name"] == "A three qubit GHZ state for a benchmark run"[:50]
    assert client.get("/api/v1/circuit-designer/design/cd-missing").status_code == 404

    def no_provider(*a, **k):
        raise NoAIProviderError("none")

    monkeypatch.setattr(designer_router, "ai_complete_json", no_provider)
    assert client.post("/api/v1/circuit-designer/design", headers=alice, json={"description": "x"}).status_code == 503


# ── arXiv search ─────────────────────────────────────────────────────────────

_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <published>2024-01-02T00:00:00Z</published>
    <title>Variational Quantum
 Eigensolver at Scale</title>
    <summary>We run VQE.</summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Alan Turing</name></author>
    <category term="quant-ph"/>
    <link title="doi" href="https://doi.org/10.1000/vqe"/>
  </entry>
</feed>"""


def test_arxiv_search_parses_the_live_feed(monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout=None):
        seen["url"] = req.full_url
        return io.BytesIO(_ATOM.encode())

    monkeypatch.setattr(arxiv_search_router.urllib.request, "urlopen", fake_urlopen)
    r = client.post("/api/v1/arxiv-search", json={"query": "vqe", "category": "quant-ph", "max_results": 5}).json()
    assert r["source"] == "arxiv_api" and r["n_results"] == 1
    assert "cat%3Aquant-ph" in seen["url"]
    paper = r["results"][0]
    assert paper["arxiv_id"] == "2401.00001v1" and paper["year"] == 2024
    assert paper["title"] == "Variational Quantum  Eigensolver at Scale"
    assert paper["authors"] == ["Ada Lovelace", "Alan Turing"]
    assert paper["doi_url"] == "https://doi.org/10.1000/vqe"
    assert paper["bibtex"].startswith("@article{Lovelace2024,")
    assert r["related_topics"] == ["quant-ph"]


def test_arxiv_search_falls_back_to_the_curated_list(monkeypatch):
    def offline(req, timeout=None):
        raise OSError("no network")

    monkeypatch.setattr(arxiv_search_router.urllib.request, "urlopen", offline)
    r = client.post("/api/v1/arxiv-search", json={"query": "shor factoring"}).json()
    assert r["source"] == "local_cache"
    assert r["results"][0]["authors"] == ["Peter W. Shor"]
    assert client.post("/api/v1/arxiv-search", json={"query": ""}).status_code == 422
