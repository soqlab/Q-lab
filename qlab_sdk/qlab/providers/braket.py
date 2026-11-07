"""Amazon Braket: every ``device.run`` / ``device.run_batch`` becomes a Q-Lab run.

``qlab.init()`` wraps ``run`` and ``run_batch`` on ``braket.devices.Device`` and all its
subclasses (``LocalSimulator``, ``AwsDevice``, and any defined later), the same way the Qiskit
hooks wrap ``BackendV2.run``. Each task specification gives one run with:

* the circuit as OpenQASM 3 (``Circuit.to_ir(IRType.OPENQASM)``, or the source of an OpenQASM
  ``Program``), its fingerprint (qubits, depth, gate counts) and the inputs;
* shots (as passed, or the device default: 0 = exact results on simulators, 1000 on QPUs);
* the device: name, ARN, type (QPU / SIMULATOR / LOCAL_SIMULATOR), provider, region, qubit
  count, native gates and the Braket noise model when one is attached;
* calibration from the device properties when the device publishes it (Braket's standardized
  T1/T2, readout and gate fidelities; IonQ's provider fidelity and timing), as errors
  (1 - fidelity) in the same shape as Qiskit calibration;
* the task id (an ARN for AwsQuantumTask) and, when the result arrives, the measurement counts,
  measured qubits, result-type values and task metadata.

Braket counts are keyed with measured_qubits[0] as the LEFTMOST character, the opposite of
Qiskit; ``results.bit_order`` says so on every run.

Runs started through qiskit-braket-provider are captured once, by the Qiskit hooks: a Braket
call made while a Qiskit run is being recorded is not recorded again.
"""

from __future__ import annotations

import contextlib
import functools
import inspect
import re
import types
from datetime import datetime, timezone
from typing import Any

from .. import qiskit_hooks as qh
from ..fingerprint import NON_CLIFFORD_GATES

PROVIDER = "braket"
SETUP_PACKAGES = ("amazon-braket-sdk", "amazon-braket-default-simulator", "amazon-braket-schemas")
BIT_ORDER = "leftmost character = measured_qubits[0] (Braket order; Qiskit keys are reversed)"


def patch() -> bool:
    """Wrap run/run_batch of every Braket device class. False when Braket is not installed."""
    try:
        from braket.devices import Device
    except Exception:
        return False
    qh._patch_family(Device, "braket", _wrap_device)
    return True


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _nested() -> bool:
    # A Qiskit run being recorded (qiskit-braket-provider), or a Braket call made by Q-Lab itself.
    return bool(getattr(qh._LOCAL, "depth", 0) or getattr(qh._LOCAL, "internal", False))


def _wrap_device(cls, _kind: str) -> None:
    for method, make in (("run", _make_run), ("run_batch", _make_run_batch)):
        original = cls.__dict__.get(method)
        if (original is None or getattr(original, "_qlab_patched", False)
                or getattr(original, "__isabstractmethod__", False)):
            continue
        wrapper = make(original)
        wrapper._qlab_patched = True
        setattr(cls, method, wrapper)


def _bind(original, self, args, kwargs) -> dict[str, Any]:
    try:
        bound = inspect.signature(original).bind(self, *args, **kwargs)
    except (TypeError, ValueError):
        return dict(kwargs)
    out = dict(bound.arguments)
    for name, param in inspect.signature(original).parameters.items():
        if param.kind is inspect.Parameter.VAR_KEYWORD and name in out:
            out.update(out.pop(name))
    return out


# ── What is captured ────────────────────────────────────────────────────────────────────

def _spec_capture(spec: Any) -> dict[str, Any]:
    """Name, OpenQASM 3 source and fingerprint of one task specification."""
    kind = type(spec).__name__
    out: dict[str, Any] = {"spec_type": kind, "qasm": None, "fingerprint": {}, "name": None}
    try:
        from braket.circuits import Circuit
        from braket.circuits.serialization import IRType
    except Exception:
        return out
    if isinstance(spec, Circuit):
        try:
            out["qasm"] = spec.to_ir(IRType.OPENQASM).source
        except Exception:
            out["qasm"] = None
        out["fingerprint"] = _circuit_fingerprint(spec)
        out["name"] = "braket_circuit"
        return out
    source = getattr(spec, "source", None)
    if isinstance(source, str):  # braket.ir.openqasm.Program
        out["qasm"] = source
        qubits = sum(int(n) for n in re.findall(r"\bqubit\[(\d+)\]", source))
        out["fingerprint"] = {"num_qubits": qubits} if qubits else {}
        out["name"] = "openqasm_program"
        return out
    out["name"] = kind  # AHS program, annealing problem, program set, pulse sequence
    return out


