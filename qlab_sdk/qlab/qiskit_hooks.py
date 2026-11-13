import atexit
import contextlib
import hashlib
import os
import sys
import threading
import time
import types
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from .client import QLabClient
from .config import load_config
from .fingerprint import fingerprint_circuit, setup_fingerprint, setup_material
from .context import capture_context

_CLIENT: Optional[QLabClient] = None
_INITIALIZED = False
_TELEMETRY_URL = "https://qlab.soqlab.com/qlab-api/ping"


def _sdk_version() -> str:
    from . import __version__
    return __version__


# Hosts of the hosted service. Only users of qlab.soqlab.com send the install ping; a
# self-hosted setup never contacts SOQLAB.
_HOSTED_API_HOSTS = ("qlab.soqlab.com", "qlab-backend.onrender.com")


def _uses_hosted_service(api_url: str) -> bool:
    from urllib.parse import urlparse
    return (urlparse(api_url or "").hostname or "") in _HOSTED_API_HOSTS


def _fire_telemetry_ping() -> None:
    """Send one anonymous ping per process so we can count active installs of the hosted service.

    Sent only when the SDK talks to the hosted service; self-hosted setups send nothing.
    Contains only the SDK and Python versions. Opt out with QLAB_TELEMETRY=off (or 0/false/no).
    """
    if os.getenv("QLAB_TELEMETRY", "").lower() in ("off", "0", "false", "no"):
        return
    if not _uses_hosted_service(_CONFIG.get("api_url", "")):
        return

    import sys
    import threading

    def _ping() -> None:
        try:
            import urllib.request, json as _json
            payload = _json.dumps({
                "sdk_version": _sdk_version(),
                "python": sys.version.split()[0],
            }).encode()
            req = urllib.request.Request(
                _TELEMETRY_URL,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            pass

    threading.Thread(target=_ping, daemon=True).start()
_transpiler_context = __import__("threading").local()
_CONFIG = {
    "api_url": "http://localhost:8000",
    "include_pip_freeze": False,
    "mask_keys": set(),
    "project": None,
    "tags": [],
    "zk_qco": False,
    "zk_qco_salt": "",
    # Set while re-running an earlier run (init(reproduces=...), qlab.reproducing(), QLAB_REPRODUCES):
    # every run uploaded is tagged as a reproduction of that run, and Q-Lab compares the two.
    "reproduces": None,
}

def _pop_transpiler_context() -> dict:
    if hasattr(_transpiler_context, "last"):
        data = _transpiler_context.last
        del _transpiler_context.last
        return data
    return {}


def _capture_calibration(backend) -> dict:
    """Calibration snapshot of a backend.

    Reads backend.properties() when the backend has it (BackendV1, IBM backends, fake
    backends), and otherwise falls back to backend.target (any BackendV2). Both give the same
    shape: t1_us, t2_us, readout_errors, gate_errors, gate_durations_us, last_update.
    """
    if backend is None:
        return {}
    cal = _calibration_from_properties(backend)
    if not cal:
        cal = _calibration_from_target(backend)
    return cal


def _num(value: Any) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def _to_us(value: Any, unit: Optional[str]) -> Optional[float]:
    f = _num(value)
    if f is None:
        return None
    scale = {"s": 1e6, "ms": 1e3, "us": 1.0, "µs": 1.0, "ns": 1e-3}.get((unit or "us").strip())
    return f * scale if scale is not None else f


def _calibration_from_target(backend) -> dict:
    """Calibration read from a BackendV2 Target. Target values are in seconds."""
    try:
        target = getattr(backend, "target", None)
        if target is None:
            return {}
        cal: dict[str, Any] = {}

        t1: dict[str, float] = {}
        t2: dict[str, float] = {}
        try:
            for i, qp in enumerate(target.qubit_properties or []):
                if qp is None:
                    continue
                v1 = _to_us(getattr(qp, "t1", None), "s")
                v2 = _to_us(getattr(qp, "t2", None), "s")
                if v1 is not None:
                    t1[str(i)] = v1
                if v2 is not None:
                    t2[str(i)] = v2
        except Exception:
            pass

        readout: dict[str, float] = {}
        gate_errors: dict[str, float] = {}
        durations: dict[str, float] = {}
        for name in list(getattr(target, "operation_names", []) or []):
            try:
                props_map = target[name]
            except Exception:
                continue
            for qargs, props in (props_map or {}).items():
                if props is None or qargs is None:
                    continue
                error = _num(getattr(props, "error", None))
                duration = _to_us(getattr(props, "duration", None), "s")
                if name == "measure":
                    if error is not None and len(qargs) == 1:
                        readout[str(qargs[0])] = error
                    continue
                key = f"{name}_{'_'.join(str(q) for q in qargs)}"
                if error is not None:
                    gate_errors[key] = error
                if duration is not None:
                    durations[key] = duration

        if t1:
            cal["t1_us"] = t1
        if t2:
            cal["t2_us"] = t2
        if readout:
            cal["readout_errors"] = readout
        if gate_errors:
            cal["gate_errors"] = gate_errors
        if durations:
            cal["gate_durations_us"] = durations
        if not cal:
            return {}
        now = datetime.now(timezone.utc).isoformat()
        cal["last_update"] = now
        cal["snapshot_time"] = now
        cal["source"] = "target"
        return cal
    except Exception:
        return {}


def _calibration_from_properties(backend) -> dict:
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
                    if param.name in ("T1", "T2"):
                        us = _to_us(param.value, getattr(param, "unit", "us") or "us")
                        if us is not None:
                            (t1 if param.name == "T1" else t2)[str(i)] = us
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
        durations: dict[str, float] = {}
        try:
            for gate in props.gates:
                key = f"{gate.gate}_{'_'.join(str(q) for q in gate.qubits)}"
                for param in gate.parameters:
                    if param.name == "gate_error":
                        gate_errors[key] = param.value
                    elif param.name == "gate_length":
                        us = _to_us(param.value, getattr(param, "unit", "ns") or "ns")
                        if us is not None:
                            durations[key] = us
        except Exception:
            pass
        if gate_errors:
            cal["gate_errors"] = gate_errors
        if durations:
            cal["gate_durations_us"] = durations
        if not cal:
            return {}

        try:
            lu = props.last_update_date
            cal["snapshot_time"] = lu.isoformat() if hasattr(lu, "isoformat") else str(lu)
        except Exception:
            cal["snapshot_time"] = datetime.now(timezone.utc).isoformat()
        cal["last_update"] = cal["snapshot_time"]
        cal["source"] = "properties"

        return cal
    except Exception:
        return {}


_SOURCE_MAX_BYTES = 512 * 1024  # per serialized circuit set; QLAB_SOURCE_MAX_BYTES overrides


def _source_cap() -> int:
    try:
        return int(os.getenv("QLAB_SOURCE_MAX_BYTES", "") or _SOURCE_MAX_BYTES)
    except ValueError:
        return _SOURCE_MAX_BYTES


def _circuit_to_qpy(circuits: Any) -> dict[str, Any]:
    """QPY (base64) of one circuit or a list, with the QPY format version; {} when unavailable.

    Over the size cap only the size is recorded, so a huge circuit never bloats the upload.
    """
    try:
        import base64
        import io
        from qiskit import qpy
    except Exception:
        return {}
    try:
        buf = io.BytesIO()
        qpy.dump(circuits, buf)
        raw = buf.getvalue()
    except Exception as error:
        return {"error": f"{error.__class__.__name__}: {error}"[:300]}
    info: dict[str, Any] = {
        "format": "qpy",
        "encoding": "base64",
        "qpy_version": _qpy_file_version(raw),
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    try:
        import qiskit
        info["qiskit_version"] = qiskit.__version__
    except Exception:
        pass
    if len(raw) > _source_cap():
        info["truncated"] = True
    else:
        info["data"] = base64.b64encode(raw).decode("ascii")
    return info


def _qpy_file_version(raw: bytes) -> Optional[int]:
    # QPY header: b"QISKIT" then one byte with the format version.
    if len(raw) > 6 and raw[:6] == b"QISKIT":
        return raw[6]
    try:
        from qiskit import qpy
        return int(qpy.QPY_VERSION)
    except Exception:
        return None


def _circuit_source(circuit) -> dict[str, Any]:
    """OpenQASM 3 (or 2) text of a circuit, size-capped."""
    text, fmt = None, None
    try:
        from qiskit import qasm3
        text, fmt = qasm3.dumps(circuit), "openqasm3"
    except Exception:
        try:
            from qiskit import qasm2
            text, fmt = qasm2.dumps(circuit), "openqasm2"
        except Exception:
            return {}
    if len(text.encode("utf-8")) > _source_cap():
        return {"format": fmt, "truncated": True, "bytes": len(text.encode("utf-8"))}
    return {"format": fmt, "text": text}


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

def _iter_pubs(args: tuple, kwargs: dict):
    """Yield (circuit, pub) for every circuit passed to run(); pub is None for a bare circuit.

    A pub is a primitive V2 PUB: a tuple whose first item is the circuit, or a
    SamplerPub/EstimatorPub object with a .circuit attribute.
    """
    # Sampler/Estimator usually receive circuits in args or kwargs.
    candidates = list(args)
    for key in ["circuits", "pubs", "circuit", "run_input"]:
        if key in kwargs:
            candidates.append(kwargs[key])

    def _one(item):
        if _looks_like_circuit(item):
            return item, None
        if isinstance(item, (list, tuple)) and item and _looks_like_circuit(item[0]):
            return item[0], item
        inner = getattr(item, "circuit", None)
        if inner is not None and _looks_like_circuit(inner):
            return inner, item
        return None, None

    for candidate in candidates:
        circuit, pub = _one(candidate)
        if circuit is not None and pub is None:
            yield circuit, None
            continue
        if circuit is not None and not isinstance(pub, (list, tuple)):
            yield circuit, pub  # a single Pub object
            continue
        if isinstance(candidate, (list, tuple)):
            for item in candidate:
                circuit, pub = _one(item)
                if circuit is not None:
                    yield circuit, pub


def _extract_circuits_from_args(args: tuple, kwargs: dict) -> list[Any]:
    return [circuit for circuit, _ in _iter_pubs(args, kwargs)]


def _positive_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 and n == value else None


def _positive_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    f = _num(value)
    return f if f is not None and f > 0 else None


def _option(obj: Any, *path: str) -> Any:
    """obj.a.b..., tolerating missing attributes, dict options and runtime's Unset."""
    for name in path:
        if obj is None:
            return None
        obj = obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)
    return obj


def _is_estimator(primitive: Any) -> bool:
    return any("Estimator" in c.__name__ for c in type(primitive).__mro__)


def _default_shots(obj: Any, kind: str) -> tuple[Optional[int], Optional[float]]:
    """The shots (and, for an Estimator, the precision) a run() uses when none are passed."""
    if kind == "backend":
        return _positive_int(_option(obj, "options", "shots")), None
    shots = None
    for path in (("default_shots",), ("options", "default_shots"), ("_options", "default_shots"),
                 ("options", "shots"), ("_options", "shots")):
        try:
            shots = _positive_int(_option(obj, *path))
        except Exception:
            shots = None
        if shots is not None:
            break
    precision = None
    if _is_estimator(obj):
        for path in (("default_precision",), ("options", "default_precision"),
                     ("_options", "default_precision")):
            try:
                precision = _positive_float(_option(obj, *path))
            except Exception:
                precision = None
            if precision is not None:
                break
    return shots, precision


def _extract_shots(obj: Any, kind: str, args: tuple, kwargs: dict) -> list[dict[str, Any]]:
    """Shots/precision of each circuit passed to run(), in the order of _extract_circuits_from_args.

    Priority: a value inside the pub, then the run() keyword, then the object's default.
    """
    estimator = kind != "backend" and _is_estimator(obj)
    try:
        default_shots, default_precision = _default_shots(obj, kind)
    except Exception:
        default_shots, default_precision = None, None
    kw_shots = _positive_int(kwargs.get("shots"))
    kw_precision = _positive_float(kwargs.get("precision")) if estimator else None

    out: list[dict[str, Any]] = []
    for _circuit, pub in _iter_pubs(args, kwargs):
        pub_shots = pub_precision = None
        if pub is not None:
            if isinstance(pub, (list, tuple)):
                # SamplerPub: (circuit, parameter_values, shots); EstimatorPub: (circuit, observables, parameter_values, precision)
                if estimator and len(pub) >= 4:
                    pub_precision = _positive_float(pub[3])
                elif not estimator and len(pub) >= 3:
                    pub_shots = _positive_int(pub[2])
            else:
                pub_shots = _positive_int(getattr(pub, "shots", None))
                pub_precision = _positive_float(getattr(pub, "precision", None))
        entry: dict[str, Any] = {}
        if pub_shots is not None:
            entry.update(shots=pub_shots, shots_source="pub")
        elif kw_shots is not None:
            entry.update(shots=kw_shots, shots_source="run")
        elif default_shots is not None and not (estimator and (pub_precision or kw_precision)):
            entry.update(shots=default_shots, shots_source="default")
        if estimator:
            precision = pub_precision or kw_precision
            if precision is None and "shots" not in entry:
                precision = default_precision
            if precision is not None:
                entry["precision"] = precision
                entry["precision_source"] = "pub" if pub_precision else ("run" if kw_precision else "default")
        out.append(entry)
    return out

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

def _int_seed(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        import numbers
        if isinstance(value, numbers.Integral):
            return int(value)
    except Exception:
        pass
    return None


def _object_seeds(obj: Any, kind: str, backend_obj: Any) -> dict[str, int]:
    """Seeds set on the primitive or backend itself rather than passed to run().

    StatevectorSampler(seed=...), Aer's SamplerV2(seed=...), runtime's options.simulator.seed_simulator
    and AerSimulator(seed_simulator=...): without them a simulator run can't be re-run exactly.
    """
    out: dict[str, int] = {}
    if kind != "backend":
        for path in (("_seed",), ("seed",)):
            seed = _int_seed(_option(obj, *path))
            if seed is not None:
                out["seed"] = seed
                break
        sim = _int_seed(_option(obj, "options", "simulator", "seed_simulator"))
        if sim is not None:
            out["seed_simulator"] = sim
    sim = _int_seed(_option(backend_obj, "options", "seed_simulator"))
    if sim is not None:
        out.setdefault("seed_simulator", sim)
    return out


def _primitive_info(obj: Any, kind: str) -> dict[str, str]:
    """How the circuit was run: backend.run(), a Sampler or an Estimator, and which class."""
    cls = type(obj)
    role = "backend" if kind == "backend" else ("estimator" if _is_estimator(obj) else "sampler")
    return {"kind": role, "class": f"{cls.__module__}.{cls.__qualname__}"}


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

    qasm = _circuit_to_qasm(circuit)
    provider_ctx = _qiskit_provider_context()
    return _send_capture(
        circuit_name=getattr(circuit, "name", None),
        qasm=qasm,
        fingerprint=fingerprint_circuit(circuit, qasm=qasm),
        backend_name=backend_name,
        parameters=parameters,
        execution=execution,
        status=status,
        calibration=calibration,
        transpiler=transpiler,
        timing=timing,
        campaign_id=campaign_id,
        context_extra=provider_ctx,
        setup_packages=tuple(provider_ctx.pop("setup_packages", ())),
    )


# Set by _wrap_run for the duration of one patched run(): what provider adapters
# (qlab.providers.ionq) add to the run's context for that backend.
def _qiskit_provider_context() -> dict[str, Any]:
    return dict(getattr(_LOCAL, "provider_context", None) or {})


def _send_capture(
    circuit_name: Optional[str],
    qasm: Optional[str],
    fingerprint: dict[str, Any],
    backend_name: Optional[str] = None,
    parameters: Optional[dict[str, Any]] = None,
    execution: Optional[dict[str, Any]] = None,
    status: str = "submitted",
    calibration: Optional[dict[str, Any]] = None,
    transpiler: Optional[dict[str, Any]] = None,
    timing: Optional[dict[str, Any]] = None,
    campaign_id: Optional[str] = None,
    context_extra: Optional[dict[str, Any]] = None,
    setup_packages: tuple[str, ...] = (),
    results: Optional[dict[str, Any]] = None,
) -> str:
    """Build one run payload and queue it for upload. Shared by every framework adapter:
    the circuit-specific parts (source text, fingerprint) are computed by the caller."""
    if _CLIENT is None:
        return ""

    run_id = str(uuid.uuid4())
    upload_qasm, upload_fingerprint, privacy = _apply_zk_qco(qasm, fingerprint)
    context = capture_context(include_pip_freeze=_CONFIG["include_pip_freeze"])
    if context_extra:
        context.update(_sanitize(context_extra))
    transpiler = dict(transpiler or {})
    if privacy:
        # Hash-only mode: no circuit source leaves the machine, in any format.
        for key in ("qpy", "qasm", "source"):
            transpiler.pop(key, None)

    try:
        versions = dict(context.get("library_versions") or {})
        versions.setdefault("qlab-sdk", _sdk_version())
        exe = execution or {}
        params = parameters or {}
        material = setup_material(
            upload_fingerprint,
            backend_name=backend_name,
            transpiler_settings=transpiler.get("settings") or {},
            shots=_positive_int(exe.get("shots")) or _positive_int(params.get("shots")),
            precision=_positive_float(exe.get("precision")),
            package_versions=versions,
            extra_packages=setup_packages,
        )
        context["setup_fingerprint"] = setup_fingerprint(material)
        context["setup"] = material
    except Exception:
        pass

    payload = {
        "run_id": run_id,
        "circuit_name": circuit_name,
        "qasm": upload_qasm,
        "fingerprint": upload_fingerprint,
        "context": context,
        "backend": backend_name,
        "parameters": _sanitize(parameters or {}),
        "execution": _sanitize(execution or {}),
        "calibration": _sanitize(calibration or {}),
        "transpiler": _sanitize(transpiler),
        "timing": timing or {},
        "results": _sanitize(results or {}),
        "project": _CONFIG["project"],
        "tags": list(_CONFIG["tags"]),
        "status": status,
        "share_url": f"{_CONFIG['api_url'].rstrip('/')}/runs/{run_id}",
        "benchmark_id": campaign_id or _CONFIG.get("campaign_id"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if privacy:
        payload["context"]["zk_qco"] = privacy
    reproduces = _CONFIG.get("reproduces")
    if reproduces:
        payload["context"]["reproduction_of"] = str(reproduces)[:64]
        if "reproduction" not in payload["tags"]:
            payload["tags"].append("reproduction")

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


def _auth_headers() -> dict[str, str]:
    """The API key header for calls the SDK makes itself, outside QLabClient."""
    key = _CLIENT.api_key if _CLIENT is not None else None
    return {"X-QLab-API-Key": key} if key else {}


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
        with urllib.request.urlopen(urllib.request.Request(url, headers=_auth_headers()), timeout=5) as resp:
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
            headers={"Content-Type": "application/json", **_auth_headers()},
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
        _LOCAL.internal = True  # this thread's Aer run is Q-Lab's own, not the user's
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
                headers={"Content-Type": "application/json", **_auth_headers()},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=20)
        except ImportError:
            pass  # qiskit-aer not installed
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()


def _primitive_pub_results(result: Any) -> list[dict[str, Any]] | None:
    """Per-circuit results of a V2 primitive (a PrimitiveResult of PubResults), or None."""
    if not hasattr(result, "__iter__") or hasattr(result, "get_counts"):
        return None
    try:
        pubs = list(result)
    except Exception:
        return None
    out: list[dict[str, Any]] = []
    for pub in pubs:
        data = getattr(pub, "data", None)
        if data is None:
            return None
        entry: dict[str, Any] = {}
        try:
            names = list(data.keys()) if hasattr(data, "keys") else list(vars(data))
        except Exception:
            names = []
        for name in names:
            try:
                value = data[name] if hasattr(data, "__getitem__") else getattr(data, name)
            except Exception:
                continue
            if hasattr(value, "get_counts"):
                entry.setdefault("counts", _sanitize(value.get_counts()))
                entry.setdefault("register", name)
            elif name in ("evs", "stds"):
                entry[name] = _sanitize(value.tolist() if hasattr(value, "tolist") else value)
        metadata = getattr(pub, "metadata", None)
        if metadata:
            entry["metadata"] = _sanitize(metadata)
        out.append(entry)
    return out


def _results_per_run(result: Any, n_runs: int) -> list[dict[str, Any]]:
    """Split one job result into the results of each circuit it ran."""
    pubs = _primitive_pub_results(result)
    if pubs is not None and len(pubs) == n_runs:
        return [{"result_class": result.__class__.__name__, **pub} for pub in pubs]
    shared = _extract_result_metadata(result)
    counts = shared.get("counts")
    if isinstance(counts, list) and len(counts) == n_runs:  # backend.run with several circuits
        return [{**shared, "counts": c} for c in counts]
    return [shared] * n_runs


def _patch_job_result(job: Any, run_ids: list[str], circuits: list[Any] | None = None,
                      backend_name: Optional[str] = None) -> None:
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

        try:
            per_run = _results_per_run(result, len(run_ids))
        except Exception:
            per_run = [{}] * len(run_ids)

        for i, run_id in enumerate(run_ids):
            results = per_run[i]
            if _CLIENT is not None:
                _CLIENT.update_run_async(
                    run_id,
                    {
                        "status": "completed",
                        "results": results,
                        "timing": {"result_time": result_time},
                    },
                )
            # Compare real-hardware counts with a noisy simulation. Simulator runs are skipped.
            counts = results.get("counts") if isinstance(results, dict) else None
            if (isinstance(counts, dict) and counts and circuits and i < len(circuits)
                    and not _is_simulator(backend_name)):
                real_counts = {str(k): int(v) for k, v in counts.items()}
                _shadow_simulate(circuits[i], real_counts, sum(real_counts.values()), run_id)

        return result

    patched_result._qlab_patched = True
    try:
        setattr(job, "result", types.MethodType(patched_result, job))
    except Exception:
        pass


def _is_simulator(backend_name: Optional[str]) -> bool:
    name = (backend_name or "").lower()
    return not name or any(k in name for k in ("sim", "aer", "statevector", "fake", "estimator", "sampler"))


# --- Patching ----------------------------------------------------------------------------
# Qiskit classes override run() (AerSimulator.run, StatevectorSampler.run, ...), so patching
# the base classes is not enough: every subclass that defines its own run() is wrapped, both
# the ones already imported and the ones defined later (through __init_subclass__).
#
# One execution must give one run. Primitives call backend.run internally, sometimes from a
# worker thread, and Q-Lab's own shadow simulation runs Aer: those inner calls are not tracked.

_LOCAL = threading.local()
_NESTED_CALLERS = ("qiskit.primitives", "qiskit_ibm_runtime")


def _is_nested_call() -> bool:
    if getattr(_LOCAL, "depth", 0) or getattr(_LOCAL, "internal", False):
        return True
    frame = sys._getframe(2)
    while frame is not None:
        if frame.f_globals.get("__name__", "").startswith(_NESTED_CALLERS):
            return True
        frame = frame.f_back
    return False


def _name_of(backend: Any) -> Optional[str]:
    if backend is None:
        return None
    name = getattr(backend, "name", None)
    if callable(name):
        try:
            name = name()
        except Exception:
            name = None
    return name if isinstance(name, str) else None


def _primitive_backend(primitive: Any) -> Any:
    for attr in ("backend", "_backend", "mode", "_mode"):
        try:
            value = getattr(primitive, attr, None)
            if callable(value) and not hasattr(value, "run"):
                value = value()
        except Exception:
            continue
        if value is not None:
            return value
    return None


def _wrap_run(cls, kind: str) -> None:
    """Wrap the run() that cls itself defines, so each top-level call records one run per circuit."""
    original_run = cls.__dict__.get("run")
    if original_run is None or getattr(original_run, "_qlab_patched", False):
        return

    def patched_run(self, *args, **kwargs):
        if _is_nested_call():
            return original_run(self, *args, **kwargs)

        backend_obj = self if kind == "backend" else _primitive_backend(self)
        backend_name = _name_of(backend_obj) or (None if kind == "backend" else type(self).__name__)
        circuits: list[Any] = []
        shots: list[dict] = []
        parameters: dict = {}
        calibration: dict = {}
        transpiler_ctx: dict = {}
        submit_time = datetime.now(timezone.utc).isoformat()
        primitive: dict = {}
        try:
            circuits = _extract_circuits_from_args(args, kwargs)
            parameters = _extract_parameters(args, kwargs)
            for key, value in _object_seeds(self, kind, backend_obj).items():
                parameters.setdefault(key, value)
            primitive = _primitive_info(self, kind)
            calibration = _capture_calibration(backend_obj)
            transpiler_ctx = _pop_transpiler_context()
        except Exception:
            pass
        try:
            shots = _extract_shots(self, kind, args, kwargs)
        except Exception:
            shots = []
        if len(shots) != len(circuits):
            shots = [{}] * len(circuits)
        provider_ctx, provider_cal = _provider_details(backend_obj, kwargs)
        if provider_cal and not calibration:
            calibration = provider_cal

        _LOCAL.depth = getattr(_LOCAL, "depth", 0) + 1
        try:
            job = original_run(self, *args, **kwargs)
        except Exception as error:
            _LOCAL.provider_context = provider_ctx
            try:
                for circuit, shot_info in zip(circuits, shots):
                    _capture_circuit(
                        circuit,
                        backend_name=backend_name,
                        parameters=parameters,
                        execution={**_error_metadata(error), **shot_info, **({"primitive": primitive} if primitive else {})},
                        status="failed",
                        calibration=calibration,
                        transpiler=transpiler_ctx,
                        timing={"submit_time": submit_time},
                    )
            finally:
                _LOCAL.provider_context = None
            raise
        finally:
            _LOCAL.depth -= 1

        execution = _extract_job_metadata(job)
        _LOCAL.provider_context = provider_ctx
        try:
            run_ids = [
                _capture_circuit(
                    circuit,
                    backend_name=backend_name,
                    parameters=parameters,
                    execution={**execution, **shot_info, **({"primitive": primitive} if primitive else {})},
                    status="submitted",
                    calibration=calibration,
                    transpiler=transpiler_ctx,
                    timing={"submit_time": submit_time},
                )
                for circuit, shot_info in zip(circuits, shots)
            ]
        finally:
            _LOCAL.provider_context = None
        _patch_job_result(job, run_ids, circuits, backend_name)
        return job

    patched_run._qlab_patched = True
    cls.run = patched_run


# Provider adapters (qlab.providers.*) register here to add their provider name, device
# details and calibration to runs of their Qiskit backends (qiskit-ionq, qiskit-braket-provider).
# Each detector gets (backend, run kwargs) and returns None when the backend is not its own,
# else (context additions, calibration).
_PROVIDER_DETECTORS: list = []


def _provider_details(backend: Any, kwargs: dict) -> tuple[dict[str, Any], dict[str, Any]]:
    for detect in list(_PROVIDER_DETECTORS):
        try:
            found = detect(backend, kwargs)
        except Exception:
            found = None
        if found:
            ctx, cal = found
            return dict(ctx or {}), dict(cal or {})
    return {}, {}


def _patch_family(base, kind: str, wrap=None) -> None:
    """Wrap run() on base, on every subclass already defined, and on subclasses defined later.

    wrap(cls, kind) does the wrapping; Qiskit's _wrap_run by default (qlab.providers.braket
    passes its own for Braket devices)."""
    wrap = wrap or _wrap_run
    pending, seen = [base], set()
    while pending:
        cls = pending.pop()
        if cls in seen:
            continue
        seen.add(cls)
        wrap(cls, kind)
        try:
            pending.extend(cls.__subclasses__())
        except TypeError:
            pass

    if base.__dict__.get("_qlab_subclass_hook"):
        return
    previous = base.__dict__.get("__init_subclass__")

    def hook(subclass, **kw):
        if previous is not None:
            previous.__func__(subclass, **kw)
        else:
            super(base, subclass).__init_subclass__(**kw)
        wrap(subclass, kind)

    base.__init_subclass__ = classmethod(hook)
    base._qlab_subclass_hook = True


def _patch_providers() -> None:
    """Hook the provider SDKs that are installed (Amazon Braket, IonQ); see qlab.providers."""
    try:
        from . import providers
        providers.patch_installed()
    except Exception:
        pass


def _patch_qiskit() -> None:
    families = [
        ("qiskit.providers", "BackendV2", "backend"),
        ("qiskit.providers", "BackendV1", "backend"),          # Qiskit 1.x only
        ("qiskit.primitives", "BaseSamplerV2", "primitive"),
        ("qiskit.primitives", "BaseEstimatorV2", "primitive"),
        ("qiskit.primitives", "BaseSamplerV1", "primitive"),   # Qiskit 1.x only
        ("qiskit.primitives", "BaseEstimatorV1", "primitive"),
    ]
    for module_name, class_name, kind in families:
        try:
            module = __import__(module_name, fromlist=[class_name])
            _patch_family(getattr(module, class_name), kind)
        except Exception:
            pass


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


_TRANSPILE_SETTING_KEYS = (
    "optimization_level", "basis_gates", "routing_method", "layout_method", "translation_method",
    "seed_transpiler", "approximation_degree", "scheduling_method",
)


def _first_circuit(value: Any) -> Any:
    if _looks_like_circuit(value):
        return value
    if isinstance(value, (list, tuple)) and value and _looks_like_circuit(value[0]):
        return value[0]
    return None


def _record_transpile(call, circuit: Any, settings: dict) -> Any:
    """Run one compilation (transpile() or a preset pass manager's run()) and remember what it did
    for the next run() on this thread: settings, circuit stats and source before and after."""
    before: dict = {}
    qpy_before: dict = {}
    qasm_before: dict = {}
    try:
        first = _first_circuit(circuit)
        if first is not None:
            before = _circuit_stats(first)
            if not _CONFIG.get("zk_qco"):
                qpy_before = _circuit_to_qpy(first)
                qasm_before = _circuit_source(first)
    except Exception:
        pass

    start_time = datetime.now(timezone.utc).isoformat()
    t0 = time.monotonic()
    result = call()
    duration_ms = round((time.monotonic() - t0) * 1000, 2)

    after: dict = {}
    qpy_after: dict = {}
    qasm_after: dict = {}
    try:
        tc = _first_circuit(result)
        if tc is not None:
            after = _circuit_stats(tc)
            if not _CONFIG.get("zk_qco"):
                qpy_after = _circuit_to_qpy(tc)
                qasm_after = _circuit_source(tc)
    except Exception:
        pass

    _transpiler_context.last = {
        "settings": settings,
        "before": before,
        "after": after,
        "qpy": {"before": qpy_before, "after": qpy_after},
        "qasm": {"before": qasm_before, "after": qasm_after},
        "start_time": start_time,
        "end_time": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
    }
    return result


def _patch_transpile() -> None:
    try:
        import qiskit.compiler
        if getattr(qiskit.compiler.transpile, "_qlab_patched", False):
            return

        original = qiskit.compiler.transpile

        def patched(*args, **kwargs):
            settings = {k: kwargs[k] for k in _TRANSPILE_SETTING_KEYS if k in kwargs and kwargs[k] is not None}
            circuit = args[0] if args else kwargs.get("circuits")

            def call():
                _LOCAL.in_transpile = getattr(_LOCAL, "in_transpile", 0) + 1
                try:
                    return original(*args, **kwargs)
                finally:
                    _LOCAL.in_transpile -= 1

            return _record_transpile(call, circuit, settings)

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
    _patch_preset_pass_manager()


def _patch_preset_pass_manager() -> None:
    """generate_preset_pass_manager(...).run(circuit), the compile step in Qiskit's docs, is recorded
    like transpile(): its settings (optimization level, transpiler seed, methods) and the circuit
    before and after."""
    try:
        import qiskit.transpiler as qt
        import qiskit.transpiler.preset_passmanagers as pp
    except Exception:
        return
    original = getattr(pp, "generate_preset_pass_manager", None)
    if not callable(original) or getattr(original, "_qlab_patched", False):
        return

    def patched(*args, **kwargs):
        pm = original(*args, **kwargs)
        if getattr(_LOCAL, "in_transpile", 0):
            return pm  # transpile() builds one inside and records itself
        try:
            settings = {k: kwargs[k] for k in _TRANSPILE_SETTING_KEYS if kwargs.get(k) is not None}
            if args and "optimization_level" not in settings and _int_seed(args[0]) is not None:
                settings["optimization_level"] = int(args[0])
            settings["via"] = "generate_preset_pass_manager"
            inner_run = pm.run

            def run(circuits, *a, **kw):
                return _record_transpile(lambda: inner_run(circuits, *a, **kw), circuits, dict(settings))

            pm.run = run
        except Exception:
            pass
        return pm

    patched._qlab_patched = True
    pp.generate_preset_pass_manager = patched
    if getattr(qt, "generate_preset_pass_manager", None) is original:
        qt.generate_preset_pass_manager = patched


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
    reproduces: Optional[str] = None,
) -> None:
    """Start capturing. reproduces=<run id> (or QLAB_REPRODUCES) tags every run uploaded from here on
    as a reproduction of that run; Q-Lab then compares the two and says whether it reproduced."""
    global _CLIENT, _INITIALIZED

    resolved_reproduces = reproduces or os.getenv("QLAB_REPRODUCES") or None
    if resolved_reproduces:
        _CONFIG["reproduces"] = str(resolved_reproduces).strip() or None
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

    _patch_qiskit()
    _patch_transpile()
    _patch_providers()

    _INITIALIZED = True

    _fire_telemetry_ping()


@contextlib.contextmanager
def reproducing(run_id: str):
    """Tag the runs uploaded inside this block as reproductions of run_id (for notebooks)::

        with qlab.reproducing("3f2a..."):
            sampler.run([isa], shots=4000).result()
    """
    previous = _CONFIG.get("reproduces")
    _CONFIG["reproduces"] = str(run_id).strip() or None
    try:
        yield
    finally:
        _CONFIG["reproduces"] = previous


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
        api_url=os.getenv("QLAB_API_URL", ""),
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
