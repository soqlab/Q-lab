"""QLabClient against a real local HTTP server: what is sent, and what happens when it fails."""
import json

import pytest

from qlab.client import QLabClient

WAIT = 60  # seconds; generous for slow CI machines, the calls return as soon as the threads finish


def _client(server, tmp_path, **kw) -> QLabClient:
    kw.setdefault("api_key", "qlab_testkey")
    return QLabClient(server.url + "/", timeout=2.0, queue_path=str(tmp_path / "q.jsonl"),
                      retry_on_start=False, **kw)


def _queued(tmp_path) -> list[dict]:
    path = tmp_path / "q.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_send_run_posts_payload_with_api_key(fake_qlab, tmp_path):
    client = _client(fake_qlab, tmp_path)
    client.send_run_async({"run_id": "r1", "circuit_name": "bell"})
    client.flush(timeout=WAIT)
    [req] = fake_qlab.received("POST", "/api/v1/runs")
    assert req["json"] == {"run_id": "r1", "circuit_name": "bell"}
    assert req["headers"]["x-qlab-api-key"] == "qlab_testkey"
    assert _queued(tmp_path) == []


def test_no_api_key_header_without_a_key(fake_qlab, tmp_path, monkeypatch):
    monkeypatch.delenv("QLAB_API_KEY", raising=False)
    client = _client(fake_qlab, tmp_path, api_key=None)
    client.send_run_async({"run_id": "anon"})
    client.flush(timeout=WAIT)
    assert "x-qlab-api-key" not in fake_qlab.received("POST", "/api/v1/runs")[0]["headers"]


def test_api_key_comes_from_environment(fake_qlab, tmp_path, monkeypatch):
    monkeypatch.setenv("QLAB_API_KEY", "qlab_from_env")
    client = _client(fake_qlab, tmp_path, api_key=None)
    assert client.api_key == "qlab_from_env"


def test_failed_upload_is_queued_and_replayed(fake_qlab, tmp_path):
    client = _client(fake_qlab, tmp_path)
    fake_qlab.respond("POST", "/api/v1/runs", {"detail": "down"}, status=503)
    client.send_run_async({"run_id": "later"})
    for t in list(client._threads):
        t.join(WAIT)
    assert _queued(tmp_path) == [{"run_id": "later"}]

    # Still failing: the run stays in the queue.
    client._retry_pending()
    assert _queued(tmp_path) == [{"run_id": "later"}]

    # Server back: the queue is replayed and removed.
    fake_qlab.respond("POST", "/api/v1/runs", {"status": "received"})
    client._retry_pending()
    assert not (tmp_path / "q.jsonl").exists()
    assert [r["json"] for r in fake_qlab.received("POST", "/api/v1/runs")][-1] == {"run_id": "later"}


def test_failed_update_is_queued_and_replayed_as_patch(fake_qlab, tmp_path):
    client = _client(fake_qlab, tmp_path)
    fake_qlab.respond("PATCH", "/api/v1/runs/r9", {}, status=500)
    client.update_run_async("r9", {"status": "completed"})
    for t in list(client._threads):
        t.join(WAIT)
    assert _queued(tmp_path) == [{"_qlab_update_run_id": "r9", "status": "completed"}]

    fake_qlab.respond("PATCH", "/api/v1/runs/r9", {})
    client.flush(timeout=WAIT)
    patches = fake_qlab.received("PATCH", "/api/v1/runs/r9")
    assert patches[-1]["json"] == {"status": "completed"}  # the queue marker is not sent
    assert patches[-1]["headers"]["x-qlab-api-key"] == "qlab_testkey"
    assert _queued(tmp_path) == []


def test_unreadable_queue_lines_are_dropped(fake_qlab, tmp_path):
    (tmp_path / "q.jsonl").write_text('not json\n\n{"run_id": "ok"}\n', encoding="utf-8")
    client = _client(fake_qlab, tmp_path)
    client._retry_pending()
    assert [r["json"] for r in fake_qlab.received("POST", "/api/v1/runs")] == [{"run_id": "ok"}]
    assert not (tmp_path / "q.jsonl").exists()


