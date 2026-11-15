"""Why did this run give a wrong outcome? Ablation attribution (app/why_failed.py, docs/WHY_METHOD.md).

Fixture calibrations make one error source dominant on purpose; the explanation must rank it first.
"""
from __future__ import annotations

import base64
import hashlib
import io
import math
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from qiskit import QuantumCircuit, qpy
from sqlalchemy import delete

from app import why_failed as wf
from app.database import SessionLocal
from app.models import MachineSnapshot
from app.rewind import store
from app.rewind.snapshot import capture
from tests.helpers import client, make_user
from tests.test_rewind_harvest import DAY, FakeIBMBackend, props_for


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    for k in ("QLAB_WHY_MAX_QUBITS", "QLAB_WHY_MAX_WORK", "QLAB_WHY_TIME_LIMIT_S"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("QLAB_REWIND_DIR", str(tmp_path / "rewind"))
    monkeypatch.setenv("QLAB_REWIND_SCHEDULER", "off")
    wf.clear_cache()
    with SessionLocal() as db:
        db.execute(delete(MachineSnapshot))
        db.commit()
    yield


# ── Fixtures shaped like what the SDK uploads ────────────────────────────────

def ghz3(on=(0, 1, 2), width=5) -> QuantumCircuit:
    """GHZ on physical qubits `on` of a `width`-qubit device, in the device's gates (sx, rz, cx)."""
    a, b, c = on
    qc = QuantumCircuit(width, 3, name="ghz")
    qc.rz(math.pi / 2, a)
    qc.sx(a)
    qc.rz(math.pi / 2, a)
    qc.cx(a, b)
    qc.cx(b, c)
    qc.measure(a, 0)
    qc.measure(b, 1)
    qc.measure(c, 2)
    return qc


def calibration(readout=None, cx=None, t1=None, cx_ns=300.0, time="2026-11-14T05:00:00+00:00"):
    ro = {str(q): 0.01 for q in range(5)}
    ro.update({str(q): v for q, v in (readout or {}).items()})
    t1s = {str(q): 200.0 for q in range(5)}
    t1s.update({str(q): v for q, v in (t1 or {}).items()})
    gates = {**{f"sx_{q}": 2e-4 for q in range(5)}, **{f"rz_{q}": 0.0 for q in range(5)},
             "cx_0_1": 0.005, "cx_1_2": 0.005, "cx_2_3": 0.005, "cx_3_4": 0.005}
    gates.update(cx or {})
    durations = {**{f"sx_{q}": 0.035 for q in range(5)}, **{f"rz_{q}": 0.0 for q in range(5)},
                 **{k: cx_ns / 1000 for k in gates if k.startswith("cx_")}}
    return {"t1_us": t1s, "t2_us": {str(q): min(150.0, 2 * float(t1s[str(q)])) for q in range(5)},
            "readout_errors": ro, "gate_errors": gates, "gate_durations_us": durations,
            "snapshot_time": time, "source": "properties"}


def payload(circuit: QuantumCircuit, counts: dict, cal: dict | None, backend="ibm_test", with_qpy=True,
            qasm: str | None = None, created_at: datetime | None = None) -> dict:
    buf = io.BytesIO()
    qpy.dump(circuit, buf)
    raw = buf.getvalue()
    transpiler: dict = {}
    if with_qpy:
        transpiler["qpy"] = {"after": {"format": "qpy", "encoding": "base64", "data": base64.b64encode(raw).decode(),
                                       "sha256": hashlib.sha256(raw).hexdigest()}}
    return {
        "run_id": f"why-{uuid.uuid4().hex[:12]}", "circuit_name": "ghz", "backend": backend,
        "qasm": qasm or "// compiled circuit",
        "fingerprint": {"num_qubits": circuit.num_qubits, "depth": circuit.depth(),
                        "gate_counts": {str(k): int(v) for k, v in circuit.count_ops().items()}},
        "execution": {"shots": sum(counts.values())}, "calibration": cal or {}, "transpiler": transpiler,
        "results": {"counts": counts}, "project": "why", "tags": [], "status": "completed",
        "created_at": (created_at or datetime(2026, 11, 14, 9, 0, tzinfo=timezone.utc)).isoformat(),
    }


def push(headers, body) -> str:
    r = client.post("/api/v1/runs", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return body["run_id"]


def why(headers, run_id, outcome):
    r = client.get(f"/api/v1/runs/{run_id}/why", headers=headers, params={"outcome": outcome})
    assert r.status_code == 200, r.text
    return r.json()


COUNTS = {"000": 440, "111": 440, "100": 60, "011": 30, "101": 20, "010": 10}


# ── The dominant source is ranked first ──────────────────────────────────────

def test_inflated_readout_error_is_ranked_first():
    h = make_user()
    rid = push(h, payload(ghz3(), COUNTS, calibration(readout={2: 0.12})))
    out = why(h, rid, "100")       # classical bit 2 (qubit 2) flipped from the 000 branch
    assert out["status"] == "explained", out
    top = out["sources"][0]
    assert top["key"] == "readout:2" and top["kind"] == "readout"
    assert top["share"] > 0.7
    assert out["headline"].startswith("Qubit 2's readout error (12.0%) explains ~")
    assert out["noise_free_probability"] == 0 and out["modelled_probability"] > 0.05
    assert abs(sum(s["share"] for s in out["sources"]) - 1) < 0.02
    assert out["is_model"] is True and out["not_modelled"]
    assert out["calibration"]["origin"] == "run"
    assert out["observed"] == {"count": 60, "shots": 1000, "share": 0.06}
    # the coupling map highlights the blamed qubit
    nodes = {n["qubit"]: n for n in out["coupling_map"]["nodes"]}
    assert nodes[2]["share"] > 0.7 and nodes[2]["used"] and not nodes[3]["used"] and 4 not in nodes  # one hop out
    assert {(e["a"], e["b"]) for e in out["coupling_map"]["edges"]} >= {(0, 1), (1, 2), (2, 3)}


def test_inflated_two_qubit_gate_error_is_ranked_first():
    h = make_user()
    rid = push(h, payload(ghz3(), COUNTS, calibration(cx={"cx_1_2": 0.15})))
    out = why(h, rid, "011")       # qubit 2 disagrees with qubits 0 and 1 in the 111 branch
    assert out["status"] == "explained", out
    assert out["sources"][0]["key"] == "gate:1-2"
    assert out["sources"][0]["share"] > 0.6
    edges = {(e["a"], e["b"]): e["share"] for e in out["coupling_map"]["edges"]}
    assert edges[(1, 2)] > 0.6 and edges[(0, 1)] < 0.2


def test_short_t1_is_ranked_first():
    h = make_user()
    # qubit 0 decays during the two long cx gates after it was put in superposition
    rid = push(h, payload(ghz3(), COUNTS, calibration(t1={0: 3.0}, cx_ns=1500.0)))
    out = why(h, rid, "110")       # qubit 0 relaxed to 0 while qubits 1 and 2 read 1
    assert out["status"] == "explained", out
    assert out["sources"][0]["key"] == "decoherence:0"
    assert out["sources"][0]["value"]["t1_us"] == 3.0


def test_physical_qubits_follow_the_layout():
    h = make_user()
    rid = push(h, payload(ghz3(on=(2, 3, 4)), COUNTS, calibration(readout={4: 0.12})))
    out = why(h, rid, "100")       # classical bit 2 is physical qubit 4
    assert out["sources"][0]["key"] == "readout:4"
    assert out["circuit"]["physical_qubits"] == [2, 3, 4]


# ── Honest answers when it can't explain ─────────────────────────────────────

def test_an_outcome_the_ideal_circuit_gives_is_not_blamed():
    h = make_user()
    rid = push(h, payload(ghz3(), COUNTS, calibration()))
    out = why(h, rid, "111")
    assert out["status"] == "expected_outcome"
    assert abs(out["noise_free_probability"] - 0.5) < 1e-6
    assert "sources" not in out


def test_simulator_run_without_calibration_says_what_is_missing():
    h = make_user()
    rid = push(h, payload(ghz3(), COUNTS, None, backend="aer_simulator"))
    out = why(h, rid, "100")
    assert out["status"] == "no_calibration"
    assert "carries no calibration" in out["message"]
    assert out["missing"] == ["calibration from the day of the run"]


def test_snapshot_too_far_from_the_run_is_not_used():
    h = make_user()
    with SessionLocal() as db:
        store.save(db, capture(FakeIBMBackend("ibm_line"), props_for(DAY - timedelta(days=5))), "harvest")
    qc = QuantumCircuit(3, 2)
    qc.sx(0)
    qc.cz(0, 1)
    qc.measure(0, 0)
    qc.measure(1, 1)
    rid = push(h, payload(qc, {"00": 900, "01": 100}, None, backend="ibm_line", created_at=DAY))
    out = why(h, rid, "01")
    assert out["status"] == "no_calibration"
    assert "more than 36 h" in out["message"]


def test_rewind_snapshot_from_the_run_day_is_used():
    h = make_user()
    with SessionLocal() as db:
        store.save(db, capture(FakeIBMBackend("ibm_line"), props_for(DAY)), "harvest")
    qc = QuantumCircuit(3, 2)
    qc.sx(1)
    qc.sx(1)                       # X on qubit 1: ideal outcome "10"
    qc.measure(0, 0)
    qc.measure(1, 1)
    rid = push(h, payload(qc, {"10": 970, "00": 20, "11": 10}, None, backend="ibm_line",
                          created_at=DAY + timedelta(hours=3)))
    out = why(h, rid, "00")        # qubit 1 read as 0
    assert out["status"] == "explained", out
    assert out["calibration"]["origin"] == "rewind" and out["calibration"]["sha256"]
    assert "Rewind stored" in out["calibration"]["note"]
    assert out["sources"][0]["key"] == "readout:1"
    assert out["sources"][0]["value"]["p0_given_1"] == 0.03   # the asymmetric figure
    assert out["confidence"] in ("medium", "low")          # not a capture made with the run


def test_logical_circuit_without_layout_is_refused():
    h = make_user()
    text = ('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\n'
            'cx q[1],q[2];\nmeasure q -> c;')
    rid = push(h, payload(ghz3(), COUNTS, calibration(), with_qpy=False, qasm=text))
    out = why(h, rid, "100")
    assert out["status"] == "no_layout"
    assert out["missing"] == ["the compiled (transpiled) circuit"]


def test_model_far_from_measurement_lowers_confidence():
    h = make_user()
    counts = {"000": 350, "111": 350, "100": 300}   # far more 100 than a 1% readout error gives
    rid = push(h, payload(ghz3(), counts, calibration()))
    out = why(h, rid, "100")
    assert out["status"] == "explained"
    assert out["confidence"] == "low"
    assert any("doesn't include" in r for r in out["confidence_reasons"])


def test_same_day_capture_matching_the_model_is_high_confidence():
    h = make_user()
    rid = push(h, payload(ghz3(), {"000": 470, "111": 470, "100": 60}, calibration(readout={2: 0.12})))
    out = why(h, rid, "100")
    assert out["confidence"] == "high", out["confidence_reasons"]


# ── Limits, cache, input ─────────────────────────────────────────────────────

def test_too_many_qubits_is_refused_with_the_limit(monkeypatch):
    monkeypatch.setenv("QLAB_WHY_MAX_QUBITS", "2")
    h = make_user()
    rid = push(h, payload(ghz3(), COUNTS, calibration()))
    out = why(h, rid, "100")
    assert out["status"] == "too_large" and out["limits"]["qubits"] == 2


def test_work_bound(monkeypatch):
    monkeypatch.setenv("QLAB_WHY_MAX_WORK", "1000000")
    h = make_user()
    big = QuantumCircuit(8, 8)
    for _ in range(40):
        for q in range(7):
            big.sx(q)
            big.cx(q, q + 1)
    big.measure(range(8), range(8))
    cal = calibration()
    cal["readout_errors"] = {str(q): 0.01 for q in range(8)}
    cal["gate_errors"].update({f"sx_{q}": 2e-4 for q in range(8)} | {f"cx_{q}_{q + 1}": 0.005 for q in range(7)})
    rid = push(h, payload(big, {"00000000": 10, "00000001": 1}, cal))
    out = why(h, rid, "00000001")
    assert out["status"] == "too_large"


def test_second_click_is_cached():
    h = make_user()
    rid = push(h, payload(ghz3(), COUNTS, calibration(readout={2: 0.12})))
    first = why(h, rid, "100")
    second = why(h, rid, "011")    # another bitstring: same simulations, no new ones
    third = why(h, rid, "100")
    assert first["cached"] is False and second["cached"] is True and third["cached"] is True
    assert third["sources"] == first["sources"]


def test_bad_outcome_and_other_users_run():
    h = make_user()
    rid = push(h, payload(ghz3(), COUNTS, calibration()))
    assert client.get(f"/api/v1/runs/{rid}/why", headers=h, params={"outcome": "10x"}).status_code == 422
    other = make_user()
    assert client.get(f"/api/v1/runs/{rid}/why", headers=other, params={"outcome": "100"}).status_code == 404


def test_readout_probability_contraction_matches_brute_force():
    import itertools
    import numpy as np
    rng = np.random.default_rng(3)
    p = rng.random(8)
    p /= p.sum()
    ro = [(0.1, 0.2), None, (0.05, 0.3)]
    for bits in itertools.product([0, 1], repeat=3):
        brute = 0.0
        for x in range(8):
            xb = [(x >> i) & 1 for i in range(3)]
            term = p[x]
            for i in range(3):
                if ro[i] is None:
                    term *= 1.0 if bits[i] == xb[i] else 0.0
                else:
                    p10, p01 = ro[i]
                    m = [[1 - p10, p01], [p10, 1 - p01]]
                    term *= m[bits[i]][xb[i]]
            brute += term
        assert abs(wf.prob_of(p, list(bits), ro) - brute) < 1e-12
