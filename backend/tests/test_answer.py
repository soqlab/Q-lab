"""Answer-first runs (app/run_answer.py, app/routers/answer.py): the sentence, the comparison, lookup."""
import uuid
from datetime import datetime, timedelta, timezone

from qiskit import qasm2

from tests.helpers import client, make_user, run_payload
from tests.test_explain_diff import BELL as BELL_PROBS, NOISY_BELL, bell_on, calibration, record, sample


def _at(days_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


def _post(headers, **kw) -> str:
    body = run_payload(**kw)
    r = client.post("/api/v1/runs", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return body["run_id"]


def _answer(headers, run_id, level="standard"):
    r = client.get(f"/api/v1/runs/{run_id}/answer?level={level}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_first_run_says_there_is_nothing_to_compare():
    me = make_user(prefix="ans")
    rid = _post(me, circuit_name=f"bell-{uuid.uuid4().hex[:6]}", backend="ibm_test", created_at=_at(1))
    a = _answer(me, rid)
    assert a["measure"]["kind"] == "ideal_share"
    assert a["measure"]["value"] == 1.0
    assert a["measure"]["ideal_outcomes"] == ["00", "11"]
    assert a["previous"] is None
    assert "100% of shots landed on the expected outcomes" in a["sentence"]
    assert "first recorded run" in a["sentence"]


def test_worse_run_is_compared_with_last_weeks_run_in_points():
    me = make_user(prefix="ans")
    name = f"bell-{uuid.uuid4().hex[:6]}"
    _post(me, circuit_name=name, backend="ibm_brisbane", created_at=_at(8), results={"counts": {"00": 2000, "11": 2000}},
          execution={"shots": 4000})
    rid = _post(me, circuit_name=name, backend="ibm_brisbane", created_at=_at(1),
                results={"counts": {"00": 1880, "11": 1880, "01": 120, "10": 120}}, execution={"shots": 4000})
    a = _answer(me, rid)
    assert a["previous"]["same_backend"] is True
    assert a["change"]["significant"] is True
    assert a["change"]["points"] == -6.0
    assert a["sentence"].startswith(f"{name} on ibm_brisbane: 94% of shots landed on the expected outcomes, 6 points worse than last week's run")
    # No calibration was stored, so no cause may be named.
    assert a["cause"] is None


def test_difference_within_shot_noise_is_called_the_same():
    me = make_user(prefix="ans")
    name = f"bell-{uuid.uuid4().hex[:6]}"
    _post(me, circuit_name=name, created_at=_at(3), results={"counts": {"00": 490, "11": 490, "01": 20}})
    rid = _post(me, circuit_name=name, created_at=_at(1), results={"counts": {"00": 488, "11": 490, "01": 22}})
    a = _answer(me, rid)
    assert a["change"]["significant"] is False
    assert "about the same as the run 2 days earlier" in a["sentence"]


def test_levels_change_the_wording_not_the_facts():
    me = make_user(prefix="ans")
    name = f"bell-{uuid.uuid4().hex[:6]}"
    _post(me, circuit_name=name, created_at=_at(2), results={"counts": {"00": 2000, "11": 2000}})
    rid = _post(me, circuit_name=name, created_at=_at(1), results={"counts": {"00": 1800, "11": 1800, "10": 400}})
    plain, expert = _answer(me, rid, "plain"), _answer(me, rid, "expert")
    assert plain["measure"] == expert["measure"]
    assert "gave an answer the circuit should give" in plain["sentence"]
    assert "TVD" not in plain["sentence"] and "Hellinger" not in plain["sentence"]
    assert "Hellinger fidelity" in expert["sentence"] and "TVD" in expert["sentence"]
    r = client.get(f"/api/v1/runs/{rid}/answer?level=chatty", headers=me)
    assert r.status_code == 422


def test_cause_is_named_only_when_stored_calibration_supports_it():
    me = make_user(prefix="ans")
    circuit = bell_on(0, 1)
    text = qasm2.dumps(circuit)
    name = f"bell5-{uuid.uuid4().hex[:6]}"
    pa = record(circuit, sample(BELL_PROBS, 8000, 1), calibration(cx01=0.01, ro=0.01), qasm=text)
    pb = record(circuit, sample(NOISY_BELL, 8000, 2), calibration(cx01=0.09, ro=0.05, time="2026-11-03T08:00:00+00:00"), qasm=text)
    for p, days in ((pa, 8), (pb, 1)):
        p.update(circuit_name=name, created_at=_at(days))
        assert client.post("/api/v1/runs", headers=me, json=p).status_code == 200
    a = _answer(me, pb["run_id"])
    assert a["change"]["significant"] is True
    assert a["cause"] and a["cause"].startswith("Likely cause: calibration drift (")
    assert "qubit" in a["cause"] or "cx" in a["cause"]
    assert _answer(me, pb["run_id"], "plain")["cause"] == "The machine's calibration changed on the qubits it used, enough to explain it"


def test_comparison_never_uses_someone_elses_run():
    alice, bob = make_user(prefix="ans"), make_user(prefix="ans")
    name = f"bell-{uuid.uuid4().hex[:6]}"
    _post(alice, circuit_name=name, created_at=_at(5))
    rid = _post(bob, circuit_name=name, created_at=_at(1))
    assert _answer(bob, rid)["previous"] is None
    assert client.get(f"/api/v1/runs/{rid}/answer", headers=alice).status_code == 404


def test_run_without_results_says_so():
    me = make_user(prefix="ans")
    rid = _post(me, results={}, status="submitted")
    a = _answer(me, rid)
    assert a["measure"] is None
    assert "no measured results" in a["sentence"]


def test_circuit_without_an_exact_ideal_uses_the_top_outcome():
    me = make_user(prefix="ans")
    rid = _post(me, qasm=None, fingerprint={"num_qubits": 2}, results={"counts": {"01": 700, "10": 300}})
    a = _answer(me, rid)
    assert a["measure"]["kind"] == "top_share"
    assert "the most common result, 01, came up in 70% of shots" in a["sentence"]


def test_project_timeline_is_oldest_first_with_measures():
    me = make_user(prefix="ans")
    project = f"tl-{uuid.uuid4().hex[:8]}"
    ids = [_post(me, project=project, created_at=_at(d), results={"counts": {"00": 500 - 50 * i, "11": 500, "01": 50 * i}})
           for i, d in enumerate((3, 2, 1))]
    r = client.get(f"/api/v1/projects/{project}/timeline", headers=me)
    assert r.status_code == 200
    body = r.json()
    assert [x["run_id"] for x in body["runs"]] == ids
    assert body["runs"][0]["measure"] == {"kind": "ideal_share", "value": 1.0}
    assert body["runs"][2]["measure"]["value"] == round(900 / 1000, 6)
    other = make_user(prefix="ans")
    assert client.get(f"/api/v1/projects/{project}/timeline", headers=other).status_code == 404


def test_lookup_recognises_run_ids_hashes_projects_and_backends():
    me = make_user(prefix="ans")
    project = f"look-{uuid.uuid4().hex[:8]}"
    rid = _post(me, project=project, backend="ibm_kingston", fingerprint={"num_qubits": 2, "qasm_sha256": "ab12cd34" * 8})
    def kinds(q):
        r = client.get("/api/v1/lookup", params={"q": q}, headers=me)
        assert r.status_code == 200
        return {(m["kind"], m["href"]) for m in r.json()["matches"]}
    assert ("run", f"/runs/{rid}") in kinds(rid[:10])
    assert ("circuit", f"/runs?circuit={'ab12cd34' * 8}") in kinds("ab12cd34ab")
    assert ("project", f"/projects/{project}/timeline") in kinds(project)
    got = kinds("ibm_kingston")
    assert ("backend", "/runs?backend=ibm_kingston") in got
    assert ("hardware", "/hardware/ibm_kingston") in got
    # Another user's runs and projects are not found.
    assert kinds(rid[:10]) and not (("run", f"/runs/{rid}") in {(m["kind"], m["href"]) for m in
        client.get("/api/v1/lookup", params={"q": rid[:10]}, headers=make_user(prefix="ans")).json()["matches"]})



def test_public_answer_compares_only_with_the_owners_shared_runs():
    me = make_user(prefix="ans")
    name = f"bell-{uuid.uuid4().hex[:6]}"
    hidden = _post(me, circuit_name=name, created_at=_at(5), results={"counts": {"00": 500, "11": 500}})
    rid = _post(me, circuit_name=name, created_at=_at(1), results={"counts": {"00": 450, "11": 450, "01": 100}})
    token = client.post(f"/api/v1/runs/{rid}/share", headers=me).json()["share_token"]
    a = client.get(f"/api/v1/runs/public/{token}/answer").json()
    assert a["previous"] is None  # the earlier run isn't shared, so it isn't used
    client.post(f"/api/v1/runs/{hidden}/share", headers=me)
    b = client.get(f"/api/v1/runs/public/{token}/answer").json()
    assert b["previous"]["run_id"] == hidden and b["previous"]["share_token"]
    assert client.get("/api/v1/runs/public/nope/answer").status_code == 404
