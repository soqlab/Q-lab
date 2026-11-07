"""IonQ through qiskit-ionq: provider, device, noise model and characterization on each run.

qiskit-ionq backends (``IonQProvider().get_backend("ionq_simulator")``, ``"ionq_qpu.forte-1"``,
...) are Qiskit ``BackendV2`` backends, so the Qiskit hooks already record every
``backend.run``: the circuit (with QPY/OpenQASM when it was transpiled), shots, the IonQ job id
(``execution.job_id``) and, when ``job.result()`` returns, the counts. This module adds what
is specific to IonQ, in ``context``:

* ``provider: "ionq"`` and ``device``: backend name, the API name (``qpu.forte-1``), type
  (SIMULATOR / QPU), gateset, and for the simulator the noise model (``ideal``, ``aria-1``,
  ``forte-1``, ...) taken from the ``run()`` options or the backend options;
* ``error_mitigation`` when it is set;
* for QPUs, calibration from IonQ's latest characterization
  (``backend.calibration()``: SPAM / 1q / 2q median fidelities and T1/T2/gate timings),
  stored as errors (1 - fidelity) in Q-Lab's calibration shape. Simulators have none.

IonQ simulator counts come from probabilities when the noise model is ``ideal``, so they may
not be whole numbers of shots (qiskit-ionq documents this).
"""

from __future__ import annotations

import contextlib
from typing import Any

from .. import qiskit_hooks as qh

PROVIDER = "ionq"
SETUP_PACKAGES = ("qiskit-ionq",)


def patch() -> bool:
    """Register the IonQ detector with the Qiskit hooks. False when qiskit-ionq is absent."""
    try:
        import qiskit_ionq  # noqa: F401
    except Exception:
        return False
    if _detect not in qh._PROVIDER_DETECTORS:
        qh._PROVIDER_DETECTORS.append(_detect)
    return True


def _is_ionq(backend: Any) -> bool:
    return any(c.__module__.startswith("qiskit_ionq") for c in type(backend).__mro__)


def _option(backend: Any, kwargs: dict, name: str) -> Any:
    if name in kwargs and kwargs[name] is not None:
        return kwargs[name]
    return getattr(getattr(backend, "options", None), name, None)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    value = getattr(value, "value", value)
    return str(value)


def device_info(backend: Any, kwargs: dict | None = None) -> dict[str, Any]:
    kwargs = kwargs or {}
    simulator = bool(getattr(backend, "_simulator", "simulator" in (qh._name_of(backend) or "")))
    info: dict[str, Any] = {
        "name": qh._name_of(backend),
        "api_name": getattr(backend, "_api_backend_name", None),
        "type": "SIMULATOR" if simulator else "QPU",
        "provider_name": "IonQ",
        "gateset": getattr(backend, "_gateset", None),
    }
    if simulator:
        info["noise_model"] = _text(_option(backend, kwargs, "noise_model")) or "ideal"
    mitigation = _option(backend, kwargs, "error_mitigation")
    if mitigation is not None:
        info["error_mitigation"] = _text(mitigation)
    with contextlib.suppress(Exception):
        info["qubit_count"] = int(backend.num_qubits)
    return {k: v for k, v in info.items() if v is not None}


def calibration_from_characterization(char: Any) -> dict[str, Any]:
    """Q-Lab calibration from a qiskit-ionq Characterization (or its JSON dict)."""
    data = getattr(char, "_data", char)
    if not isinstance(data, dict):
        return {}
    fidelity = data.get("fidelity") or {}
    timing = data.get("timing") or {}

    def fid(key: str) -> float | None:
        block = fidelity.get(key) or {}
        return qh._num(block.get("median", block.get("mean")))

    cal: dict[str, Any] = {}
    spam = fid("spam")
    if spam is not None:
        cal["readout_errors"] = {"avg": 1 - spam}
    gates = {k: 1 - v for k, v in (("1q", fid("1q")), ("2q", fid("2q"))) if v is not None}
    if gates:
        cal["gate_errors"] = gates
    for key, out in (("t1", "t1_us"), ("t2", "t2_us")):
        v = qh._to_us(timing.get(key, timing.get(key.upper())), "s")
        if v is not None:
            cal[out] = {"avg": v}
    durations = {k: qh._to_us(timing[k], "s") for k in ("1q", "2q", "readout", "reset") if k in timing}
    durations = {k: v for k, v in durations.items() if v is not None}
    if durations:
        cal["gate_durations_us"] = durations
    if not cal:
        return {}
    stamp = data.get("date")
    cal.update(snapshot_time=stamp, last_update=stamp, source="ionq_characterization",
               characterization_id=data.get("id"), qubits=data.get("qubits"))
    return {k: v for k, v in cal.items() if v is not None}


def _detect(backend: Any, kwargs: dict):
    if backend is None or not _is_ionq(backend):
        return None
    device = device_info(backend, kwargs)
    calibration: dict[str, Any] = {}
    if device.get("type") == "QPU":
        try:
            calibration = calibration_from_characterization(backend.calibration())
        except Exception:
            calibration = {}
    return {"provider": PROVIDER, "framework": "qiskit-ionq", "device": device,
            "setup_packages": SETUP_PACKAGES}, calibration
