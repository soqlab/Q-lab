"""Rewind part 3: the benchmark set, Hellinger math, the shared QPU budget, choosing machines,
comparing hardware with the replica, and what replays and the public endpoint say."""
from __future__ import annotations

import importlib.util
import time
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from app import hardware_board as hb
from app import qpu_budget
from app.database import SessionLocal
from app.models import HardwareBoardJob, HardwareBoardState, MachineSnapshot, QpuUsage, RewindAccuracy
from app.rewind import bench
from app.rewind import replay as rp
from app.rewind import store
from app.rewind.snapshot import capture
from tests.helpers import BELL, client, make_user
from tests.test_hardware_board import FakeBackend, FakeIBM, FakeJob
from tests.test_rewind_harvest import DAY, FakeIBMBackend, props_for

ENV = ("QISKIT_IBM_TOKEN", "QLAB_HARDWARE_BOARD_SIMULATE", "RENDER", "QLAB_REWIND_BENCH_MACHINES_PER_WEEK",
       "QLAB_REWIND_BENCH_CIRCUITS", "QLAB_REWIND_BENCH_SHOTS", "QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D",
       "QLAB_HARDWARE_BOARD_BACKENDS", "QLAB_REWIND_TRIGGER_TOKEN")


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for k in ENV:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("QLAB_REWIND_DIR", str(tmp_path / "rewind"))
    monkeypatch.setenv("QLAB_REWIND_SCHEDULER", "off")
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SCHEDULER", "off")
    hb.provider = None
    hb._live.reset()
    with SessionLocal() as db:
        for m in (HardwareBoardJob, HardwareBoardState, MachineSnapshot, QpuUsage, RewindAccuracy):
            db.execute(delete(m))
        db.commit()
    yield
    hb.provider = None
    hb._live.reset()


def _now():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# The set
# ---------------------------------------------------------------------------

def test_set_is_deterministic_with_known_ideal_answers():
    specs = bench.bench_set(20)
    assert len(specs) == 20 and len({s["id"] for s in specs}) == 20
    assert bench.BENCH_VERSION == "rewind-bench-1"
    # Pinned: a changed circuit must come with a new BENCH_VERSION.
    assert bench.set_digest() == "36b96f6bff95b79a042087f97de12eece210c784c8e5128c745b592b771b5cb3"
    for s in specs:
        assert bench._canonical(s["build"]()) == bench._canonical(s["build"]())
        assert s["build"]().num_qubits == s["qubits"] <= 10
        assert sum(s["ideal"].values()) == pytest.approx(1.0)
    ideal = {s["id"]: s["ideal"] for s in specs}
    assert ideal["bell"] == {"00": 0.5, "11": 0.5}
    for n in (3, 4, 5, 6, 8, 10):
        assert ideal[f"ghz{n}"] == {"0" * n: 0.5, "1" * n: 0.5}
    assert ideal["qft3"] == {format(i, "03b"): 0.125 for i in range(8)}
    assert ideal["iqft3"] == {"101": 1.0} and ideal["iqft4"] == {"1011": 1.0}
    mirrors = [k for k in ideal if k.startswith("mirror")]
    assert len(mirrors) == 8
    for k in mirrors:  # one known bitstring, never all zeros
        (bits, p), = ideal[k].items()
        assert p == 1.0 and "1" in bits
    assert ideal["idle_t1"] == {"1": 1.0} and ideal["idle_echo"] == {"0": 1.0}
    assert any(i.operation.name == "delay" for i in bench.BY_ID["idle_t1"]["build"]().data)


def test_fewer_circuits_take_the_first_of_the_set(monkeypatch):
    monkeypatch.setenv("QLAB_REWIND_BENCH_CIRCUITS", "3")
    assert [s["id"] for s in bench.bench_set()] == ["bell", "ghz3", "ghz4"]
    monkeypatch.setenv("QLAB_REWIND_BENCH_CIRCUITS", "999")
    assert len(bench.bench_set()) == 20


# ---------------------------------------------------------------------------
# Hellinger fidelity
# ---------------------------------------------------------------------------

