"""Rewind part 1: capture, canonical JSON, storage, idempotency, signed manifests, backfill, access."""
from __future__ import annotations

import gzip
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app import hardware_board as hb
from app.database import SessionLocal
from app.models import MachineSnapshot
from app.rewind import harvest as hv
from app.rewind import signing, store, verify
from app.rewind.snapshot import canonical_bytes, capture, sha256_hex
from tests.helpers import client

DAY = datetime(2026, 11, 14, 5, 41, 12, tzinfo=timezone.utc)


def props_for(cal: datetime, t1_scale: float = 1.0) -> dict:
    """properties().to_dict() for a 3-qubit line, in the units IBM uses."""
    def q(t1_us, t2_us, ro, p10, p01):
        return [
            {"date": cal, "name": "T1", "unit": "us", "value": t1_us * t1_scale},
            {"date": cal, "name": "T2", "unit": "us", "value": t2_us},
            {"date": cal, "name": "frequency", "unit": "GHz", "value": 4.9},
            {"date": cal, "name": "readout_error", "unit": "", "value": ro},
            {"date": cal, "name": "prob_meas1_prep0", "unit": "", "value": p10},
            {"date": cal, "name": "prob_meas0_prep1", "unit": "", "value": p01},
            {"date": cal, "name": "readout_length", "unit": "us", "value": 1.56},
        ]

    def g(name, qubits, err, length_ns):
        params = [{"date": cal, "name": "gate_length", "unit": "ns", "value": length_ns}]
        if err is not None:
            params.insert(0, {"date": cal, "name": "gate_error", "unit": "", "value": err})
        return {"gate": name, "qubits": qubits, "parameters": params, "name": f"{name}{'_'.join(map(str, qubits))}"}

    gates = []
    for i in range(3):
        gates += [g("sx", [i], 2e-4, 32), g("x", [i], 2e-4, 32), g("rz", [i], 0.0, 0)]
    gates += [g("cz", [0, 1], 0.004, 68), g("cz", [1, 0], 0.004, 68), g("cz", [1, 2], 0.006, 68),
              g("cz", [2, 1], 0.006, 68), g("reset", [0], None, 1500)]
    return {"backend_name": "x", "backend_version": "1.0", "last_update_date": cal,
            "qubits": [q(150, 100, 0.01, 0.006, 0.014), q(200, 120, 0.02, 0.01, 0.03), q(90, 300, 0.015, 0.01, 0.02)],
            "gates": gates, "general": [{"date": cal, "name": "lf_3", "unit": "", "value": 0.97}]}


class _Conf:
    def __init__(self, name):
        self.name = name

    def to_dict(self):
        return {"backend_name": self.name, "n_qubits": 3, "basis_gates": ["cz", "id", "rz", "sx", "x"],
                "coupling_map": [[1, 2], [0, 1], [1, 0], [2, 1]], "dt": 2.2222e-10, "channels": {"huge": 1},
                "processor_type": {"family": "Heron"}}


class FakeIBMBackend:
    """Answers properties() today and properties(datetime=d) from a history dict {date: calibration time}."""

    def __init__(self, name, cal=DAY, history=None):
        self.name, self.num_qubits, self._cal, self.history = name, 3, cal, history or {}
        self.asked: list = []

    def properties(self, refresh=False, datetime=None):
        if datetime is None:
            return props_for(self._cal)
        self.asked.append(datetime.date())
        cal = self.history.get(datetime.date())
        if isinstance(cal, Exception):
            raise cal
        return props_for(cal) if cal else None

    def configuration(self):
        return _Conf(self.name)

    @property
    def target(self):
        raise RuntimeError("not needed")


class FakeIBM:
    def __init__(self, backends):
        self._b = list(backends)

    def backends(self):
        return self._b

    def backend(self, name):
        return next(b for b in self._b if b.name == name)


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for k in ("QISKIT_IBM_TOKEN", "QLAB_HARDWARE_BOARD_SIMULATE", "RENDER", signing.KEY_ENV,
              "QLAB_REWIND_TRIGGER_TOKEN"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("QLAB_REWIND_DIR", str(tmp_path / "rewind"))
    monkeypatch.setenv("QLAB_REWIND_SCHEDULER", "off")
    hb.provider = None
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot))
        db.commit()
    yield
    hb.provider = None


