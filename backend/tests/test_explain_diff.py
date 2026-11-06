"""Why two runs differ: shot noise vs compiler changes vs calibration drift (app/run_diff.py)."""
import base64
import hashlib
import io
import math
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient
from qiskit import QuantumCircuit, qpy

from app.database import init_db
from app.main import app
from app.run_diff import counts_of, estimate_fidelity, executed_usage, explain_difference, shot_noise_analysis

init_db()
client = TestClient(app, raise_server_exceptions=False)


# ── Seeded run records, shaped like what the SDK uploads ─────────────────────

def bell_on(q0: int, q1: int, extra_cx: int = 0) -> QuantumCircuit:
    """A Bell circuit on physical qubits q0, q1 of a 5-qubit device (as a transpiled circuit is)."""
    qc = QuantumCircuit(5, 2, name="bell")
    qc.rz(math.pi / 2, q0)
    qc.sx(q0)
    qc.rz(math.pi / 2, q0)
    qc.cx(q0, q1)
    for _ in range(extra_cx):
        qc.cx(q0, q1)
        qc.cx(q0, q1)
    qc.measure(q0, 0)
    qc.measure(q1, 1)
    return qc


def calibration(cx01=0.01, cx12=0.012, ro=0.02, t1=120.0, sx=0.0003, time="2026-11-01T08:00:00+00:00"):
    return {
        "t1_us": {str(q): t1 + q for q in range(5)},
        "t2_us": {str(q): 80.0 + q for q in range(5)},
        "readout_errors": {str(q): ro for q in range(5)},
        "gate_errors": {
            **{f"sx_{q}": sx for q in range(5)},
            **{f"rz_{q}": 0.0 for q in range(5)},
            "cx_0_1": cx01, "cx_1_2": cx12, "cx_2_3": 0.011, "cx_3_4": 0.013,
        },
        "snapshot_time": time,
        "source": "properties",
    }


