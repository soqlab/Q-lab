"""IBM runs on each user's own key, and jobs belong to whoever submitted them."""
import uuid

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("qiskit_ibm_runtime")

from app import ibm_quantum  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app, raise_server_exceptions=False)

BELL = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'


def _user() -> dict:
    email = f"ibm-{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": "testpassword", "name": "T"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _save_key(headers: dict, provider: str, key: str) -> str:
    r = client.post("/api/v1/credentials", headers=headers, json={"provider": provider, "label": "mine", "api_key": key})
    assert r.status_code in (200, 201), r.text
    return r.json().get("cred_id") or r.json().get("id")


class _FakeService:
    """Stands in for IBM's servers: a real backend model and a real local sampler job."""

    seen_tokens: list = []
    jobs: dict = {}

    def __init__(self, token=None, channel=None):
        from qiskit_ibm_runtime.accounts import InvalidAccountError
        from qiskit_ibm_runtime.fake_provider import FakeManilaV2

        if token == "revoked-key":
            raise InvalidAccountError("Unable to retrieve instances.")
        _FakeService.seen_tokens.append(token)
        self.channel = channel
        self._backend = FakeManilaV2()

    def backend(self, name):
        return self._backend

    def backends(self):
        return [self._backend]

    def job(self, job_id):
        return _FakeService.jobs[job_id]


@pytest.fixture
def ibm(monkeypatch):
    import qiskit_ibm_runtime

    _FakeService.seen_tokens = []
    _FakeService.jobs = {}
    ibm_quantum._clients.clear()
    real = qiskit_ibm_runtime.SamplerV2

    class Recording(real):
        def run(self, pubs, *a, **k):
            job = super().run(pubs, *a, **k)
            _FakeService.jobs[job.job_id()] = job
            return job

    monkeypatch.setattr(qiskit_ibm_runtime, "IBMQuantumComputeService", _FakeService)
    monkeypatch.setattr(qiskit_ibm_runtime, "SamplerV2", Recording)
    monkeypatch.setattr("app.routers.job_executor._poll_job", lambda job_id: None)
    yield
    ibm_quantum._clients.clear()


def _submit(headers, provider="ibm"):
    return client.post("/api/v1/jobs", headers=headers,
                       json={"qasm": BELL, "backend": "ibm_fake", "shots": 100, "provider": provider})


def test_running_on_ibm_without_your_own_key_says_how_to_add_one(ibm):
    r = _submit(_user())
    assert r.status_code == 422
    assert "Credentials" in r.json()["detail"]
    assert _FakeService.seen_tokens == []


def test_each_user_runs_on_their_own_key_and_not_a_server_key(ibm, monkeypatch):
    monkeypatch.setenv("IBM_QUANTUM_TOKEN", "server-wide-key")
    alice, bob = _user(), _user()
    _save_key(alice, "ibm", "alice-key")
    _save_key(bob, "ibm", "bob-key")
    assert _submit(alice).status_code == 200
    assert _submit(bob).status_code == 200
    assert _FakeService.seen_tokens == ["alice-key", "bob-key"]


def test_a_refused_key_gets_a_clear_message(ibm):
    alice = _user()
    _save_key(alice, "ibm", "revoked-key")
    r = _submit(alice)
    assert r.status_code == 422
    assert "refused" in r.json()["detail"]


def test_credential_check_asks_ibm(ibm):
    alice = _user()
    good = _save_key(alice, "ibm", "alice-key")
    bad = _save_key(alice, "ibm", "revoked-key")
    assert client.post(f"/api/v1/credentials/{good}/test", headers=alice).json()["status"] == "valid"
    assert client.post(f"/api/v1/credentials/{bad}/test", headers=alice).json()["status"] == "invalid"


def test_ibm_job_poll_returns_real_counts(ibm):
    job_id = ibm_quantum.submit(BELL, "ibm_fake", 500, "alice-key")
    _FakeService.jobs[job_id].result()
    state = ibm_quantum.job_state(job_id, "alice-key")
    assert state["status"] == "completed"
    assert sum(state["counts"].values()) == 500


