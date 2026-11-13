"""Drift alarm (app/drift.py): same circuit, same backend, the result moved, and why."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from qiskit import qasm2

from app import drift
from tests.helpers import BELL as BELL_QASM, client, make_user
from tests.test_explain_diff import BELL, NOISY_BELL, bell_on, calibration, record, sample


@pytest.fixture(autouse=True)
def _clean():
    drift.reset_cache()
    yield


def _at(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def _pair(headers, counts_a, counts_b, cal_a=None, cal_b=None, *, backend=None, logical=True,
          kw_a=None, kw_b=None, days=(3, 1), project=None):
    """Two runs of the same Bell circuit on one backend, a few days apart. Returns their payloads."""
    backend = backend or f"ibm_{uuid.uuid4().hex[:6]}"
    circuit = bell_on(0, 1)
    text = qasm2.dumps(circuit)
    out = []
    for counts, cal, kw, d in ((counts_a, cal_a, kw_a or {}, days[0]), (counts_b, cal_b, kw_b or {}, days[1])):
        p = record(circuit, counts, cal, qasm=text, backend=backend, **kw)
        if logical:
            p["transpiler"]["qasm"] = {"before": {"format": "openqasm2", "text": BELL_QASM}}
        p["created_at"] = _at(d)
        if project:
            p["project"] = project
        r = client.post("/api/v1/runs", headers=headers, json=p)
        assert r.status_code == 200, r.text
        out.append(p)
    return out


def _drift(headers, run_id, level="standard"):
    r = client.get(f"/api/v1/runs/{run_id}/drift?level={level}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_same_distribution_is_steady():
    me = make_user(prefix="drift")
    _, b = _pair(me, sample(BELL, 4000, 1), sample(BELL, 4000, 2))
    d = _drift(me, b["run_id"])
    assert d["state"] == "steady"
    assert d["shift"]["drifted"] is False
    assert d["sentence"].startswith("Same circuit as the run 2 days earlier on ")
    assert "the result held" in d["sentence"]


def test_shift_beyond_shot_noise_is_an_alarm_and_calibration_is_blamed():
    me = make_user(prefix="drift")
    _, b = _pair(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2),
                 calibration(ro=0.012), calibration(ro=0.025, time="2026-11-11T08:00:00+00:00"))
    d = _drift(me, b["run_id"])
    assert d["state"] == "drifted" and d["shift"]["p_value"] < drift.ALPHA
    assert d["verdict"] == "hardware"
    assert d["code"]["changed"] is False
    top = d["hardware"]["changes"][0]
    assert top["kind"] == "readout_errors" and top["qubit"] in (0, 1) and top["worse"] is True
    assert "Your code didn't change: qubit" in d["sentence"]
    assert "readout error doubled since then (calibration Wed 11 Nov)" in d["sentence"]
    assert "TVD 0.1" in d["sentence"]
    plain = _drift(me, b["run_id"], "plain")
    assert "TVD" not in plain["sentence"] and plain["verdict"] == "hardware"


def test_shot_noise_threshold_depends_on_shots():
    me = make_user(prefix="drift")
    # The same 5-point shift in the 01/10 share: invisible with 60 shots, clear with 20000.
    few_a, few_b = {"00": 29, "11": 29, "01": 1, "10": 1}, {"00": 27, "11": 27, "01": 3, "10": 3}
    _, b = _pair(me, few_a, few_b)
    assert _drift(me, b["run_id"])["state"] == "steady"
    many_a = {"00": 9700, "11": 9700, "01": 300, "10": 300}
    many_b = {"00": 9200, "11": 9200, "01": 800, "10": 800}
    _, b = _pair(me, many_a, many_b)
    assert _drift(me, b["run_id"])["state"] == "drifted"


def test_a_code_side_change_is_named_when_calibration_held():
    me = make_user(prefix="drift")
    cal = calibration()
    _, b = _pair(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2), cal, cal,
                 kw_a={"opt_level": 1, "qiskit": "2.5.0"}, kw_b={"opt_level": 3, "qiskit": "2.6.2"})
    d = _drift(me, b["run_id"])
    assert d["verdict"] == "code"
    fields = {c["field"] for c in d["code"]["changes"]}
    assert "optimization_level" in fields and "version:qiskit" in fields
    assert "what changed is on your side" in d["sentence"] and "qiskit 2.5.0 → 2.6.2" in d["sentence"]


def test_without_calibration_attribution_is_unavailable():
    me = make_user(prefix="drift")
    _, b = _pair(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2))
    d = _drift(me, b["run_id"])
    assert d["state"] == "drifted" and d["verdict"] == "unknown"
    assert d["hardware"]["available"] is False
    assert "whether the machine changed can't be said: no calibration snapshot was recorded" in d["sentence"]


def test_only_the_same_backend_and_the_same_circuit_count():
    me = make_user(prefix="drift")
    a, b = _pair(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2))
    other = record(bell_on(0, 1), sample(NOISY_BELL, 4000, 3), None, qasm=qasm2.dumps(bell_on(0, 1)), backend="ibm_elsewhere")
    other["created_at"] = _at(0.5)
    assert client.post("/api/v1/runs", headers=me, json=other).status_code == 200
    assert _drift(me, other["run_id"])["state"] == "no_previous"
    changed = record(bell_on(1, 2), sample(BELL, 4000, 4), None, qasm=qasm2.dumps(bell_on(1, 2)), backend=a["backend"])
    changed["created_at"] = _at(0.2)
    assert client.post("/api/v1/runs", headers=me, json=changed).status_code == 200
    assert _drift(me, changed["run_id"])["state"] == "no_previous"


def test_another_users_run_is_never_compared_or_shown():
    alice, bob = make_user(prefix="drift"), make_user(prefix="drift")
    backend = f"ibm_{uuid.uuid4().hex[:6]}"
    a, _ = _pair(alice, sample(BELL, 4000, 1), sample(BELL, 4000, 2), backend=backend)
    circuit = bell_on(0, 1)
    p = record(circuit, sample(NOISY_BELL, 4000, 5), None, qasm=qasm2.dumps(circuit), backend=backend)
    p["transpiler"]["qasm"] = {"before": {"text": BELL_QASM}}
    p["created_at"] = _at(0.1)
    assert client.post("/api/v1/runs", headers=bob, json=p).status_code == 200
    assert _drift(bob, p["run_id"])["state"] == "no_previous"
    assert client.get(f"/api/v1/runs/{a['run_id']}/drift", headers=bob).status_code == 404


def test_timeline_marks_the_run_that_drifted():
    me = make_user(prefix="drift")
    project = f"drift-{uuid.uuid4().hex[:8]}"
    a, b = _pair(me, sample(BELL, 4000, 1), sample(NOISY_BELL, 4000, 2), project=project)
    body = client.get(f"/api/v1/projects/{project}/timeline", headers=me).json()
    by_id = {r["run_id"]: r for r in body["runs"]}
    assert by_id[a["run_id"]]["drift"] is None
    mark = by_id[b["run_id"]]["drift"]
    assert mark["drifted"] is True and mark["previous_run_id"] == a["run_id"] and mark["tvd"] > 0.05
