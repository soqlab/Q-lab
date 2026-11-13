"""Hardware board: live status, the due claim, submitting and collecting, and what is public."""
from __future__ import annotations

import importlib.util
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app import hardware_board as hb
from app.database import SessionLocal
from app.models import HardwareBoardJob, HardwareBoardState, Run
from tests.helpers import client, make_user


# ---------------------------------------------------------------------------
# Stand-ins for IBM
# ---------------------------------------------------------------------------

def _target():
    """A real qiskit Target for a 3-qubit line 0-1-2 with known calibration."""
    from qiskit.circuit import Measure, Parameter
    from qiskit.circuit.library import CZGate, RZGate, SXGate, XGate
    from qiskit.providers import QubitProperties
    from qiskit.transpiler import InstructionProperties, Target

    t = Target(num_qubits=3, qubit_properties=[
        QubitProperties(t1=100e-6, t2=50e-6),
        QubitProperties(t1=200e-6, t2=150e-6),
        QubitProperties(t1=300e-6, t2=250e-6),
    ])
    one = {(q,): InstructionProperties(error=1e-4, duration=3.5e-8) for q in range(3)}
    t.add_instruction(SXGate(), one)
    t.add_instruction(XGate(), dict(one))
    t.add_instruction(RZGate(Parameter("t")), {(q,): InstructionProperties(error=0.0, duration=0.0) for q in range(3)})
    t.add_instruction(CZGate(), {
        (0, 1): InstructionProperties(error=0.01), (1, 0): InstructionProperties(error=0.01),
        (1, 2): InstructionProperties(error=0.03), (2, 1): InstructionProperties(error=0.03),
    })
    t.add_instruction(Measure(), {(0,): InstructionProperties(error=0.02), (1,): InstructionProperties(error=0.04),
                                  (2,): InstructionProperties(error=0.06)})
    return t


class _Status:
    def __init__(self, operational=True, pending=7, msg="active"):
        self.operational, self.pending_jobs, self.status_msg = operational, pending, msg


class _Props:
    last_update_date = datetime(2026, 11, 12, 8, 0, tzinfo=timezone.utc)


class FakeBackend:
    def __init__(self, name, pending=7, operational=True, num_qubits=3):
        self.name, self._status, self.num_qubits = name, _Status(operational, pending), num_qubits
        self.target = _target()

    def status(self):
        return self._status

    def properties(self):
        return _Props()


class _Reg:
    def __init__(self, counts):
        self._c = counts

    def get_counts(self):
        return self._c


class _Pub:
    def __init__(self, counts):
        self.data = type("D", (), {"meas": _Reg(counts)})()


class FakeJob:
    def __init__(self, status, counts=None, error=""):
        self._status, self._counts, self._error = status, counts or [], error

    def status(self):
        return self._status

    def result(self):
        return [_Pub(c) for c in self._counts]

    def error_message(self):
        return self._error


class FakeIBM:
    def __init__(self, backends=(), jobs=None):
        self._backends = list(backends)
        self.jobs = jobs or {}
        self.calls = 0

    def backends(self):
        self.calls += 1
        return self._backends

    def backend(self, name):
        return next(b for b in self._backends if b.name == name)

    def job(self, job_id):
        return self.jobs[job_id]


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("QISKIT_IBM_TOKEN", raising=False)
    monkeypatch.delenv("QLAB_HARDWARE_BOARD_SIMULATE", raising=False)
    monkeypatch.delenv("QLAB_HARDWARE_BOARD_BACKENDS", raising=False)
    monkeypatch.delenv("QLAB_HARDWARE_BOARD_EVERY_DAYS", raising=False)
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SCHEDULER", "off")
    hb._live.reset()
    hb.provider = None
    with SessionLocal() as db:
        db.execute(delete(HardwareBoardJob))
        db.execute(delete(HardwareBoardState))
        db.execute(delete(Run).where(Run.project_slug == hb.PROJECT))
        db.commit()
    yield
    hb._live.reset()
    hb.provider = None


def _configure(monkeypatch, fake):
    monkeypatch.setenv("QISKIT_IBM_TOKEN", "test-token-not-real")
    hb.provider = fake


