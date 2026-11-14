"""Rewind part 2: the noise model from a stored calibration, snapshot choice, limits, and the run."""
from __future__ import annotations

import base64
import io
from datetime import date, timedelta

import pytest
from sqlalchemy import delete

from app import hardware_board as hb
from app.database import SessionLocal
from app.models import MachineSnapshot
from app.rewind import replay as rp
from app.rewind import store
from app.rewind.snapshot import capture
from tests.helpers import BELL, GHZ3, client, make_user
from tests.test_rewind_harvest import DAY, FakeIBMBackend, props_for


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for k in ("QISKIT_IBM_TOKEN", "QLAB_HARDWARE_BOARD_SIMULATE", "RENDER", "QLAB_REWIND_MAX_QUBITS",
              "QLAB_REWIND_MAX_SHOTS", "QLAB_REWIND_MAX_SHOTS_ANON", "QLAB_REWIND_MAX_WORK"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("QLAB_REWIND_DIR", str(tmp_path / "rewind"))
    monkeypatch.setenv("QLAB_REWIND_SCHEDULER", "off")
    hb.provider = None
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot))
        db.commit()
        for d in (DAY - timedelta(days=3), DAY):
            store.save(db, capture(FakeIBMBackend("ibm_line"), props_for(d)), "harvest")
    yield


def _record():
    return capture(FakeIBMBackend("ibm_line"), props_for(DAY))


# ---------------------------------------------------------------------------
# The noise model
# ---------------------------------------------------------------------------

def test_noise_model_has_relaxation_depolarizing_and_readout_channels():
    model, summary = rp.build_noise_model(_record(), [1, 2])
    ch = summary["channels"]
    # sx and x on 2 qubits, cz both ways between 1 and 2: relaxation and depolarizing on each
    assert ch["thermal_relaxation"] == 6 and ch["depolarizing"] == 6
    assert ch["readout"] == 2 and ch["readout_asymmetric"] == 2
    assert summary["gates_with_errors"] == {"cz": 2, "sx": 2, "x": 2}
    assert summary["physical_qubits"] == [1, 2] and summary["t1_us"] == {"1": 200.0, "2": 90.0}
    assert set(model.noise_instructions) >= {"cz", "sx", "x", "measure"}
    assert model.noise_qubits == [0, 1]  # renumbered to the simulated qubits
    assert "crosstalk between neighbouring qubits" in summary["not_modelled"]


def test_gate_error_matches_the_reported_error():
    from qiskit.quantum_info import average_gate_fidelity
    for err, dur, t1s, t2s in ((0.004, 68, [150, 200], [100, 120]), (2e-4, 32, [150], [400]), (0.3, 500, [20], [10])):
        e, kinds = rp.gate_error(err, dur, t1s, t2s)
        assert kinds == {"thermal_relaxation": True, "depolarizing": True}
        assert abs((1 - average_gate_fidelity(e)) - err) < 1e-6
    # an error smaller than relaxation alone explains: relaxation only
    e, kinds = rp.gate_error(1e-7, 500, [20], [10])
    assert kinds == {"thermal_relaxation": True, "depolarizing": False}
    # no duration: depolarizing only; nothing at all: no error
    assert rp.gate_error(0.01, 0, [100], [100])[1] == {"thermal_relaxation": False, "depolarizing": True}
    assert rp.gate_error(0.0, 0, [100], [100])[0] is None


def test_broken_gates_are_not_used():
    rec = _record()
    rec["noise"]["gates"]["cz"]["1_2"] = [1.0, 68]
    rec["noise"]["gates"]["cz"]["2_1"] = [1.0, 68]
    assert set(rp.usable_view(rec["noise"])["gates"]["cz"]) == {"0_1", "1_0"}


# ---------------------------------------------------------------------------
# Choosing the snapshot
# ---------------------------------------------------------------------------