def test_hellinger_math():
    assert bench.hellinger({"00": 500, "11": 500}, {"00": 0.5, "11": 0.5}) == pytest.approx(1.0)
    assert bench.hellinger({"01": 10}, {"00": 0.5, "11": 0.5}) == 0.0
    # counts and probabilities are normalized: BC = 2 sqrt(0.45 * 0.5) -> 0.9
    assert bench.hellinger({"00": 450, "11": 450, "01": 100}, {"00": 1, "11": 1}) == pytest.approx(0.9)
    assert bench.hellinger({"0": 3, "1": 1}, {"0": 30, "1": 10}) == pytest.approx(1.0)
    assert bench.hellinger({}, {"0": 1}) == 0.0
    from qiskit.quantum_info import hellinger_fidelity
    a, b = {"000": 900, "001": 60, "111": 40}, {"000": 850, "001": 100, "110": 50}
    assert bench.hellinger(a, b) == pytest.approx(hellinger_fidelity(a, b))
    assert bench.hellinger(a, b) == pytest.approx(bench.hellinger(b, a))


# ---------------------------------------------------------------------------
# The QPU budget, shared with the hardware board
# ---------------------------------------------------------------------------

def test_estimator_is_ibms_formula():
    assert qpu_budget.estimate_seconds(20, 4000) == pytest.approx(30.0)  # 2 + 0.00035 x 80 000
    assert qpu_budget.estimate_seconds(4, 1000) == pytest.approx(3.4)
    assert qpu_budget.budget_seconds() == 480


def test_budget_refuses_over_and_the_window_rolls(monkeypatch):
    monkeypatch.setenv("QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D", "100")
    now = _now()
    with SessionLocal() as db:
        old = qpu_budget.reserve(db, "rewind-bench", "ibm_a", 60, now=now - timedelta(days=27))
        assert old is not None and qpu_budget.used_seconds(db, now=now) == pytest.approx(60)
        assert qpu_budget.reserve(db, "rewind-bench", "ibm_b", 50, now=now) is None  # 110 > 100
        assert qpu_budget.reserve(db, "hardware-board", "ibm_b", 30, now=now) is not None  # 90
        assert qpu_budget.reserve(db, "rewind-bench", "ibm_c", 20, now=now) is None
        # Two days on, the 60 s job is out of the 28-day window.
        later = now + timedelta(days=2)
        assert qpu_budget.used_seconds(db, now=later) == pytest.approx(30)
        assert qpu_budget.reserve(db, "rewind-bench", "ibm_c", 50, now=later) is not None
        # IBM's reported usage replaces the 60 s estimate.
        qpu_budget.attach(db, old, "job-old")
        qpu_budget.record_actual(db, "job-old", 12.5)
        assert qpu_budget.used_seconds(db, now=now) == pytest.approx(12.5 + 30 + 50)
        # Simulated previews have their own ledger.
        assert qpu_budget.used_seconds(db, simulated=True, now=now) == 0


def test_board_jobs_from_before_the_ledger_count(monkeypatch):
    with SessionLocal() as db:
        db.add(HardwareBoardJob(job_id="legacy", backend="ibm_a", set_version=hb.SET_VERSION, shots=1000,
                                simulated=False, status="done", submitted_at=_now() - timedelta(days=3),
                                circuits=[{}] * 4, results=[], versions={}))
        db.commit()
        assert qpu_budget.used_seconds(db) == pytest.approx(3.4)


def test_usage_reported_by_ibm():
    class J:
        def usage(self):
            return 7

    class M:
        def usage(self):
            raise RuntimeError

        def metrics(self):
            return {"usage": {"quantum_seconds": 3.0}}

    assert qpu_budget.usage_of(J()) == 7.0 and qpu_budget.usage_of(M()) == 3.0
    assert qpu_budget.usage_of(FakeJob("DONE")) is None