def _circuit_fingerprint(circuit: Any) -> dict[str, Any]:
    counts: dict[str, int] = {}
    for instruction in getattr(circuit, "instructions", []) or []:
        name = str(getattr(getattr(instruction, "operator", None), "name", "op")).lower()
        counts[name] = counts.get(name, 0) + 1
    total = sum(counts.values())
    non_clifford = sum(n for g, n in counts.items() if g in NON_CLIFFORD_GATES)
    try:
        measured = len(circuit.measure_targets) if getattr(circuit, "measure_targets", None) else None
    except Exception:
        measured = None
    qubits = int(getattr(circuit, "qubit_count", 0) or 0)
    return {
        "num_qubits": qubits,
        "num_clbits": measured if measured is not None else qubits,
        "depth": int(getattr(circuit, "depth", 0) or 0),
        "size": total,
        "gate_counts": counts,
        "non_clifford_count": non_clifford,
        "non_clifford_ratio": non_clifford / total if total else 0,
    }


def _text(value: Any) -> str | None:
    if value is None:
        return None
    value = getattr(value, "value", value)  # enums
    return str(value)


def _device_info(device: Any) -> dict[str, Any]:
    info: dict[str, Any] = {"name": _text(getattr(device, "name", None))}
    try:
        from braket.devices import LocalSimulator
        local = isinstance(device, LocalSimulator)
    except Exception:
        local = False
    if local:
        info.update(type="LOCAL_SIMULATOR", provider_name="Amazon Braket (local)",
                    simulator=_text(getattr(getattr(device, "_delegate", None), "DEVICE_ID", None)))
    else:
        for key, attr in (("arn", "arn"), ("type", "type"), ("provider_name", "provider_name"),
                          ("status", "status")):
            with contextlib.suppress(Exception):
                info[key] = _text(getattr(device, attr, None))
        arn = info.get("arn") or ""
        m = re.match(r"arn:aws:braket:([a-z0-9-]*):", arn)
        if m and m.group(1):
            info["region"] = m.group(1)
    try:
        paradigm = getattr(device.properties, "paradigm", None)
        if paradigm is not None:
            if getattr(paradigm, "qubitCount", None) is not None:
                info["qubit_count"] = int(paradigm.qubitCount)
            gates = getattr(paradigm, "nativeGateSet", None)
            if gates:
                info["native_gates"] = list(gates)
    except Exception:
        pass
    noise = getattr(device, "_noise_model", None)
    if noise is not None:
        try:
            info["noise_model"] = str(noise).strip()
            info["noise_model_spec"] = noise.to_dict()
        except Exception:
            info["noise_model"] = repr(noise)
    return {k: v for k, v in info.items() if v is not None}


def _fidelity_name(entry: dict) -> str:
    kind = entry.get("fidelityType") or {}
    name = kind.get("name") if isinstance(kind, dict) else kind
    return str(getattr(name, "value", name) or "").upper()


def _us(value: Any, unit: Any) -> float | None:
    return qh._to_us(value, str(getattr(unit, "value", unit) or "us").lower())