def _job_row(db, job_id="job-1", backend="ibm_test", circuits=("bell", "mirror3"), submitted=None):
    meta = []
    for cid in circuits:
        meta.append({
            "circuit": cid, "qasm": "OPENQASM 2.0;", "fingerprint": {"num_qubits": hb.BY_ID[cid]["qubits"]},
            "qubits_used": list(range(hb.BY_ID[cid]["qubits"])),
            "transpiler": {"two_qubit_gates": 1, "transpiled_depth": 5},
            "calibration": {"t1_us": {"0": 100.0}, "summary": {"t1_us_median": 100.0}, "last_update": "2026-11-12T08:00:00Z"},
        })
    row = HardwareBoardJob(job_id=job_id, backend=backend, backend_qubits=3, set_version=hb.SET_VERSION,
                           shots=1000, simulated=False, status="pending",
                           submitted_at=submitted or datetime.now(timezone.utc), circuits=meta, results=[], versions={})
    db.add(row)
    db.commit()
    return row


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def test_metrics_on_known_counts():
    ideal = hb.BY_ID["bell"]["ideal"]
    assert hb.hellinger_fidelity({"00": 500, "11": 500}, ideal) == pytest.approx(1.0)
    assert hb.hellinger_fidelity({"01": 1000}, ideal) == 0.0
    # p = (0.45, 0.45, 0.1 on 01): BC = 2 * sqrt(0.45 * 0.5) -> F = BC^2 = 0.9
    assert hb.hellinger_fidelity({"00": 450, "11": 450, "01": 100}, ideal) == pytest.approx(0.9)
    assert hb.success({"00": 450, "11": 450, "01": 100}, ideal) == pytest.approx(0.9)
    assert hb.success({}, ideal) == 0.0


def test_hellinger_matches_qiskit():
    from qiskit.quantum_info import hellinger_fidelity
    counts = {"000": 900, "001": 60, "111": 40}
    ideal = hb.BY_ID["mirror3"]["ideal"]
    assert hb.hellinger_fidelity(counts, ideal) == pytest.approx(hellinger_fidelity(counts, {"000": 1000}))


# ---------------------------------------------------------------------------
# Public board
# ---------------------------------------------------------------------------

def test_unconfigured_board_is_empty_and_says_so():
    body = client.get("/api/v1/public/hardware-board").json()
    assert body["configured"] is False
    assert body["live"]["backends"] == [] and body["runs"] == []
    assert body["benchmark"]["enabled"] is False and body["benchmark"]["next_due"] is None
    assert [c["id"] for c in body["benchmark"]["circuits"]] == ["bell", "ghz3", "ghz5", "mirror3"]
    assert set(body) >= {"configured", "live", "benchmark", "runs"}


def test_live_status_and_calibration_medians(monkeypatch):
    fake = FakeIBM([FakeBackend("ibm_b", pending=12), FakeBackend("ibm_a", pending=3, operational=False)])
    _configure(monkeypatch, fake)
    live = client.get("/api/v1/public/hardware-board").json()["live"]
    assert [b["name"] for b in live["backends"]] == ["ibm_a", "ibm_b"]
    a, b = live["backends"]
    assert a["operational"] is False and a["pending_jobs"] == 3 and b["pending_jobs"] == 12
    cal = b["calibration"]
    assert cal["t1_us_median"] == pytest.approx(200.0)
    assert cal["t2_us_median"] == pytest.approx(150.0)
    assert cal["readout_error_median"] == pytest.approx(0.04)
    assert cal["two_qubit_error_median"] == pytest.approx(0.02)  # 0.01, 0.01, 0.03, 0.03
    assert cal["last_update"] == "2026-11-12T08:00:00Z"
    # Cached: a second read does not ask IBM again.
    client.get("/api/v1/public/hardware-board")
    assert fake.calls == 1


def test_live_status_reports_ibm_failure(monkeypatch):
    class Broken(FakeIBM):
        def backends(self):
            raise ConnectionError("down")
    _configure(monkeypatch, Broken())
    live = client.get("/api/v1/public/hardware-board").json()["live"]
    assert live["backends"] == [] and "could not be reached" in live["error"]


def test_token_never_appears_in_the_response(monkeypatch):
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_a")]))
    assert "test-token-not-real" not in client.get("/api/v1/public/hardware-board").text


# ---------------------------------------------------------------------------
# Scheduling
# ---------------------------------------------------------------------------

def test_due_claim_has_exactly_one_winner(monkeypatch):
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_EVERY_DAYS", "7")
    now = datetime.now(timezone.utc)
    with SessionLocal() as a, SessionLocal() as b:
        assert hb.claim_due(a, now=now) is True
        assert hb.claim_due(b, now=now) is False  # another worker, same moment
        assert hb.claim_due(b, now=now + timedelta(days=6)) is False
        assert hb.claim_due(b, now=now + timedelta(days=7, seconds=1)) is True


def test_benchmark_disabled_keeps_live_status(monkeypatch):
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_EVERY_DAYS", "0")
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_a")]))
    with SessionLocal() as db:
        assert hb.tick(db)["submitted"] == []
    body = client.get("/api/v1/public/hardware-board").json()
    assert body["configured"] is True and body["benchmark"]["enabled"] is False
    assert body["live"]["backends"][0]["name"] == "ibm_a"


