"""The public qlab.* API (init, track, run, log_*, expect, benchmark, policy, campaigns) end to end.

qlab.init() is pointed at a real local HTTP server (conftest.FakeQLab), so every test checks what
actually goes over the wire, including the API key.
"""
import time
import warnings

import pytest

qiskit = pytest.importorskip("qiskit")
from qiskit import QuantumCircuit  # noqa: E402

import qlab  # noqa: E402
from qlab import qiskit_hooks  # noqa: E402

KEY = "qlab_hooks_test_key"


@pytest.fixture
def live(fake_qlab, tmp_path, monkeypatch):
    """qlab.init() against the fake server; the SDK's global state is restored afterwards."""
    saved_config = dict(qiskit_hooks._CONFIG)
    monkeypatch.setattr(qiskit_hooks, "_INITIALIZED", False)
    monkeypatch.setattr(qiskit_hooks, "_CLIENT", None)
    monkeypatch.delenv("QLAB_POLICY_ENFORCE", raising=False)
    monkeypatch.chdir(tmp_path)  # no stray qlab.toml
    qlab.init(api_url=fake_qlab.url, api_key=KEY, project="hooks", tags=["t1"],
              queue_path=str(tmp_path / "q.jsonl"), mask_keys=["secret"])
    qiskit_hooks._pop_transpiler_context()
    yield fake_qlab
    qiskit_hooks._CLIENT.flush(timeout=60)
    qiskit_hooks._CONFIG.clear()
    qiskit_hooks._CONFIG.update(saved_config)


def _bell() -> QuantumCircuit:
    qc = QuantumCircuit(2, name="bell")
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc


def _runs(server) -> list[dict]:
    qiskit_hooks._CLIENT.flush(timeout=60)
    return [r["json"] for r in server.received("POST", "/api/v1/runs")]


def _patches(server, run_id) -> list[dict]:
    qiskit_hooks._CLIENT.flush(timeout=60)
    return [r["json"] for r in server.received("PATCH", f"/api/v1/runs/{run_id}")]


def test_track_uploads_the_circuit(live):
    run_id = qlab.track(_bell(), backend_name="ibm_test", parameters={"theta": 0.5, "secret": "x"},
                        execution={"shots": 100})
    [run] = _runs(live)
    assert run["run_id"] == run_id
    assert run["circuit_name"] == "bell" and run["backend"] == "ibm_test"
    assert run["status"] == "captured"
    assert run["project"] == "hooks" and run["tags"] == ["t1"]
    assert run["parameters"] == {"theta": 0.5, "secret": "[MASKED]"}
    assert run["fingerprint"]["num_qubits"] == 2
    assert "OPENQASM" in run["qasm"]
    assert run["share_url"] == f"{live.url}/runs/{run_id}"
    assert live.received("POST", "/api/v1/runs")[0]["headers"]["x-qlab-api-key"] == KEY
    # The policy is consulted before the upload.
    assert live.received("POST", "/api/v1/policy/check")[0]["json"]["run_id"] == run_id


def test_run_context_logs_metrics_and_finishes(live):
    with qlab.run(_bell(), backend_name="aer", project="vqe", tags=["sweep"], campaign_id="cmp_9") as r:
        r.log("energy", -1.0)
        r.log("energy", -1.5)
        r.log("energy", -1.7, step=10)
        r.log_metrics({"fidelity": 0.9, "cost": 2}, step=3)
        r.finish()
    [run] = _runs(live)
    assert run["status"] == "running" and run["project"] == "vqe" and run["tags"] == ["sweep"]
    assert run["benchmark_id"] == "cmp_9"
    # project/tags/campaign apply to this run only
    assert qiskit_hooks._CONFIG["project"] == "hooks" and qiskit_hooks._CONFIG["tags"] == ["t1"]
    assert qiskit_hooks._CONFIG["campaign_id"] is None

    sent = [m for req in live.received("POST", f"/api/v1/runs/{r.run_id}/metrics")
            for m in req["json"]["metrics"]]
    assert {"name": "energy", "value": -1.0, "step": 0} in sent
    assert {"name": "energy", "value": -1.5, "step": 1} in sent
    assert {"name": "energy", "value": -1.7, "step": 10} in sent
    assert {"name": "fidelity", "value": 0.9, "step": 3} in sent
    assert {"name": "cost", "value": 2.0, "step": 3} in sent
    assert _patches(live, r.run_id) == [{"status": "completed"}]