def _with_ibm(monkeypatch, *backends):
    monkeypatch.setenv("QISKIT_IBM_TOKEN", "test-token")
    hb.provider = FakeIBM(backends)


# ---------------------------------------------------------------------------
# Capture and canonical JSON
# ---------------------------------------------------------------------------

def test_capture_gives_noise_in_replay_units_and_keeps_raw_properties():
    rec = capture(FakeIBMBackend("ibm_test"), props_for(DAY))
    assert rec["calibrated_at"] == "2026-11-14T05:41:12Z"
    assert rec["num_qubits"] == 3 and rec["basis_gates"] == ["cz", "id", "rz", "sx", "x"]
    assert rec["coupling_map"] == [[0, 1], [1, 0], [1, 2], [2, 1]]
    assert "channels" not in rec["configuration"]  # only the parts a replay uses
    n = rec["noise"]
    assert n["t1_us"] == [150.0, 200.0, 90.0] and n["t2_us"][2] == 300.0
    assert n["readout"][0] == [0.01, 1560.0]  # 1.56 us -> ns
    assert n["readout_asym"][1] == [0.01, 0.03]
    assert n["gates"]["cz"]["1_2"] == [0.006, 68.0]
    assert n["gates"]["reset"]["0"] == [None, 1500.0]
    assert rec["properties"]["general"][0]["name"] == "lf_3"
    assert rec["properties"]["last_update_date"] == "2026-11-14T05:41:12Z"


def test_canonical_json_and_hash_are_stable():
    a = capture(FakeIBMBackend("ibm_test"), props_for(DAY))
    b = capture(FakeIBMBackend("ibm_test"), props_for(DAY))
    shuffled = json.loads(json.dumps(a))
    shuffled = {k: shuffled[k] for k in reversed(list(shuffled))}
    assert canonical_bytes(a) == canonical_bytes(b) == canonical_bytes(shuffled)
    assert sha256_hex(canonical_bytes(a)) == sha256_hex(canonical_bytes(b))
    assert b" " not in canonical_bytes({"a": [1, 2]}) and canonical_bytes({"x": float("nan")}) == b'{"x":null}'
    c = capture(FakeIBMBackend("ibm_test"), props_for(DAY, t1_scale=1.01))
    assert sha256_hex(canonical_bytes(c)) != sha256_hex(canonical_bytes(a))


def test_capture_refuses_a_machine_without_calibration():
    from app.rewind.snapshot import CaptureError
    with pytest.raises(CaptureError):
        capture(FakeIBMBackend("ibm_test"), None)


# ---------------------------------------------------------------------------
# Storage and idempotency
# ---------------------------------------------------------------------------

def test_save_is_idempotent_and_the_file_matches_its_hash():
    rec = capture(FakeIBMBackend("ibm_test"), props_for(DAY))
    with SessionLocal() as db:
        row, created = store.save(db, rec, "harvest")
        assert created
        again, created2 = store.save(db, rec, "harvest")
        assert not created2 and again.id == row.id
        assert db.scalar(select(MachineSnapshot).where(MachineSnapshot.machine == "ibm_test")) is not None
        assert len(db.scalars(select(MachineSnapshot)).all()) == 1
        assert row.storage_path == "ibm/ibm_test/2026-11-14T054112Z.json.gz"
        raw = gzip.decompress(store.read_bytes(row))
        assert sha256_hex(raw) == row.sha256 == verify.content_sha256(store.read_bytes(row))
        assert store.load(row) == json.loads(canonical_bytes(rec))
        assert row.sdk_versions.get("qiskit")
        # a changed file is caught
        (store.rewind_dir() / row.storage_path).write_bytes(gzip.compress(raw.replace(b"150", b"151")))
        with pytest.raises(store.SnapshotCorrupt):
            store.load(row)


def test_nearest_snapshot_picks_the_closest_calibration():
    b = FakeIBMBackend("ibm_test")
    with SessionLocal() as db:
        for d in (DAY - timedelta(days=3), DAY, DAY + timedelta(days=2)):
            store.save(db, capture(b, props_for(d)), "harvest")
        assert store.nearest(db, "ibm_test", DAY + timedelta(hours=20)).calibrated_at.day == 14
        assert store.nearest(db, "ibm_test", DAY + timedelta(days=1, hours=13)).calibrated_at.day == 16
        assert store.nearest(db, "ibm_test", DAY - timedelta(days=30)).calibrated_at.day == 11
        assert store.nearest(db, "ibm_other", DAY) is None


