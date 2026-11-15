"""The time dial on a run's page (app/time_dial.py): replays on stored days, the run itself, the forecast."""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import delete

from app import hardware_board as hb
from app import time_dial as td
from app.database import SessionLocal
from app.models import MachineSnapshot
from app.rewind import store
from app.rewind.snapshot import capture
from tests.helpers import BELL, client, make_user, push_run
from tests.test_rewind_harvest import DAY, FakeIBMBackend, props_for

EARLY = DAY - timedelta(days=3)


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for k in ("QISKIT_IBM_TOKEN", "QLAB_HARDWARE_BOARD_SIMULATE", "RENDER", "QLAB_REWIND_MAX_QUBITS",
              "QLAB_REWIND_MAX_SHOTS", "QLAB_REWIND_MAX_SHOTS_ANON", "QLAB_REWIND_MAX_WORK"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("QLAB_REWIND_DIR", str(tmp_path / "rewind"))
    monkeypatch.setenv("QLAB_REWIND_SCHEDULER", "off")
    hb.provider = None
    td.reset_cache()
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot))
        db.commit()
        # ibm_line: T1 lower and readout error tripled three days before the run's day; ibm_ring: one good day.
        early = capture(FakeIBMBackend("ibm_line"), props_for(EARLY, t1_scale=0.4))
        early["noise"]["readout"] = [[r[0] * 3, r[1]] for r in early["noise"]["readout"]]
        early["noise"]["readout_asym"] = [[a[0] * 3, a[1] * 3] for a in early["noise"]["readout_asym"]]
        store.save(db, early, "harvest")
        store.save(db, capture(FakeIBMBackend("ibm_line"), props_for(DAY)), "harvest")
        store.save(db, capture(FakeIBMBackend("ibm_ring"), props_for(DAY - timedelta(days=1))), "harvest")
    yield
    td.reset_cache()


def _run(headers, backend="ibm_line", **kw) -> str:
    return push_run(headers, run_id=f"td-{uuid.uuid4().hex[:10]}", backend=backend, created_at=DAY.isoformat(),
                    results={"counts": {"00": 480, "11": 470, "01": 30, "10": 20}}, **kw)


def test_timeline_lists_stored_days_and_the_run_itself():
    me = make_user(prefix="td")
    rid = _run(me)
    r = client.get(f"/api/v1/runs/{rid}/timeline", headers=me)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "ready" and body["machine"] == "ibm_line"
    assert [d["date"] for d in body["past"]] == ["2026-11-11", "2026-11-14"]
    assert body["run_date"] == "2026-11-14"
    assert body["present"]["shots"] == 1000 and body["present"]["counts"]["00"] == 480
    assert body["accuracy"] is None and body["accuracy_note"]
    assert "Not affiliated" in body["label"]
    assert body["forecast"]["available"] is True and "persistence forecast" in body["forecast"]["method"]


def test_someone_elses_run_is_not_found():
    me, other = make_user(prefix="td"), make_user(prefix="td")
    rid = _run(me)
    assert client.get(f"/api/v1/runs/{rid}/timeline", headers=other).status_code == 404
    assert client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-11-11", headers=other).status_code == 404
    assert client.get(f"/api/v1/runs/{rid}/timeline/forecast", headers=other).status_code == 404


def test_simulator_and_non_ibm_runs_explain_instead():
    me = make_user(prefix="td")
    sim = client.get(f"/api/v1/runs/{_run(me, backend='aer_simulator')}/timeline", headers=me).json()
    assert sim["state"] == "unavailable" and sim["reason"] == "simulator" and "simulator" in sim["message"]
    other = client.get(f"/api/v1/runs/{_run(me, backend='ionq_aria')}/timeline", headers=me).json()
    assert other["reason"] == "not_ibm"
    rid = _run(me, backend="aer_simulator")
    assert client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-11-11", headers=me).status_code == 409


def test_no_snapshots_is_an_honest_empty_state():
    me = make_user(prefix="td")
    body = client.get(f"/api/v1/runs/{_run(me, backend='ibm_fez')}/timeline", headers=me).json()
    assert body["state"] == "empty" and body["past"] == []
    assert body["message"].startswith("Rewind starts collecting once this server has an IBM Quantum key")
    assert body["forecast"]["available"] is False


