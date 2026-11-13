"""Verify this run (app/routers/verify_run.py): checks anyone can repeat on the stored record."""
import hashlib
import json
import uuid

from tests.helpers import BELL, client, make_user, run_payload


def _post(headers, **kw) -> str:
    body = run_payload(**kw)
    assert client.post("/api/v1/runs", headers=headers, json=body).status_code == 200
    return body["run_id"]


def _verify(headers, rid):
    r = client.get(f"/api/v1/runs/{rid}/verify", headers=headers)
    assert r.status_code == 200, r.text
    return r.json(), {c["id"]: c for c in r.json()["checks"]}


def test_consistent_run_passes_and_digest_is_recomputable():
    me = make_user(prefix="ver")
    rid = _post(me, fingerprint={"num_qubits": 2, "qasm_sha256": hashlib.sha256(BELL.encode()).hexdigest()},
                execution={"shots": 1000}, results={"counts": {"00": 497, "11": 503}})
    body, checks = _verify(me, rid)
    assert checks["circuit_hash"]["status"] == "pass"
    assert checks["shots"]["status"] == "pass"
    assert checks["result"]["status"] == "pass" and "100.00%" in checks["result"]["detail"]
    assert body["passed"] is True
    # The digest is what the documented one-liner computes from the returned record.
    text = json.dumps(body["record"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert hashlib.sha256(text.encode()).hexdigest() == body["record_sha256"]
    assert "board" not in checks


def test_mismatches_fail_and_missing_data_is_cant():
    me = make_user(prefix="ver")
    rid = _post(me, fingerprint={"num_qubits": 2, "qasm_sha256": "0" * 64}, execution={"shots": 2000},
                results={"counts": {"00": 497, "11": 503}})
    body, checks = _verify(me, rid)
    assert checks["circuit_hash"]["status"] == "fail"
    assert checks["shots"]["status"] == "fail"
    assert body["passed"] is False
    rid2 = _post(me, qasm=None, fingerprint={}, results={})
    _, c2 = _verify(me, rid2)
    assert c2["circuit_hash"]["status"] == "cant" and c2["shots"]["status"] == "cant" and c2["result"]["status"] == "cant"


def test_uploaded_lookalike_of_a_board_run_fails_the_board_check():
    me = make_user(prefix="ver")
    rid = _post(me, run_id=f"hwb-fake{uuid.uuid4().hex[:8]}-bell", context={"source": "hardware-board"},
                execution={"shots": 1000, "job_id": "d0fake"})
    _, checks = _verify(me, rid)
    assert checks["board"]["status"] == "fail"


def test_someone_elses_run_is_not_verifiable_here():
    alice, bob = make_user(prefix="ver"), make_user(prefix="ver")
    rid = _post(alice)
    assert client.get(f"/api/v1/runs/{rid}/verify", headers=bob).status_code == 404
