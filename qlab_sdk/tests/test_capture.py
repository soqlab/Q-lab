"""Capture details: calibration from Target, shots, setup fingerprint, QPY source.

Runs on Qiskit 1.x and 2.x; tests needing a package that is missing are skipped.
"""
import base64
import io

import pytest

qiskit = pytest.importorskip("qiskit")
from qiskit import QuantumCircuit  # noqa: E402

import qlab  # noqa: E402
from qlab import qiskit_hooks  # noqa: E402
from qlab.fingerprint import fingerprint_circuit, setup_fingerprint, setup_material  # noqa: E402


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
    monkeypatch.setattr(qiskit_hooks, "_shadow_simulate", lambda *a, **k: None)
    qiskit_hooks._pop_transpiler_context()
    return sent, updates


def _bell(measure: bool = True) -> QuantumCircuit:
    qc = QuantumCircuit(2, name="bell")
    qc.h(0)
    qc.cx(0, 1)
    if measure:
        qc.measure_all()
    return qc


def _generic_backend(n=3):
    try:
        from qiskit.providers.fake_provider import GenericBackendV2
    except ImportError:
        pytest.skip("GenericBackendV2 not available")
    return GenericBackendV2(n, seed=7)


# --- 1. Calibration ----------------------------------------------------------------------

def test_calibration_from_target_generic_backend():
    backend = _generic_backend(3)
    cal =qiskit_hooks._calibration_from_target(backend)
    target = backend.target

    assert set(cal["t1_us"]) == {"0", "1", "2"}
    assert cal["t1_us"]["0"] == pytest.approx(target.qubit_properties[0].t1 * 1e6)
    assert cal["t2_us"]["1"] == pytest.approx(target.qubit_properties[1].t2 * 1e6)
    assert cal["readout_errors"]["0"] == pytest.approx(target["measure"][(0,)].error)
    qargs = next(iter(target["cx"]))
    key = f"cx_{qargs[0]}_{qargs[1]}"
    assert cal["gate_errors"][key] == pytest.approx(target["cx"][qargs].error)
    assert cal["gate_durations_us"][key] == pytest.approx(target["cx"][qargs].duration * 1e6)
    assert "measure_0" not in cal["gate_errors"]
    assert cal["last_update"] and cal["source"] == "target"

    # Without properties(), _capture_calibration falls back to the target.
    if not callable(getattr(backend, "properties", None)):
        assert qiskit_hooks._capture_calibration(backend)["t1_us"] == cal["t1_us"]


def test_calibration_target_matches_properties_on_fake_backend():
    fake = pytest.importorskip("qiskit_ibm_runtime.fake_provider")
    backend = fake.FakeManilaV2()
    from_target = qiskit_hooks._calibration_from_target(backend)
    from_props = qiskit_hooks._calibration_from_properties(backend)
    assert from_props["source"] == "properties"
    for q in from_props["t1_us"]:
        assert from_target["t1_us"][q] == pytest.approx(from_props["t1_us"][q], rel=1e-6)
        assert from_target["readout_errors"][q] == pytest.approx(from_props["readout_errors"][q], rel=1e-6)
    assert 10 < from_target["t1_us"]["0"] < 10_000  # microseconds, not seconds
    assert from_target["gate_errors"]["cx_0_1"] == pytest.approx(from_props["gate_errors"]["cx_0_1"], rel=1e-6)
    assert from_target["gate_durations_us"]["cx_0_1"] == pytest.approx(
        from_props["gate_durations_us"]["cx_0_1"], rel=1e-6)


def test_calibration_falls_back_when_properties_is_empty():
    backend = _generic_backend(2)

    class NoProps:
        target = backend.target

        def properties(self):
            return None

    cal = qiskit_hooks._capture_calibration(NoProps())
    assert cal["source"] == "target" and "0" in cal["t1_us"]


def test_backend_run_records_target_calibration(captured):
    sent, _ = captured
    backend = _generic_backend(2)
    qc = qiskit.transpile(_bell(), backend, optimization_level=1, seed_transpiler=3)
    backend.run(qc, shots=64).result()
    assert len(sent) == 1
    assert "t1_us" in sent[0]["calibration"]


# --- 2. Shots ----------------------------------------------------------------------------

def test_backend_run_shots(captured):
    sent, _ = captured
    aer = pytest.importorskip("qiskit_aer")
    aer.AerSimulator().run(_bell(), shots=321).result()
    assert sent[0]["execution"]["shots"] == 321
    assert sent[0]["execution"]["shots_source"] == "run"


def test_backend_run_default_shots(captured):
    sent, _ = captured
    aer = pytest.importorskip("qiskit_aer")
    sim = aer.AerSimulator()
    sim.run(_bell()).result()
    assert sent[0]["execution"]["shots"] == sim.options.shots
    assert sent[0]["execution"]["shots_source"] == "default"


def _sampler_v2():
    try:
        from qiskit.primitives import StatevectorSampler
    except ImportError:
        pytest.skip("StatevectorSampler not available")
    return StatevectorSampler


def test_sampler_v2_shots(captured):
    sent, _ = captured
    Sampler = _sampler_v2()
    Sampler(default_shots=77).run([_bell(), (_bell(), None, 55)], shots=None).result()
    assert [r["execution"]["shots"] for r in sent] == [77, 55]
    assert [r["execution"]["shots_source"] for r in sent] == ["default", "pub"]

    sent.clear()
    Sampler().run([_bell()], shots=200).result()
    assert sent[0]["execution"]["shots"] == 200