def test_choose_backends_alphabetical_operational_and_capped(monkeypatch):
    fake = FakeIBM([FakeBackend(n, operational=(n != "ibm_c"), num_qubits=q)
                    for n, q in [("ibm_d", 127), ("ibm_c", 127), ("ibm_b", 156), ("ibm_a", 3), ("ibm_e", 133), ("ibm_f", 133)]])
    assert [b.name for b in hb.choose_backends(fake)] == ["ibm_b", "ibm_d", "ibm_e"]
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_BACKENDS", "ibm_f, ibm_zz")
    assert [b.name for b in hb.choose_backends(fake)] == ["ibm_f"]


# ---------------------------------------------------------------------------
# Collecting results
# ---------------------------------------------------------------------------

def test_finished_job_becomes_public_runs(monkeypatch):
    published = []
    monkeypatch.setattr("app.events.publish_sync", lambda t, d: published.append((t, d["run_id"])))
    jobs = {"job-1": FakeJob("DONE", [{"00": 450, "11": 450, "01": 100}, {"000": 950, "010": 50}])}
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_test")], jobs))
    with SessionLocal() as db:
        _job_row(db)
        assert hb.collect_pending(db) == {"done": 1, "pending": 0, "failed": 0}
        runs = {r.run_id: r for r in db.scalars(select(Run).where(Run.project_slug == hb.PROJECT))}
    assert set(runs) == {"hwb-job-1-bell", "hwb-job-1-mirror3"}
    bell = runs["hwb-job-1-bell"]
    assert bell.results["hellinger_fidelity"] == pytest.approx(0.9)
    assert bell.results["success_probability"] == pytest.approx(0.9)
    assert bell.created_by_user_id is None and bell.org_id is None and bell.share_token
    assert bell.context["source"] == "hardware-board" and bell.context["simulated"] is False
    assert bell.tags == ["hardware-board", hb.SET_VERSION, "bell"]
    assert bell.execution["job_id"] == "job-1" and bell.backend == "ibm_test"
    assert ("run.created", "hwb-job-1-bell") in published

    body = client.get("/api/v1/public/hardware-board").json()
    points = {p["circuit"]: p for p in body["runs"]}
    assert points["mirror3"]["success"] == pytest.approx(0.95)
    assert points["bell"]["share_token"] == bell.share_token
    # The run is public through its share link ...
    shared = client.get(f"/api/v1/runs/public/{bell.share_token}")
    assert shared.status_code == 200 and shared.json()["run_id"] == "hwb-job-1-bell"
    # ... and not part of anyone's private run list.
    headers = make_user(prefix="board")
    mine = client.get("/api/v1/runs", headers=headers).json()
    assert all(not r["run_id"].startswith("hwb-") for r in mine)


def test_board_ignores_runs_posted_through_the_api(monkeypatch):
    from tests.helpers import push_run
    push_run(run_id="hwb-forged-bell", project="hardware-board", backend="ibm_test",
             context={"source": "hardware-board"}, results={"counts": {"00": 1000}, "hellinger_fidelity": 1.0})
    assert client.get("/api/v1/public/hardware-board").json()["runs"] == []


def test_queued_job_stays_pending_with_its_ibm_status(monkeypatch):
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_test")], {"job-1": FakeJob("QUEUED")}))
    with SessionLocal() as db:
        _job_row(db)
        assert hb.collect_pending(db)["pending"] == 1
    pending = client.get("/api/v1/public/hardware-board").json()["benchmark"]["pending"]
    assert pending == [{"backend": "ibm_test", "job_id": "job-1", "submitted": pending[0]["submitted"], "status": "QUEUED"}]


def test_errored_and_cancelled_jobs_are_recorded(monkeypatch):
    jobs = {"job-e": FakeJob("ERROR", error="Circuit too long"), "job-c": FakeJob("CANCELLED")}
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_test")], jobs))
    with SessionLocal() as db:
        _job_row(db, job_id="job-e")
        _job_row(db, job_id="job-c")
        assert hb.collect_pending(db)["failed"] == 2
        rows = {r.job_id: r for r in db.scalars(select(HardwareBoardJob))}
    assert rows["job-e"].status == "error" and rows["job-e"].error == "Circuit too long"
    assert rows["job-c"].status == "cancelled"
    body = client.get("/api/v1/public/hardware-board").json()
    assert body["runs"] == [] and {e["status"] for e in body["benchmark"]["ended"]} == {"error", "cancelled"}


def test_stale_job_is_given_up(monkeypatch):
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_test")], {"job-old": FakeJob("QUEUED")}))
    with SessionLocal() as db:
        _job_row(db, job_id="job-old", submitted=datetime.now(timezone.utc) - timedelta(days=15))
        assert hb.collect_pending(db)["failed"] == 1
        row = db.scalar(select(HardwareBoardJob))
    assert row.status == "abandoned" and "given up" in row.error


