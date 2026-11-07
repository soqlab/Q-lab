"""IonQ auto-capture through qiskit-ionq (qlab.providers.ionq).

No IonQ key is used. qiskit-ionq is pointed (IonQProvider(url=...), IONQ_API_URL) at a local
HTTP server standing in for api.ionq.co/v0.4. It answers the requests qiskit-ionq makes, with
responses in the v0.4 shape qiskit-ionq parses: POST /jobs, GET /jobs/{id} (echoing the
submitted metadata, as the API does), GET /jobs/{id}/results/probabilities, GET /backends/{name}
and GET /backends/{name}/characterizations. The responses are hand-written from that shape,
not recorded from IonQ; everything above the HTTP layer (IonQBackend.run, IonQJob, result
parsing) is qiskit-ionq's real code. Nothing has been run on IonQ's cloud.
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

pytest.importorskip("qiskit_ionq")
from qiskit import QuantumCircuit  # noqa: E402

import qlab  # noqa: E402
from qlab import providers, qiskit_hooks  # noqa: E402
from qlab.providers import ionq as qionq  # noqa: E402

CHARACTERIZATION = {
    "id": "c0ffee00-0000-4000-8000-000000000001",
    "backend": "qpu.forte-1",
    "date": "2026-11-05T06:00:00Z",
    "qubits": 36,
    "connectivity": [[0, 1], [1, 0]],
    "fidelity": {"spam": {"median": 0.9952}, "1q": {"median": 0.9998}, "2q": {"median": 0.9941}},
    "timing": {"t1": 100, "t2": 1, "1q": 0.000063, "2q": 0.00065, "readout": 0.0002, "reset": 0.00002},
}


class IonQStub(BaseHTTPRequestHandler):
    jobs: dict = {}
    submitted: list = []
    probabilities = {"0": 0.5, "3": 0.5}

    def log_message(self, *args):
        pass

    def _send(self, body, status=200):
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert self.path == "/v0.4/jobs"
        job_id = f"0193b2c4-0000-7000-8000-{len(self.submitted):012d}"
        self.submitted.append(body)
        self.jobs[job_id] = body
        self._send({"id": job_id, "status": "submitted"})

    def do_GET(self):
        parts = self.path.split("?")[0].strip("/").split("/")  # v0.4, ...
        if parts[1:2] == ["backends"]:
            if parts[-1] == "characterizations":
                return self._send({"characterizations": [CHARACTERIZATION]})
            return self._send({"backend": parts[2], "qubits": 36 if "forte" in parts[2] else 29})
        if parts[1:2] == ["jobs"]:
            job_id = parts[2]
            job = self.jobs[job_id]
            if parts[3:] == ["results", "probabilities"]:
                return self._send(self.probabilities)
            return self._send({
                "id": job_id, "status": "completed", "type": job.get("type"),
                "backend": job.get("backend"), "metadata": job.get("metadata"),
                "noise": job.get("noise"), "stats": {"qubits": 2, "circuits": 1},
                "execution_duration_ms": 12,
                "results": {"probabilities": {"url": f"/v0.4/jobs/{job_id}/results/probabilities"}},
            })
        self._send({"error": "not found"}, 404)


@pytest.fixture
def ionq_api(monkeypatch):
    server = HTTPServer(("127.0.0.1", 0), IonQStub)
    IonQStub.jobs, IonQStub.submitted = {}, []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/v0.4"
    monkeypatch.setenv("IONQ_API_URL", url)
    monkeypatch.setenv("IONQ_API_KEY", "offline-test-key")
    yield url
    server.shutdown()


@pytest.fixture
def captured(monkeypatch):
    qlab.init(api_url="http://127.0.0.1:9", api_key=None)
    providers.patch_installed()
    client = qiskit_hooks._CLIENT
    sent: list[dict] = []
    updates: list[tuple[str, dict]] = []
    monkeypatch.setattr(client, "send_run_async", lambda payload: sent.append(payload))
    monkeypatch.setattr(client, "update_run_async", lambda run_id, payload: updates.append((run_id, payload)))
    monkeypatch.setattr(client, "check_policy", lambda payload: {"violations": []})
    monkeypatch.setattr(qiskit_hooks, "_shadow_simulate", lambda *a, **k: None)
    return sent, updates


def _provider(url):
    from qiskit_ionq import IonQProvider
    return IonQProvider(token="offline-test-key", url=url)


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2, name="bell")
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc


def test_simulator_run_records_noise_model_job_and_counts(ionq_api, captured):
    sent, updates = captured
    backend = _provider(ionq_api).get_backend("simulator")
    job = backend.run(_bell(), shots=1000, noise_model="aria-1")

    assert len(sent) == 1
    run = sent[0]
    assert run["backend"] == "ionq_simulator"
    assert run["execution"]["job_id"] == job.job_id() == "0193b2c4-0000-7000-8000-000000000000"
    assert run["execution"]["shots"] == 1000
    ctx = run["context"]
    assert ctx["provider"] == "ionq" and ctx["framework"] == "qiskit-ionq"
    assert ctx["device"]["type"] == "SIMULATOR"
    assert ctx["device"]["noise_model"] == "aria-1"
    assert "qiskit-ionq" in ctx["setup"]["packages"]
    assert run["calibration"] == {}  # simulators have no characterization
    # What reached IonQ is what Q-Lab recorded.
    assert IonQStub.submitted[0]["noise"]["model"] == "aria-1"
    assert IonQStub.submitted[0]["shots"] == 1000

    counts = job.result().get_counts()
    done = [p for rid, p in updates if rid == run["run_id"] and p["status"] == "completed"]
    assert len(done) == 1
    assert done[0]["results"]["counts"] == counts
    assert set(counts) == {"00", "11"}


def test_backend_default_noise_model_and_shots(ionq_api, captured):
    sent, _ = captured
    backend = _provider(ionq_api).get_backend("simulator")
    backend.run(_bell())
    run = sent[0]
    assert run["context"]["device"]["noise_model"] == "ideal"
    assert run["execution"]["shots"] == 1024 and run["execution"]["shots_source"] == "default"


def test_qpu_run_records_characterization(ionq_api, captured):
    sent, updates = captured
    IonQStub.probabilities = {"0": 0.49, "3": 0.48, "1": 0.03}
    try:
        backend = _provider(ionq_api).get_backend("qpu.forte-1")
        job = backend.run(_bell(), shots=100)
        job.result()
    finally:
        IonQStub.probabilities = {"0": 0.5, "3": 0.5}
    run = sent[0]
    assert run["backend"] == "ionq_qpu.forte-1"
    dev = run["context"]["device"]
    assert dev["type"] == "QPU" and dev["api_name"] == "qpu.forte-1" and "noise_model" not in dev
    cal = run["calibration"]
    assert cal["source"] == "ionq_characterization"
    assert cal["readout_errors"]["avg"] == pytest.approx(1 - 0.9952)
    assert cal["gate_errors"]["2q"] == pytest.approx(1 - 0.9941)
    assert cal["t1_us"]["avg"] == pytest.approx(100e6)
    assert cal["gate_durations_us"]["2q"] == pytest.approx(650)
    assert cal["snapshot_time"] == "2026-11-05T06:00:00Z"
    done = [p for rid, p in updates if rid == run["run_id"] and p["status"] == "completed"]
    assert sum(done[0]["results"]["counts"].values()) == pytest.approx(100, abs=2)


def test_characterization_conversion_handles_missing_blocks():
    assert qionq.calibration_from_characterization(None) == {}
    assert qionq.calibration_from_characterization({"fidelity": {}, "timing": {}}) == {}
    cal = qionq.calibration_from_characterization({"fidelity": {"2q": {"mean": 0.99}}})
    assert cal["gate_errors"] == {"2q": pytest.approx(0.01)}


def test_non_ionq_backends_are_left_alone(captured):
    aer = pytest.importorskip("qiskit_aer")
    sent, _ = captured
    aer.AerSimulator().run(_bell(), shots=10).result()
    assert "provider" not in sent[0]["context"]