def test_the_board_also_respects_the_shared_budget(monkeypatch):
    monkeypatch.setenv("QISKIT_IBM_TOKEN", "test-token")
    monkeypatch.setenv("QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D", "5")
    hb.provider = FakeIBM([FakeBackend("ibm_a", num_qubits=127), FakeBackend("ibm_b", num_qubits=127)])
    submitted = []
    monkeypatch.setattr(hb, "submit_to", lambda db, b, sim: submitted.append(b.name) or
                        type("R", (), {"job_id": f"job-{b.name}", "backend": b.name})())
    with SessionLocal() as db:
        rows = hb.submit_benchmark(db)  # 3.4 s each: the first fits, the second doesn't
        assert [r.backend for r in rows] == ["ibm_a"] and submitted == ["ibm_a"]
        state = db.get(HardwareBoardState, 1)
        assert "shared QPU budget" in state.last_message
        ledger = db.scalars(select(QpuUsage)).all()
        assert [(u.source, u.job_id, u.estimated_seconds) for u in ledger] == [("hardware-board", "job-ibm_a", 3.4)]


def test_bench_refuses_to_submit_over_budget(monkeypatch):
    monkeypatch.setenv("QISKIT_IBM_TOKEN", "test-token")
    monkeypatch.setenv("QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D", "40")  # one 30 s job, not two
    hb.provider = FakeIBM([FakeBackend("ibm_a", num_qubits=127), FakeBackend("ibm_b", num_qubits=127)])
    calls = []
    monkeypatch.setattr(hb, "submit_to", lambda db, b, sim, **kw: calls.append((b.name, kw)) or
                        type("R", (), {"job_id": f"job-{b.name}", "backend": b.name})())
    with SessionLocal() as db:
        for name in ("ibm_a", "ibm_b"):
            _store(db, name, _now() - timedelta(hours=3))
        out = bench.tick(db)
        assert [s["machine"] for s in out["submitted"]] == ["ibm_a"]
        assert "shared QPU budget of 40 s" in out["problems"][0]
        name, kw = calls[0]
        assert kw["set_version"] == "rewind-bench-1" and kw["shots"] == 4000 and kw["keep_isa"] is True
        assert len(kw["benchmarks"]) == 20
        assert qpu_budget.used_seconds(db) == pytest.approx(30.0)
        # Not due again for a week.
        assert bench.tick(db)["submitted"] == []


# ---------------------------------------------------------------------------
# Choosing machines
# ---------------------------------------------------------------------------

def _store(db, machine, cal, source="harvest"):
    rec = capture(FakeIBMBackend(machine, cal=cal), props_for(cal))
    return store.save(db, rec, source)[0]


def test_round_robin_among_machines_with_fresh_calibration():
    now = _now()
    backends = [FakeBackend(n, num_qubits=127) for n in ("ibm_a", "ibm_b", "ibm_c", "ibm_d")]
    backends.append(FakeBackend("ibm_down", num_qubits=127, operational=False))
    with SessionLocal() as db:
        _store(db, "ibm_a", now - timedelta(hours=5))
        _store(db, "ibm_b", now - timedelta(hours=20))
        _store(db, "ibm_c", now - timedelta(days=4))  # stale
        _store(db, "ibm_d", now - timedelta(hours=1))
        _store(db, "ibm_down", now - timedelta(hours=1))
        fake = FakeIBM(backends)
        assert [b.name for b in bench.choose(db, fake, now, 3, 3)] == ["ibm_a", "ibm_b", "ibm_d"]
        # ibm_a and ibm_b were benchmarked last week: ibm_d (never) comes first, then the older one.
        for name, ago in (("ibm_a", 7), ("ibm_b", 14)):
            db.add(HardwareBoardJob(job_id=f"j-{name}", backend=name, set_version=bench.BENCH_VERSION, shots=10,
                                    simulated=False, status="done", submitted_at=now - timedelta(days=ago),
                                    circuits=[], results=[], versions={}))
        db.commit()
        assert [b.name for b in bench.choose(db, fake, now, 2, 3)] == ["ibm_d", "ibm_b"]
        assert bench.choose(db, fake, now, 3, 200) == []  # none has enough qubits


