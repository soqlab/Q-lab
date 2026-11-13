"""Pick the machine before you run (app/machine_pick.py, app/routers/machine_pick.py)."""
import math
import uuid

import pytest
from qiskit import QuantumCircuit, qasm2

from app import machine_pick as mp
from tests.helpers import BELL, GHZ3, client, make_user, push_run


def snapshot(name: str, *, n=5, sx=0.0003, cz=0.008, ro=0.015, t1=150.0, t2=90.0, bad_readout=None,
             last_update="2026-11-10T08:00:00Z") -> dict:
    """A line of n qubits (0-1-2-...) with basis rz, sx, x, cz: the shape snapshot_from_backend returns."""
    readout = [[ro, 1200.0] for _ in range(n)]
    for q, err in (bad_readout or {}).items():
        readout[q] = [err, 1200.0]
    edges = [(q, q + 1) for q in range(n - 1)]
    return {
        "backend": name, "num_qubits": n, "last_update": last_update, "fetched_at": "2026-11-13T09:00:00Z",
        "simulated": False, "operational": True, "pending_jobs": 3,
        "t1_us": [t1] * n, "t2_us": [t2] * n, "readout": readout,
        "gates": {
            "rz": {str(q): [0.0, 0.0] for q in range(n)},
            "sx": {str(q): [sx, 36.0] for q in range(n)},
            "x": {str(q): [sx, 36.0] for q in range(n)},
            "cz": {**{f"{a}_{b}": [cz, 68.0] for a, b in edges}, **{f"{b}_{a}": [cz, 68.0] for a, b in edges}},
        },
    }


def source(*snaps) -> dict:
    return {"available": True, "simulated": False, "snapshots": list(snaps), "problems": [], "message": None}


@pytest.fixture(autouse=True)
def _clean():
    mp.reset_cache()
    yield
    mp.reset_cache()


# ── The arithmetic ───────────────────────────────────────────────────────────

def test_esp_is_the_product_of_gate_readout_and_idle_factors():
    snap = snapshot("fixture", sx=0.001, cz=0.01, ro=0.02, t1=100.0, t2=50.0)
    snap["readout"][1] = [0.03, 1000.0]
    snap["readout"][0] = [0.02, 1000.0]
    isa = QuantumCircuit(5, 2)
    isa.cz(0, 1)              # 0-68 ns on both
    for _ in range(3):
        isa.sx(0)             # q0 busy until 176 ns
    isa.barrier(0, 1)         # q1 waits 108 ns
    isa.measure(0, 0)
    isa.measure(1, 1)
    s = mp.score_isa(isa, snap)
    idle = 108.0 / (50.0 * 1000)  # T2eff = min(T2, 2 T1) = 50 us
    expected = (1 - 0.01) * (1 - 0.001) ** 3 * (1 - 0.02) * (1 - 0.03) * math.exp(-idle)
    assert s["esp"] == pytest.approx(expected, abs=1e-6)
    assert s["factors"]["readout"] == pytest.approx((1 - 0.02) * (1 - 0.03), abs=1e-6)
    assert s["factors"]["idle"] == pytest.approx(math.exp(-idle), abs=1e-6)
    assert s["transpiled"]["duration_us"] == pytest.approx(1.176)
    assert s["transpiled"]["two_qubit_gates"] == 1
    # Readout on qubit 1 (3%) is the biggest single loss, and readout is the biggest source.
    assert s["weak_point"]["kind"] == "readout" and s["weak_point"]["qubits"] == [1]
    assert s["weak_point"]["text"] == "qubit 1's readout error"
    assert s["dominant"]["source"] == "readout"


def test_machines_are_ranked_and_the_weak_point_is_named():
    circuit = mp.parse_circuit(GHZ3)
    good = snapshot("ibm_good")
    worse = snapshot("ibm_worse", ro=0.08)
    out = mp.estimate(circuit, source(worse, good))
    assert [r["backend"] for r in out["ranked"]] == ["ibm_good", "ibm_worse"]
    a, b = out["ranked"]
    assert 0 < b["esp"] < a["esp"] < 1
    assert a["method"] == "transpiled" and a["transpiled"]["two_qubit_gates"] >= 2
    assert b["weak_point"]["kind"] == "readout"
    assert out["sentence"].startswith(f"On ibm_good expect ≈{a['esp']:.2f}; on ibm_worse ≈{b['esp']:.2f}: qubit ")
    assert out["sentence"].endswith("readout error on ibm_worse is the weak point.")
    assert "calibration at 2026-11-10 08:00 UTC" in out["basis"] and "not a measurement" in out["basis"]
    plain = mp.estimate(circuit, source(worse, good), "plain")
    assert plain["ranked"] == out["ranked"]
    assert plain["sentence"].startswith("Run it on ibm_good: about")