def test_clients_are_reused_per_key_and_never_shared(ibm):
    assert ibm_quantum.service("a") is ibm_quantum.service("a")
    assert ibm_quantum.service("a") is not ibm_quantum.service("b")
    assert all("a" != k for k in ibm_quantum._clients), "the raw key must not be stored as the cache key"


def test_calibration_parses_ibm_properties(ibm):
    from app.routers.calibration_oracle import _fetch_ibm_calibration

    cal = _fetch_ibm_calibration("ibm_fake", "alice-key")
    assert cal["data_source"] == "ibm_api"
    assert cal["n_qubits"] == 5
    assert cal["median_t1_us"] > 1
    assert isinstance(cal["timestamp"], str)


def test_queue_lists_only_with_the_users_own_key(ibm, monkeypatch):
    monkeypatch.setenv("IBM_QUANTUM_TOKEN", "server-wide-key")
    alice = _user()
    assert client.get("/api/v1/queue/status", headers=alice).status_code == 503
    _save_key(alice, "ibm", "alice-key")
    r = client.get("/api/v1/queue/status", headers=alice)
    assert r.status_code == 200
    assert _FakeService.seen_tokens == ["alice-key"]


# ── Whose job is it ───────────────────────────────────────────────────────────

def test_job_routes_require_signing_in(ibm):
    assert client.get("/api/v1/jobs").status_code == 401
    assert client.get("/api/v1/jobs/stats/summary").status_code == 401
    assert client.post("/api/v1/jobs", json={"qasm": BELL, "backend": "s", "provider": "simulator"}).status_code == 401
    assert client.get("/api/v1/jobs/job-x").status_code == 401
    assert client.post("/api/v1/jobs/job-x/cancel").status_code == 401


def test_nobody_can_see_or_cancel_someone_elses_job(ibm):
    alice, bob = _user(), _user()
    job_id = _submit(alice, "simulator").json()["job_id"]
    assert job_id in [j["job_id"] for j in client.get("/api/v1/jobs", headers=alice).json()]
    assert job_id not in [j["job_id"] for j in client.get("/api/v1/jobs", headers=bob).json()]
    assert client.get(f"/api/v1/jobs/{job_id}", headers=bob).status_code == 404
    assert client.post(f"/api/v1/jobs/{job_id}/cancel", headers=bob).status_code == 404
    assert client.get("/api/v1/jobs/stats/summary", headers=bob).json()["total_jobs"] == 0
    assert client.get(f"/api/v1/jobs/{job_id}", headers=alice).json()["status"] != "cancelled"


def test_cost_summary_counts_only_your_own_jobs():
    alice, bob = _user(), _user()
    assert client.post("/api/v1/jobs", headers=alice,
                       json={"qasm": BELL, "backend": "s", "shots": 100, "provider": "simulator"}).status_code == 200
    mine = client.get("/api/v1/costs/summary", params={"period": "monthly"}, headers=bob)
    assert mine.status_code == 200, mine.text
    assert mine.json()["total_usd"] == 0


def test_projects_are_private_to_their_owner_and_runs():
    alice, bob = _user(), _user()
    slug = f"secret-{uuid.uuid4().hex[:8]}"
    assert client.post("/api/v1/projects", headers=alice, json={"slug": slug, "name": "Alice's"}).status_code == 200
    assert slug in [p["slug"] for p in client.get("/api/v1/projects", headers=alice).json()]
    assert slug not in [p["slug"] for p in client.get("/api/v1/projects", headers=bob).json()]
    assert client.get(f"/api/v1/projects/{slug}/stats", headers=bob).status_code == 404
    takeover = client.post("/api/v1/projects", headers=bob, json={"slug": slug, "name": "Bob's now"})
    assert takeover.status_code == 409
    assert client.get(f"/api/v1/projects/{slug}/stats", headers=alice).json()["name"] == "Alice's"
