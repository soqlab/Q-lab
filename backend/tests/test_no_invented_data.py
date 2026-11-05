"""Q-Lab must not present invented numbers as real, and must never invent a DOI."""
import sys
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.calibration_history import calibration_metric
from app.illustrative import ILLUSTRATIVE_ROUTERS
from app.main import app

client = TestClient(app, raise_server_exceptions=False)
BELL = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'


def _user() -> dict:
    email = f"data-{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": "testpassword", "name": "T"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _run(headers, backend, hours_ago, t1, t2=None, counts=None, qasm=None):
    calibration = {"t1_us": {"0": t1, "1": t1 + 2}}
    if t2 is not None:
        calibration["t2_us"] = {"0": t2}
    run_id = f"run-{uuid.uuid4().hex[:12]}"
    r = client.post("/api/v1/runs", headers=headers, json={
        "run_id": run_id, "backend": backend, "calibration": calibration, "qasm": qasm,
        "results": {"counts": counts or {}}, "status": "completed",
        "created_at": (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat(),
    })
    assert r.status_code == 200, r.text
    return run_id


# ── The notice ────────────────────────────────────────────────────────────────

def test_illustrative_tools_are_marked_and_real_ones_are_not():
    assert client.post("/api/v1/xeb", json={}).headers.get("x-qlab-data") == "illustrative"
    assert "x-qlab-data" not in client.get("/health").headers


def test_every_listed_router_exists():
    missing = [name for name in ILLUSTRATIVE_ROUTERS if f"app.routers.{name}" not in sys.modules]
    assert missing == [], "a renamed router would silently lose its label"


def test_calibration_without_a_key_is_marked_illustrative():
    r = client.get("/api/v1/calibration-oracle/ibm_brisbane", headers=_user())
    assert r.status_code == 200
    assert r.json()["data_source"] == "simulated"
    assert r.headers["x-qlab-data"] == "illustrative"


# ── DOIs ──────────────────────────────────────────────────────────────────────

def test_doi_is_not_invented_without_a_repository(monkeypatch):
    headers = _user()
    run_id = _run(headers, "aer", 1, 100.0)
    monkeypatch.delenv("ZENODO_TOKEN", raising=False)
    r = client.post(f"/api/v1/doi/mint/{run_id}", headers=headers, json={
        "title": "T", "description": "D", "authors": ["A"], "keywords": [], "license": "cc-by-4.0"})
    assert r.status_code == 200, r.text
    assert r.json()["doi"] is None
    assert r.json()["citation_text"] is None
    assert client.get(f"/api/v1/doi/cite/{run_id}", headers=headers).status_code == 404


def test_dataset_publication_without_a_repository_stays_a_draft():
    from app.routers.dataset_publish import PublishRequest

    headers = _user()
    body = {"title": "T", "description": "D", "repository": "zenodo", "license": "cc-by-4.0", "keywords": [],
            "authors": ["A"], "run_ids": ["x"]}
    PublishRequest(**body)
    r = client.post("/api/v1/dataset-publish/publish", headers=headers, json=body)
    assert r.status_code == 200, r.text
    pub = r.json()
    assert pub["doi"] is None and pub["status"] == "draft"
    assert client.get(f"/api/v1/dataset-publish/publication/{pub['pub_id']}", headers=headers).json()["doi"] is None
    assert client.post(f"/api/v1/dataset-publish/{pub['pub_id']}/mint-doi", headers=headers).status_code == 503


# ── Forecasts ─────────────────────────────────────────────────────────────────

def test_sdk_shaped_calibration_gives_one_number_per_snapshot():
    assert calibration_metric({"t1_us": {"0": 100.0, "1": 200.0}}, "avg_t1_us") == 150.0
    assert calibration_metric({"avg_t1_us": 90}, "avg_t1_us") == 90.0
    assert calibration_metric({}, "avg_t1_us") is None
    assert calibration_metric(None, "avg_t2_us") is None


def test_forecast_refuses_without_real_history():
    backend = f"ibm_{uuid.uuid4().hex[:6]}"
    r = client.post("/api/v1/cal-forecast/forecast", headers=_user(), json={"backend": backend})
    assert r.status_code == 422
    assert "Found 0" in r.json()["detail"]


def test_forecast_follows_the_users_own_calibration():
    headers = _user()
    backend = f"ibm_{uuid.uuid4().hex[:6]}"
    for i, hours_ago in enumerate([50, 40, 30, 20, 10, 0]):
        _run(headers, backend, hours_ago, t1=200.0 - i * 10, t2=90.0)  # falls exactly 1 us per hour
    r = client.post("/api/v1/cal-forecast/forecast", headers=headers, json={"backend": backend, "horizon_hours": 20})
    assert r.status_code == 200, r.text
    fc = r.json()
    assert fc["training_points"] == 6
    assert fc["model_r2"] > 0.99
    assert abs(fc["forecasts"][0]["t1_predicted_us"] - 151.0) < 1
    assert abs(fc["forecasts"][-1]["t1_predicted_us"] - 131.0) < 1
    assert fc["degradation_alert"] is True
    assert client.post("/api/v1/cal-forecast/forecast", headers=headers, json={"backend": backend}).json()["model_r2"] == fc["model_r2"]


def test_one_users_calibration_does_not_feed_anothers_forecast():
    alice, bob = _user(), _user()
    backend = f"ibm_{uuid.uuid4().hex[:6]}"
    for h in range(6):
        _run(alice, backend, h * 5, t1=100.0 + h)
    assert client.post("/api/v1/cal-forecast/forecast", headers=bob, json={"backend": backend}).status_code == 422


def test_health_forecast_reads_what_the_sdk_sends():
    headers = _user()
    backend = f"ibm_{uuid.uuid4().hex[:6]}"
    for i, hours_ago in enumerate([30, 20, 10, 0]):
        _run(headers, backend, hours_ago, t1=100.0 + i)
    r = client.get(f"/api/v1/health-forecast/{backend}", headers=headers, params={"metric": "t1"})
    assert r.status_code == 200, r.text
    assert r.json()["data_points"] == 4


# ── Reproducibility and simulated jobs ────────────────────────────────────────

def test_reproducibility_compares_with_a_real_simulation():
    headers = _user()
    good = _run(headers, "aer", 1, 100.0, counts={"00": 500, "11": 500}, qasm=BELL)
    bad = _run(headers, "aer", 1, 100.0, counts={"01": 500, "10": 500}, qasm=BELL)
    good_r = client.post("/api/v1/reproducibility", headers=headers, json={"run_id": good, "n_reruns": 3, "shots": 500})
    bad_r = client.post("/api/v1/reproducibility", headers=headers, json={"run_id": bad, "n_reruns": 3, "shots": 500})
    assert good_r.status_code == 200, good_r.text
    assert good_r.json()["reproducibility_score"] > 0.9
    assert bad_r.json()["reproducibility_score"] < 0.1
    assert "not a rerun on hardware" in good_r.json()["method"]


def test_simulated_job_counts_come_from_the_circuit():
    import random

    from app.routers.hardware_jobs import _simulate_counts

    counts = _simulate_counts(BELL, "any", 500, random.Random(1))
    assert set(counts) <= {"00", "11"} and sum(counts.values()) == 500