def test_a_circuit_that_does_not_fit_is_listed_with_the_reason():
    big = QuantumCircuit(7)
    big.h(0)
    for q in range(6):
        big.cx(q, q + 1)
    big.measure_all()
    out = mp.estimate(big, source(snapshot("ibm_small", n=5), snapshot("ibm_big", n=8)))
    assert [r["backend"] for r in out["ranked"]] == ["ibm_big"]
    assert out["unavailable"][0]["backend"] == "ibm_small"
    assert "needs 7 qubits" in out["unavailable"][0]["reason"]


def test_empty_calibration_gives_no_numbers():
    out = mp.estimate(mp.parse_circuit(BELL), {"available": False, "snapshots": [], "message": "no_key"})
    assert out["available"] is False and out["ranked"] == []
    assert "no IBM Quantum key" in out["sentence"]
    assert "QISKIT_IBM_TOKEN" in out["todo"]
    assert not any(ch.isdigit() for ch in out["sentence"])


def test_qasm3_is_read_and_idle_wires_are_dropped():
    text = ('OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[20] q;\nbit[2] c;\n'
            'h q[3];\ncx q[3], q[7];\nc[0] = measure q[3];\nc[1] = measure q[7];\n')
    c = mp.parse_circuit(text)
    assert c.num_qubits == 2 and c.count_ops()["cx"] == 1 and c.count_ops()["measure"] == 2


def test_limits_and_bad_input_are_refused_with_a_reason():
    wide = QuantumCircuit(mp.MAX_QUBITS + 1)
    for q in range(mp.MAX_QUBITS):
        wide.cx(q, q + 1)
    with pytest.raises(mp.CircuitError, match="qubits"):
        mp.check_size(mp.parse_circuit(qasm2.dumps(wide)))
    with pytest.raises(mp.CircuitError, match="couldn't be read"):
        mp.parse_circuit("OPENQASM 2.0;\nqreg q[2];\nfrobnicate q[0];")
    with pytest.raises(mp.CircuitError, match="classical or timing"):
        mp.parse_circuit("OPENQASM 3.0;\ninput float[64] theta;\nqubit q;\nrx(theta) q;")


# ── The API ──────────────────────────────────────────────────────────────────

def test_api_needs_a_signed_in_caller():
    r = client.post("/api/v1/machine-pick", json={"qasm": BELL})
    assert r.status_code == 401


def test_api_without_a_key_says_so_and_returns_no_estimates():
    me = make_user(prefix="pick")
    r = client.post("/api/v1/machine-pick", headers=me, json={"qasm": BELL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is False and body["ranked"] == []
    assert "no IBM Quantum key" in body["sentence"]
    status = client.get("/api/v1/machine-pick/calibration").json()
    assert status["available"] is False and status["reason"] == "no_key"


def test_api_ranks_with_calibration(monkeypatch):
    monkeypatch.setattr(mp, "load_snapshots", lambda wait_s=25.0: source(snapshot("ibm_a", cz=0.004), snapshot("ibm_b", cz=0.03)))
    me = make_user(prefix="pick")
    r = client.post("/api/v1/machine-pick", headers=me, json={"qasm": GHZ3, "level": "expert"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["backend"] for x in body["ranked"]] == ["ibm_a", "ibm_b"]
    assert body["circuit"]["num_qubits"] == 3 and body["circuit"]["two_qubit_gates"] == 2
    assert "%" in body["sentence"]  # expert names the weak point's numbers
    bad = client.post("/api/v1/machine-pick", headers=me, json={"qasm": "not a circuit"})
    assert bad.status_code == 422
    assert client.post("/api/v1/machine-pick", headers=me, json={"qasm": BELL, "level": "loud"}).status_code == 422


def test_api_uses_a_run_only_when_the_caller_can_see_it(monkeypatch):
    monkeypatch.setattr(mp, "load_snapshots", lambda wait_s=25.0: source(snapshot("ibm_a")))
    alice, bob = make_user(prefix="pick"), make_user(prefix="pick")
    rid = push_run(alice, run_id=f"pick-{uuid.uuid4().hex[:10]}", qasm=GHZ3)
    mine = client.post("/api/v1/machine-pick", headers=alice, json={"run_id": rid})
    assert mine.status_code == 200, mine.text
    assert mine.json()["from_run"]["run_id"] == rid
    assert mine.json()["ranked"][0]["backend"] == "ibm_a"
    assert client.post("/api/v1/machine-pick", headers=bob, json={"run_id": rid}).status_code == 404


def test_api_is_rate_limited(monkeypatch):
    monkeypatch.setattr(mp, "load_snapshots", lambda wait_s=25.0: source(snapshot("ibm_a")))
    me = make_user(prefix="pick")
    codes = [client.post("/api/v1/machine-pick", headers=me, json={"qasm": BELL}).status_code for _ in range(14)]
    assert codes[0] == 200 and 429 in codes
