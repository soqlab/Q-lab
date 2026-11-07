"""Every part of the backend that uses Qiskit, run for real on the pinned Qiskit version.

Much of this code catches exceptions and falls back to something cheaper (rule-based compilation,
an ideal simulation, a regex parser), so an API removed by a Qiskit upgrade would not crash anything:
results would just quietly get worse. These tests assert that the real path ran.
"""
import typing

import pytest

pytest.importorskip("qiskit")
pytest.importorskip("qiskit_aer")

BELL = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;"""


def _only_correlated(counts: dict, at_least: float = 0.8) -> bool:
    total = sum(counts.values())
    return (counts.get("00", 0) + counts.get("11", 0)) / total >= at_least


# ── IBM Quantum ────────────────────────────────────────────────────────────────

def test_new_ibm_service_name_is_the_real_class():
    import qiskit_ibm_runtime as q

    assert q.IBMQuantumComputeService is q.QiskitRuntimeService


def test_ibm_channel_is_one_ibm_still_accepts():
    import inspect

    from qiskit_ibm_runtime.accounts.account import ChannelType

    from app import ibm_quantum

    accepted = [a for arg in typing.get_args(ChannelType) for a in typing.get_args(arg)]
    assert 'channel="ibm_quantum_platform"' in inspect.getsource(ibm_quantum._connect)
    assert "ibm_quantum_platform" in accepted


# ── Compiling and rendering ───────────────────────────────────────────────────

@pytest.mark.parametrize("provider,allowed", [
    ("ibm", {"cx", "id", "rz", "sx", "x"}),
    ("ionq", {"rx", "ry", "rz", "cx"}),
])
def test_compiler_really_uses_the_transpiler(provider, allowed):
    from qiskit import QuantumCircuit

    from app.routers.circuit_compiler import _compile_with_qiskit

    compiled, warnings = _compile_with_qiskit(BELL, provider, 1)
    assert warnings == []
    assert {i.operation.name for i in QuantumCircuit.from_qasm_str(compiled).data} - {"measure", "barrier"} <= allowed


def test_circuit_renders_from_qasm2_and_qasm3():
    from app.circuit_renderer import render_qasm_svg, render_qasm_text

    assert b"<svg" in render_qasm_svg("test-qiskit2", BELL)
    qasm3 = 'OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[2] q;\nbit[2] c;\nh q[0];\ncx q[0], q[1];\nc = measure q;'
    assert "q" in render_qasm_text(qasm3)


def test_zx_simplify_returns_qasm():
    from app.routers.zx_simplify import _simplify_qiskit

    assert "OPENQASM 2.0" in _simplify_qiskit(BELL)["simplified_qasm"]


def test_circuit_search_reads_the_dag():
    from app.routers.circuit_search import _dag_from_qiskit

    parsed = _dag_from_qiskit(BELL)
    assert parsed is not None, "fell back to the regex parser"
    node_feats, pred_adj, stats = parsed
    assert len(node_feats) == len(pred_adj) > 0
    assert stats["depth"] > 0


# ── Simulation ────────────────────────────────────────────────────────────────

def test_noise_sim_applies_calibration():
    from app.routers.noise_sim import _aer_simulate

    cal = {"qubits": {i: {"t1": 100.0, "t2": 80.0, "gate_error_1q": 0.01, "readout_error": 0.05} for i in (0, 1)},
           "gate_errors_2q": {}}
    counts = _aer_simulate(BELL, cal, shots=2000)
    assert counts is not None
    assert set(counts) - {"00", "11"}


def test_transpiled_circuits_with_sx_are_parsed():
    """Qiskit's strict QASM 2 parser refuses sx, which every circuit transpiled for IBM contains."""
    from app.routers.circuit_search import _dag_from_qiskit
    from app.routers.noise_sim import _aer_simulate
    from app.routers.zx_simplify import _simplify_qiskit

    qasm = BELL.replace("h q[0];", "sx q[0];")
    assert _aer_simulate(qasm, {"qubits": {}, "gate_errors_2q": {}}, shots=50) is not None
    assert _dag_from_qiskit(qasm) is not None
    assert _simplify_qiskit(qasm)["simplified_qasm"]


def test_auto_mitigation_folds_and_simulates():
    from app.routers import auto_mitigation as m

    qc = m._build_ghz(3, 0)
    assert m._fold(qc, 2).size() == 3 * qc.size()  # G G-dagger G
    assert m._ghz_fidelity(m._run(qc, shots=200), 3) > 0.95


def test_quantum_finance_circuits_run():
    from app.routers import quantum_finance as f

    assert 0.0 <= f._qae_estimate(0.3, 3, shots=200) <= 1.0
    assert f._qaoa_portfolio([0.1, 0.2, 0.15], 2, shots=200)