def test_the_nearest_calibration_is_used_and_the_gap_is_stated():
    with SessionLocal() as db:
        same = rp.replay(db, "ibm_line", date(2026, 11, 14), BELL, shots=200)
        assert same["snapshot"]["calibrated_at"] == "2026-11-14T05:41:12Z"
        assert "from the day asked" in same["snapshot"]["note"]
        later = rp.replay(db, "ibm_line", date(2026, 11, 20), BELL, shots=200)
        assert later["snapshot"]["calibrated_at"] == "2026-11-14T05:41:12Z"
        assert "6 days before" in later["snapshot"]["note"] and later["snapshot"]["gap_days"] < -5
        early = rp.replay(db, "ibm_line", date(2026, 11, 12), BELL, shots=200)
        assert early["snapshot"]["calibrated_at"] == "2026-11-11T05:41:12Z" and "1 day before" in early["snapshot"]["note"]
        with pytest.raises(rp.ReplayError) as e:
            rp.replay(db, "ibm_nowhere", date(2026, 11, 14), BELL)
        assert e.value.status == 404


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------

def test_bell_gives_mostly_00_and_11_with_realistic_error():
    with SessionLocal() as db:
        out = rp.replay(db, "ibm_line", date(2026, 11, 14), BELL, shots=4000)
    c = out["counts"]
    assert sum(c.values()) == 4000
    good = c.get("00", 0) + c.get("11", 0)
    assert 0.9 < good / 4000 < 0.995  # readout ~1-2% per qubit plus a CZ at 0.4%: a few % wrong
    assert abs(c.get("00", 0) - c.get("11", 0)) < 400
    assert out["noise_model"]["method"] == "density_matrix"
    assert out["label"] == ("Simulated from IBM-published calibration of ibm_line as of 2026-11-14; "
                            "not affiliated with or endorsed by IBM.")
    assert out["accuracy"] is None and out["accuracy_note"] == "Not yet measured for this machine"
    assert out["real_hardware"] is False and out["software"]["qiskit"]
    assert len(out["snapshot"]["sha256"]) == 64 and out["transpiled"]["two_qubit_gates"] >= 1


def test_same_input_same_counts_and_the_seed_changes_them():
    with SessionLocal() as db:
        a = rp.replay(db, "ibm_line", date(2026, 11, 14), GHZ3, shots=1000)
        b = rp.replay(db, "ibm_line", date(2026, 11, 14), GHZ3, shots=1000)
        c = rp.replay(db, "ibm_line", date(2026, 11, 14), GHZ3, shots=1000, seed=5)
    assert a["counts"] == b["counts"] and a["counts"] != c["counts"]
    assert a["seeds"] == {"simulator": rp.SEED_SIMULATOR, "transpiler": 7}


def test_statevector_trajectories_above_the_density_matrix_limit(monkeypatch):
    monkeypatch.setenv("QLAB_REWIND_DENSITY_MAX", "1")
    with SessionLocal() as db:
        a = rp.replay(db, "ibm_line", date(2026, 11, 14), BELL, shots=300)
        b = rp.replay(db, "ibm_line", date(2026, 11, 14), BELL, shots=300)
    assert a["noise_model"]["method"] == "statevector" and a["counts"] == b["counts"]


def test_limits(monkeypatch):
    with SessionLocal() as db:
        def err(**kw):
            with pytest.raises(rp.ReplayError) as e:
                rp.replay(db, "ibm_line", date(2026, 11, 14), kw.pop("circuit", BELL), **kw)
            return e.value
        assert err(shots=4097).status == 422  # anonymous cap
        assert rp.replay(db, "ibm_line", date(2026, 11, 14), BELL, shots=4097, signed_in=True)["shots"] == 4097
        assert err(shots=8193, signed_in=True).status == 422
        assert err(shots=0).status == 422
        monkeypatch.setenv("QLAB_REWIND_MAX_QUBITS", "2")
        assert "up to 2" in err(circuit=GHZ3).message
        monkeypatch.delenv("QLAB_REWIND_MAX_QUBITS")
        four = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[4];\nh q[0];\ncx q[0],q[3];\nmeasure q[0] -> c[0];'
        assert err(circuit=four).status == 422  # bad text, or more qubits than the machine has
        monkeypatch.setenv("QLAB_REWIND_MAX_WORK", "10")
        assert "too long" in err().message
        monkeypatch.delenv("QLAB_REWIND_MAX_WORK")
        assert err(circuit="not a circuit").status == 422
        assert err(circuit="").status == 422


