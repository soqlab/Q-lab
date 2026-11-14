"""Rewind's screen: the ideal distribution and Hellinger fidelity, stored days, QPU Watch medians,
compare across time (a background job) and saving a replay as a run."""
from __future__ import annotations

import time
from datetime import timedelta

import pytest
from sqlalchemy import delete

from app import hardware_board as hb
from app.database import SessionLocal
from app.models import MachineSnapshot
from app.rewind import compare as cmp
from app.rewind import replay as rp
from app.rewind import store
from app.rewind.snapshot import capture
from tests.helpers import BELL, GHZ3, client, make_user
from tests.test_rewind_harvest import DAY, FakeIBMBackend, props_for

# Four calibrations: three in November 2026 (two on one day), one in September.
CALS = [DAY - timedelta(days=62), DAY - timedelta(days=3), DAY - timedelta(hours=4), DAY]


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for k in ("QISKIT_IBM_TOKEN", "QLAB_HARDWARE_BOARD_SIMULATE", "RENDER", "QLAB_REWIND_MAX_QUBITS",
              "QLAB_REWIND_MAX_SHOTS", "QLAB_REWIND_MAX_SHOTS_ANON", "QLAB_REWIND_MAX_WORK"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("QLAB_REWIND_DIR", str(tmp_path / "rewind"))
    monkeypatch.setenv("QLAB_REWIND_SCHEDULER", "off")
    monkeypatch.setattr(cmp, "BUSY_WAIT_S", 0.05)
    hb.provider = None
    cmp._medians.clear()
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot))
        db.commit()
        for i, d in enumerate(CALS):
            store.save(db, capture(FakeIBMBackend("ibm_line"), props_for(d, t1_scale=1.0 + 0.1 * i)), "harvest")
    yield


def test_ideal_distribution_of_bell_and_ghz():
    dist, why = cmp.ideal_distribution(cmp.parse_for_ideal(BELL, None))
    assert why is None and set(dist) == {"00", "11"} and abs(dist["00"] - 0.5) < 1e-9
    dist, _ = cmp.ideal_distribution(cmp.parse_for_ideal(GHZ3, None))
    assert set(dist) == {"000", "111"}
    # measured into chosen classical bits: q0 -> c2, q1 -> c0
    qasm = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[3];\nx q[0];\nmeasure q[0] -> c[2];\nmeasure q[1] -> c[0];'
    dist, _ = cmp.ideal_distribution(cmp.parse_for_ideal(qasm, None))
    assert dist == {"100": pytest.approx(1.0)}
    # an unmeasured circuit is measured at the end, as the replay does
    dist, _ = cmp.ideal_distribution(cmp.parse_for_ideal('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nx q[0];', None))
    assert dist == {"1": pytest.approx(1.0)}


def test_mid_circuit_measurement_has_no_single_ideal():
    qasm = ('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[2];\nh q[0];\nmeasure q[0] -> c[0];\n'
            'h q[0];\nmeasure q[0] -> c[1];')
    dist, why = cmp.ideal_distribution(cmp.parse_for_ideal(qasm, None))
    assert dist is None and "part-way" in why


def test_hellinger_fidelity_matches_qiskit():
    from qiskit.quantum_info import hellinger_fidelity
    counts = {"00": 480, "11": 470, "01": 30, "10": 20}
    ideal = {"00": 0.5, "11": 0.5}
    assert cmp.hellinger_fidelity(counts, ideal) == pytest.approx(hellinger_fidelity(counts, {"00": 500, "11": 500}), abs=1e-6)
    assert cmp.ideal_share(counts, ideal) == pytest.approx(0.95)
    assert cmp.hellinger_fidelity({"0 1": 10}, {"01": 1.0}) == pytest.approx(1.0)  # register spaces ignored


def test_run_answers_with_the_ideal():
    r = client.post("/api/v1/rewind/run", json={"machine": "ibm_line", "date": DAY.date().isoformat(),
                                                "circuit": BELL, "shots": 2000})
    assert r.status_code == 200, r.text
    ideal = r.json()["ideal"]
    assert ideal["available"] and 0.8 < ideal["hellinger_fidelity"] < 1.0
    assert 0.8 < ideal["share_on_ideal_outcomes"] < 1.0 and ideal["outcomes"] == 2
    assert {k for k, _ in ideal["top"]} == {"00", "11"}