def test_run_context_marks_failure_and_reraises(live):
    with pytest.raises(ZeroDivisionError), qlab.run(_bell()) as r:
        raise ZeroDivisionError("division by zero")
    [patch] = _patches(live, r.run_id)
    assert patch["status"] == "failed"
    assert patch["execution"]["error_type"] == "ZeroDivisionError"


def test_log_result_from_dict_and_from_result_object(live):
    run_id = qlab.track(_bell())
    qlab.log_result(run_id, {"counts": {"00": 3}, "secret": 1}, execution={"job_id": "j1"})

    class Result:
        def get_counts(self):
            return {"11": 7}

        def to_dict(self):
            return {"success": True}

    with qlab.run(_bell()) as r:
        r.finish(Result(), status="done")
    first, = _patches(live, run_id)
    assert first == {"status": "completed", "results": {"counts": {"00": 3}, "secret": "[MASKED]"},
                     "execution": {"job_id": "j1"}}
    second, = _patches(live, r.run_id)
    assert second["status"] == "done"
    assert second["results"]["counts"] == {"11": 7}
    assert second["results"]["raw"] == {"success": True}
    assert second["results"]["result_class"] == "Result"


@pytest.mark.parametrize("kwargs, passed, kind", [
    ({"min_prob": 0.4}, True, "min_prob"),
    ({"min_prob": 0.6}, False, "min_prob"),
    ({"max_prob": 0.4}, False, "max_prob"),
    ({"min_prob": 0.4, "max_prob": 0.6}, True, "range_prob"),
    ({}, None, "custom"),
])
def test_expect_evaluates_stored_counts(live, kwargs, passed, kind):
    live.respond("GET", "/api/v1/runs/r-exp", {"run_id": "r-exp", "results": {"counts": {"00": 50, "11": 50}}})
    out = qlab.expect("r-exp", state="00", label="bell", **kwargs)
    assert out["actual_prob"] == 0.5 and out["passed"] is passed and out["label"] == "bell"
    [posted] = live.received("POST", "/api/v1/runs/r-exp/assertions")
    a = posted["json"]["assertions"][0]
    assert a["assertion_type"] == kind and a["passed"] is passed and a["actual_value"] == 0.5
    assert a["state"] == "00"


def test_expect_sends_the_api_key(live):
    """Regression: expect() read the run and posted the assertion without the API key, so on a
    server with accounts the run was invisible and the assertion was rejected."""
    live.respond("GET", "/api/v1/runs/r-key", {"results": {"counts": {"00": 1}}})
    out = qlab.expect("r-key", state="00", min_prob=0.5)
    assert out["passed"] is True
    assert live.received("GET", "/api/v1/runs/r-key")[0]["headers"]["x-qlab-api-key"] == KEY
    assert live.received("POST", "/api/v1/runs/r-key/assertions")[0]["headers"]["x-qlab-api-key"] == KEY


def test_expect_reads_quasi_distributions(live):
    live.respond("GET", "/api/v1/runs/r-q", {"results": {"quasi_dists": [{"3": 0.25, "0": 0.75}]}})
    out = qlab.expect("r-q", state="11", max_prob=0.3)
    assert out["actual_prob"] == 0.25 and out["passed"] is True


def test_expect_without_results(live):
    live.respond("GET", "/api/v1/runs/r-none", {"results": {}})
    out = qlab.expect("r-none", state="0", min_prob=0.1)
    assert out["actual_prob"] is None and out["passed"] is None
    assert "not yet available" in out["message"]


def test_policy_violation_warns_by_default(live):
    live.respond("POST", "/api/v1/policy/check",
                 {"policy_active": True, "violations": [{"message": "depth over 1"}]})
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        qlab.track(_bell())
    assert any("depth over 1" in str(w.message) for w in caught)
    assert len(_runs(live)) == 1  # warned, still uploaded


def test_policy_violation_blocks_the_upload_when_enforced(live, monkeypatch):
    monkeypatch.setenv("QLAB_POLICY_ENFORCE", "1")
    live.respond("POST", "/api/v1/policy/check",
                 {"policy_active": True, "violations": [{"message": "a"}, {"message": "b"}]})
    with pytest.raises(qlab.PolicyViolationError, match="2"):
        qlab.track(_bell())
    assert _runs(live) == []


def test_check_and_get_policy(live):
    live.respond("POST", "/api/v1/policy/check", {"policy_active": True, "violations": [{"rule": "x"}]})
    live.respond("GET", "/api/v1/policy", {"max_depth": 5})
    assert qlab.check_policy({"run_id": "p"}) == [{"rule": "x"}]
    assert qlab.get_policy() == {"max_depth": 5}