def calibration_from_properties(properties: Any) -> dict[str, Any]:
    """Q-Lab calibration (t1_us, t2_us, readout_errors, gate_errors, gate_durations_us) from
    Braket device properties: the standardized properties (v1/v2 per qubit, v3 device-wide),
    else IonQ's provider properties. {} when the device publishes none (simulators)."""
    cal: dict[str, Any] = {}
    standardized = getattr(properties, "standardized", None)
    std = standardized.dict() if hasattr(standardized, "dict") else (standardized or {})
    t1: dict[str, float] = {}
    t2: dict[str, float] = {}
    readout: dict[str, float] = {}
    gate_errors: dict[str, float] = {}
    durations: dict[str, float] = {}

    for q, props in (std.get("oneQubitProperties") or {}).items():
        for key, target in (("T1", t1), ("T2", t2)):
            ct = props.get(key) or {}
            v = _us(ct.get("value"), ct.get("unit"))
            if v is not None:
                target[str(q)] = v
        for f in props.get("oneQubitFidelity") or []:
            name, fid = _fidelity_name(f), qh._num(f.get("fidelity"))
            if fid is None:
                continue
            if "READOUT" in name:
                readout[str(q)] = 1 - fid
            elif "RANDOMIZED_BENCHMARKING" in name and f"1q_{q}" not in gate_errors:
                gate_errors[f"1q_{q}"] = 1 - fid
    for pair, props in (std.get("twoQubitProperties") or {}).items():
        for f in props.get("twoQubitGateFidelity") or []:
            fid = qh._num(f.get("fidelity"))
            if fid is not None:
                gate = str(f.get("gateName") or "2q").lower()
                gate_errors[f"{gate}_{str(pair).replace('-', '_')}"] = 1 - fid

    # v3: one figure for the whole device (IonQ), stored as {"avg": x}.
    for key, target in (("T1", t1), ("T2", t2)):
        d = std.get(key)
        if isinstance(d, dict) and not target:
            v = _us(d.get("value"), d.get("unit"))
            if v is not None:
                target["avg"] = v
    for key, label in (("readoutFidelity", None), ("singleQubitFidelity", "1q"),
                       ("twoQubitGateFidelity", "2q")):
        for f in std.get(key) or []:
            fid = qh._num(f.get("fidelity"))
            if fid is None:
                continue
            if label is None:
                readout.setdefault("avg", 1 - fid)
            else:
                gate_errors.setdefault(label, 1 - fid)
    for key, label in (("singleQubitGateDuration", "1q"), ("twoQubitGateDuration", "2q"),
                       ("readoutDuration", "readout")):
        d = std.get(key)
        if isinstance(d, dict):
            v = _us(d.get("value"), d.get("unit"))
            if v is not None:
                durations[label] = v

    source = "braket_standardized" if (t1 or t2 or readout or gate_errors) else None

    # IonQ provider properties: mean fidelities and timings in seconds.
    provider = getattr(properties, "provider", None)
    fidelity = getattr(provider, "fidelity", None) or {}
    timing = getattr(provider, "timing", None) or {}
    if fidelity or timing:
        if "spam" in fidelity and "avg" not in readout and not readout:
            v = qh._num((fidelity.get("spam") or {}).get("mean"))
            if v is not None:
                readout["avg"] = 1 - v
        for key in ("1Q", "2Q"):
            v = qh._num((fidelity.get(key) or {}).get("mean"))
            if v is not None:
                gate_errors.setdefault(key.lower(), 1 - v)
        for key, target in (("T1", t1), ("T2", t2)):
            if key in timing and not target:
                v = qh._to_us(timing[key], "s")
                if v is not None:
                    target["avg"] = v
        for key in ("1Q", "2Q", "readout", "reset"):
            if key in timing:
                v = qh._to_us(timing[key], "s")
                if v is not None:
                    durations.setdefault(key.lower(), v)
        source = source or "braket_provider"

    for name, value in (("t1_us", t1), ("t2_us", t2), ("readout_errors", readout),
                        ("gate_errors", gate_errors), ("gate_durations_us", durations)):
        if value:
            cal[name] = value
    if not cal:
        return {}
    updated = std.get("updatedAt") or getattr(getattr(properties, "service", None), "updatedAt", None)
    stamp = updated.isoformat() if hasattr(updated, "isoformat") else (str(updated) if updated else _now())
    cal.update(snapshot_time=stamp, last_update=stamp, source=source)
    return cal


def _calibration(device: Any) -> dict[str, Any]:
    try:
        return calibration_from_properties(device.properties)
    except Exception:
        return {}


def _shots(device: Any, spec: Any, bound: dict) -> tuple[int | None, str]:
    shots = bound.get("shots")
    if isinstance(shots, int) and not isinstance(shots, bool):
        return shots, "run"
    try:
        default = device._default_shots(spec)
    except TypeError:
        try:
            default = device._default_shots()
        except Exception:
            default = None
    except Exception:
        default = None
    return (default, "default") if isinstance(default, int) else (None, "unknown")


_PARAMETER_KEYS = ("inputs", "reservation_arn", "device_parameters", "disable_qubit_rewiring",
                   "max_parallel", "experimental_capabilities")


def _parameters(bound: dict) -> dict[str, Any]:
    out = {}
    for key in _PARAMETER_KEYS:
        value = bound.get(key)
        if value not in (None, {}, []):
            out[key] = value if not hasattr(value, "dict") else value.dict()
    return out


def _plain(value: Any) -> Any:
    """numpy arrays/scalars and Counters as JSON-friendly values."""
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if isinstance(value, complex):
        return [value.real, value.imag]
    return value