def test_estimator_v2_precision(captured):
    sent, _ = captured
    try:
        from qiskit.primitives import StatevectorEstimator
        from qiskit.quantum_info import SparsePauliOp
    except ImportError:
        pytest.skip("StatevectorEstimator not available")
    obs = SparsePauliOp("ZZ")
    StatevectorEstimator().run([(_bell(False), obs), (_bell(False), obs, None, 0.05)], precision=0.01).result()
    assert [r["execution"]["precision"] for r in sent] == [0.01, 0.05]
    assert [r["execution"]["precision_source"] for r in sent] == ["run", "pub"]
    assert "shots" not in sent[0]["execution"]

    sent.clear()
    StatevectorEstimator(default_precision=0.02).run([(_bell(False), obs)]).result()
    assert sent[0]["execution"]["precision"] == 0.02


def test_runtime_sampler_v2_default_shots(captured):
    runtime = pytest.importorskip("qiskit_ibm_runtime")
    pytest.importorskip("qiskit_aer")
    fake = pytest.importorskip("qiskit_ibm_runtime.fake_provider")
    sent, _ = captured
    backend = fake.FakeManilaV2()
    qc = qiskit.transpile(_bell(), backend, optimization_level=0, seed_transpiler=1)
    sampler = runtime.SamplerV2(mode=backend)
    sampler.options.default_shots = 123
    sampler.run([qc]).result()
    assert len(sent) == 1
    assert sent[0]["execution"]["shots"] == 123


# --- 3. Setup fingerprint ----------------------------------------------------------------

def test_setup_fingerprint_separates_backends_and_keeps_circuit_fingerprint(captured):
    sent, _ = captured
    qc = _bell()
    qlab.track(qc, backend_name="ibm_a", execution={"shots": 100})
    qlab.track(qc, backend_name="ibm_b", execution={"shots": 100})
    qlab.track(qc, backend_name="ibm_a", execution={"shots": 100})
    qlab.track(qc, backend_name="ibm_a", execution={"shots": 200})
    a, b, a2, a_more = sent
    assert a["fingerprint"] == b["fingerprint"] == fingerprint_circuit(qc, qasm=a["qasm"])
    fps = [r["context"]["setup_fingerprint"] for r in sent]
    assert fps[0] == fps[2]
    assert len({fps[0], fps[1], fps[3]}) == 3
    assert len(fps[0]) == 64
    assert a["context"]["setup"]["backend"] == "ibm_a"
    assert a["context"]["setup"]["shots"] == 100
    assert "qiskit" in a["context"]["setup"]["packages"]


def test_setup_fingerprint_is_canonical():
    fp = {"num_qubits": 2, "gate_counts": {"h": 1, "cx": 1}}
    m1 = setup_material(fp, "dev", {"seed_transpiler": 1, "optimization_level": 2, "basis_gates": ["rz", "cx"]},
                        shots=10, package_versions={"qiskit": "2.0", "numpy": "x"})
    m2 = setup_material({"gate_counts": {"cx": 1, "h": 1}, "num_qubits": 2}, "dev",
                        {"basis_gates": ["cx", "rz"], "optimization_level": 2, "seed_transpiler": 1,
                         "callback": "ignored"},
                        shots=10, package_versions={"qiskit": "2.0"})
    assert setup_fingerprint(m1) == setup_fingerprint(m2)
    m3 = setup_material(fp, "dev", {"seed_transpiler": 2, "optimization_level": 2}, shots=10)
    assert setup_fingerprint(m3) != setup_fingerprint(m1)


def test_setup_fingerprint_includes_transpiler_options(captured):
    sent, _ = captured
    aer = pytest.importorskip("qiskit_aer")
    sim = aer.AerSimulator()
    for seed in (1, 1, 2):
        tqc = qiskit.transpile(_bell(), sim, optimization_level=1, seed_transpiler=seed)
        sim.run(tqc, shots=50).result()
    fps = [r["context"]["setup_fingerprint"] for r in sent]
    assert fps[0] == fps[1] != fps[2]
    assert sent[0]["context"]["setup"]["transpiler"] == {"optimization_level": 1, "seed_transpiler": 1}


# --- 4. QPY ------------------------------------------------------------------------------

def test_transpile_captures_qpy_and_qasm(captured):
    sent, _ = captured
    aer = pytest.importorskip("qiskit_aer")
    from qiskit import qpy
    sim = aer.AerSimulator()
    qc = _bell()
    tqc = qiskit.transpile(qc, sim, optimization_level=2, seed_transpiler=4)
    sim.run(tqc, shots=20).result()
    tr = sent[0]["transpiler"]
    for stage, expected in (("before", qc), ("after", tqc)):
        info = tr["qpy"][stage]
        assert info["encoding"] == "base64" and isinstance(info["qpy_version"], int)
        loaded = qpy.load(io.BytesIO(base64.b64decode(info["data"])))[0]
        assert loaded == expected
        assert tr["qasm"][stage]["format"] in ("openqasm3", "openqasm2")
        assert tr["qasm"][stage]["text"]


def test_qpy_size_cap(monkeypatch):
    monkeypatch.setenv("QLAB_SOURCE_MAX_BYTES", "10")
    info = qiskit_hooks._circuit_to_qpy(_bell())
    assert info["truncated"] is True and "data" not in info and info["bytes"] > 10
    assert qiskit_hooks._circuit_source(_bell())["truncated"] is True


def test_zk_mode_uploads_no_qpy(captured, monkeypatch):
    sent, _ = captured
    aer = pytest.importorskip("qiskit_aer")
    monkeypatch.setitem(qiskit_hooks._CONFIG, "zk_qco", True)
    sim = aer.AerSimulator()
    sim.run(qiskit.transpile(_bell(), sim), shots=10).result()
    tr = sent[0]["transpiler"]
    assert "qpy" not in tr and "qasm" not in tr
    assert sent[0]["qasm"] is None