def test_benchmark_creates_one_run_per_backend(live):
    bid = qlab.benchmark(_bell(), backends=["ibm_a", "ibm_b"], name="ab")
    runs = _runs(live)
    assert [r["backend"] for r in runs] == ["ibm_a", "ibm_b"]
    [bench] = [r["json"] for r in live.received("POST", "/api/v1/benchmarks")]
    assert bench["benchmark_id"] == bid and bench["name"] == "ab"
    assert bench["run_ids"] == [r["run_id"] for r in runs]
    assert bench["project"] == "hooks" and "OPENQASM" in bench["circuit_qasm"]


def test_campaign_helpers(live):
    live.respond("POST", "/api/v1/campaigns", {"campaign_id": "cmp_1", "combinations": []})
    live.respond("GET", "/api/v1/campaigns/cmp_1/combinations", {"combinations": [{"reps": 1}]})
    live.respond("GET", "/api/v1/campaigns/cmp_1", {"campaign_id": "cmp_1"})
    assert qlab.create_campaign("c", grid=[{"name": "reps", "values": [1]}])["campaign_id"] == "cmp_1"
    assert live.received("POST", "/api/v1/campaigns")[0]["json"]["project"] == "hooks"
    assert qlab.campaign_combinations("cmp_1") == [{"reps": 1}]
    assert qlab.get_campaign("cmp_1") == {"campaign_id": "cmp_1"}


def test_helpers_without_init(monkeypatch):
    monkeypatch.setattr(qiskit_hooks, "_CLIENT", None)
    assert qlab.track(_bell()) == ""
    assert qlab.benchmark(_bell(), ["a"]) == ""
    assert qlab.expect("r", "0") == {}
    assert qlab.check_policy({}) == [] and qlab.get_policy() == {}
    qlab.log_metric("r", "x", 1.0)
    qlab.log_metrics("r", {"x": 1.0})
    qlab.log_result("r", {})
    for fn, args in ((qlab.create_campaign, ("c", [])), (qlab.campaign_combinations, ("c",)),
                     (qlab.get_campaign, ("c",))):
        with pytest.raises(RuntimeError, match="qlab.init"):
            fn(*args)


def test_init_reads_qlab_toml(fake_qlab, tmp_path, monkeypatch):
    """Regression: on Python 3.10 (no tomllib) qlab.toml was silently ignored; tomli is used there."""
    saved = dict(qiskit_hooks._CONFIG)
    monkeypatch.setattr(qiskit_hooks, "_INITIALIZED", False)
    monkeypatch.setattr(qiskit_hooks, "_CLIENT", None)
    for var in ("QLAB_API_URL", "QLAB_API_KEY", "QLAB_PROJECT", "QLAB_QUEUE_PATH", "QLAB_ZK_QCO"):
        monkeypatch.delenv(var, raising=False)
    cfg = tmp_path / "lab.toml"
    cfg.write_text(
        f'[qlab]\napi_url = "{fake_qlab.url}/"\napi_key = "qlab_from_toml"\nproject = "toml-proj"\n'
        f'tags = ["a", "b"]\nmask_keys = ["token"]\ntimeout = 1.5\nzk_qco = true\n'
        f'queue_path = "{(tmp_path / "toml-q.jsonl").as_posix()}"\n',
        encoding="utf-8",
    )
    try:
        qlab.init(config_path=str(cfg))
        client = qiskit_hooks._CLIENT
        assert client.api_url == fake_qlab.url and client.api_key == "qlab_from_toml"
        assert client.timeout == 1.5 and client.queue_path == tmp_path / "toml-q.jsonl"
        assert qiskit_hooks._CONFIG["project"] == "toml-proj"
        assert qiskit_hooks._CONFIG["tags"] == ["a", "b"]
        assert qiskit_hooks._CONFIG["mask_keys"] == {"token"}
        assert qiskit_hooks._CONFIG["zk_qco"] is True
        qlab.init(api_url="http://ignored")  # a second init is a no-op
        assert qiskit_hooks._CLIENT is client
        client.flush(timeout=60)
    finally:
        qiskit_hooks._CONFIG.clear()
        qiskit_hooks._CONFIG.update(saved)


def test_load_config_handles_bad_files(tmp_path):
    from qlab.config import load_config
    bad = tmp_path / "bad.toml"
    bad.write_text("this is = = not toml", encoding="utf-8")
    assert load_config(str(bad)) == {}
    flat = tmp_path / "flat.toml"
    flat.write_text('api_url = "http://x"\n', encoding="utf-8")
    assert load_config(str(flat)) == {"api_url": "http://x"}
    odd = tmp_path / "odd.toml"
    odd.write_text('qlab = 3\n', encoding="utf-8")
    assert load_config(str(odd)) == {}