def result_summary(result: Any) -> dict[str, Any]:
    """Counts, measured qubits, result-type values and task metadata of one Braket result."""
    out: dict[str, Any] = {"result_class": type(result).__name__}
    try:
        counts = getattr(result, "measurement_counts", None)
        if counts:
            out["counts"] = {str(k): int(v) for k, v in counts.items()}
            out["bit_order"] = BIT_ORDER
    except Exception:
        pass
    try:
        measured = getattr(result, "measured_qubits", None)
        if measured is not None:
            out["measured_qubits"] = [int(q) for q in measured]
    except Exception:
        pass
    try:
        result_types = getattr(result, "result_types", None) or []
        values = []
        for rt in result_types:
            kind = getattr(rt, "type", None)
            values.append({"type": str(getattr(kind, "type", kind) or ""), "value": _plain(rt.value)})
        if values:
            out["result_types"] = values
    except Exception:
        pass
    meta = getattr(result, "task_metadata", None)
    if meta is not None:
        try:
            md = meta.dict()
            out["task_metadata"] = {k: _plain(md.get(k)) for k in (
                "id", "shots", "deviceId", "createdAt", "endedAt", "status", "failureReason",
                "executionDuration") if md.get(k) is not None}
        except Exception:
            pass
    return out


def _task_execution(task: Any, shots: int | None, shots_source: str) -> dict[str, Any]:
    execution: dict[str, Any] = {"task_class": type(task).__name__}
    with contextlib.suppress(Exception):
        execution["task_id"] = str(task.id)
    with contextlib.suppress(Exception):
        execution["task_state"] = str(task.state())
    if shots is not None:
        execution.update(shots=shots, shots_source=shots_source)
    return execution


def _task_state(task: Any) -> str:
    try:
        return str(task.state())
    except Exception:
        return "unknown state"


def _is_local_task(task: Any) -> bool:
    return type(task).__name__.startswith("Local")


def _send(spec_info: dict, device: dict, *, execution: dict, status: str, calibration: dict,
          parameters: dict, timing: dict, results: dict | None = None) -> str:
    return qh._send_capture(
        circuit_name=spec_info.get("name"),
        qasm=spec_info.get("qasm"),
        fingerprint=dict(spec_info.get("fingerprint") or {}),
        backend_name=f"braket:{device.get('name') or 'device'}",
        parameters={**parameters, "task_specification_type": spec_info.get("spec_type")},
        execution=execution,
        status=status,
        calibration=calibration,
        transpiler={"source": {"format": "openqasm3", "text": spec_info["qasm"]}}
        if spec_info.get("qasm") else {},
        timing=timing,
        context_extra={"provider": PROVIDER, "framework": "amazon-braket-sdk", "device": device},
        setup_packages=SETUP_PACKAGES,
        results=results,
    )


def _complete(run_id: str, result: Any, result_time: str) -> None:
    if qh._CLIENT is None or not run_id:
        return
    try:
        summary = result_summary(result)
    except Exception:
        summary = {}
    qh._CLIENT.update_run_async(run_id, {
        "status": "completed", "results": qh._sanitize(summary), "timing": {"result_time": result_time},
    })


def _fail(run_ids: list[str], error: Exception) -> None:
    if qh._CLIENT is None:
        return
    for run_id in run_ids:
        if run_id:
            qh._CLIENT.update_run_async(run_id, {
                "status": "failed", "execution": qh._error_metadata(error),
                "timing": {"result_time": _now()},
            })


def _patch_task_result(task: Any, run_id: str) -> None:
    original = getattr(task, "result", None)
    if original is None or getattr(original, "_qlab_patched", False):
        return

    reported = []  # result() may be called again; the run is completed once

    def result(self, *args, **kwargs):
        try:
            value = original(*args, **kwargs)
        except Exception as error:
            if not reported:
                reported.append(True)
                _fail([run_id], error)
            raise
        if not reported:
            reported.append(True)
            if value is None:  # Braket returns None for FAILED/CANCELLED tasks
                _fail([run_id], RuntimeError(f"task ended without a result ({_task_state(self)})"))
            else:
                _complete(run_id, value, _now())
        return value

    result._qlab_patched = True
    with contextlib.suppress(Exception):
        task.result = types.MethodType(result, task)