def test_replay_on_a_stored_day_says_what_changed_and_is_cached():
    me = make_user(prefix="td")
    rid = _run(me)
    r = client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-11-11", headers=me)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["real_hardware"] is False and body["label"].startswith("Simulated from IBM-published calibration")
    assert sum(body["counts"].values()) == 1000 and body["cached"] is False
    assert body["snapshot"]["calibrated_at"] == "2026-11-11T05:41:12Z"
    assert 0 <= body["tvd_vs_run"] <= 1 and body["hellinger_fidelity"] > 0.5
    changed = body["changed"]
    assert changed["run_calibration"]["near_run"] is True
    assert any(c["kind"] == "t1_us" for c in changed["changes"])
    assert changed["sentence"].startswith("From Wed 11 Nov 2026 to the run's day:") and "readout error fell 67%" in changed["sentence"]
    again = client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-11-11", headers=me).json()
    assert again["cached"] is True and again["counts"] == body["counts"]
    same = client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-11-14", headers=me).json()
    assert same["changed"]["sentence"].startswith("Same calibration as the run's day")


def test_replay_only_on_days_with_a_calibration():
    me = make_user(prefix="td")
    rid = _run(me)
    assert client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-11-12", headers=me).status_code == 404
    assert client.get(f"/api/v1/runs/{rid}/timeline/replay?date=11-12-2026", headers=me).status_code == 422
    assert client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-02-30", headers=me).status_code == 422


def test_forecast_ranks_machines_and_says_how():
    me = make_user(prefix="td")
    rid = _run(me)
    r = client.get(f"/api/v1/runs/{rid}/timeline/forecast", headers=me)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True and body["kind"] == "forecast"
    names = [m["machine"] for m in body["machines"]]
    assert names[0] == "ibm_line" and set(names) == {"ibm_line", "ibm_ring"}
    line = body["machines"][0]
    assert line["days"] == 2 and line["low"] <= line["esp"] <= line["high"] and line["low"] < line["high"]
    assert line["usual_calibration_hour_utc"] == 5
    assert body["sentence"].startswith("Best bet for the coming days: ") and "05:00 UTC" in body["sentence"]
    assert "not a prediction" in body["method"]
    assert client.get(f"/api/v1/runs/{rid}/timeline/forecast", headers=me).json()["cached"] is True


def test_forecast_without_snapshots_is_empty():
    me = make_user(prefix="td")
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot))
        db.commit()
    body = client.get(f"/api/v1/runs/{_run(me)}/timeline/forecast", headers=me).json()
    assert body["available"] is False and "IBM Quantum key" in body["message"]


def test_calibration_changes_reuse_the_drift_threshold():
    a = {"t1_us": [100.0, 100.0], "t2_us": [80.0, 80.0], "readout": [[0.01, 1.0], [0.01, 1.0]],
         "gates": {"cz": {"0_1": [0.004, 68]}}}
    b = {"t1_us": [100.0, 40.0], "t2_us": [80.0, 85.0], "readout": [[0.03, 1.0], [0.01, 1.0]],
         "gates": {"cz": {"0_1": [0.0042, 68]}}}
    texts = [c["text"] for c in td.calibration_changes(a, b, [0, 1])]
    assert "qubit 1's T1 halved" in texts and "qubit 0's readout error tripled" in texts
    assert not any("cz" in t for t in texts)
    assert td.calibration_changes(a, b, [0]) and all(c.get("qubit") != 1 for c in td.calibration_changes(a, b, [0]))


def test_bell_circuit_is_the_one_replayed():
    me = make_user(prefix="td")
    rid = _run(me, qasm=BELL)
    body = client.get(f"/api/v1/runs/{rid}/timeline/replay?date=2026-11-14", headers=me).json()
    top = sorted(body["counts"].items(), key=lambda kv: -kv[1])[:2]
    assert {k for k, _ in top} == {"00", "11"}