def test_stored_days_and_monthly_days():
    r = client.get("/api/v1/rewind/machines/ibm_line/days")
    assert r.status_code == 200
    d = r.json()
    days = [x["date"] for x in d["days"]]
    assert days == sorted({c.date().isoformat() for c in CALS})
    assert d["monthly"] == [CALS[0].date().isoformat(), DAY.date().isoformat()]
    assert client.get("/api/v1/rewind/machines/no such/days").status_code == 422


def test_watch_gives_medians_only_one_point_per_day():
    r = client.get("/api/v1/rewind/watch?days=90")
    assert r.status_code == 200
    m = r.json()["machines"][0]
    assert m["machine"] == "ibm_line" and m["snapshots"] == 4
    assert len(m["series"]) == 3  # two calibrations on one day: one point
    assert set(m["latest"]) == {"date", "calibrated_at", *cmp.METRICS}
    assert m["series"][-1]["t1_us_median"] > m["series"][0]["t1_us_median"]
    # the window counts back from the last stored calibration
    assert len(client.get("/api/v1/rewind/watch?days=10").json()["machines"][0]["series"]) == 2


def _wait(job: str, timeout: float = 120.0) -> dict:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        doc = client.get(f"/api/v1/rewind/compare/{job}").json()
        if doc["status"] != "running":
            return doc
        time.sleep(0.2)
    raise AssertionError("comparison did not finish")


def test_compare_across_time_runs_each_month():
    r = client.post("/api/v1/rewind/compare", json={"machine": "ibm_line", "circuit": BELL, "shots": 500})
    assert r.status_code == 202, r.text
    doc = _wait(r.json()["job"])
    assert doc["status"] == "done" and doc["ideal"]["available"]
    assert [x["date"] for x in doc["results"]] == [CALS[0].date().isoformat(), DAY.date().isoformat()]
    for x in doc["results"]:
        assert x["status"] == "ok" and 0.5 < x["hellinger_fidelity"] <= 1 and len(x["snapshot"]["sha256"]) == 64
    assert doc["accuracy"] is None and doc["real_hardware"] is False
    assert client.get("/api/v1/rewind/compare/abc").status_code == 422
    assert client.get("/api/v1/rewind/compare/" + "a" * 16).status_code == 404


def test_compare_needs_two_months_and_a_valid_circuit():
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot).where(MachineSnapshot.calibrated_at < DAY - timedelta(days=30)))
        db.commit()
    r = client.post("/api/v1/rewind/compare", json={"machine": "ibm_line", "circuit": BELL})
    assert r.status_code == 409 and "two months" in r.json()["detail"]


def test_compare_refuses_a_bad_circuit():
    r = client.post("/api/v1/rewind/compare", json={"machine": "ibm_line", "circuit": "OPENQASM 2.0; nonsense"})
    assert r.status_code == 422


def test_save_needs_an_account_and_keeps_a_marked_simulated_run():
    body = {"machine": "ibm_line", "date": DAY.date().isoformat(), "circuit": BELL, "shots": 300, "project": "rw-proj"}
    assert client.post("/api/v1/rewind/save", json=body).status_code == 401
    h = make_user(prefix="rw")
    r = client.post("/api/v1/rewind/save", json=body, headers=h)
    assert r.status_code == 200, r.text
    run = client.get(f"/api/v1/runs/{r.json()['run_id']}", headers=h).json()
    assert run["backend"] == "rewind:ibm_line" and set(run["tags"]) == {"rewind", "simulated"}
    rw = run["context"]["rewind"]
    assert rw["real_hardware"] is False and len(rw["snapshot"]["sha256"]) == 64 and "not affiliated" in rw["label"]
    assert run["execution"]["real_hardware"] is False and sum(run["results"]["counts"].values()) == 300
    assert run["project"] == "rw-proj"
    # the same inputs give the same counts as an anonymous replay
    again = client.post("/api/v1/rewind/run", json={k: body[k] for k in ("machine", "date", "circuit", "shots")}).json()
    assert again["counts"] == run["results"]["counts"]


def test_limits_still_apply_to_compare(monkeypatch):
    monkeypatch.setenv("QLAB_REWIND_MAX_SHOTS_ANON", "100")
    r = client.post("/api/v1/rewind/compare", json={"machine": "ibm_line", "circuit": BELL, "shots": 101})
    assert r.status_code == 422
    assert rp.max_shots(False) == 100
