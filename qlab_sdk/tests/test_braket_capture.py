"""Amazon Braket auto-capture (qlab.providers.braket).

No AWS account is used. LocalSimulator runs are real Braket simulations. The AwsDevice tests
replace AwsSession (Braket's wrapper around the AWS API calls get_device, create_quantum_task,
get_quantum_task and the S3 result download) with an object answering those four calls with
fixed responses in the documented schemas, so everything above that boundary (AwsDevice.run,
AwsQuantumTask, result parsing) is Braket's real code. Nothing has been run on AWS hardware.
"""

import json

import pytest

pytest.importorskip("braket.devices")
from braket.circuits import Circuit  # noqa: E402
from braket.devices import LocalSimulator  # noqa: E402

import qlab  # noqa: E402
from qlab import providers, qiskit_hooks  # noqa: E402
from qlab.providers import braket as qbraket  # noqa: E402


@pytest.fixture
def captured(monkeypatch):
    qlab.init(api_url="http://127.0.0.1:9", api_key=None)
    providers.patch_installed()
    client = qiskit_hooks._CLIENT
    sent: list[dict] = []
    updates: list[tuple[str, dict]] = []
    monkeypatch.setattr(client, "send_run_async", lambda payload: sent.append(payload))
    monkeypatch.setattr(client, "update_run_async", lambda run_id, payload: updates.append((run_id, payload)))
    monkeypatch.setattr(client, "check_policy", lambda payload: {"violations": []})
    return sent, updates


def _bell() -> Circuit:
    return Circuit().h(0).cnot(0, 1)


# ── LocalSimulator ────────────────────────────────────────────────────────────────────────

def test_local_run_is_one_completed_run(captured):
    sent, _ = captured
    task = LocalSimulator().run(_bell(), shots=200)
    counts = task.result().measurement_counts

    assert len(sent) == 1
    run = sent[0]
    assert run["status"] == "completed"
    assert run["backend"] == "braket:StateVectorSimulator"
    assert run["qasm"].startswith("OPENQASM 3.0;") and "cnot q[0], q[1];" in run["qasm"]
    assert run["transpiler"]["source"]["format"] == "openqasm3"
    assert run["fingerprint"]["num_qubits"] == 2
    assert run["fingerprint"]["gate_counts"] == {"h": 1, "cnot": 1}
    assert run["execution"]["shots"] == 200 and run["execution"]["shots_source"] == "run"
    assert run["execution"]["task_id"] == task.id
    assert run["results"]["counts"] == dict(counts)
    assert sum(run["results"]["counts"].values()) == 200
    assert run["results"]["measured_qubits"] == [0, 1]
    assert "measured_qubits[0]" in run["results"]["bit_order"]

    ctx = run["context"]
    assert ctx["provider"] == "braket"
    assert ctx["device"]["type"] == "LOCAL_SIMULATOR"
    assert ctx["device"]["simulator"] == "braket_sv"
    assert ctx["library_versions"]["amazon-braket-sdk"]
    assert "amazon-braket-sdk" in ctx["setup"]["packages"]
    assert ctx["setup"]["shots"] == 200 and len(ctx["setup_fingerprint"]) == 64


def test_default_shots_and_exact_results(captured):
    sent, _ = captured
    LocalSimulator().run(Circuit().h(0).probability(target=[0])).result()
    run = sent[0]
    assert run["execution"]["shots"] == 0 and run["execution"]["shots_source"] == "default"
    assert run["results"]["result_types"][0]["value"] == pytest.approx([0.5, 0.5])
    assert "counts" not in run["results"]


def test_noise_model_is_recorded_and_the_user_circuit_kept(captured):
    sent, _ = captured
    from braket.circuits import Gate
    from braket.circuits.noise_model import GateCriteria, NoiseModel
    from braket.circuits.noises import Depolarizing

    noise = NoiseModel().add_noise(Depolarizing(0.05), GateCriteria(Gate.H))
    LocalSimulator("braket_dm", noise_model=noise).run(_bell(), shots=50).result()
    run = sent[0]
    assert run["backend"] == "braket:DensityMatrixSimulator"
    assert "Depolarizing(0.05)" in run["context"]["device"]["noise_model"]
    assert run["context"]["device"]["noise_model_spec"]["instructions"]
    assert "depolarizing" not in run["qasm"].lower()  # the circuit as written, not as noised


def test_openqasm_program(captured):
    sent, _ = captured
    from braket.ir.openqasm import Program

    source = "OPENQASM 3.0;\nbit[1] b;\nqubit[1] q;\nx q[0];\nb[0] = measure q[0];"
    LocalSimulator().run(Program(source=source), shots=10).result()
    run = sent[0]
    assert run["qasm"] == source
    assert run["fingerprint"]["num_qubits"] == 1
    assert run["results"]["counts"] == {"1": 10}