# ---------------------------------------------------------------------------
# Harvest
# ---------------------------------------------------------------------------

def test_no_token_harvests_nothing_and_says_so():
    with SessionLocal() as db:
        out = hv.harvest(db)
        assert out["stored"] == [] and "QISKIT_IBM_TOKEN" in out["problems"][0]
        assert db.scalars(select(MachineSnapshot)).all() == []
    r = client.get("/api/v1/rewind/machines")
    assert r.status_code == 200
    body = r.json()
    assert body["collecting"] is False and "QISKIT_IBM_TOKEN" in body["reason"] and body["machines"] == []


def test_harvest_stores_each_machine_once_and_signs_the_day(monkeypatch):
    monkeypatch.setenv(signing.KEY_ENV, signing.generate_key())
    _with_ibm(monkeypatch, FakeIBMBackend("ibm_b"), FakeIBMBackend("ibm_a"))
    now = datetime(2026, 11, 14, 6, 23, tzinfo=timezone.utc)
    with SessionLocal() as db:
        first = hv.harvest(db, now=now)
        assert [s["machine"] for s in first["stored"]] == ["ibm_a", "ibm_b"] and not first["problems"]
        second = hv.harvest(db, now=now + timedelta(hours=1))
        assert second["stored"] == [] and len(second["skipped"]) == 2
        rows = db.scalars(select(MachineSnapshot)).all()
        assert {r.source for r in rows} == {"harvest"} and len(rows) == 2
    assert hv.harvest_due(now + timedelta(hours=2)) is False
    assert hv.harvest_due(now + timedelta(hours=30)) is True

    body = client.get("/api/v1/rewind/machines").json()
    assert body["collecting"] is True and body["signing"]["enabled"] is True
    m = {x["machine"]: x for x in body["machines"]}
    assert m["ibm_a"]["snapshots"] == 1 and m["ibm_a"]["first_date"] == "2026-11-14"
    assert m["ibm_a"]["latest"]["t1_us_median"] == 150.0
    assert m["ibm_a"]["latest"]["two_qubit_error_median"] == 0.005

    r = client.get("/api/v1/rewind/manifests/2026-11-14")
    assert r.status_code == 200
    doc = r.json()
    assert doc["signed"] is True and len(doc["entries"]) == 2
    assert set(doc["entries"][0]) == {"path", "sha256", "size_bytes", "provider", "machine", "calibrated_at", "source"}
    assert verify.verify_manifest(doc)["valid"] is True
    assert client.get("/api/v1/rewind/manifests/2026-11-13").status_code == 404
    assert client.get("/api/v1/rewind/manifests/2026-13-45").status_code == 422
    assert client.get("/api/v1/rewind/public-key").json()["public_key"]["key_id"] == doc["signature"]["key"]


def test_snapshot_contents_are_never_served(monkeypatch):
    _with_ibm(monkeypatch, FakeIBMBackend("ibm_a"))
    with SessionLocal() as db:
        hv.harvest(db, now=datetime(2026, 11, 14, 6, 0, tzinfo=timezone.utc))
    doc = client.get("/api/v1/rewind/manifests/2026-11-14").json()
    assert "properties" not in json.dumps(doc) and "noise" not in doc
    assert client.get("/api/v1/rewind/files/" + doc["entries"][0]["path"]).status_code == 404


def test_simulated_preview_is_marked_and_refused_on_render(monkeypatch):
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SIMULATE", "1")
    monkeypatch.setenv("RENDER", "true")
    assert hv.configured() is False
    with SessionLocal() as db:
        assert hv.harvest(db)["stored"] == []
    monkeypatch.delenv("RENDER")
    hb.provider = FakeIBM([FakeIBMBackend("fake_a")])
    with SessionLocal() as db:
        out = hv.harvest(db, now=datetime(2026, 11, 14, 6, 0, tzinfo=timezone.utc))
        assert len(out["stored"]) == 1
        assert {r.source for r in db.scalars(select(MachineSnapshot)).all()} == {"simulated"}
        assert store.day_entries(db, date(2026, 11, 14)) == []  # never in a manifest
        assert hv.backfill(db)["problems"]
    assert [m["machine"] for m in client.get("/api/v1/rewind/machines").json()["machines"]] == ["fake_a"]
    monkeypatch.delenv("QLAB_HARDWARE_BOARD_SIMULATE")
    assert client.get("/api/v1/rewind/machines").json()["machines"] == []  # not shown as real