def test_nothing_fresh_means_nothing_submitted_and_a_retry_tomorrow(monkeypatch):
    monkeypatch.setenv("QISKIT_IBM_TOKEN", "test-token")
    hb.provider = FakeIBM([FakeBackend("ibm_a", num_qubits=127)])
    now = _now()
    with SessionLocal() as db:
        out = bench.tick(db, now=now)
        assert out["submitted"] == [] and "No operational machine" in out["problems"][0]
        nxt = db.get(HardwareBoardState, bench.STATE_ID).next_due
        nxt = nxt.replace(tzinfo=timezone.utc) if nxt.tzinfo is None else nxt
        assert abs((nxt - (now + timedelta(days=1))).total_seconds()) < 5


# ---------------------------------------------------------------------------
# Comparing a finished job with its replica
# ---------------------------------------------------------------------------

def _bench_job(db, machine="ibm_line", counts=None, executed=None, simulated=False):
    """A finished benchmark job on ibm_line with the Bell circuit compiled as the hardware would run it."""
    rec = capture(FakeIBMBackend(machine), props_for(DAY))
    isa = rp.transpile(bench.BY_ID["bell"]["build"](), rec)
    meta = [{"circuit": "bell", "qasm": "", "fingerprint": {}, "qubits_used": [], "transpiler": {},
             "calibration": {}, "isa_qpy": hb._qpy_b64(isa), "dt": None}]
    row = HardwareBoardJob(job_id=f"bench-{machine}", backend=machine, backend_qubits=3, set_version=bench.BENCH_VERSION,
                           shots=2000, simulated=simulated, status="pending", submitted_at=_now(),
                           circuits=meta, results=[], versions={})
    db.add(row)
    db.commit()

    class Job:
        def metrics(self):
            return {"timestamps": {"running": (executed or _now()).isoformat()}}

    bench.record_hardware(db, row, [counts or {"00": 960, "11": 940, "01": 60, "10": 40}], Job())
    return row


def test_comparison_waits_for_the_calibration_in_force_then_replays_the_same_circuit():
    now = _now().replace(microsecond=0)
    executed = now + timedelta(hours=1)
    with SessionLocal() as db:
        _store(db, "ibm_line", now - timedelta(days=4))
        first_sha = _store(db, "ibm_line", now - timedelta(days=1)).sha256
        _store(db, "ibm_line", now + timedelta(days=2))  # made after the job ran: not the one in force
        _bench_job(db, executed=executed)
        acc = db.scalar(select(RewindAccuracy))
        assert acc.status == "waiting" and acc.n_circuits == 1
        # No harvest since the job ran: wait, in case a newer calibration was in force.
        assert bench.compare_pending(db, now=executed + timedelta(hours=1)) == 0
        assert bench.compare_pending(db, now=executed + bench.SETTLE + timedelta(minutes=1)) == 1
        db.refresh(acc)
    assert acc.status == "done" and acc.snapshot_sha256 == first_sha
    assert acc.snapshot_rule == "in force when the job ran"
    c = acc.circuits[0]
    assert c["circuit"] == "bell" and sum(c["replica_counts"].values()) == 2000
    assert 0.9 < c["hardware_vs_replica"] <= 1.0 and acc.median == acc.worst == c["hardware_vs_replica"]
    assert c["hardware_vs_ideal"] == pytest.approx(bench.hellinger(c["hardware_counts"], {"00": 1, "11": 1}), abs=1e-6)
    assert c["replica_vs_ideal"] > 0.9 and c["physical_qubits"]


