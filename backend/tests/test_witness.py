"""SOQLAB Witness: every finished run gets a signed, chained receipt, and tampering shows."""

import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.database import DATABASE_URL, SessionLocal, engine, init_db
from app.main import app
from app.models import Receipt, Run
from app.witness import KeysDocument, Receipt as ReceiptModel, verify, verify_chain
from app.witness_service import key_dir, run_data

init_db()
client = TestClient(app, raise_server_exceptions=False)
PASSWORD = "Witness-Test-Password-1!"
COUNTS = {"00": 500, "11": 524}
sqlite = DATABASE_URL.startswith("sqlite")


def _user() -> dict:
    email = f"wit_{uuid.uuid4().hex[:10]}@example.com"
    # Sign-up is rate limited per address, and other test files share the limiter.
    origin = {"X-Forwarded-For": f"198.51.100.{uuid.uuid4().int % 250 + 1}"}
    r = client.post("/auth/register", headers=origin, json={"email": email, "password": PASSWORD, "name": "W"})
    assert r.status_code in (200, 201), r.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified = TRUE WHERE email = :e"), {"e": email})
    token = client.post("/auth/login", headers=origin, json={"email": email, "password": PASSWORD}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def users() -> tuple[dict, dict]:
    return _user(), _user()


def _push(headers: dict | None = None, status: str = "completed", **extra) -> str:
    run_id = f"wit-{uuid.uuid4().hex[:12]}"
    body = {
        "run_id": run_id, "circuit_name": "bell", "backend": "ibm_brisbane",
        "qasm": "OPENQASM 3.0;\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n",
        "fingerprint": {"num_qubits": 2}, "execution": {"shots": 1024, "provider": "ibm"},
        "results": {"counts": COUNTS, "success_probability": 0.51},
        "calibration": {"t1": 215.5, "snapshot_time": "2026-10-01T10:00:00+00:00"},
        "context": {"git_commit": "a" * 40, "git_dirty": True, "library_versions": {"Qiskit": "2.2.0"}},
        "status": status, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    r = client.post("/api/v1/runs", headers=headers or {}, json={**body, **extra})
    assert r.status_code == 200, r.text
    return run_id


def _keys() -> KeysDocument:
    r = client.get("/.well-known/witness-keys.json")
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"
    return KeysDocument.from_dict(r.json())


def _status(run_id: str, headers: dict | None = None) -> dict:
    r = client.get(f"/api/v1/runs/{run_id}/receipt", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


def _tamper(sql: str, **params) -> None:
    """Change the database directly, the way an attacker with database access would."""
    with engine.begin() as conn:
        conn.execute(text(sql), params)


# --- sealing ---------------------------------------------------------------------------------


def test_finished_run_gets_a_receipt_that_verifies_independently():
    run_id = _push()
    status = _status(run_id)
    assert status["status"] == "verified", status
    receipt = status["receipt"]
    model = ReceiptModel.from_dict(receipt)
    assert model.kind == "qlab.run"
    subject = model.subject
    assert subject["backend"] == {"name": "ibm_brisbane", "provider": "ibm"}
    assert subject["shots"] == 1024
    assert subject["code"] == {"commit": "a" * 40, "dirty": True}
    assert subject["calibration_snapshot"]["captured_at"] == "2026-10-01T10:00:00Z"
    assert subject["compiled_circuit"] is None
    assert verify(receipt, _keys()).valid


def test_receipt_contains_no_raw_data():
    run_id = _push(circuit_name="secret-circuit-name", tags=["secret-tag"], project="secret-project")
    text_form = json.dumps(_status(run_id)["receipt"])
    for raw in ("secret", "OPENQASM", "\"00\"", "215.5", "Qiskit", "wit-"):
        assert raw not in text_form, raw


def test_data_files_from_the_api_verify_with_the_library():
    run_id = _push()
    receipt = _status(run_id)["receipt"]
    data = {}
    for field in ("circuit", "results", "calibration_snapshot", "environment", "postprocessing.0"):
        r = client.get(f"/api/v1/runs/{run_id}/receipt/data/{field}")
        assert r.status_code == 200, field
        data[field] = r.content
    assert json.loads(data["results"]) == COUNTS
    result = verify(receipt, _keys(), data=data)
    assert result.valid, result.to_dict()
    assert client.get(f"/api/v1/runs/{run_id}/receipt/data/nonsense").status_code == 404


def test_unfinished_run_has_no_receipt_until_it_finishes(users):
    alice, _ = users
    run_id = _push(alice, status="running")
    assert client.get(f"/api/v1/runs/{run_id}/receipt", headers=alice).status_code == 404
    r = client.patch(f"/api/v1/runs/{run_id}", headers=alice, json={"status": "completed", "results": {"counts": COUNTS}})
    assert r.status_code == 200, r.text
    assert _status(run_id, alice)["status"] == "verified"


def test_failed_runs_are_sealed_too():
    assert _status(_push(status="failed", results={}))["status"] == "verified"


def test_run_with_no_counts_hashes_whole_results():
    run_id = _push(results={"expectation_values": [0.25, -0.5]})
    status = _status(run_id)
    assert status["status"] == "verified"
    assert status["receipt"]["subject"]["postprocessing"] == []
    r = client.get(f"/api/v1/runs/{run_id}/receipt/data/results")
    assert json.loads(r.content) == {"expectation_values": [0.25, -0.5]}


@pytest.mark.skipif(not sqlite, reason="Postgres JSON columns refuse NaN before it can be stored")
def test_unrepresentable_results_do_not_block_the_run():
    run_id = _push(results={"counts": COUNTS})
    with SessionLocal() as db:
        run = db.query(Run).filter(Run.run_id == run_id).one()
        run.results = {"value": float("nan")}
        db.commit()
        assert "results" not in run_data(run)
    status = _status(run_id)
    assert status["receipt"]["subject"]["results"] is None
    assert status["versions"] == 2


def test_other_finish_paths_are_sealed():
    """Runs written by code that never heard of receipts get one anyway."""
    run_id = f"wit-{uuid.uuid4().hex[:12]}"
    with SessionLocal() as db:
        db.add(Run(run_id=run_id, status="completed", backend="b", results={"counts": COUNTS},
                   created_at=datetime.now(timezone.utc)))
        db.commit()
    assert _status(run_id)["status"] == "verified"


def test_unchanged_reupload_adds_no_receipt_and_changed_one_adds_a_version(users):
    alice, _ = users
    run_id = _push(alice)
    client.patch(f"/api/v1/runs/{run_id}", headers=alice, json={"tags": ["x"]})
    assert _status(run_id, alice)["versions"] == 1
    client.patch(f"/api/v1/runs/{run_id}", headers=alice, json={"results": {"counts": {"00": 1}}})
    status = _status(run_id, alice)
    assert status["versions"] == 2 and status["status"] == "verified"


def test_seal_failure_keeps_the_run(monkeypatch):
    import app.witness_service as service

    def broken(*_a, **_k):
        raise RuntimeError("signing is broken")

    monkeypatch.setattr(service, "seal", broken)
    run_id = _push()
    assert client.get(f"/api/v1/runs/{run_id}").status_code == 200
    assert client.get(f"/api/v1/runs/{run_id}/receipt").status_code == 404


# --- chain -----------------------------------------------------------------------------------


def _all_receipts() -> list[dict]:
    with SessionLocal() as db:
        return [json.loads(r.body) for r in db.query(Receipt).order_by(Receipt.seq)]


def test_chain_stays_continuous_across_many_runs():
    for _ in range(25):
        _push()
    report = verify_chain(_all_receipts(), _keys())
    assert report.valid, report.to_dict()
    head = client.get("/api/v1/receipts/chain/head").json()
    assert head["seq"] == report.head.seq and head["digest"] == report.head.digest


@pytest.mark.skipif(sqlite and ":memory:" in DATABASE_URL, reason="needs a database with real concurrent connections")
def test_concurrent_runs_never_fork_the_chain():
    def worker(_):
        fresh = TestClient(app, raise_server_exceptions=False)
        run_id = f"wit-{uuid.uuid4().hex[:12]}"
        return fresh.post("/api/v1/runs", json={
            "run_id": run_id, "backend": "b", "results": {"counts": COUNTS}, "status": "completed",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }).status_code

    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(worker, range(40)))
    assert codes.count(200) == 40, codes
    report = verify_chain(_all_receipts(), _keys())
    assert report.valid, report.to_dict()


# --- tampering -------------------------------------------------------------------------------


def test_changing_one_byte_of_stored_results_is_detected():
    run_id = _push()
    assert _status(run_id)["status"] == "verified"
    with engine.begin() as conn:
        stored = conn.execute(text("SELECT results FROM runs WHERE run_id = :r"), {"r": run_id}).scalar()
    stored = stored if isinstance(stored, str) else json.dumps(stored)
    assert "524" in stored
    _tamper(f"UPDATE runs SET results = {'CAST(:v AS JSON)' if not sqlite else ':v'} WHERE run_id = :r",
            v=stored.replace("524", "525"), r=run_id)

    status = _status(run_id)
    assert status["status"] == "modified"
    assert status["changed_fields"] == ["results"]
    failed = next(c for c in status["checks"] if c["name"] == "data.results")
    assert failed["status"] == "fail" and "hashes to" in failed["reason"]


@pytest.mark.parametrize("column,value,field", [
    ("qasm", "OPENQASM 3.0; // changed", "circuit"),
    ("backend", "ibm_fake", "backend"),
])
def test_changing_other_stored_fields_is_detected(column, value, field):
    run_id = _push()
    _tamper(f"UPDATE runs SET {column} = :v WHERE run_id = :r", v=value, r=run_id)
    status = _status(run_id)
    assert status["status"] == "modified" and field in status["changed_fields"]


def test_receipts_table_refuses_update_and_delete():
    run_id = _push()
    for sql in (
        "UPDATE receipts SET body = 'x' WHERE run_id = :r",
        "DELETE FROM receipts WHERE run_id = :r",
    ):
        with pytest.raises(Exception, match="append-only"):
            _tamper(sql, r=run_id)
    assert _status(run_id)["status"] == "verified"


def test_no_api_can_change_or_delete_a_receipt(users):
    alice, _ = users
    run_id = _push(alice)
    receipt_id = _status(run_id, alice)["receipt"]["id"]
    for method in (client.put, client.patch, client.delete):
        r = method(f"/api/v1/receipts/{receipt_id}", headers=alice)
        assert r.status_code == 405


def test_deleting_a_run_keeps_its_receipt(users):
    alice, _ = users
    run_id = _push(alice)
    receipt_id = _status(run_id, alice)["receipt"]["id"]
    assert client.delete(f"/api/v1/runs/{run_id}", headers=alice).status_code == 200
    assert client.get(f"/api/v1/receipts/{receipt_id}", headers=alice).status_code == 200
    assert verify_chain(_all_receipts()).valid


# --- visibility ------------------------------------------------------------------------------


def test_private_runs_do_not_leak_receipts(users):
    alice, bob = users
    run_id = _push(alice)
    receipt_id = _status(run_id, alice)["receipt"]["id"]

    for headers in (bob, {}):
        assert client.get(f"/api/v1/receipts/{receipt_id}", headers=headers).status_code == 404
        assert client.get(f"/api/v1/runs/{run_id}/receipt", headers=headers).status_code == 404
        assert client.get(f"/api/v1/runs/{run_id}/receipt/data/results", headers=headers).status_code == 404
    assert client.get(f"/api/v1/receipts/{receipt_id}", headers=alice).status_code == 200


def test_shared_run_makes_its_receipt_public(users):
    alice, _ = users
    run_id = _push(alice)
    receipt_id = _status(run_id, alice)["receipt"]["id"]
    assert client.get(f"/api/v1/receipts/{receipt_id}").status_code == 404

    r = client.post(f"/api/v1/runs/{run_id}/share", headers=alice)
    assert r.status_code == 200, r.text
    token = r.json()["share_token"]
    assert client.get(f"/api/v1/receipts/{receipt_id}").status_code == 200
    assert client.get(f"/api/v1/runs/public/{token}/receipt").json()["status"] == "verified"


def test_key_material_stays_private():
    text_form = client.get("/.well-known/witness-keys.json").text
    assert "seed" not in text_form and "secret" not in text_form
    private_files = list(key_dir().glob("*.key"))
    assert private_files, "instance key should exist outside the database"
    secret = json.loads(private_files[0].read_text())["secret"]
    for value in secret.values():
        assert value not in text_form


# --- anchors ---------------------------------------------------------------------------------


def test_anchor_is_off_by_default_and_records_the_head(monkeypatch):
    import app.witness_service as service

    monkeypatch.delenv("QLAB_WITNESS_TSA_URL", raising=False)
    assert service.anchor_once() is None

    _push()
    head = _all_receipts()[-1]
    seen = {}

    def fake_token(digest, authority):
        seen["digest"], seen["authority"] = digest, authority
        return "AAAA"

    monkeypatch.setenv("QLAB_WITNESS_TSA_URL", "https://tsa.invalid/")
    monkeypatch.setattr(service, "request_token", fake_token)
    anchor = service.anchor_once()
    assert anchor["kind"] == "witness.anchor"
    assert anchor["subject"]["head"]["seq"] == head["chain"]["seq"]
    assert seen == {"digest": anchor["subject"]["head"]["digest"], "authority": "https://tsa.invalid/"}
    assert verify_chain(_all_receipts()).valid
    assert service.anchor_once() is None  # nothing new to anchor
    assert _status(_push())["status"] == "verified"  # the chain carries on after an anchor


# --- the /verify page and erasure ------------------------------------------------------------


def _verify(run_id: str, headers: dict | None = None) -> dict:
    r = client.get(f"/api/v1/runs/{run_id}/verify", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


def _receipt_check(report: dict) -> dict:
    return next(c for c in report["checks"] if c["id"] == "receipt")


def test_verify_page_checks_the_sealed_receipt():
    run_id = _push()
    report = _verify(run_id)
    check = _receipt_check(report)
    assert check["status"] == "pass", check
    assert report["receipt"]["status"] == "verified" and report["receipt"]["seq"] >= 1
    assert "ML-DSA-65 and Ed25519" in check["detail"]

    _tamper("UPDATE runs SET backend = 'ibm_elsewhere' WHERE run_id = :r", r=run_id)
    report = _verify(run_id)
    assert _receipt_check(report)["status"] == "fail"
    assert "backend" in _receipt_check(report)["detail"]
    assert report["passed"] is False


def test_verify_page_says_when_there_is_no_receipt():
    run_id = _push(status="running")
    report = _verify(run_id)
    assert _receipt_check(report)["status"] == "cant"
    assert report["receipt"] is None


def test_receipt_download_is_the_bare_receipt_and_verifies(users):
    alice, bob = users
    run_id = _push(alice)
    r = client.get(f"/api/v1/runs/{run_id}/receipt?download=1", headers=alice)
    assert r.status_code == 200
    assert "attachment" in r.headers["content-disposition"]
    body = r.json()
    assert body["kind"] == "qlab.run" and "status" not in body
    assert verify(body, _keys()).valid
    assert client.get(f"/api/v1/runs/{run_id}/receipt?download=1", headers=bob).status_code == 404


def test_erasing_an_account_keeps_its_receipts():
    from app import erasure
    from app.models import User

    headers = _user()
    run_id = _push(headers)
    receipt_id = _status(run_id, headers)["receipt"]["id"]
    with SessionLocal() as db:
        uid = db.scalar(select(Run.created_by_user_id).where(Run.run_id == run_id))
        assert db.get(User, uid) is not None
        erasure.erase(db, uid, notify=False)
    with SessionLocal() as db:
        assert db.scalar(select(Run).where(Run.run_id == run_id)) is None
        assert db.get(Receipt, receipt_id) is not None
    assert verify_chain(_all_receipts()).valid  # the fake anchor above has no real token to check