# ---------------------------------------------------------------------------
# Manifests
# ---------------------------------------------------------------------------

def _entries():
    return [{"path": "ibm/ibm_a/2026-11-14T054112Z.json.gz", "sha256": "a" * 64},
            {"path": "ibm/ibm_b/2026-11-14T054112Z.json.gz", "sha256": "b" * 64}]


def _signed(entries=None):
    s = signing.parse_key(signing.generate_key())
    doc = {"format": verify.MANIFEST_FORMAT, "date": "2026-11-14", "entries": entries or _entries()}
    msg = verify.manifest_bytes("2026-11-14", s.key_id, "2026-11-14T06:20:00Z", doc["entries"])
    doc["signature"] = {"key": s.key_id, "signed_at": "2026-11-14T06:20:00Z", **s.sign(msg), "public_key": s.public_key()}
    return doc, s


def test_manifest_bytes_are_plain_lines_in_path_order():
    msg = verify.manifest_bytes("2026-11-14", "qrk-" + "0" * 32, "2026-11-14T06:20:00Z", list(reversed(_entries())))
    assert msg.decode().splitlines() == [
        "qlab-rewind-manifest/1", "date 2026-11-14", "key qrk-" + "0" * 32, "signed-at 2026-11-14T06:20:00Z",
        "a" * 64 + " ibm/ibm_a/2026-11-14T054112Z.json.gz", "b" * 64 + " ibm/ibm_b/2026-11-14T054112Z.json.gz"]
    for bad in ([{"path": "../x", "sha256": "a" * 64}], [{"path": "x", "sha256": "A" * 64}], _entries() + _entries()[:1]):
        with pytest.raises(verify.ManifestError):
            verify.manifest_bytes("2026-11-14", "qrk-" + "0" * 32, "2026-11-14T06:20:00Z", bad)


def test_manifest_signature_detects_tampering():
    doc, s = _signed()
    assert verify.verify_manifest(doc) == {"valid": True, "ed25519": True, "ml_dsa_65": True, "key_id": s.key_id,
                                           "reason": None}
    for change in (lambda d: d["entries"][0].update(sha256="c" * 64), lambda d: d.update(date="2026-11-15"),
                   lambda d: d["entries"].pop(), lambda d: d["signature"].update(signed_at="2026-11-14T06:20:01Z")):
        tampered = json.loads(json.dumps(doc))
        change(tampered)
        res = verify.verify_manifest(tampered)
        assert res["valid"] is False and not (res["ed25519"] or res["ml_dsa_65"])
    other, _ = _signed()
    swapped = json.loads(json.dumps(doc))
    swapped["signature"]["public_key"] = other["signature"]["public_key"]
    assert verify.verify_manifest(swapped)["valid"] is False
    assert verify.verify_manifest(doc, expect_key="qrk-" + "1" * 32)["valid"] is False
    assert verify.verify_manifest({**doc, "signature": None})["valid"] is False


def test_verify_command_line(tmp_path, capsys):
    doc, _ = _signed()
    f = tmp_path / "m.json"
    f.write_text(json.dumps(doc))
    assert verify.main(["--manifest", str(f)]) == 0
    assert "VALID" in capsys.readouterr().out
    doc["entries"][0]["sha256"] = "d" * 64
    f.write_text(json.dumps(doc))
    assert verify.main(["--manifest", str(f)]) == 1


def test_unsigned_without_a_key_then_signed_once_one_is_set(monkeypatch):
    _with_ibm(monkeypatch, FakeIBMBackend("ibm_a"))
    with SessionLocal() as db:
        hv.harvest(db, now=datetime(2026, 11, 14, 6, 0, tzinfo=timezone.utc))
    doc = client.get("/api/v1/rewind/manifests/2026-11-14").json()
    assert doc["signed"] is False and signing.KEY_ENV in doc["unsigned_reason"]
    assert client.get("/api/v1/rewind/public-key").json()["enabled"] is False
    monkeypatch.setenv(signing.KEY_ENV, "not-a-key")
    assert signing.status()["enabled"] is False and signing.signer() is None
    monkeypatch.setenv(signing.KEY_ENV, signing.generate_key())
    doc = client.get("/api/v1/rewind/manifests/2026-11-14").json()
    assert doc["signed"] is True and verify.verify_manifest(doc)["valid"]


