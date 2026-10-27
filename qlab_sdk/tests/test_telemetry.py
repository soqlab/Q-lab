"""The install ping: only for the hosted service, never for self-hosted setups, and opt-out."""
import json

import pytest

from qlab import __version__, qiskit_hooks


@pytest.fixture
def sent(monkeypatch):
    calls = []

    class Thread:  # run the ping inline so the test can see it
        def __init__(self, target, daemon=None):
            self.target = target

        def start(self):
            self.target()

    def urlopen(req, timeout=None):
        calls.append({"url": req.full_url, "body": json.loads(req.data)})

    monkeypatch.setattr("threading.Thread", Thread)
    monkeypatch.setattr("urllib.request.urlopen", urlopen)
    monkeypatch.delenv("QLAB_TELEMETRY", raising=False)
    original = qiskit_hooks._CONFIG.get("api_url")
    yield calls
    qiskit_hooks._CONFIG["api_url"] = original


@pytest.mark.parametrize("api_url", ["http://localhost:8000", "https://qlab.example-lab.org", ""])
def test_self_hosted_setups_send_nothing(sent, api_url):
    qiskit_hooks._CONFIG["api_url"] = api_url
    qiskit_hooks._fire_telemetry_ping()
    assert sent == []


def test_hosted_service_sends_only_versions(sent):
    qiskit_hooks._CONFIG["api_url"] = "https://qlab-backend.onrender.com"
    qiskit_hooks._fire_telemetry_ping()
    assert len(sent) == 1
    assert set(sent[0]["body"]) == {"sdk_version", "python"}
    assert sent[0]["body"]["sdk_version"] == __version__


def test_opt_out(sent, monkeypatch):
    monkeypatch.setenv("QLAB_TELEMETRY", "off")
    qiskit_hooks._CONFIG["api_url"] = "https://qlab.soqlab.com/qlab-api"
    qiskit_hooks._fire_telemetry_ping()
    assert sent == []
