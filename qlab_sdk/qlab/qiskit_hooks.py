import atexit
import hashlib
import os
import time
import types
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .client import QLabClient
from .config import load_config
from .fingerprint import fingerprint_circuit
from .context import capture_context

_CLIENT: Optional[QLabClient] = None
_INITIALIZED = False
_transpiler_context = __import__("threading").local()
_CONFIG = {
    "api_url": "http://localhost:8000",
    "include_pip_freeze": False,
    "mask_keys": set(),
    "project": None,
    "tags": [],
    "zk_qco": False,
    "zk_qco_salt": "",
}

def _pop_transpiler_context() -> dict:
    if hasattr(_transpiler_context, "last"):
        data = _transpiler_context.last
        del _transpiler_context.last
        return data
    return {}


def _capture_calibration(backend) -> dict:
    if backend is None:
        return {}
    try:
        props_fn = getattr(backend, "properties", None)
        if not callable(props_fn):
            return {}
        props = props_fn()
        if props is None:
            return {}

        cal: dict[str, Any] = {}

        t1: dict[str, float] = {}
        t2: dict[str, float] = {}
        readout_errors: dict[str, float] = {}
        try:
            for i, qubit_props in enumerate(props.qubits):
                for param in qubit_props:
                    if param.name == "T1":
                        t1[str(i)] = param.value
                    elif param.name == "T2":
                        t2[str(i)] = param.value
                    elif param.name == "readout_error":
                        readout_errors[str(i)] = param.value
        except Exception:
            pass
        if t1:
            cal["t1_us"] = t1
        if t2:
            cal["t2_us"] = t2
        if readout_errors:
            cal["readout_errors"] = readout_errors

        gate_errors: dict[str, float] = {}
        try:
            for gate in props.gates:
                for param in gate.parameters:
                    if param.name == "gate_error":
                        key = f"{gate.gate}_{'_'.join(str(q) for q in gate.qubits)}"
                        gate_errors[key] = param.value
        except Exception:
            pass
        if gate_errors:
            cal["gate_errors"] = gate_errors

        try:
            lu = props.last_update_date
            cal["snapshot_time"] = lu.isoformat() if hasattr(lu, "isoformat") else str(lu)
        except Exception:
            cal["snapshot_time"] = datetime.now(timezone.utc).isoformat()

        return cal
    except Exception:
        return {}


def _circuit_to_qasm(circuit) -> Optional[str]:
    try:
        from qiskit import qasm3
        return qasm3.dumps(circuit)
    except Exception:
        try:
            from qiskit import qasm2
            return qasm2.dumps(circuit)
        except Exception:
            return None


def _apply_zk_qco(qasm: Optional[str], fingerprint: dict[str, Any]) -> tuple[Optional[str], dict[str, Any], dict[str, Any]]:
    """Strip circuit source while preserving noise/resource metadata."""
    if not _CONFIG.get("zk_qco"):
        return qasm, fingerprint, {}
    salt = str(_CONFIG.get("zk_qco_salt") or os.getenv("QLAB_ZK_QCO_SALT") or "")
    material = (salt + "\n" + (qasm or "")).encode("utf-8")
    digest = hashlib.sha256(material).hexdigest()
    obfuscated_fp = dict(fingerprint)
    if qasm:
        obfuscated_fp["qasm_sha256"] = digest
    obfuscated_fp["zk_qco"] = True
    return None, obfuscated_fp, {
        "enabled": True,
        "mode": "hash_only",
        "qasm_sha256": digest if qasm else None,
        "preserved_fields": ["num_qubits", "num_clbits", "depth", "size", "gate_counts", "non_clifford_ratio"],
    }

def _extract_circuits_from_args(args: tuple, kwargs: dict) -> list[Any]:
    circuits = []

    # Sampler/Estimator usually receive circuits in args or kwargs.
    candidates = list(args)

    for key in ["circuits", "pubs", "circuit"]:
        if key in kwargs:
            candidates.append(kwargs[key])

    for candidate in candidates:
        if _looks_like_circuit(candidate):
            circuits.append(candidate)
        elif isinstance(candidate, (list, tuple)):
            for item in candidate:
                if _looks_like_circuit(item):
                    circuits.append(item)
                elif isinstance(item, (list, tuple)) and item:
                    # Primitive V2 PUB-like tuples can contain circuit first.
                    if _looks_like_circuit(item[0]):
                        circuits.append(item[0])

    return circuits

def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            if str(key) in _CONFIG["mask_keys"]:
                sanitized[str(key)] = "[MASKED]"
            else:
                sanitized[str(key)] = _sanitize(item)
        return sanitized

    if isinstance(value, (list, tuple)):
        return [_sanitize(item) for item in value]

    try:
        import qiskit

        if isinstance(value, qiskit.circuit.Parameter):
            return str(value)
    except Exception:
        pass

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    return repr(value)