def test_unreachable_job_is_kept(monkeypatch):
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_test")], {}))
    with SessionLocal() as db:
        _job_row(db, job_id="job-x")
        assert hb.collect_pending(db)["pending"] == 1
        assert db.scalar(select(HardwareBoardJob)).provider_status == "UNREACHABLE"


def test_backend_endpoint_filters_and_validates(monkeypatch):
    jobs = {"job-1": FakeJob("DONE", [{"00": 500, "11": 500}, {"000": 1000}]),
            "job-2": FakeJob("DONE", [{"00": 500, "11": 500}, {"000": 1000}])}
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_one"), FakeBackend("ibm_two")], jobs))
    with SessionLocal() as db:
        _job_row(db, job_id="job-1", backend="ibm_one")
        _job_row(db, job_id="job-2", backend="ibm_two")
        hb.collect_pending(db)
    body = client.get("/api/v1/public/hardware-board/ibm_one").json()
    assert {p["backend"] for p in body["runs"]} == {"ibm_one"}
    assert [b["name"] for b in body["live"]["backends"]] == ["ibm_one"]
    assert body["live"]["detail"]["qubits"][2] == {"qubit": 2, "t1_us": 300.0, "t2_us": 250.0, "readout_error": 0.06}
    assert client.get("/api/v1/public/hardware-board/bad%20name").status_code == 404


# ---------------------------------------------------------------------------
# Run now
# ---------------------------------------------------------------------------

def test_run_now_is_for_the_server_owner_only(monkeypatch):
    submitted = []
    monkeypatch.setattr(hb, "submit_benchmark", lambda db: submitted.append(1) or [])
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_a")]))
    assert client.post("/api/v1/hardware-board/run-now").status_code == 401
    assert client.post("/api/v1/hardware-board/run-now", headers=make_user(prefix="r")).status_code == 403
    owner = make_user(role="owner", prefix="o")
    r = client.post("/api/v1/hardware-board/run-now", headers=owner)
    assert r.status_code == 200, r.text
    assert submitted == [1]


def test_run_now_without_a_key_is_refused(monkeypatch):
    owner = make_user(role="owner", prefix="o2")
    assert client.post("/api/v1/hardware-board/run-now", headers=owner).status_code == 409


def test_simulation_is_refused_on_render(monkeypatch):
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SIMULATE", "1")
    monkeypatch.setenv("RENDER", "true")
    assert hb.simulated() is False and hb.configured() is False


def test_simulated_results_never_show_on_a_real_board(monkeypatch):
    _configure(monkeypatch, FakeIBM([FakeBackend("ibm_test")], {"job-s": FakeJob("DONE", [{"00": 500, "11": 500}, {"000": 1000}])}))
    with SessionLocal() as db:
        row = _job_row(db, job_id="job-s")
        row.simulated = True
        db.commit()
        hb.collect_pending(db)
    assert client.get("/api/v1/public/hardware-board").json()["runs"] == []


# ---------------------------------------------------------------------------
# The real circuits, end to end on a local simulator (needs qiskit-aer)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(importlib.util.find_spec("qiskit_aer") is None, reason="qiskit-aer not installed")
def test_benchmark_end_to_end_on_a_fake_backend(monkeypatch):
    from qiskit_ibm_runtime.fake_provider import FakeManilaV2

    class Local(hb._Simulated):
        def backends(self):
            return [FakeManilaV2()]

    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SIMULATE", "1")
    monkeypatch.delenv("RENDER", raising=False)
    hb.provider = Local()
    with SessionLocal() as db:
        out = hb.tick(db)
        assert len(out["submitted"]) == 1
        for _ in range(120):
            if hb.collect_pending(db)["pending"] == 0:
                break
            time.sleep(0.5)
        row = db.scalar(select(HardwareBoardJob))
        assert row.status == "done" and row.simulated is True
        runs = db.scalars(select(Run).where(Run.project_slug == hb.PROJECT)).all()
    assert len(runs) == 4
    for r in runs:
        assert r.context["simulated"] is True and "simulated" in r.tags
        assert 0.5 < r.results["hellinger_fidelity"] <= 1.0
        assert sum(r.results["counts"].values()) == hb.SHOTS
        assert r.fingerprint["qasm_sha256"] and r.calibration["readout_errors"]
        assert set(r.calibration["readout_errors"]) == {str(q) for q in r.transpiler["physical_qubits"]}
    body = client.get("/api/v1/public/hardware-board").json()
    assert body["simulated"] is True and len(body["runs"]) == 4 and all(p["simulated"] for p in body["runs"])
