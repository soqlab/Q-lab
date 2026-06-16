import hashlib
import json

from qlab.client import QLabClient
from qlab.cli import cmd_queue_retry
from qlab import qiskit_hooks


def test_zk_qco_strips_qasm_and_keeps_salted_hash():
    qasm = "OPENQASM 2.0;\nqreg q[1];\nh q[0];"
    fingerprint = {"num_qubits": 1, "depth": 1, "gate_counts": {"h": 1}}

    original_config = dict(qiskit_hooks._CONFIG)
    try:
        qiskit_hooks._CONFIG["zk_qco"] = True
        qiskit_hooks._CONFIG["zk_qco_salt"] = "lab-secret"

        upload_qasm, upload_fingerprint, privacy = qiskit_hooks._apply_zk_qco(qasm, fingerprint)
    finally:
        qiskit_hooks._CONFIG.clear()
        qiskit_hooks._CONFIG.update(original_config)

    expected_hash = hashlib.sha256(("lab-secret\n" + qasm).encode("utf-8")).hexdigest()
    assert upload_qasm is None
    assert upload_fingerprint["qasm_sha256"] == expected_hash
    assert upload_fingerprint["zk_qco"] is True
    assert privacy["enabled"] is True
    assert privacy["qasm_sha256"] == expected_hash


def test_failed_run_upload_is_written_to_retry_queue(tmp_path):
    queue_path = tmp_path / "pending_runs.jsonl"
    client = QLabClient(
        api_url="http://127.0.0.1:9",
        timeout=0.05,
        queue_path=str(queue_path),
    )
    payload = {"run_id": "offline-run", "fingerprint": {"depth": 1}}

    client._send_run(payload)

    queued = [json.loads(line) for line in queue_path.read_text(encoding="utf-8").splitlines()]
    assert queued == [payload]


def test_queue_retry_cli_replays_pending_upload(tmp_path, monkeypatch, capsys):
    queue_path = tmp_path / "pending_runs.jsonl"
    queue_path.write_text(json.dumps({"run_id": "queued-run"}) + "\n", encoding="utf-8")

    sent = []

    def fake_send(self, payload):
        sent.append(payload)
        return True

    monkeypatch.setattr(QLabClient, "_send_run_sync", fake_send)
    args = type("Args", (), {"queue_path": str(queue_path)})()

    cmd_queue_retry(args, {"api_url": "http://localhost:8000", "api_key": ""})

    assert sent == [{"run_id": "queued-run"}]
    assert not queue_path.exists()
    assert "Uploaded : 1" in capsys.readouterr().out