def test_unreachable_server_queues_instead_of_raising(tmp_path):
    client = QLabClient("http://127.0.0.1:9", timeout=0.5, queue_path=str(tmp_path / "q.jsonl"),
                        retry_on_start=False)
    client.send_run_async({"run_id": "offline"})
    for t in list(client._threads):
        t.join(WAIT)
    assert _queued(tmp_path) == [{"run_id": "offline"}]


def test_metrics_and_benchmark_uploads(fake_qlab, tmp_path):
    client = _client(fake_qlab, tmp_path)
    client.log_metrics_async("r1", [{"name": "energy", "value": -1.1, "step": 0}])
    client.send_benchmark_async({"benchmark_id": "b1", "backends": ["a", "b"]})
    client.flush(timeout=WAIT)
    [m] = fake_qlab.received("POST", "/api/v1/runs/r1/metrics")
    assert m["json"] == {"metrics": [{"name": "energy", "value": -1.1, "step": 0}]}
    [b] = fake_qlab.received("POST", "/api/v1/benchmarks")
    assert b["json"]["benchmark_id"] == "b1" and b["headers"]["x-qlab-api-key"] == "qlab_testkey"


def test_metric_failures_are_swallowed(fake_qlab, tmp_path):
    fake_qlab.default_status = 500
    client = _client(fake_qlab, tmp_path)
    client._log_metrics("r1", [])
    client._send_benchmark({})
    assert _queued(tmp_path) == []  # metrics and benchmarks are not queued


def test_policy_check_and_fetch(fake_qlab, tmp_path):
    client = _client(fake_qlab, tmp_path)
    verdict = {"policy_active": True, "passed": False, "violation_count": 1,
               "violations": [{"message": "too deep"}]}
    fake_qlab.respond("POST", "/api/v1/policy/check", verdict)
    fake_qlab.respond("GET", "/api/v1/policy", {"rules": {"max_depth": 10}})
    assert client.check_policy({"run_id": "x"}) == verdict
    assert fake_qlab.received("POST", "/api/v1/policy/check")[0]["json"] == {"run_id": "x"}
    assert client.get_policy() == {"rules": {"max_depth": 10}}


def test_policy_server_errors_fail_open(fake_qlab, tmp_path):
    fake_qlab.default_status = 500
    client = _client(fake_qlab, tmp_path)
    assert client.check_policy({}) == {"policy_active": False, "passed": True, "violation_count": 0,
                                       "violations": []}
    assert client.get_policy() == {}


def test_campaign_calls(fake_qlab, tmp_path):
    client = _client(fake_qlab, tmp_path)
    fake_qlab.respond("POST", "/api/v1/campaigns", {"campaign_id": "cmp_1", "total_combinations": 2})
    fake_qlab.respond("GET", "/api/v1/campaigns/cmp_1/combinations",
                      {"combinations": [{"shots": 100}, {"shots": 1000}]})
    fake_qlab.respond("GET", "/api/v1/campaigns/cmp_1", {"campaign_id": "cmp_1", "status": "active"})

    created = client.create_campaign("sweep", grid=[{"name": "shots", "values": [100, 1000]}], project="p")
    assert created["campaign_id"] == "cmp_1"
    body = fake_qlab.received("POST", "/api/v1/campaigns")[0]["json"]
    assert body == {"name": "sweep", "grid": [{"name": "shots", "values": [100, 1000]}],
                    "description": None, "project": "p", "tags": []}
    assert client.campaign_combinations("cmp_1") == [{"shots": 100}, {"shots": 1000}]
    assert client.get_campaign("cmp_1")["status"] == "active"


@pytest.mark.parametrize("call", [
    lambda c: c.create_campaign("x", grid=[]),
    lambda c: c.campaign_combinations("missing"),
    lambda c: c.get_campaign("missing"),
])
def test_campaign_errors_raise(fake_qlab, tmp_path, call):
    fake_qlab.default_status = 404
    with pytest.raises(RuntimeError):
        call(_client(fake_qlab, tmp_path))