def _extract_parameters(args: tuple, kwargs: dict) -> dict[str, Any]:
    parameters = {}

    for key in ["parameter_values", "parameter_binds", "parameters"]:
        if key in kwargs:
            parameters[key] = _sanitize(kwargs[key])

    # Capture seeds for deterministic reproducibility
    for key in ["seed_simulator", "seed"]:
        if key in kwargs and kwargs[key] is not None:
            parameters[key] = kwargs[key]

    # IBM Runtime primitives nest seed inside options
    options = kwargs.get("options")
    if isinstance(options, dict):
        sim = options.get("simulator", {})
        if isinstance(sim, dict) and "seed_simulator" in sim:
            parameters["seed_simulator"] = sim["seed_simulator"]
    elif options is not None:
        sim = getattr(options, "simulator", None)
        if sim is not None:
            seed = getattr(sim, "seed_simulator", None)
            if seed is not None:
                parameters["seed_simulator"] = seed

    if len(args) > 1:
        parameters["args"] = _sanitize(args[1:])

    return parameters

def _extract_job_metadata(job: Any) -> dict[str, Any]:
    metadata = {}

    for key in ["job_id", "backend", "status"]:
        try:
            value = getattr(job, key, None)
            if callable(value):
                value = value()
            if value is not None:
                metadata[key] = _sanitize(value)
        except Exception:
            pass

    try:
        metadata["job_class"] = job.__class__.__name__
    except Exception:
        pass

    return metadata

def _error_metadata(error: Exception) -> dict[str, Any]:
    return {
        "error_type": error.__class__.__name__,
        "error_message": str(error),
    }

def _extract_result_metadata(result: Any) -> dict[str, Any]:
    metadata = {}

    try:
        metadata["result_class"] = result.__class__.__name__
    except Exception:
        pass

    try:
        get_counts = getattr(result, "get_counts", None)
        if callable(get_counts):
            metadata["counts"] = _sanitize(get_counts())
    except Exception:
        pass

    for key in ["quasi_dists", "metadata", "data"]:
        try:
            value = getattr(result, key, None)
            if callable(value):
                value = value()
            if value is not None:
                metadata[key] = _sanitize(value)
        except Exception:
            pass

    try:
        to_dict = getattr(result, "to_dict", None)
        if callable(to_dict):
            metadata["raw"] = _sanitize(to_dict())
    except Exception:
        pass

    return metadata

def _looks_like_circuit(obj: Any) -> bool:
    return (
        hasattr(obj, "num_qubits")
        and hasattr(obj, "depth")
        and hasattr(obj, "count_ops")
    )