def test_auto_track_uses_environment(fake_qlab, tmp_path, monkeypatch):
    saved = dict(qiskit_hooks._CONFIG)
    monkeypatch.setattr(qiskit_hooks, "_INITIALIZED", False)
    monkeypatch.setattr(qiskit_hooks, "_CLIENT", None)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("QLAB_API_URL", fake_qlab.url)
    monkeypatch.setenv("QLAB_API_KEY", "qlab_env")
    monkeypatch.setenv("QLAB_QUEUE_PATH", str(tmp_path / "env-q.jsonl"))
    try:
        qlab.auto_track(project="auto")
        assert qiskit_hooks._CLIENT.api_url == fake_qlab.url
        assert qiskit_hooks._CLIENT.api_key == "qlab_env"
        assert qiskit_hooks._CONFIG["project"] == "auto"
        qiskit_hooks._CLIENT.flush(timeout=60)
    finally:
        qiskit_hooks._CONFIG.clear()
        qiskit_hooks._CONFIG.update(saved)


# --- job result patching -------------------------------------------------------------------

class _Job:
    def __init__(self, result=None, error=None):
        self._result, self._error = result, error

    def job_id(self):
        return "job-1"

    def result(self):
        if self._error:
            raise self._error
        return self._result


class _Counts:
    def __init__(self, counts):
        self._counts = counts

    def get_counts(self):
        return self._counts


def test_job_failure_marks_runs_failed(live):
    job = _Job(error=RuntimeError("queue timeout"))
    qiskit_hooks._patch_job_result(job, ["ra", "rb"])
    with pytest.raises(RuntimeError):
        job.result()
    for rid in ("ra", "rb"):
        [p] = _patches(live, rid)
        assert p["status"] == "failed"
        assert p["execution"] == {"error_type": "RuntimeError", "error_message": "queue timeout"}
        assert "result_time" in p["timing"]


def test_job_result_splits_counts_per_circuit_and_patches_once(live):
    job = _Job(_Counts([{"0": 4}, {"1": 6}]))
    qiskit_hooks._patch_job_result(job, ["c1", "c2"], backend_name="aer_simulator")
    qiskit_hooks._patch_job_result(job, ["c1", "c2"])  # already patched: no second wrapper
    job.result()
    assert _patches(live, "c1")[0]["results"]["counts"] == {"0": 4}
    assert _patches(live, "c2")[0]["results"]["counts"] == {"1": 6}
    assert len(_patches(live, "c1")) == 1


def test_hardware_counts_trigger_a_shadow_simulation(live, monkeypatch):
    calls = []
    monkeypatch.setattr(qiskit_hooks, "_shadow_simulate", lambda *a: calls.append(a))
    qc = _bell()
    job = _Job(_Counts({"00": 30, "11": 70}))
    qiskit_hooks._patch_job_result(job, ["hw"], [qc], backend_name="ibm_brisbane")
    job.result()
    assert calls == [(qc, {"00": 30, "11": 70}, 100, "hw")]

    calls.clear()
    sim_job = _Job(_Counts({"00": 1}))
    qiskit_hooks._patch_job_result(sim_job, ["sim"], [qc], backend_name="aer_simulator")
    sim_job.result()
    assert calls == []  # simulators are not compared with a simulation


def test_shadow_simulation_posts_tvd(live):
    pytest.importorskip("qiskit_aer")
    qiskit_hooks._shadow_simulate(_bell(), {"00": 500, "11": 500}, 1000, "shadow-run")
    deadline = time.time() + 60
    while not live.received("POST", "/api/v1/runs/shadow-run/shadow") and time.time() < deadline:
        time.sleep(0.2)
    [req] = live.received("POST", "/api/v1/runs/shadow-run/shadow")
    body = req["json"]
    assert body["shots"] == 1000 and sum(body["sim_counts"].values()) == 1000
    assert 0 <= body["tvd"] < 0.2  # a lightly noisy Bell state is close to 50/50
    assert req["headers"]["x-qlab-api-key"] == KEY


def test_optimize_reports_every_level():
    qc = QuantumCircuit(3)
    qc.h(0)
    qc.cx(0, 1)
    qc.cx(0, 1)  # cancels at higher optimisation levels
    qc.cx(1, 2)
    out = qlab.optimize(qc, basis_gates=["cx", "rz", "sx", "x"])
    assert [lv["level"] for lv in out["levels"]] == [0, 1, 2, 3]
    assert out["best_depth"] == min(lv["depth"] for lv in out["levels"])
    assert out["original_depth"] == qc.depth()
    assert out["best_depth"] < out["levels"][0]["depth"]
    assert out["max_depth_reduction"] == max(0, qc.depth() - out["best_depth"])


