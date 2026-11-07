"""Runs captured by the SDK's Amazon Braket and IonQ adapters: accepted, stored, and returned
with their provider and device.

The payloads below have the shape qlab.providers.braket / qlab.providers.ionq send
(qlab_sdk/tests/test_braket_capture.py and test_ionq_capture.py check the SDK side).
"""

import uuid
from datetime import datetime, timezone

from app import pricing
from app.database import engine, init_db
from app.main import app
from fastapi.testclient import TestClient
from sqlalchemy import text

init_db()
client = TestClient(app, raise_server_exceptions=False)
PASSWORD = "Provider-Runs-Password-1!"

BELL_QASM3 = "OPENQASM 3.0;\nbit[2] b;\nqubit[2] q;\nh q[0];\ncnot q[0], q[1];\nb[0] = measure q[0];\nb[1] = measure q[1];"


def _headers() -> dict:
    email = f"prov_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": "P"})
    assert r.status_code in (200, 201), r.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified = 1 WHERE email = :e"), {"e": email})
    token = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _run(provider: str, backend: str, device: dict, **extra) -> dict:
    return {
        "run_id": str(uuid.uuid4()),
        "circuit_name": "bell",
        "qasm": BELL_QASM3,
        "fingerprint": {"num_qubits": 2, "depth": 2, "size": 2, "gate_counts": {"h": 1, "cnot": 1}},
        "context": {"provider": provider, "device": device, "framework": provider},
        "backend": backend,
        "execution": {"shots": 100, "shots_source": "run", **extra.pop("execution", {})},
        "project": "provider-runs",
        "status": "submitted",
        "created_at": datetime.now(timezone.utc).isoformat(),
        **extra,
    }


def test_braket_run_is_stored_with_provider_and_device():
    h = _headers()
    arn = "arn:aws:braket:us-east-1::device/qpu/ionq/Forte-1"
    body = _run("braket", "braket:Forte 1",
                {"name": "Forte 1", "arn": arn, "provider_name": "IonQ", "type": "QPU"},
                execution={"task_id": "arn:aws:braket:us-east-1:123456789012:quantum-task/abc"},
                calibration={"t1_us": {"0": 1.0e8}, "gate_errors": {"cz_0_1": 0.01}, "source": "braket"})
    assert client.post("/api/v1/runs", headers=h, json=body).status_code == 200

    upd = client.patch(f"/api/v1/runs/{body['run_id']}", headers=h, json={
        "status": "completed", "results": {"counts": {"00": 52, "11": 48}, "task_id": "abc"},
    })
    assert upd.status_code == 200, upd.text

    got = client.get(f"/api/v1/runs/{body['run_id']}", headers=h).json()
    assert got["provider"] == "braket"
    assert got["device"]["arn"] == arn and got["device"]["provider_name"] == "IonQ"
    assert got["backend"] == "braket:Forte 1"
    assert got["qasm"].startswith("OPENQASM 3.0;")
    assert got["results"]["counts"] == {"00": 52, "11": 48}
    assert got["calibration"]["gate_errors"] == {"cz_0_1": 0.01}
    assert got["health_score"] is not None

    listed = client.get("/api/v1/runs?project=provider-runs&limit=1000", headers=h).json()
    row = next(r for r in listed if r["run_id"] == body["run_id"])
    assert row["provider"] == "braket" and row["device"]["name"] == "Forte 1"

    # The backend name resolves to the right price entry.
    assert pricing.resolve(got["backend"]) == "braket_ionq_forte"
    assert pricing.resolve("braket:SV1") == "braket_sv1"
    assert pricing.resolve("braket:StateVectorSimulator") == "local_simulator"


def test_ionq_run_is_stored_with_noise_model():
    h = _headers()
    body = _run("ionq", "ionq_simulator",
                {"name": "ionq_simulator", "provider_name": "IonQ", "type": "SIMULATOR",
                 "noise_model": "aria-1"},
                execution={"job_id": "0193b2c4-ionq-job"})
    assert client.post("/api/v1/runs", headers=h, json=body).status_code == 200
    got = client.get(f"/api/v1/runs/{body['run_id']}", headers=h).json()
    assert got["provider"] == "ionq"
    assert got["device"]["noise_model"] == "aria-1"
    assert got["execution"]["job_id"] == "0193b2c4-ionq-job"


def test_runs_without_provider_report_none():
    h = _headers()
    body = _run("x", "aer_simulator", {})
    body["context"] = {"python_version": "3.12"}
    assert client.post("/api/v1/runs", headers=h, json=body).status_code == 200
    got = client.get(f"/api/v1/runs/{body['run_id']}", headers=h).json()
    assert got["provider"] is None and got["device"] is None