def record(circuit: QuantumCircuit, counts: dict, cal: dict | None, *, opt_level=1, qiskit="2.6.2",
           with_qpy=True, qasm: str | None = "", parameters=None, backend="ibm_test") -> dict:
    """A run payload as the SDK would post it: fingerprint, QPY of the transpiled circuit, settings."""
    buf = io.BytesIO()
    qpy.dump(circuit, buf)
    raw = buf.getvalue()
    gate_counts = {str(k): int(v) for k, v in circuit.count_ops().items()}
    ops = [(i.operation.name, [circuit.find_bit(q).index for q in i.qubits]) for i in circuit.data]
    text = qasm if qasm != "" else f"// {ops}"  # stands in for the QASM text: hashed, not parsed
    transpiler: dict = {"settings": {"optimization_level": opt_level}}
    if with_qpy:
        transpiler["qpy"] = {"after": {"format": "qpy", "encoding": "base64", "data": base64.b64encode(raw).decode(),
                                       "sha256": hashlib.sha256(raw).hexdigest(), "qiskit_version": qiskit}}
    return {
        "run_id": f"why-{uuid.uuid4().hex[:12]}",
        "circuit_name": "bell",
        "backend": backend,
        "qasm": text,
        "fingerprint": {"num_qubits": 5, "depth": circuit.depth(), "size": circuit.size(), "gate_counts": gate_counts,
                        **({"qasm_sha256": hashlib.sha256(text.encode()).hexdigest()} if text else {})},
        "context": {"library_versions": {"qiskit": qiskit}},
        "parameters": parameters or {},
        "execution": {"shots": sum(counts.values())},
        "calibration": cal or {},
        "transpiler": transpiler,
        "results": {"counts": counts},
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def as_run(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        **{k: payload[k] for k in ("run_id", "circuit_name", "backend", "qasm", "fingerprint", "context",
                                   "parameters", "execution", "calibration", "transpiler", "results")},
        created_at=datetime.fromisoformat(payload["created_at"]),
        shots=payload["execution"]["shots"],
    )


def sample(probs: dict, shots: int, seed: int) -> dict:
    keys = sorted(probs)
    drawn = np.random.default_rng(seed).multinomial(shots, [probs[k] for k in keys])
    return {k: int(n) for k, n in zip(keys, drawn) if n}


def factor(result: dict, name: str) -> dict:
    return next(f for f in result["attribution"]["factors"] if f["factor"] == name)


BELL = {"00": 0.5, "11": 0.5}
NOISY_BELL = {"00": 0.44, "11": 0.44, "01": 0.06, "10": 0.06}


# ── Statistics ───────────────────────────────────────────────────────────────

def test_known_distances():
    out = shot_noise_analysis({"00": 50, "11": 50}, {"00": 60, "11": 40})
    assert out["observed_tvd"] == pytest.approx(0.1)
    expected_h = math.sqrt(1 - (math.sqrt(0.5 * 0.6) + math.sqrt(0.5 * 0.4)))
    assert out["observed_hellinger"] == pytest.approx(expected_h, abs=1e-6)
    assert out["shots"] == {"a": 100, "b": 100}


def test_identical_counts_are_not_significant():
    out = shot_noise_analysis({"00": 500, "11": 500}, {"00": 500, "11": 500})
    assert out["observed_tvd"] == 0
    assert out["p_value"] == 1.0
    assert out["significant"] is False


def test_shot_noise_alone_is_not_significant():
    for seed in (1, 2, 3):
        out = shot_noise_analysis(sample(BELL, 4000, seed), sample(BELL, 4000, seed + 100))
        assert out["observed_tvd"] > 0  # the samples do differ ...
        assert out["significant"] is False  # ... but by no more than sampling explains
        lo, hi = out["observed_tvd_interval_95"]
        assert lo <= out["observed_tvd"] <= hi


def test_real_shift_is_significant():
    out = shot_noise_analysis(sample(BELL, 8000, 7), sample(NOISY_BELL, 8000, 8))
    assert out["significant"] is True
    assert out["p_value"] < 0.001
    assert out["observed_tvd"] > out["shot_noise_tvd_95th_percentile"]
    assert out["excess_tvd"] > 0


def test_resampling_is_seeded_and_matches_the_analytic_estimate():
    a, b = sample(NOISY_BELL, 2000, 1), sample(NOISY_BELL, 3000, 2)
    first, second = shot_noise_analysis(a, b), shot_noise_analysis(a, b)
    assert first == second
    assert first["expected_tvd_from_shot_noise"] == pytest.approx(first["expected_tvd_analytic"], rel=0.15)


def test_quasi_probabilities_are_not_counts():
    assert counts_of(SimpleNamespace(results={"counts": {"0": 0.4, "1": 0.6}})) is None
    assert counts_of(SimpleNamespace(results={})) is None
    assert counts_of(SimpleNamespace(results={"counts": {"0": 10, "1": 0}})) == {"0": 10}


# ── The executed circuit and the fidelity estimate ───────────────────────────

def test_usage_and_fidelity_come_from_the_executed_circuit():
    run = as_run(record(bell_on(0, 1), {"00": 1}, calibration()))
    usage = executed_usage(run)
    assert usage.source == "transpiler.qpy.after"
    assert usage.qubits == [0, 1]
    assert usage.edges == [(0, 1)]
    assert usage.two_qubit_gates == 1
    fid = estimate_fidelity(usage, run.calibration)
    # rz(0) x2 error 0, sx(0) 0.0003, cx(0,1) 0.01, two readouts 0.02
    assert fid["value"] == pytest.approx(round((1 - 0.0003) * (1 - 0.01) * (1 - 0.02) ** 2, 6))
    assert fid["covered_operations"] == fid["total_operations"] == 6


def test_fidelity_with_missing_errors_is_only_an_upper_bound():
    cal = calibration()
    del cal["gate_errors"]["cx_0_1"]
    usage = executed_usage(as_run(record(bell_on(0, 1), {"00": 1}, cal)))
    fid = estimate_fidelity(usage, cal)
    assert fid["value"] is None
    assert fid["missing"] == ["cx_0_1"]
    assert fid["upper_bound"] == pytest.approx(round((1 - 0.0003) * (1 - 0.02) ** 2, 6))


def test_qpy_that_isnt_the_executed_circuit_is_not_used():
    payload = record(bell_on(0, 1), {"00": 1}, calibration(), qasm=None)
    payload["fingerprint"]["gate_counts"] = {"h": 1, "cx": 1, "measure": 2}  # ran something else
    assert executed_usage(as_run(payload)) is None


# ── Compiler ─────────────────────────────────────────────────────────────────

def test_same_circuit_rules_out_the_compiler():
    a = as_run(record(bell_on(0, 1), sample(BELL, 4000, 1), calibration()))
    b = as_run(record(bell_on(0, 1), sample(BELL, 4000, 2), calibration()))
    out = explain_difference(a, b)
    assert out["compiler"]["circuit_changed"] is False
    assert factor(out, "compiler")["verdict"] == "ruled_out"
    assert factor(out, "calibration")["verdict"] == "ruled_out"
    assert factor(out, "noise")["verdict"] == "explains"
    assert "shot noise alone" in out["attribution"]["summary"]


def test_different_settings_that_compile_to_the_same_circuit_are_ruled_out():
    a = as_run(record(bell_on(0, 1), sample(BELL, 4000, 1), calibration(), opt_level=1))
    b = as_run(record(bell_on(0, 1), sample(BELL, 4000, 2), calibration(), opt_level=3))
    out = explain_difference(a, b)
    assert out["compiler"]["circuit_changed"] is False
    assert [c["field"] for c in out["compiler"]["changes"]] == ["optimization_level"]
    f = factor(out, "compiler")
    assert f["verdict"] == "ruled_out" and "Optimization level" in f["text"]


def test_compiler_change_is_detected_and_listed():
    a = as_run(record(bell_on(0, 1), sample(BELL, 8000, 1), calibration(), opt_level=3))
    b = as_run(record(bell_on(1, 2, extra_cx=2), sample(NOISY_BELL, 8000, 2), calibration(), opt_level=0,
                      qiskit="2.5.0"))
    out = explain_difference(a, b)
    comp = out["compiler"]
    assert comp["circuit_changed"] is True
    changed = {c["field"]: c for c in comp["changes"]}
    assert changed["two_qubit_gate_count"]["a"] == 1 and changed["two_qubit_gate_count"]["b"] == 5
    assert changed["physical_qubits"]["a"] == [0, 1] and changed["physical_qubits"]["b"] == [1, 2]
    assert changed["optimization_level"]["a"] == 3 and changed["optimization_level"]["b"] == 0
    assert changed["qiskit_version"]["b"] == "2.5.0"
    assert "depth" in changed
    assert factor(out, "noise")["verdict"] == "ruled_out"
    f = factor(out, "compiler")
    assert f["verdict"] in ("plausible", "too_small")
    # Same calibration both times, so the fidelity change is all compiler.
    fid = out["calibration"]["fidelity"]
    assert fid["calibration_effect"] == 0
    assert fid["compiler_effect"] == pytest.approx(fid["change"])
    assert fid["compiler_effect"] < 0


def test_no_circuit_record_means_cant_tell():
    pa = record(bell_on(0, 1), sample(BELL, 4000, 1), calibration(), with_qpy=False, qasm=None)
    pb = record(bell_on(0, 1), sample(NOISY_BELL, 4000, 2), calibration(), with_qpy=False, qasm=None)
    for p in (pa, pb):
        p["fingerprint"] = {}
    out = explain_difference(as_run(pa), as_run(pb))
    assert factor(out, "compiler")["verdict"] == "cant_tell"
    assert factor(out, "calibration")["verdict"] == "cant_tell"
    assert out["calibration"]["fidelity"] is None


# ── Calibration ──────────────────────────────────────────────────────────────

def test_calibration_drift_on_used_gates_is_attributed():
    a = as_run(record(bell_on(0, 1), sample(BELL, 8000, 1), calibration(cx01=0.01, ro=0.01)))
    b = as_run(record(bell_on(0, 1), sample(NOISY_BELL, 8000, 2),
                      calibration(cx01=0.09, ro=0.05, time="2026-11-03T08:00:00+00:00")))
    out = explain_difference(a, b)
    assert factor(out, "noise")["verdict"] == "ruled_out"
    assert factor(out, "compiler")["verdict"] == "ruled_out"
    cal = factor(out, "calibration")
    assert cal["verdict"] == "plausible", cal["text"]
    assert "cx_0_1" in cal["text"]
    gates = {g["gate"]: g for g in out["calibration"]["gates"]}
    assert set(gates) == {"cx_0_1", "rz_0", "sx_0"}  # only what the circuit used
    assert gates["cx_0_1"]["a"] == 0.01 and gates["cx_0_1"]["b"] == 0.09
    assert [q["qubit"] for q in out["calibration"]["qubits"]] == [0, 1]
    fid = out["calibration"]["fidelity"]
    assert fid["a"]["value"] == pytest.approx(round((1 - 0.0003) * 0.99 * 0.99 ** 2, 6))
    assert fid["b"]["value"] == pytest.approx(round((1 - 0.0003) * 0.91 * 0.95 ** 2, 6))
    assert fid["compiler_effect"] == 0
    assert abs(fid["calibration_effect"]) >= out["noise"]["excess_tvd"]
    assert "calibration drift" in out["attribution"]["summary"]


def test_drift_on_unused_qubits_does_not_count():
    cal_b = calibration()
    cal_b["gate_errors"]["cx_3_4"] = 0.2
    cal_b["t1_us"]["4"] = 10.0
    a = as_run(record(bell_on(0, 1), sample(BELL, 8000, 1), calibration()))
    b = as_run(record(bell_on(0, 1), sample(NOISY_BELL, 8000, 2), cal_b))
    out = explain_difference(a, b)
    assert out["calibration"]["changed"] is False
    assert factor(out, "calibration")["verdict"] == "ruled_out"
    assert factor(out, "compiler")["verdict"] == "ruled_out"
    assert "not captured" in out["attribution"]["summary"]


def test_missing_snapshot_is_cant_tell_not_zero():
    a = as_run(record(bell_on(0, 1), sample(BELL, 8000, 1), calibration()))
    b = as_run(record(bell_on(0, 1), sample(NOISY_BELL, 8000, 2), None))
    out = explain_difference(a, b)
    f = factor(out, "calibration")
    assert f["verdict"] == "cant_tell"
    assert "run B" in f["text"]
    assert out["calibration"]["fidelity"] is None
    assert "can't say why" in out["attribution"]["summary"]


def test_small_drift_is_too_small_to_explain_a_big_shift():
    a = as_run(record(bell_on(0, 1), sample(BELL, 8000, 1), calibration(cx01=0.010)))
    b = as_run(record(bell_on(0, 1), sample(NOISY_BELL, 8000, 2), calibration(cx01=0.011)))
    out = explain_difference(a, b)
    assert factor(out, "calibration")["verdict"] == "too_small"


# ── API ──────────────────────────────────────────────────────────────────────

def _user() -> dict:
    email = f"why-{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": "Explain-Diff-Pass-1!", "name": "W"})
    assert r.status_code in (200, 201), r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_explain_diff_endpoint_end_to_end():
    alice, bob = _user(), _user()
    pa = record(bell_on(0, 1), sample(BELL, 8000, 1), calibration(cx01=0.01, ro=0.01))
    pb = record(bell_on(0, 1), sample(NOISY_BELL, 8000, 2), calibration(cx01=0.09, ro=0.05))
    for p in (pa, pb):
        p["project"] = "explain-diff"
        r = client.post("/api/v1/runs", headers=alice, json=p)
        assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/runs/{pa['run_id']}/explain-diff/{pb['run_id']}", headers=alice)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["a"]["run_id"] == pa["run_id"] and body["b"]["run_id"] == pb["run_id"]
    assert set(body) >= {"observed", "noise", "compiler", "calibration", "attribution", "sources"}
    assert body["observed"]["tvd"] == body["noise"]["observed_tvd"] > 0
    assert body["noise"]["significant"] is True
    assert body["noise"]["recorded_shots"] == {"a": 8000, "b": 8000}
    assert factor(body, "calibration")["verdict"] == "plausible"
    assert factor(body, "compiler")["verdict"] == "ruled_out"
    assert "runs.calibration.gate_errors" in body["sources"]["calibration"]

    # Another user's runs are invisible, and unknown ids are a 404.
    assert client.get(f"/api/v1/runs/{pa['run_id']}/explain-diff/{pb['run_id']}", headers=bob).status_code == 404
    assert client.get(f"/api/v1/runs/{pa['run_id']}/explain-diff/nope", headers=alice).status_code == 404