def _capture_circuit(
    circuit,
    backend_name: Optional[str] = None,
    parameters: Optional[dict[str, Any]] = None,
    execution: Optional[dict[str, Any]] = None,
    status: str = "submitted",
    calibration: Optional[dict[str, Any]] = None,
    transpiler: Optional[dict[str, Any]] = None,
    timing: Optional[dict[str, Any]] = None,
    campaign_id: Optional[str] = None,
) -> str:
    if _CLIENT is None:
        return ""

    run_id = str(uuid.uuid4())
    qasm = _circuit_to_qasm(circuit)
    fingerprint = fingerprint_circuit(circuit, qasm=qasm)
    upload_qasm, upload_fingerprint, privacy = _apply_zk_qco(qasm, fingerprint)

    payload = {
        "run_id": run_id,
        "circuit_name": getattr(circuit, "name", None),
        "qasm": upload_qasm,
        "fingerprint": upload_fingerprint,
        "context": capture_context(include_pip_freeze=_CONFIG["include_pip_freeze"]),
        "backend": backend_name,
        "parameters": _sanitize(parameters or {}),
        "execution": _sanitize(execution or {}),
        "calibration": _sanitize(calibration or {}),
        "transpiler": _sanitize(transpiler or {}),
        "timing": timing or {},
        "project": _CONFIG["project"],
        "tags": list(_CONFIG["tags"]),
        "status": status,
        "share_url": f"{_CONFIG['api_url'].rstrip('/')}/runs/{run_id}",
        "benchmark_id": campaign_id or _CONFIG.get("campaign_id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if privacy:
        payload["context"]["zk_qco"] = privacy

    # Policy gate — check before sending
    _enforce_policy(payload)

    _CLIENT.send_run_async(payload)
    return run_id


def _enforce_policy(payload: dict) -> None:
    """Check policy and either warn or raise based on QLAB_POLICY_ENFORCE env var."""
    if _CLIENT is None:
        return
    try:
        result = _CLIENT.check_policy(payload)
        if not result.get("policy_active"):
            return
        violations = result.get("violations", [])
        if not violations:
            return
        enforce = os.getenv("QLAB_POLICY_ENFORCE", "").lower() in ("1", "true", "yes")
        msg_lines = [f"Q-Lab policy violation{'' if len(violations) == 1 else 's'} ({len(violations)}):"]
        for v in violations:
            msg_lines.append(f"  • {v.get('message', v)}")
        msg = "\n".join(msg_lines)
        if enforce:
            raise PolicyViolationError(msg)
        else:
            import warnings
            warnings.warn(msg, stacklevel=4)
    except PolicyViolationError:
        raise
    except Exception:
        pass  # Never break the researcher's workflow


def track(
    circuit,
    backend_name: Optional[str] = None,
    parameters: Optional[dict[str, Any]] = None,
    execution: Optional[dict[str, Any]] = None,
    status: str = "captured",
) -> str:
    """Capture one circuit explicitly, useful for local simulators and notebooks."""
    return _capture_circuit(
        circuit,
        backend_name=backend_name,
        parameters=parameters,
        execution=execution,
        status=status,
    )

def log_result(
    run_id: str,
    result: Any,
    status: str = "completed",
    execution: Optional[dict[str, Any]] = None,
) -> None:
    """Attach result metadata to an existing run."""
    if _CLIENT is None:
        return

    if isinstance(result, dict):
        results = _sanitize(result)
    else:
        results = _extract_result_metadata(result)

    payload = {"status": status, "results": results}
    if execution:
        payload["execution"] = _sanitize(execution)

    _CLIENT.update_run_async(run_id, payload)

def flush(timeout: float = 5.0) -> None:
    """Wait briefly for background uploads, useful at notebook/script shutdown."""
    if _CLIENT is not None:
        _CLIENT.flush(timeout=timeout)


def expect(
    run_id: str,
    state: str,
    min_prob: Optional[float] = None,
    max_prob: Optional[float] = None,
    label: Optional[str] = None,
) -> dict:
    """Assert an expected measurement probability for a bitstring state.

    Evaluates the assertion against the run's stored results immediately.
    Posts the result to Q-Lab so it appears in the UI as a pass/fail badge.

    Example::

        run_id = qlab.track(qc, backend="ibm_brisbane")
        job.result()  # auto-patches result via SDK hook

        qlab.expect(run_id, state="00", min_prob=0.45, label="Bell |00⟩ ≥ 45%")
        qlab.expect(run_id, state="11", min_prob=0.45, label="Bell |11⟩ ≥ 45%")
        qlab.expect(run_id, state="01", max_prob=0.05, label="No leakage")

    Returns a dict with 'passed', 'actual_prob', and 'message'.
    """
    if _CLIENT is None:
        return {}

    # Fetch the run to check its stored results
    actual_prob: Optional[float] = None
    message: Optional[str] = None
    passed: Optional[bool] = None

    try:
        import urllib.request, json as _json
        url = f"{_CONFIG['api_url'].rstrip('/')}/api/v1/runs/{run_id}"
        with urllib.request.urlopen(url, timeout=5) as resp:
            run_data = _json.loads(resp.read())
        results = run_data.get("results") or {}

        # Extract probability for the requested state
        counts = results.get("counts") or {}
        if counts and isinstance(counts, dict):
            total = sum(counts.values())
            if total > 0:
                actual_prob = counts.get(state, 0) / total

        # If no bitstring counts, check quasi_dists
        if actual_prob is None:
            qdists = results.get("quasi_dists")
            if qdists and isinstance(qdists, list) and qdists:
                qd = qdists[0]
                # Convert state bitstring to integer key
                try:
                    int_key = int(state, 2)
                    actual_prob = float(qd.get(int_key, qd.get(str(int_key), 0.0)))
                except (ValueError, TypeError):
                    pass

    except Exception:
        pass

    # Evaluate assertion
    if actual_prob is not None:
        if min_prob is not None and max_prob is not None:
            passed = min_prob <= actual_prob <= max_prob
            message = f"|{state}⟩: {actual_prob:.4f} {'∈' if passed else '∉'} [{min_prob:.4f}, {max_prob:.4f}]"
        elif min_prob is not None:
            passed = actual_prob >= min_prob
            message = f"|{state}⟩: {actual_prob:.4f} {'≥' if passed else '<'} {min_prob:.4f}"
        elif max_prob is not None:
            passed = actual_prob <= max_prob
            message = f"|{state}⟩: {actual_prob:.4f} {'≤' if passed else '>'} {max_prob:.4f}"
        else:
            passed = None
            message = f"|{state}⟩: probability = {actual_prob:.4f}"
    else:
        message = f"Could not determine probability for |{state}⟩ — results not yet available"

    # Post assertion to backend
    _CLIENT.log_metrics_async(run_id, [])  # ensure client is alive
    try:
        import threading, urllib.request, json as _json
        payload = _json.dumps({
            "assertions": [{
                "label": label,
                "assertion_type": "min_prob" if min_prob is not None and max_prob is None
                    else ("max_prob" if max_prob is not None and min_prob is None
                    else ("range_prob" if min_prob is not None and max_prob is not None
                    else "custom")),
                "state": state,
                "expected_min": min_prob,
                "expected_max": max_prob,
                "actual_value": actual_prob,
                "passed": passed,
                "message": message,
            }]
        }).encode()
        req = urllib.request.Request(
            f"{_CONFIG['api_url'].rstrip('/')}/api/v1/runs/{run_id}/assertions",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=3)
    except Exception:
        pass

    return {
        "state": state,
        "actual_prob": actual_prob,
        "passed": passed,
        "message": message,
        "label": label,
    }


def log_metric(run_id: str, name: str, value: float, step: Optional[int] = None) -> None:
    """Log a single scalar metric to an existing run.

    Example::

        run_id = qlab.track(qc, backend="ibm_brisbane")
        for i, energy in enumerate(vqe_energies):
            qlab.log_metric(run_id, "energy", energy, step=i)
    """
    if _CLIENT is None:
        return
    _CLIENT.log_metrics_async(run_id, [{"name": name, "value": float(value), "step": step}])


def log_metrics(run_id: str, metrics: dict[str, float], step: Optional[int] = None) -> None:
    """Log multiple scalar metrics in one call.

    Example::

        qlab.log_metrics(run_id, {"fidelity": 0.94, "energy": -1.23, "cost": 0.06}, step=10)
    """
    if _CLIENT is None:
        return
    payload = [{"name": k, "value": float(v), "step": step} for k, v in metrics.items()]
    _CLIENT.log_metrics_async(run_id, payload)


class RunContext:
    """Context manager returned by qlab.run(). Tracks a circuit and provides
    a fluent API for logging metrics during an iterative algorithm.

    Example::

        with qlab.run(qc, backend="ibm_brisbane", project="vqe-2026") as r:
            for step, (params, energy) in enumerate(optimizer):
                r.log("energy", energy, step=step)
                r.log("params", params)
            r.finish(result)
    """

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        self._auto_step = 0

    def log(self, name: str, value: float, step: Optional[int] = None) -> None:
        """Log a single metric. If step is omitted, auto-increments per call."""
        s = step if step is not None else self._auto_step
        if step is None:
            self._auto_step += 1
        log_metric(self.run_id, name, value, step=s)

    def log_metrics(self, metrics: dict[str, float], step: Optional[int] = None) -> None:
        """Log multiple metrics at once."""
        log_metrics(self.run_id, metrics, step=step)

    def expect(
        self,
        state: str,
        min_prob: Optional[float] = None,
        max_prob: Optional[float] = None,
        label: Optional[str] = None,
    ) -> dict:
        """Assert an expected measurement probability (convenience wrapper)."""
        return expect(self.run_id, state=state, min_prob=min_prob, max_prob=max_prob, label=label)

    def finish(self, result: Any = None, status: str = "completed") -> None:
        """Mark the run finished, optionally attaching a result object."""
        if result is not None:
            log_result(self.run_id, result, status=status)
        elif _CLIENT is not None:
            _CLIENT.update_run_async(self.run_id, {"status": status})

    def __enter__(self) -> "RunContext":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        if exc_type is not None and _CLIENT is not None:
            _CLIENT.update_run_async(
                self.run_id,
                {
                    "status": "failed",
                    "execution": {
                        "error_type": exc_type.__name__,
                        "error_message": str(exc_val),
                    },
                },
            )
        return False  # never suppress exceptions


def run(
    circuit,
    backend_name: Optional[str] = None,
    parameters: Optional[dict[str, Any]] = None,
    project: Optional[str] = None,
    tags: Optional[list[str]] = None,
    campaign_id: Optional[str] = None,
) -> RunContext:
    """Start a tracked run and return a RunContext for live metric logging.

    Designed for iterative algorithms (VQE, QAOA, QML training loops).
    Pass ``campaign_id`` to associate this run with an experiment campaign.

    Example::

        import qlab
        qlab.init(project="vqe-h2")

        qc = QuantumCircuit(2)
        qc.ry(theta, 0); qc.cx(0, 1)

        campaign = qlab.create_campaign("shots sweep", grid=[{"name": "shots", "values": [100, 1000]}])
        for params in campaign["combinations"]:
            with qlab.run(qc, campaign_id=campaign["campaign_id"], parameters=params) as r:
                r.finish(result)
    """
    # Temporarily override project/tags/campaign if provided
    prev_project = _CONFIG.get("project")
    prev_tags = _CONFIG.get("tags", [])
    prev_campaign = _CONFIG.get("campaign_id")
    if project is not None:
        _CONFIG["project"] = project
    if tags is not None:
        _CONFIG["tags"] = tags
    if campaign_id is not None:
        _CONFIG["campaign_id"] = campaign_id

    run_id = track(circuit, backend_name=backend_name, parameters=parameters, status="running")

    _CONFIG["project"] = prev_project
    _CONFIG["tags"] = prev_tags
    _CONFIG["campaign_id"] = prev_campaign

    return RunContext(run_id)

def _shadow_simulate(circuit: Any, real_counts: dict, shots: int, run_id: str) -> None:
    """Run noisy Aer simulation and post TVD comparison. Fire-and-forget thread."""
    import threading

    def _run() -> None:
        try:
            from qiskit_aer import AerSimulator  # type: ignore
            from qiskit_aer.noise import NoiseModel, depolarizing_error, ReadoutError  # type: ignore
            from qiskit import transpile as _transpile

            gate_err = 0.01
            ro_err = 0.02
            noise = NoiseModel()
            dep1 = depolarizing_error(gate_err, 1)
            dep2 = depolarizing_error(gate_err * 10, 2)
            noise.add_all_qubit_quantum_error(
                dep1, ["h", "x", "y", "z", "s", "sdg", "t", "tdg", "rx", "ry", "rz", "u", "u1", "u2", "u3"]
            )
            noise.add_all_qubit_quantum_error(dep2, ["cx", "cz", "ecr", "swap", "cy", "iswap"])
            ro_matrix = [[1 - ro_err, ro_err], [ro_err, 1 - ro_err]]
            noise.add_all_qubit_readout_error(ReadoutError(ro_matrix))

            sim = AerSimulator(noise_model=noise)
            tqc = _transpile(circuit, sim, optimization_level=1)
            aer_result = sim.run(tqc, shots=shots).result()
            sim_counts: dict = aer_result.get_counts()

            total_real = sum(real_counts.values()) or 1
            total_sim = sum(sim_counts.values()) or 1
            all_states = set(real_counts) | set(sim_counts)
            tvd = sum(
                abs(real_counts.get(s, 0) / total_real - sim_counts.get(s, 0) / total_sim)
                for s in all_states
            ) / 2

            import urllib.request, json as _json
            payload = _json.dumps({
                "sim_counts": {k: int(v) for k, v in sim_counts.items()},
                "noise_model_summary": {"gate_error": gate_err, "readout_error": ro_err},
                "tvd": round(tvd, 6),
                "shots": shots,
                "sim_backend": "AerSimulator(depolarizing)",
            }).encode()
            req = urllib.request.Request(
                f"{_CONFIG['api_url'].rstrip('/')}/api/v1/runs/{run_id}/shadow",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=20)
        except ImportError:
            pass  # qiskit-aer not installed
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()


def _patch_job_result(job: Any, run_ids: list[str], circuits: list[Any] | None = None) -> None:
    if not run_ids or not hasattr(job, "result"):
        return

    original_result = getattr(job, "result")
    if getattr(original_result, "_qlab_patched", False):
        return

    def patched_result(self, *args, **kwargs):
        result_time = datetime.now(timezone.utc).isoformat()
        try:
            result = original_result(*args, **kwargs)
        except Exception as error:
            for run_id in run_ids:
                if _CLIENT is not None:
                    _CLIENT.update_run_async(
                        run_id,
                        {
                            "status": "failed",
                            "execution": _error_metadata(error),
                            "timing": {"result_time": result_time},
                        },
                    )
            raise

        results = _extract_result_metadata(result)

        # Real QPU counts for shadow simulation
        real_counts: dict = {}
        try:
            rc = results.get("counts")
            if isinstance(rc, dict):
                real_counts = {str(k): int(v) for k, v in rc.items()}
        except Exception:
            pass
        shots = sum(real_counts.values()) if real_counts else 1024

        for i, run_id in enumerate(run_ids):
            if _CLIENT is not None:
                _CLIENT.update_run_async(
                    run_id,
                    {
                        "status": "completed",
                        "results": results,
                        "timing": {"result_time": result_time},
                    },
                )
            # Fire shadow simulation if Aer is available and we have real counts
            if real_counts and circuits and i < len(circuits):
                _shadow_simulate(circuits[i], real_counts, shots, run_id)

        return result

    patched_result._qlab_patched = True
    try:
        setattr(job, "result", types.MethodType(patched_result, job))
    except Exception:
        pass

def _patch_runtime_primitive(cls) -> None:
    original_run = cls.run

    if getattr(cls.run, "_qlab_patched", False):
        return

    def patched_run(self, *args, **kwargs):
        backend_name = None
        backend_obj = None
        circuits = []
        parameters = {}
        calibration: dict = {}
        transpiler_ctx: dict = {}
        submit_time = datetime.now(timezone.utc).isoformat()
        try:
            if hasattr(self, "backend"):
                backend_obj = getattr(self, "backend")
                backend_name = getattr(backend_obj, "name", None)

            circuits = _extract_circuits_from_args(args, kwargs)
            parameters = _extract_parameters(args, kwargs)
            calibration = _capture_calibration(backend_obj)
            transpiler_ctx = _pop_transpiler_context()
        except Exception:
            pass

        try:
            job = original_run(self, *args, **kwargs)
        except Exception as error:
            for circuit in circuits:
                _capture_circuit(
                    circuit,
                    backend_name=backend_name,
                    parameters=parameters,
                    execution=_error_metadata(error),
                    status="failed",
                    calibration=calibration,
                    transpiler=transpiler_ctx,
                    timing={"submit_time": submit_time},
                )
            raise

        execution = _extract_job_metadata(job)
        run_ids = []
        for circuit in circuits:
            run_ids.append(
                _capture_circuit(
                    circuit,
                    backend_name=backend_name,
                    parameters=parameters,
                    execution=execution,
                    status="submitted",
                    calibration=calibration,
                    transpiler=transpiler_ctx,
                    timing={"submit_time": submit_time},
                )
            )

        _patch_job_result(job, run_ids, circuits)
        return job

    patched_run._qlab_patched = True
    cls.run = patched_run

def _patch_backend_run(cls) -> None:
    if not hasattr(cls, "run") or getattr(cls.run, "_qlab_patched", False):
        return

    original_run = cls.run

    def patched_run(self, *args, **kwargs):
        backend_name = None
        circuits = []
        parameters = {}
        calibration: dict = {}
        transpiler_ctx: dict = {}
        submit_time = datetime.now(timezone.utc).isoformat()
        try:
            backend_name = getattr(self, "name", None)
            if callable(backend_name):
                backend_name = backend_name()

            circuits = _extract_circuits_from_args(args, kwargs)
            parameters = _extract_parameters(args, kwargs)
            calibration = _capture_calibration(self)
            transpiler_ctx = _pop_transpiler_context()
        except Exception:
            pass

        try:
            job = original_run(self, *args, **kwargs)
        except Exception as error:
            for circuit in circuits:
                _capture_circuit(
                    circuit,
                    backend_name=backend_name,
                    parameters=parameters,
                    execution=_error_metadata(error),
                    status="failed",
                    calibration=calibration,
                    transpiler=transpiler_ctx,
                    timing={"submit_time": submit_time},
                )
            raise

        execution = _extract_job_metadata(job)
        run_ids = []
        for circuit in circuits:
            run_ids.append(
                _capture_circuit(
                    circuit,
                    backend_name=backend_name,
                    parameters=parameters,
                    execution=execution,
                    status="submitted",
                    calibration=calibration,
                    transpiler=transpiler_ctx,
                    timing={"submit_time": submit_time},
                )
            )

        _patch_job_result(job, run_ids, circuits)
        return job

    patched_run._qlab_patched = True
    cls.run = patched_run

def benchmark(
    circuit,
    backends: list[str],
    name: Optional[str] = None,
    project: Optional[str] = None,
) -> str:
    """
    Submit the same circuit to multiple backends for side-by-side comparison.

    Returns a benchmark_id. Use GET /api/v1/benchmarks/{id} to view results.

    Example::

        import qlab
        qlab.init()

        from qiskit import QuantumCircuit
        qc = QuantumCircuit(2)
        qc.h(0); qc.cx(0, 1); qc.measure_all()

        bid = qlab.benchmark(qc, backends=["ibm_kyoto", "ibm_brisbane"])
        print(f"Benchmark: http://localhost:8000/api/v1/benchmarks/{bid}")
    """
    if _CLIENT is None:
        return ""

    bid = str(uuid.uuid4())
    qasm = _circuit_to_qasm(circuit)
    run_ids = []

    transpiler_ctx = _pop_transpiler_context()

    for backend_name in backends:
        run_id = _capture_circuit(
            circuit,
            backend_name=backend_name,
            status="submitted",
            transpiler=transpiler_ctx,
            timing={"submit_time": datetime.now(timezone.utc).isoformat()},
        )
        run_ids.append(run_id)

    _CLIENT.send_benchmark_async({
        "benchmark_id": bid,
        "name": name or f"Benchmark {bid[:8]}",
        "circuit_qasm": qasm,
        "backends": backends,
        "run_ids": run_ids,
        "project": project or _CONFIG.get("project"),
    })

    return bid


def optimize(
    circuit,
    backend=None,
    coupling_map=None,
    basis_gates=None,
    seed: int = 42,
) -> dict:
    """Compare transpilation at all optimization levels (O0–O3) and recommend the best.

    Sweeps optimization_level 0 through 3 using qiskit.transpile, collecting
    depth, gate count, and runtime for each. Returns the best level by minimum depth.

    Example::

        import qlab
        from qiskit import QuantumCircuit

        qc = QuantumCircuit(4)
        qc.h(0); qc.cx(0, 1); qc.cx(1, 2); qc.cx(2, 3); qc.measure_all()

        result = qlab.optimize(qc, backend=my_backend)
        print(f"Best: O{result['best_level']} → depth {result['best_depth']}")

    The returned dict is also safe to store in run.transpiler for later retrieval.
    """
    try:
        from qiskit import transpile as _transpile
    except ImportError:
        return {"error": "Qiskit not installed — cannot run optimization sweep"}

    original_depth = circuit.depth()
    original_size = circuit.size()
    levels = []

    for level in [0, 1, 2, 3]:
        try:
            t0 = time.monotonic()
            tc = _transpile(
                circuit,
                backend=backend,
                coupling_map=coupling_map,
                basis_gates=basis_gates,
                optimization_level=level,
                seed_transpiler=seed,
            )
            duration_ms = round((time.monotonic() - t0) * 1000, 2)
            levels.append({
                "level": level,
                "depth": tc.depth(),
                "size": tc.size(),
                "num_qubits": tc.num_qubits,
                "gate_counts": {str(k): int(v) for k, v in tc.count_ops().items()},
                "depth_reduction": original_depth - tc.depth(),
                "size_reduction": original_size - tc.size(),
                "duration_ms": duration_ms,
            })
        except Exception as e:
            levels.append({"level": level, "error": str(e)})

    valid = [lv for lv in levels if "error" not in lv]
    if not valid:
        return {"levels": levels, "best_level": None, "error": "All optimization levels failed"}

    best = min(valid, key=lambda lv: lv["depth"])

    return {
        "levels": levels,
        "best_level": best["level"],
        "best_depth": best["depth"],
        "best_size": best["size"],
        "original_depth": original_depth,
        "original_size": original_size,
        "max_depth_reduction": max(0, original_depth - best["depth"]),
        "max_size_reduction": max(0, original_size - best["size"]),
        "sweep_seed": seed,
    }


def _circuit_stats(circuit) -> dict:
    """Extract depth, size, qubit count, and gate breakdown from a circuit."""
    try:
        return {
            "num_qubits": circuit.num_qubits,
            "depth": circuit.depth(),
            "size": circuit.size(),
            "gate_counts": {str(k): int(v) for k, v in circuit.count_ops().items()},
        }
    except Exception:
        return {}


def _patch_transpile() -> None:
    try:
        import qiskit.compiler
        if getattr(qiskit.compiler.transpile, "_qlab_patched", False):
            return

        original = qiskit.compiler.transpile

        def patched(*args, **kwargs):
            settings = {
                k: kwargs[k]
                for k in [
                    "optimization_level", "basis_gates", "routing_method",
                    "layout_method", "translation_method", "seed_transpiler",
                    "approximation_degree", "scheduling_method",
                ]
                if k in kwargs and kwargs[k] is not None
            }

            # Capture pre-transpile circuit stats
            before: dict = {}
            try:
                circuit = args[0] if args else kwargs.get("circuits")
                if _looks_like_circuit(circuit):
                    before = _circuit_stats(circuit)
                elif isinstance(circuit, (list, tuple)) and circuit and _looks_like_circuit(circuit[0]):
                    before = _circuit_stats(circuit[0])
            except Exception:
                pass

            start_time = datetime.now(timezone.utc).isoformat()
            t0 = time.monotonic()
            result = original(*args, **kwargs)
            duration_ms = round((time.monotonic() - t0) * 1000, 2)

            # Capture post-transpile circuit stats
            after: dict = {}
            try:
                tc = result if _looks_like_circuit(result) else (
                    result[0] if isinstance(result, (list, tuple)) and result and _looks_like_circuit(result[0]) else None
                )
                if tc is not None:
                    after = _circuit_stats(tc)
            except Exception:
                pass

            _transpiler_context.last = {
                "settings": settings,
                "before": before,
                "after": after,
                "start_time": start_time,
                "end_time": datetime.now(timezone.utc).isoformat(),
                "duration_ms": duration_ms,
            }
            return result

        patched._qlab_patched = True
        qiskit.compiler.transpile = patched

        try:
            import qiskit as _qiskit
            if not getattr(getattr(_qiskit, "transpile", None), "_qlab_patched", False):
                _qiskit.transpile = patched
        except Exception:
            pass
    except Exception:
        pass


def init(
    api_url: Optional[str] = None,
    api_key: Optional[str] = None,
    include_pip_freeze: Optional[bool] = None,
    mask_keys: Optional[list[str]] = None,
    project: Optional[str] = None,
    tags: Optional[list[str]] = None,
    timeout: Optional[float] = None,
    queue_path: Optional[str] = None,
    config_path: Optional[str] = None,
    zk_qco: Optional[bool] = None,
    zk_qco_salt: Optional[str] = None,
) -> None:
    global _CLIENT, _INITIALIZED

    if _INITIALIZED:
        return

    file_config = load_config(config_path)
    resolved_api_url = (
        api_url
        or os.getenv("QLAB_API_URL")
        or file_config.get("api_url")
        or "http://localhost:8000"
    )
    resolved_api_key = api_key or os.getenv("QLAB_API_KEY") or file_config.get("api_key")
    resolved_include_pip_freeze = (
        include_pip_freeze
        if include_pip_freeze is not None
        else bool(file_config.get("include_pip_freeze", False))
    )
    resolved_mask_keys = (
        mask_keys
        if mask_keys is not None
        else file_config.get("mask_keys", [])
    )
    resolved_project = project or os.getenv("QLAB_PROJECT") or file_config.get("project")
    resolved_tags = tags if tags is not None else file_config.get("tags", [])
    resolved_timeout = timeout if timeout is not None else float(file_config.get("timeout", 3.0))
    resolved_queue_path = queue_path or os.getenv("QLAB_QUEUE_PATH") or file_config.get("queue_path")
    resolved_zk_qco = (
        zk_qco
        if zk_qco is not None
        else os.getenv("QLAB_ZK_QCO", "").lower() in ("1", "true", "yes")
        or bool(file_config.get("zk_qco", False))
    )
    resolved_zk_qco_salt = zk_qco_salt or os.getenv("QLAB_ZK_QCO_SALT") or file_config.get("zk_qco_salt", "")

    _CONFIG["api_url"] = resolved_api_url.rstrip("/")
    _CONFIG["include_pip_freeze"] = resolved_include_pip_freeze
    _CONFIG["mask_keys"] = set(resolved_mask_keys or [])
    _CONFIG["project"] = resolved_project
    _CONFIG["tags"] = resolved_tags or []
    _CONFIG["zk_qco"] = resolved_zk_qco
    _CONFIG["zk_qco_salt"] = resolved_zk_qco_salt

    _CLIENT = QLabClient(
        api_url=resolved_api_url,
        timeout=resolved_timeout,
        api_key=resolved_api_key,
        queue_path=resolved_queue_path,
    )
    atexit.register(flush)

    try:
        from qiskit_ibm_runtime import SamplerV2, EstimatorV2

        _patch_runtime_primitive(SamplerV2)
        _patch_runtime_primitive(EstimatorV2)
    except Exception:
        pass

    try:
        from qiskit_ibm_runtime import Sampler, Estimator

        _patch_runtime_primitive(Sampler)
        _patch_runtime_primitive(Estimator)
    except Exception:
        pass

    try:
        from qiskit.providers import BackendV1

        _patch_backend_run(BackendV1)
    except Exception:
        pass

    try:
        from qiskit.providers import BackendV2

        _patch_backend_run(BackendV2)
    except Exception:
        pass

    _patch_transpile()

    _INITIALIZED = True


def auto_track(api_key: Optional[str] = None, project: Optional[str] = None) -> None:
    """One-liner setup: initialise Q-Lab and auto-patch Qiskit so every circuit
    execution is logged without any further code changes.

    Example::

        import qlab
        qlab.auto_track(api_key="qlab_abc123...")

        # All subsequent Qiskit Sampler/Estimator/backend.run() calls are
        # automatically captured and sent to Q-Lab.
    """
    init(
        api_key=api_key or os.getenv("QLAB_API_KEY"),
        api_url=os.getenv("QLAB_API_URL", "https://www.soqlab.com/qlab-api"),
        project=project,
    )


# ---------------------------------------------------------------------------
# Policy helpers
# ---------------------------------------------------------------------------

class PolicyViolationError(Exception):
    """Raised when a run payload violates the active policy and enforcement is on."""


def check_policy(payload: dict) -> list[dict]:
    """Check a run payload against the server policy.

    Returns a list of violation dicts (empty = passed).
    Requires qlab.init() to have been called first.
    """
    if _CLIENT is None:
        return []
    result = _CLIENT.check_policy(payload)
    return result.get("violations", [])


def get_policy() -> dict:
    """Fetch the current active policy from the server."""
    if _CLIENT is None:
        return {}
    return _CLIENT.get_policy()


# ------------------------------------------------------------------
# Campaigns
# ------------------------------------------------------------------

def create_campaign(
    name: str,
    grid: list[dict],
    description: str | None = None,
    project: str | None = None,
    tags: list[str] | None = None,
) -> dict:
    """Create an experiment campaign and return its campaign_id and grid combinations.

    Example::

        import qlab

        qlab.init()

        result = qlab.create_campaign(
            name="QAOA depth sweep",
            grid=[
                {"name": "reps", "values": [1, 2, 3, 4]},
                {"name": "backend", "values": ["ibm_kyoto", "ibm_osaka"]},
            ],
            project="qaoa-study",
        )
        campaign_id = result["campaign_id"]
        print(f"Created campaign {campaign_id} with {result['total_combinations']} combinations")

        for params in result["combinations"]:
            with qlab.run(my_circuit) as r:
                r.context["campaign_id"] = campaign_id
                r.context.update(params)
    """
    if _CLIENT is None:
        raise RuntimeError("Call qlab.init() before creating a campaign")
    return _CLIENT.create_campaign(
        name=name,
        grid=grid,
        description=description,
        project=project or _CONFIG.get("project"),
        tags=tags,
    )


def campaign_combinations(campaign_id: str) -> list[dict]:
    """Fetch grid combinations for an existing campaign."""
    if _CLIENT is None:
        raise RuntimeError("Call qlab.init() before fetching campaign combinations")
    return _CLIENT.campaign_combinations(campaign_id)


def get_campaign(campaign_id: str) -> dict:
    """Get campaign status, run count, and sweep matrix."""
    if _CLIENT is None:
        raise RuntimeError("Call qlab.init() before fetching a campaign")
    return _CLIENT.get_campaign(campaign_id)