def test_run_batch_gives_one_run_per_circuit(captured):
    sent, _ = captured
    batch = LocalSimulator().run_batch([Circuit().x(0), Circuit().h(0).cnot(0, 1)], shots=20, max_parallel=1)
    assert len(batch.results()) == 2
    assert len(sent) == 2
    assert sent[0]["results"]["counts"] == {"1": 20}
    assert sent[1]["fingerprint"]["num_qubits"] == 2
    assert {s["execution"]["batch_index"] for s in sent} == {0, 1}


def test_failed_run_is_recorded_and_the_error_raised(captured):
    sent, _ = captured
    from braket.circuits import FreeParameter

    with pytest.raises(Exception):  # noqa: B017 (the error type differs across Braket versions)
        LocalSimulator().run(Circuit().rx(0, FreeParameter("theta")), shots=10)  # unbound parameter
    assert len(sent) == 1 and sent[0]["status"] == "failed"
    assert sent[0]["execution"]["error_type"]


def test_not_initialised_means_untouched(monkeypatch):
    monkeypatch.setattr(qiskit_hooks, "_CLIENT", None)
    assert LocalSimulator().run(_bell(), shots=5).result().measurement_counts


def test_qiskit_run_in_progress_is_not_recorded_twice(captured):
    sent, _ = captured
    qiskit_hooks._LOCAL.depth = 1  # as during a qiskit-braket-provider backend.run
    try:
        LocalSimulator().run(_bell(), shots=5).result()
    finally:
        qiskit_hooks._LOCAL.depth = 0
    assert sent == []


# ── AwsDevice (fake AwsSession at the AWS API boundary) ───────────────────────────────────

ARN = "arn:aws:braket:us-east-1::device/qpu/ionq/Forte-1"
TASK_ARN = "arn:aws:braket:us-east-1:123456789012:quantum-task/0d1e2f3a-qlab-test"

# Device capabilities in the IonQ schema (braket.device_schema.ionq), provider figures as
# Braket publishes them: mean fidelities, timings in seconds.
IONQ_CAPABILITIES = {
    "braketSchemaHeader": {"name": "braket.device_schema.ionq.ionq_device_capabilities", "version": "1"},
    "service": {
        "braketSchemaHeader": {"name": "braket.device_schema.device_service_properties", "version": "1"},
        "executionWindows": [{"executionDay": "Everyday", "windowStartHour": "00:00", "windowEndHour": "23:59:59"}],
        "shotsRange": [1, 10000],
        "updatedAt": "2026-11-01T08:00:00",
    },
    "action": {"braket.ir.openqasm.program": {
        "actionType": "braket.ir.openqasm.program", "version": ["1"],
        "supportedOperations": ["h", "cnot", "x", "rx", "ry", "rz"], "supportedResultTypes": []}},
    "paradigm": {
        "braketSchemaHeader": {"name": "braket.device_schema.gate_model_qpu_paradigm_properties", "version": "1"},
        "qubitCount": 36, "nativeGateSet": ["gpi", "gpi2", "zz"],
        "connectivity": {"fullyConnected": True, "connectivityGraph": {}}},
    "provider": {
        "braketSchemaHeader": {"name": "braket.device_schema.ionq.ionq_provider_properties", "version": "1"},
        "fidelity": {"1Q": {"mean": 0.9998}, "2Q": {"mean": 0.9952}, "spam": {"mean": 0.9937}},
        "timing": {"T1": 100, "T2": 1, "1Q": 6.3e-05, "2Q": 0.00065, "readout": 0.0002, "reset": 2e-05}},
    "deviceParameters": {},
}

TASK_RESULT = {
    "braketSchemaHeader": {"name": "braket.task_result.gate_model_task_result", "version": "1"},
    "measurements": [[0, 0]] * 48 + [[1, 1]] * 49 + [[0, 1]] * 3,
    "measuredQubits": [0, 1],
    "taskMetadata": {"braketSchemaHeader": {"name": "braket.task_result.task_metadata", "version": "1"},
                     "id": TASK_ARN, "shots": 100, "deviceId": ARN},
    "additionalMetadata": {"action": {
        "braketSchemaHeader": {"name": "braket.ir.openqasm.program", "version": "1"},
        "source": "OPENQASM 3.0;"}},
}


class FakeAwsSession:
    """Answers the AwsSession calls AwsDevice and AwsQuantumTask make, with fixed responses."""

    region = "us-east-1"

    def __init__(self, status: str = "COMPLETED"):
        self.status = status
        self.created: list[dict] = []

    def get_device(self, arn):
        return {"deviceArn": arn, "deviceName": "Forte 1", "providerName": "IonQ", "deviceType": "QPU",
                "deviceStatus": "ONLINE", "deviceCapabilities": json.dumps(IONQ_CAPABILITIES)}

    def create_quantum_task(self, **kwargs):
        self.created.append(kwargs)
        return TASK_ARN

    def get_quantum_task(self, arn):
        return {"quantumTaskArn": arn, "status": self.status, "deviceArn": ARN, "shots": 100,
                "outputS3Bucket": "qlab-test-bucket", "outputS3Directory": "tasks/0d1e2f3a",
                "actionMetadata": {"actionType": "braket.ir.openqasm.program"},
                "failureReason": "device offline" if self.status == "FAILED" else None}

    def retrieve_s3_object_body(self, bucket, key):
        assert (bucket, key) == ("qlab-test-bucket", "tasks/0d1e2f3a/results.json")
        return json.dumps(TASK_RESULT)

    def default_bucket(self):
        return "qlab-test-bucket"