def test_signing_key_round_trip():
    raw = signing.generate_key()
    a, b = signing.parse_key(raw), signing.parse_key(raw)
    assert a.key_id == b.key_id and a.key_id.startswith("qrk-")
    for bad in ("qrk1:abc", "qrk1:" + "A" * 10, "nope"):
        with pytest.raises(signing.SigningKeyError):
            signing.parse_key(bad)


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

def _walk(answers: dict, start=date(2026, 11, 13), miss_limit=3, max_days=50, stored_already=()):
    """answers: day -> calibration datetime, None, or an Exception."""
    kept = set(stored_already)

    def fetch(day):
        a = answers.get(day)
        if isinstance(a, Exception):
            raise a
        return None if a is None else {"last_update_date": a}

    def keep(props):
        cal = props["last_update_date"]
        if cal in kept:
            return False
        kept.add(cal)
        return True

    return hv.walk_back(fetch, keep, start, max_days, miss_limit), kept


def _at(d: date, h=5):
    return datetime(d.year, d.month, d.day, h, tzinfo=timezone.utc)


def test_backfill_stops_after_n_misses_in_a_row():
    s = date(2026, 11, 13)
    answers = {s - timedelta(days=i): _at(s - timedelta(days=i)) for i in range(5)}
    answers[s - timedelta(days=5)] = None  # one gap is tolerated
    answers[s - timedelta(days=6)] = _at(s - timedelta(days=6))
    res, kept = _walk(answers)
    assert res["stored"] == 6 and res["days_asked"] == 10
    assert res["oldest_stored"] == "2026-11-07T05:00:00Z" and "3 days in a row" in res["stopped_because"]


def test_backfill_counts_errors_repeats_and_future_answers_as_misses():
    s = date(2026, 11, 13)
    answers = {
        s: _at(s),
        s - timedelta(days=1): RuntimeError("IBM said no"),
        s - timedelta(days=2): _at(s),                      # the same calibration again
        s - timedelta(days=3): _at(s + timedelta(days=1)),  # newer than the day asked
    }
    res, _ = _walk(answers)
    assert res["stored"] == 1 and res["days_asked"] == 4
    res, _ = _walk({s - timedelta(days=i): _at(s - timedelta(days=i)) for i in range(100)}, max_days=12)
    assert res["stored"] == 12 and res["stopped_because"] == "max_days"


def test_backfill_walks_back_from_the_earliest_stored_and_records_reach(monkeypatch):
    today = datetime.now(timezone.utc).date()
    history = {today - timedelta(days=i): _at(today - timedelta(days=i), 4) for i in range(1, 6)}
    b = FakeIBMBackend("ibm_a", cal=_at(today, 4), history=history)
    _with_ibm(monkeypatch, b)
    with SessionLocal() as db:
        hv.harvest(db)
        out = hv.backfill(db, miss_limit=3, max_days=40, delay_s=0)
        assert not out["problems"]
        res = out["machines"]["ibm_a"]
        assert res["stored"] == 5 and res["from"] == (today - timedelta(days=1)).isoformat()
        assert b.asked[0] == today - timedelta(days=1)
        assert {r.source for r in db.scalars(select(MachineSnapshot)).all()} == {"harvest", "backfill"}
        reach = store.read_state()["reach"]["ibm_a"]
        assert reach["complete"] is True and reach["oldest_calibrated_at"].startswith((today - timedelta(days=5)).isoformat())
        # a second automatic pass leaves a machine whose history start is known alone
        b.asked.clear()
        assert hv.backfill(db, delay_s=0)["machines"] == {} and b.asked == []
        assert hv.backfill_due() is False
    entries = client.get(f"/api/v1/rewind/manifests/{today.isoformat()}").json()["entries"]
    assert len(entries) == 6


# ---------------------------------------------------------------------------
# Who may start a harvest
# ---------------------------------------------------------------------------

