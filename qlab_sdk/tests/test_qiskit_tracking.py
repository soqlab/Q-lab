"""End-to-end auto-tracking: real Qiskit executions must each produce exactly one Q-Lab run.

Runs against whatever Qiskit is installed (CI runs it on 1.x and 2.x). Nothing goes over the
network: the client's send methods are replaced with recorders.
"""
import pytest

qiskit = pytest.importorskip("qiskit")
from qiskit import QuantumCircuit  # noqa: E402

import qlab  # noqa: E402
from qlab import qiskit_hooks  # noqa: E402


@pytest.fixture
def captured(monkeypatch):
    qlab.init(api_url="http://127.0.0.1:9", api_key=None)
    client = qiskit_hooks._CLIENT
    sent: list[dict] = []
    updates: list[tuple[str, dict]] = []
    monkeypatch.setattr(client, "send_run_async", lambda payload: sent.append(payload))
    monkeypatch.setattr(client, "update_run_async", lambda run_id, payload: updates.append((run_id, payload)))
    monkeypatch.setattr(client, "log_metrics_async", lambda *a, **k: None)
    monkeypatch.setattr(client, "check_policy", lambda payload: {"violations": []})
    return sent, updates


def _bell(measure: bool = True) -> QuantumCircuit:
    qc = QuantumCircuit(2, name="bell")
    qc.h(0)
    qc.cx(0, 1)
    if measure:
        qc.measure_all()
    return qc


def _completed(updates, run_id):
    return [p for rid, p in updates if rid == run_id and p.get("status") == "completed"]


def _assert_one_tracked_run(sent, updates, backend_hint: str | None = None):
    assert len(sent) == 1, f"expected exactly one tracked run, got {len(sent)}"
    run = sent[0]
    assert run["fingerprint"]["num_qubits"] == 2
    assert run.get("qasm")
    if backend_hint:
        assert backend_hint in (run.get("backend") or "")
    assert _completed(updates, run["run_id"]), "the run never received its results"
    return run


def test_aer_backend_run(captured):
    aer = pytest.importorskip("qiskit_aer")
    sent, updates = captured
    result = aer.AerSimulator().run(_bell(), shots=200).result()
    assert sum(result.get_counts().values()) == 200
    run = _assert_one_tracked_run(sent, updates, backend_hint="aer")
    counts = _completed(updates, run["run_id"])[0]["results"].get("counts")
    assert counts and sum(counts.values()) == 200


def test_reference_sampler(captured):
    from qiskit.primitives import StatevectorSampler
    sent, updates = captured
    StatevectorSampler().run([_bell()], shots=128).result()
    _assert_one_tracked_run(sent, updates)


def test_reference_estimator(captured):
    from qiskit.primitives import StatevectorEstimator
    from qiskit.quantum_info import SparsePauliOp
    sent, updates = captured
    StatevectorEstimator().run([(_bell(measure=False), SparsePauliOp("ZZ"))]).result()
    _assert_one_tracked_run(sent, updates)


def test_backend_sampler_is_not_counted_twice(captured):
    """BackendSamplerV2 calls backend.run inside: that must not create a second run."""
    aer = pytest.importorskip("qiskit_aer")
    from qiskit.primitives import BackendSamplerV2
    sent, updates = captured
    BackendSamplerV2(backend=aer.AerSimulator()).run([_bell()], shots=100).result()
    _assert_one_tracked_run(sent, updates, backend_hint="aer")


def test_ibm_runtime_sampler_local_mode(captured):
    aer = pytest.importorskip("qiskit_aer")
    runtime = pytest.importorskip("qiskit_ibm_runtime")
    sent, updates = captured
    runtime.SamplerV2(mode=aer.AerSimulator()).run([_bell()], shots=100).result()
    _assert_one_tracked_run(sent, updates, backend_hint="aer")