def _aws_device(status="COMPLETED"):
    from braket.aws import AwsDevice
    return AwsDevice(ARN, aws_session=FakeAwsSession(status))


def test_aws_device_run_records_arn_calibration_and_task(captured):
    sent, updates = captured
    device = _aws_device()
    task = device.run(_bell(), s3_destination_folder=("qlab-test-bucket", "tasks"), shots=100)

    assert len(sent) == 1
    run = sent[0]
    assert run["status"] == "submitted"
    assert run["backend"] == "braket:Forte 1"
    assert run["execution"]["task_id"] == TASK_ARN
    assert run["execution"]["shots"] == 100
    dev = run["context"]["device"]
    assert dev["arn"] == ARN and dev["type"] == "QPU" and dev["provider_name"] == "IonQ"
    assert dev["region"] == "us-east-1" and dev["qubit_count"] == 36
    cal = run["calibration"]
    assert cal["source"] == "braket_provider"
    assert cal["readout_errors"]["avg"] == pytest.approx(1 - 0.9937)
    assert cal["gate_errors"]["2q"] == pytest.approx(1 - 0.9952)
    assert cal["t1_us"]["avg"] == pytest.approx(100e6)
    assert cal["gate_durations_us"]["2q"] == pytest.approx(650)
    assert cal["snapshot_time"].startswith("2026-11-01")
    # The submitted program is what Q-Lab recorded.
    assert json.loads(device.aws_session.created[0]["action"])["source"] == run["qasm"]

    result = task.result()
    done = [p for rid, p in updates if rid == run["run_id"] and p["status"] == "completed"]
    assert len(done) == 1
    assert done[0]["results"]["counts"] == dict(result.measurement_counts) == {"00": 48, "11": 49, "01": 3}
    assert done[0]["results"]["task_metadata"]["id"] == TASK_ARN

    task.result()  # cached by Braket: no second update
    assert len([p for rid, p in updates if rid == run["run_id"]]) == 1


def test_aws_task_that_fails_marks_the_run_failed(captured):
    sent, updates = captured
    task = _aws_device("FAILED").run(_bell(), s3_destination_folder=("qlab-test-bucket", "tasks"), shots=10)
    assert task.result() is None
    final = [p for rid, p in updates if rid == sent[0]["run_id"]]
    assert len(final) == 1 and final[0]["status"] == "failed"
    assert "FAILED" in final[0]["execution"]["error_message"]


def test_aws_default_shots_on_a_qpu(captured):
    sent, _ = captured
    _aws_device().run(_bell(), s3_destination_folder=("qlab-test-bucket", "tasks"))
    assert sent[0]["execution"]["shots"] == 1000 and sent[0]["execution"]["shots_source"] == "default"


# ── Calibration conversion ───────────────────────────────────────────────────────────────

def test_standardized_v1_per_qubit_calibration():
    from braket.device_schema.standardized_gate_model_qpu_device_properties_v1 import (
        StandardizedGateModelQpuDeviceProperties,
    )
    std = StandardizedGateModelQpuDeviceProperties.parse_obj({
        "braketSchemaHeader": {"name": "braket.device_schema.standardized_gate_model_qpu_device_properties",
                               "version": "1"},
        "oneQubitProperties": {"0": {
            "T1": {"value": 28.9, "standardError": 0.01, "unit": "us"},
            "T2": {"value": 44.5, "standardError": 0.02, "unit": "us"},
            "oneQubitFidelity": [
                {"fidelityType": {"name": "RANDOMIZED_BENCHMARKING"}, "fidelity": 0.9993},
                {"fidelityType": {"name": "READOUT"}, "fidelity": 0.903},
            ]}},
        "twoQubitProperties": {"0-1": {"twoQubitGateFidelity": [
            {"gateName": "CZ", "fidelity": 0.877, "fidelityType": {"name": "INTERLEAVED_RANDOMIZED_BENCHMARKING"}}]}},
    })

    class Props:
        standardized = std
        provider = None
        service = None

    cal = qbraket.calibration_from_properties(Props())
    assert cal["t1_us"] == {"0": pytest.approx(28.9)}
    assert cal["readout_errors"]["0"] == pytest.approx(0.097)
    assert cal["gate_errors"]["1q_0"] == pytest.approx(0.0007)
    assert cal["gate_errors"]["cz_0_1"] == pytest.approx(0.123)
    assert cal["source"] == "braket_standardized"


def test_simulators_have_no_calibration():
    assert qbraket.calibration_from_properties(LocalSimulator().properties) == {}