def test_unmeasured_circuit_is_measured_and_qpy_is_read():
    from qiskit import QuantumCircuit, qpy
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    buf = io.BytesIO()
    qpy.dump(qc, buf)
    with SessionLocal() as db:
        out = rp.replay(db, "ibm_line", date(2026, 11, 14), base64.b64encode(buf.getvalue()).decode(), shots=500)
    assert out["notes"] and sum(out["counts"].values()) == 500
    assert out["counts"].get("00", 0) + out["counts"].get("11", 0) > 400


def test_concurrency_gate(monkeypatch):
    import threading
    monkeypatch.setattr(rp, "_gate", threading.BoundedSemaphore(1))
    hold, entered = threading.Event(), threading.Event()

    def slow():
        entered.set()
        hold.wait(5)
        return {"ok": True}

    t = threading.Thread(target=lambda: rp.run_limited(slow))
    t.start()
    assert entered.wait(5)
    with pytest.raises(rp.ReplayError) as e:
        rp.run_limited(lambda: {"ok": True})
    assert e.value.status == 503
    hold.set()
    t.join(5)
    assert rp.run_limited(lambda: {"ok": 1}) == {"ok": 1}
    monkeypatch.setenv("QLAB_REWIND_TIME_LIMIT_S", "1")
    gate = threading.Event()
    with pytest.raises(rp.ReplayError) as e:
        rp.run_limited(lambda: gate.wait(3))
    assert e.value.status == 504
    gate.set()


# ---------------------------------------------------------------------------
# The API and the command line
# ---------------------------------------------------------------------------

def test_run_endpoint_is_public_and_labelled():
    r = client.post("/api/v1/rewind/run", json={"machine": "ibm_line", "date": "2026-11-14", "circuit": BELL, "shots": 1000})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["label"].startswith("Simulated from IBM-published calibration of ibm_line as of 2026-11-14")
    assert sum(body["counts"].values()) == 1000 and body["limits"]["shots"] == 4096
    assert client.post("/api/v1/rewind/run", json={"machine": "ibm_line", "date": "2026-11-14", "circuit": BELL,
                                                    "shots": 5000}).status_code == 422
    h = make_user()
    assert client.post("/api/v1/rewind/run", headers=h, json={"machine": "ibm_line", "date": "2026-11-14",
                                                              "circuit": BELL, "shots": 5000}).status_code == 200
    assert client.post("/api/v1/rewind/run", json={"machine": "ibm_none", "date": "2026-11-14",
                                                    "circuit": BELL}).status_code == 404
    assert client.post("/api/v1/rewind/run", json={"machine": "../x", "date": "2026-11-14",
                                                    "circuit": BELL}).status_code == 422
    assert client.post("/api/v1/rewind/run", json={"machine": "ibm_line", "date": "14/11/2026",
                                                    "circuit": BELL}).status_code == 422


def test_run_endpoint_is_rate_limited_per_address():
    codes = [client.post("/api/v1/rewind/run", json={"machine": "ibm_none", "date": "2026-11-14", "circuit": BELL}).status_code
             for _ in range(12)]
    assert 429 in codes


def test_simulated_snapshots_are_not_replayed_as_real(monkeypatch):
    with SessionLocal() as db:
        store.save(db, capture(FakeIBMBackend("fake_line"), props_for(DAY)), "simulated")
        with pytest.raises(rp.ReplayError):
            rp.replay(db, "fake_line", date(2026, 11, 14), BELL, shots=100)
    monkeypatch.setenv("QLAB_HARDWARE_BOARD_SIMULATE", "1")
    r = client.post("/api/v1/rewind/run", json={"machine": "fake_line", "date": "2026-11-14", "circuit": BELL, "shots": 100})
    assert r.status_code == 200 and r.json()["snapshot"]["source"] == "simulated"


def test_command_line_run(tmp_path, capsys):
    from app.rewind.__main__ import main
    f = tmp_path / "bell.qasm"
    f.write_text(BELL)
    assert main(["run", "--machine", "ibm_line", "--date", "2026-11-14", "--qasm", str(f), "--shots", "400"]) == 0
    out = capsys.readouterr().out
    assert "not affiliated with or endorsed by IBM" in out and '"counts"' in out
    assert main(["run", "--machine", "ibm_none", "--date", "2026-11-14", "--qasm", str(f)]) == 1