def test_harvest_trigger_needs_the_token_or_the_owner(monkeypatch):
    assert client.post("/api/v1/rewind/harvest").status_code == 403
    monkeypatch.setenv("QLAB_REWIND_TRIGGER_TOKEN", "s3cret-trigger")
    assert client.post("/api/v1/rewind/harvest", headers={"X-Rewind-Trigger": "wrong"}).status_code == 403
    r = client.post("/api/v1/rewind/harvest", headers={"X-Rewind-Trigger": "s3cret-trigger"})
    assert r.status_code == 409 and "QISKIT_IBM_TOKEN" in r.json()["detail"]
    assert client.post("/api/v1/rewind/backfill", json={"machine": "../x"},
                       headers={"X-Rewind-Trigger": "s3cret-trigger"}).status_code == 409
    _with_ibm(monkeypatch, FakeIBMBackend("ibm_a"))
    monkeypatch.setattr(hv, "start_in_background", lambda fn, factory: True)
    r = client.post("/api/v1/rewind/harvest", headers={"X-Rewind-Trigger": "s3cret-trigger"})
    assert r.status_code == 202 and r.json()["started"] is True
    assert client.post("/api/v1/rewind/backfill", json={"machine": "../x"},
                       headers={"X-Rewind-Trigger": "s3cret-trigger"}).status_code == 422
    assert client.post("/api/v1/rewind/backfill", json={"machine": "ibm_a", "max_days": 5},
                       headers={"X-Rewind-Trigger": "s3cret-trigger"}).status_code == 202


def test_background_runner_runs_one_job_at_a_time():
    import threading
    gate, done = threading.Event(), threading.Event()
    calls = []

    def job(db):
        calls.append(1)
        gate.wait(5)
        done.set()

    assert hv.start_in_background(job, SessionLocal) is True
    assert hv.start_in_background(job, SessionLocal) is False
    gate.set()
    assert done.wait(5)
    for _ in range(50):
        if hv._run_lock.acquire(blocking=False):
            hv._run_lock.release()
            break
        import time
        time.sleep(0.05)
    assert calls == [1]


def test_alembic_009_creates_and_drops_the_table(tmp_path):
    from sqlalchemy import create_engine, inspect

    from tests.test_usernameless import _alembic
    db = tmp_path / "rewind.db"
    up = _alembic(db, "upgrade", "009_rewind_snapshots")
    assert up.returncode == 0, up.stderr[-2000:]
    eng = create_engine(f"sqlite:///{db.as_posix()}")
    assert "machine_snapshots" in inspect(eng).get_table_names()
    eng.dispose()
    down = _alembic(db, "downgrade", "008_encrypt_integration_secrets")
    assert down.returncode == 0, down.stderr[-2000:]
    eng = create_engine(f"sqlite:///{db.as_posix()}")
    assert "machine_snapshots" not in inspect(eng).get_table_names()
    eng.dispose()


# ---------------------------------------------------------------------------
# The soqlab.com pulse line
# ---------------------------------------------------------------------------

def _pulse(origin="https://soqlab.com"):
    from app.routers import rewind as rewind_router
    rewind_router._pulse_cache.clear()
    return client.get("/api/v1/rewind/pulse", headers={"Origin": origin} if origin else {})


def test_pulse_says_nothing_is_collected_without_a_key():
    r = _pulse()
    assert r.status_code == 200
    assert r.json()["collecting"] is False and r.json()["machines"] == []
    assert r.headers["access-control-allow-origin"] == "https://soqlab.com"
    assert "max-age=300" in r.headers["cache-control"] and "Origin" in r.headers["vary"]


def test_pulse_lists_real_calibrations_newest_first_and_only_for_soqlab(monkeypatch):
    _with_ibm(monkeypatch, FakeIBMBackend("ibm_a", cal=DAY), FakeIBMBackend("ibm_b", cal=DAY + timedelta(hours=3)))
    with SessionLocal() as db:
        hv.harvest(db, now=DAY + timedelta(hours=4))
    body = _pulse().json()
    assert body["collecting"] is True
    assert body["machines"] == [{"machine": "ibm_b", "last_calibrated_at": "2026-11-14T08:41:12Z"},
                                {"machine": "ibm_a", "last_calibrated_at": "2026-11-14T05:41:12Z"}]
    assert set(body) == {"collecting", "machines", "generated_at", "note"}  # no medians, no files
    assert "affiliated" in body["note"]
    other = _pulse("https://evil.example")
    assert other.status_code == 200 and other.headers.get("access-control-allow-origin") != "https://evil.example"


def test_pulse_never_shows_the_simulated_preview(monkeypatch):
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SIMULATE", "1")
    hb.provider = FakeIBM([FakeIBMBackend("fake_a")])
    with SessionLocal() as db:
        assert len(hv.harvest(db, now=DAY)["stored"]) == 1
    assert _pulse().json()["machines"] == []