def test_finished_bench_jobs_are_collected_by_the_board_and_kept_off_its_display(monkeypatch):
    monkeypatch.setenv("QISKIT_IBM_TOKEN", "test-token")

    class Done(FakeJob):
        def usage(self):
            return 4.0

    hb.provider = FakeIBM([FakeBackend("ibm_test")], {"jb": Done("DONE", [{"00": 500, "11": 500}])})
    with SessionLocal() as db:
        db.add(HardwareBoardJob(job_id="jb", backend="ibm_test", set_version=bench.BENCH_VERSION, shots=1000,
                                simulated=False, status="pending", submitted_at=_now(),
                                circuits=[{"circuit": "bell"}], results=[], versions={}))
        held = qpu_budget.reserve(db, "rewind-bench", "ibm_test", 2.35)
        qpu_budget.attach(db, held, "jb")
        assert hb.collect_pending(db)["done"] == 1
        row = db.scalar(select(HardwareBoardJob))
        assert row.status == "done" and row.results[0]["hellinger"] == pytest.approx(1.0)
        assert db.scalar(select(RewindAccuracy)).status == "waiting"
        assert db.scalar(select(QpuUsage)).actual_seconds == 4.0
    body = client.get("/api/v1/public/hardware-board").json()
    assert body["runs"] == [] and body["benchmark"]["pending"] == []


# ---------------------------------------------------------------------------
# What replays and the public endpoint say
# ---------------------------------------------------------------------------

def _done(db, machine, median, worst, when, n=20, simulated=False, job="j1"):
    db.add(RewindAccuracy(job_id=job, machine=machine, bench_version=bench.BENCH_VERSION, simulated=simulated,
                          status="done", executed_at=when, measured_at=when, shots=4000, median=median, worst=worst,
                          n_circuits=n, circuits=[{"circuit": "bell", "hardware_vs_replica": median,
                                                   "hardware_vs_ideal": 0.9, "replica_vs_ideal": 0.95,
                                                   "hardware_counts": {"00": 1}, "replica_counts": {"00": 1}}]))
    db.commit()


def test_replay_carries_the_measured_accuracy():
    when = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)
    with SessionLocal() as db:
        _store(db, "ibm_line", DAY)
        before = rp.replay(db, "ibm_line", date(2026, 11, 14), BELL, shots=200)
        assert before["accuracy"] is None and before["accuracy_note"] == "Not yet measured for this machine"
        _done(db, "ibm_line", 0.9712, 0.8834, when)
        out = rp.replay(db, "ibm_line", date(2026, 11, 14), BELL, shots=200)
    acc = out["accuracy"]
    assert acc["median"] == 0.9712 and acc["worst"] == 0.8834 and acc["n_circuits"] == 20
    assert acc["measured_at"] == "2026-11-11T09:00:00Z" and acc["bench_version"] == "rewind-bench-1"
    assert acc["poor_match"] is False and acc["simulated"] is False
    assert out["accuracy_note"] == ("On ibm_line, replicas matched real hardware with median Hellinger fidelity 0.97 "
                                    "(worst 0.88) on our 20-circuit benchmark, 11 Nov 2026.")


def test_a_poor_match_is_said_plainly():
    when = datetime(2026, 11, 11, 9, 0, tzinfo=timezone.utc)
    with SessionLocal() as db:
        _done(db, "ibm_bad", 0.8971, 0.61, when)
        acc, note = bench.accuracy_for(db, "ibm_bad")
    assert acc["poor_match"] is True
    assert note.startswith("On ibm_bad, replicas did not match real hardware well: median Hellinger fidelity 0.897 "
                           "(worst 0.61) on our 20-circuit benchmark, 11 Nov 2026. Treat replays of this machine as rough")


def test_simulated_results_are_labelled_and_hidden_from_a_real_server():
    with SessionLocal() as db:
        _done(db, "fake_fez", 0.99, 0.95, _now(), simulated=True)
        assert bench.accuracy_for(db, "fake_fez") == (None, "Not yet measured for this machine")
        acc, note = bench.accuracy_for(db, "fake_fez", include_simulated=True)
    assert acc["simulated"] is True and "not real hardware" in note
    assert client.get("/api/v1/rewind/accuracy").json()["machines"] == []


