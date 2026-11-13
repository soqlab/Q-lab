"""What the SDK records so a run can be re-run exactly, and the reproduction tag.

Seeds set on the primitive or backend object, which primitive ran the circuit, the settings of
generate_preset_pass_manager(...).run(), and init(reproduces=...)/qlab.reproducing() tagging the
upload as a reproduction of an earlier run. Nothing goes over the network.
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
    monkeypatch.setattr(client, "send_run_async", lambda payload: sent.append(payload))
    monkeypatch.setattr(client, "update_run_async", lambda run_id, payload: None)
    monkeypatch.setattr(client, "log_metrics_async", lambda *a, **k: None)
    monkeypatch.setattr(client, "check_policy", lambda payload: {"violations": []})
    monkeypatch.setitem(qiskit_hooks._CONFIG, "reproduces", None)
    return sent


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2, name="bell")
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc


def test_sampler_seed_and_primitive_are_recorded(captured):
    from qiskit.primitives import StatevectorSampler
    StatevectorSampler(seed=1234).run([_bell()], shots=64).result()
    run = captured[-1]
    assert run["parameters"]["seed"] == 1234
    assert run["execution"]["primitive"]["kind"] == "sampler"
    assert run["execution"]["primitive"]["class"].endswith("StatevectorSampler")


def test_estimator_is_named_as_such(captured):
    from qiskit.primitives import StatevectorEstimator
    from qiskit.quantum_info import SparsePauliOp
    qc = QuantumCircuit(2)
    qc.h(0)
    qc.cx(0, 1)
    StatevectorEstimator().run([(qc, SparsePauliOp("ZZ"))]).result()
    assert captured[-1]["execution"]["primitive"]["kind"] == "estimator"


def test_backend_seed_simulator_option_is_recorded(captured):
    aer = pytest.importorskip("qiskit_aer")
    aer.AerSimulator(seed_simulator=77).run(_bell(), shots=50).result()
    run = captured[-1]
    assert run["parameters"]["seed_simulator"] == 77
    assert run["execution"]["primitive"]["kind"] == "backend"


def test_seed_passed_to_run_wins_over_the_backend_option(captured):
    aer = pytest.importorskip("qiskit_aer")
    aer.AerSimulator(seed_simulator=77).run(_bell(), shots=50, seed_simulator=5).result()
    assert captured[-1]["parameters"]["seed_simulator"] == 5


def test_no_seed_means_none_recorded(captured):
    from qiskit.primitives import StatevectorSampler
    StatevectorSampler().run([_bell()], shots=16).result()
    assert "seed" not in captured[-1]["parameters"]


def test_int_seed_ignores_bools_and_non_integers():
    assert qiskit_hooks._int_seed(True) is None
    assert qiskit_hooks._int_seed(1.5) is None
    assert qiskit_hooks._int_seed("7") is None
    assert qiskit_hooks._int_seed(7) == 7


def test_preset_pass_manager_settings_are_recorded(captured):
    from qiskit.primitives import StatevectorSampler
    from qiskit.transpiler import generate_preset_pass_manager
    from qiskit.transpiler import CouplingMap
    pm = generate_preset_pass_manager(optimization_level=2, coupling_map=CouplingMap.from_line(3),
                                      basis_gates=["cx", "rz", "sx", "x"], seed_transpiler=11)
    isa = pm.run(_bell())
    StatevectorSampler(seed=3).run([isa], shots=16).result()
    settings = captured[-1]["transpiler"]["settings"]
    assert settings["optimization_level"] == 2
    assert settings["seed_transpiler"] == 11
    assert settings["via"] == "generate_preset_pass_manager"
    assert captured[-1]["transpiler"]["qasm"]["before"]["text"]


def test_preset_pass_manager_positional_level(captured):
    from qiskit.primitives import StatevectorSampler
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
    isa = generate_preset_pass_manager(1, basis_gates=["cx", "rz", "sx", "x"]).run(_bell())
    StatevectorSampler().run([isa], shots=8).result()
    assert captured[-1]["transpiler"]["settings"]["optimization_level"] == 1


def test_transpile_inside_is_recorded_once_by_transpile(captured):
    from qiskit import transpile
    from qiskit.primitives import StatevectorSampler
    isa = transpile(_bell(), basis_gates=["cx", "rz", "sx", "x"], optimization_level=0, seed_transpiler=9)
    StatevectorSampler().run([isa], shots=8).result()
    settings = captured[-1]["transpiler"]["settings"]
    assert settings == {"optimization_level": 0, "seed_transpiler": 9, "basis_gates": ["cx", "rz", "sx", "x"]}


def test_reproducing_tags_the_upload(captured):
    from qiskit.primitives import StatevectorSampler
    with qlab.reproducing("orig-run-123"):
        StatevectorSampler(seed=1).run([_bell()], shots=8).result()
    tagged = captured[-1]
    assert tagged["context"]["reproduction_of"] == "orig-run-123"
    assert "reproduction" in tagged["tags"]
    StatevectorSampler(seed=1).run([_bell()], shots=8).result()
    assert "reproduction_of" not in captured[-1]["context"]
    assert "reproduction" not in captured[-1]["tags"]


def test_init_reproduces_applies_even_when_already_initialised(captured, monkeypatch):
    from qiskit.primitives import StatevectorSampler
    qlab.init(reproduces="orig-run-456")
    StatevectorSampler().run([_bell()], shots=8).result()
    assert captured[-1]["context"]["reproduction_of"] == "orig-run-456"


def test_reproduces_from_environment(captured, monkeypatch):
    monkeypatch.setenv("QLAB_REPRODUCES", "orig-env-789")
    qlab.init()
    assert qiskit_hooks._CONFIG["reproduces"] == "orig-env-789"