def test_optimize_when_every_level_fails():
    out = qlab.optimize(_bell(), basis_gates=["not_a_gate"])
    assert out["best_level"] is None and len(out["levels"]) == 4


# --- argument extraction ---------------------------------------------------------------------

def test_extract_parameters_and_seeds():
    class Sim:
        seed_simulator = 11

    class Opts:
        simulator = Sim()

    params = qiskit_hooks._extract_parameters(
        (_bell(), [0.1, 0.2]), {"parameter_values": [[1.0]], "seed_simulator": 5, "options": Opts()})
    assert params == {"parameter_values": [[1.0]], "seed_simulator": 11, "args": [[0.1, 0.2]]}
    dict_opts = qiskit_hooks._extract_parameters((), {"options": {"simulator": {"seed_simulator": 3}}})
    assert dict_opts == {"seed_simulator": 3}


def test_job_and_result_metadata():
    meta = qiskit_hooks._extract_job_metadata(_Job())
    assert meta == {"job_id": "job-1", "job_class": "_Job"}

    class Weird:
        quasi_dists = [{0: 1.0}]

        @property
        def metadata(self):
            raise ValueError("boom")

    res = qiskit_hooks._extract_result_metadata(Weird())
    assert res["quasi_dists"] == [{"0": 1.0}] and "metadata" not in res


def test_sanitize_parameters_and_objects():
    from qiskit.circuit import Parameter
    theta = Parameter("θ")
    out = qiskit_hooks._sanitize({"p": theta, "t": (1, 2), "o": object, 3: None})
    assert out["p"] == "θ" and out["t"] == [1, 2] and out["3"] is None
    assert out["o"].startswith("<class")


def test_positive_number_helpers():
    assert qiskit_hooks._positive_int(True) is None
    assert qiskit_hooks._positive_int("x") is None
    assert qiskit_hooks._positive_int(2.5) is None
    assert qiskit_hooks._positive_int(4) == 4
    assert qiskit_hooks._positive_float(False) is None
    assert qiskit_hooks._positive_float(-1) is None
    assert qiskit_hooks._positive_float("0.5") == 0.5
    assert qiskit_hooks._to_us(2, "ms") == 2000.0
    assert qiskit_hooks._to_us(5, "weird") == 5.0
    assert qiskit_hooks._num(float("nan")) is None
    assert qiskit_hooks._source_cap() > 0


def test_source_cap_ignores_bad_values(monkeypatch):
    monkeypatch.setenv("QLAB_SOURCE_MAX_BYTES", "lots")
    assert qiskit_hooks._source_cap() == qiskit_hooks._SOURCE_MAX_BYTES


def test_name_and_backend_lookup():
    class B:
        def name(self):
            return "dev"

    class Broken:
        def name(self):
            raise RuntimeError

    assert qiskit_hooks._name_of(B()) == "dev"
    assert qiskit_hooks._name_of(Broken()) is None
    assert qiskit_hooks._name_of(None) is None

    class Prim:
        _backend = "the-backend"

    assert qiskit_hooks._primitive_backend(Prim()) == "the-backend"
    assert qiskit_hooks._primitive_backend(object()) is None


def test_calibration_from_properties_units():
    class P:
        def __init__(self, name, value, unit):
            self.name, self.value, self.unit = name, value, unit

    class G:
        gate, qubits = "cx", [0, 1]
        parameters = [P("gate_error", 0.01, ""), P("gate_length", 300, "ns")]

    class Props:
        qubits = [[P("T1", 100, "us"), P("T2", 0.00008, "s"), P("readout_error", 0.02, "")]]
        gates = [G()]
        last_update_date = "yesterday"

    class Backend:
        def properties(self):
            return Props()

    cal = qiskit_hooks._calibration_from_properties(Backend())
    assert cal["t1_us"] == {"0": 100.0}
    assert cal["t2_us"]["0"] == pytest.approx(80.0)
    assert cal["readout_errors"] == {"0": 0.02}
    assert cal["gate_errors"] == {"cx_0_1": 0.01}
    assert cal["gate_durations_us"]["cx_0_1"] == pytest.approx(0.3)
    assert cal["snapshot_time"] == "yesterday" and cal["source"] == "properties"
    assert qiskit_hooks._capture_calibration(None) == {}
    assert qiskit_hooks._calibration_from_target(object()) == {}