def test_public_accuracy_without_a_key_says_nothing_runs():
    body = client.get("/api/v1/rewind/accuracy").json()
    assert body["running"] is False and "QISKIT_IBM_TOKEN" in body["reason"]
    assert body["machines"] == [] and body["schedule"]["next_due"] is None
    assert body["bench"]["version"] == "rewind-bench-1" and len(body["bench"]["circuits"]) == 20
    assert body["budget"]["budget_seconds"] == 480 and body["budget"]["window_days"] == 28
    assert any("better than reality" in c for c in body["caveats"])
    with SessionLocal() as db:
        assert bench.tick(db, force=True) == {"submitted": [], "problems": [], "compared": 0}
    owner = make_user(role="owner", prefix="bench")
    assert client.post("/api/v1/rewind/bench/run-now", headers=owner).status_code == 409
    assert client.post("/api/v1/rewind/bench/run-now").status_code == 403


def test_public_accuracy_publishes_numbers_not_calibration():
    with SessionLocal() as db:
        _done(db, "ibm_x", 0.95, 0.9, _now() - timedelta(days=8), job="j1")
        _done(db, "ibm_x", 0.93, 0.85, _now() - timedelta(days=1), job="j2")
    body = client.get("/api/v1/rewind/accuracy").json()
    (m,) = body["machines"]
    assert m["machine"] == "ibm_x" and m["latest"]["job_id"] == "j2" and m["latest"]["median"] == 0.93
    assert m["latest"]["circuits"][0]["hardware_counts"] == {"00": 1}
    assert m["window"]["runs"] == 2 and m["window"]["n_circuits"] == 2 and m["window"]["worst"] == 0.93
    assert [r["job_id"] for r in m["runs"]] == ["j1", "j2"] and "hardware_counts" not in m["runs"][0]["circuits"][0]
    text = client.get("/api/v1/rewind/accuracy").text
    assert "t1_us" not in text and "readout_asym" not in text and "properties" not in text


def test_simulation_is_refused_on_render(monkeypatch):
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SIMULATE", "1")
    monkeypatch.setenv("RENDER", "true")
    assert bench.configured() is False and bench.enabled() is False


# ---------------------------------------------------------------------------
# End to end on a local simulator standing in for the hardware (labelled simulated)
# ---------------------------------------------------------------------------

@pytest.mark.skipif(importlib.util.find_spec("qiskit_aer") is None, reason="qiskit-aer not installed")
def test_end_to_end_on_a_fake_backend(monkeypatch):
    from qiskit_ibm_runtime.fake_provider import FakeManilaV2

    from app.rewind import harvest as hv

    class Local(hb._Simulated):
        def backends(self):
            return [FakeManilaV2()]

    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SIMULATE", "1")
    monkeypatch.setenv("QLAB_REWIND_BENCH_CIRCUITS", "3")
    monkeypatch.setenv("QLAB_REWIND_BENCH_SHOTS", "1000")
    monkeypatch.setenv("QLAB_REWIND_BENCH_MACHINES_PER_WEEK", "1")
    monkeypatch.setattr(hb, "provider", Local())
    with SessionLocal() as db:
        assert hv.harvest(db)["stored"]  # the replica's calibration, stored as simulated
        out = bench.tick(db)
        assert len(out["submitted"]) == 1, out
        for _ in range(480):
            if hb.collect_pending(db)["pending"] == 0:
                break
            time.sleep(0.5)
        assert bench.compare_pending(db) == 1
        acc = db.scalar(select(RewindAccuracy))
        usage = db.scalar(select(QpuUsage))
    assert acc.status == "done" and acc.simulated is True and acc.n_circuits == 3
    assert usage.simulated is True and usage.estimated_seconds == pytest.approx(2 + 0.00035 * 3 * 1000)
    for c in acc.circuits:
        assert sum(c["hardware_counts"].values()) == 1000 == sum(c["replica_counts"].values())
        assert c["hardware_vs_replica"] > 0.85
    body = client.get("/api/v1/rewind/accuracy").json()
    assert body["simulated"] is True and body["machines"][0]["machine"] == "fake_manila"
    with SessionLocal() as db:
        _acc, note = bench.accuracy_for(db, "fake_manila", include_simulated=True)
    assert "not real hardware" in note and "3-circuit benchmark" in note