def _make_run(original):
    @functools.wraps(original)
    def run(self, *args, **kwargs):
        if qh._CLIENT is None or _nested():
            return original(self, *args, **kwargs)
        prepared = None
        try:
            bound = _bind(original, self, args, kwargs)
            spec = bound.get("task_specification", args[0] if args else None)
            shots, shots_source = _shots(self, spec, bound)
            prepared = dict(spec=_spec_capture(spec), device=_device_info(self),
                            calibration=_calibration(self), parameters=_parameters(bound),
                            shots=shots, shots_source=shots_source, submit_time=_now())
        except Exception:
            prepared = None

        qh._LOCAL.depth = getattr(qh._LOCAL, "depth", 0) + 1
        try:
            task = original(self, *args, **kwargs)
        except Exception as error:
            if prepared is not None:
                _send(prepared["spec"], prepared["device"], status="failed",
                      execution={**qh._error_metadata(error),
                                 **({"shots": prepared["shots"]} if prepared["shots"] is not None else {})},
                      calibration=prepared["calibration"], parameters=prepared["parameters"],
                      timing={"submit_time": prepared["submit_time"]})
            raise
        finally:
            qh._LOCAL.depth -= 1
        if prepared is None:
            return task

        try:
            execution = _task_execution(task, prepared["shots"], prepared["shots_source"])
            local = _is_local_task(task)
            results = result_summary(task.result()) if local else None  # local tasks are already done
            run_id = _send(prepared["spec"], prepared["device"], execution=execution,
                           status="completed" if local else "submitted",
                           calibration=prepared["calibration"], parameters=prepared["parameters"],
                           timing={"submit_time": prepared["submit_time"],
                                   **({"result_time": _now()} if local else {})},
                           results=results)
            if not local:
                _patch_task_result(task, run_id)
        except qh.PolicyViolationError:
            raise
        except Exception:
            pass
        return task

    return run


def _specs_of(bound: dict) -> list[Any]:
    specs = bound.get("task_specifications")
    if isinstance(specs, (list, tuple)):
        return list(specs)
    return [specs] if specs is not None else []


def _make_run_batch(original):
    @functools.wraps(original)
    def run_batch(self, *args, **kwargs):
        if qh._CLIENT is None or _nested():
            return original(self, *args, **kwargs)
        prepared = None
        try:
            bound = _bind(original, self, args, kwargs)
            specs = _specs_of(bound)
            shots, shots_source = _shots(self, specs[0] if specs else None, bound)
            prepared = dict(specs=[_spec_capture(s) for s in specs], device=_device_info(self),
                            calibration=_calibration(self), parameters=_parameters(bound),
                            shots=shots, shots_source=shots_source, submit_time=_now())
        except Exception:
            prepared = None

        qh._LOCAL.depth = getattr(qh._LOCAL, "depth", 0) + 1
        try:
            batch = original(self, *args, **kwargs)
        except Exception as error:
            if prepared is not None:
                for spec in prepared["specs"]:
                    _send(spec, prepared["device"], status="failed", execution=qh._error_metadata(error),
                          calibration=prepared["calibration"], parameters=prepared["parameters"],
                          timing={"submit_time": prepared["submit_time"]})
            raise
        finally:
            qh._LOCAL.depth -= 1
        if prepared is None:
            return batch

        try:
            tasks = list(getattr(batch, "tasks", None) or [])
            local = not tasks  # LocalQuantumTaskBatch holds results, not tasks
            results = [result_summary(r) for r in batch.results()] if local else []
            run_ids = []
            for i, spec in enumerate(prepared["specs"]):
                task = tasks[i] if i < len(tasks) else None
                execution = (_task_execution(task, prepared["shots"], prepared["shots_source"])
                             if task is not None else
                             {"task_class": "LocalQuantumTask", "shots": prepared["shots"],
                              "shots_source": prepared["shots_source"], "batch_index": i})
                if local and i < len(results):
                    tid = (results[i].get("task_metadata") or {}).get("id")
                    if tid:
                        execution["task_id"] = tid
                run_ids.append(_send(
                    spec, prepared["device"], execution=execution,
                    status="completed" if local else "submitted",
                    calibration=prepared["calibration"], parameters=prepared["parameters"],
                    timing={"submit_time": prepared["submit_time"]},
                    results=results[i] if local and i < len(results) else None))
            if not local:
                for task, run_id in zip(tasks, run_ids, strict=False):
                    _patch_task_result(task, run_id)
        except qh.PolicyViolationError:
            raise
        except Exception:
            pass
        return batch

    return run_batch
