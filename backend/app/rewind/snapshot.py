"""One machine's calibration as a canonical JSON record: what Rewind keeps and replays from.

The record is built from what qiskit-ibm-runtime returns (backend.properties(), backend.configuration()
and backend.target), so a replay months later needs nothing from IBM:

    {
      "format": "qlab-rewind-snapshot/1",
      "provider": "ibm", "machine": "ibm_fez",
      "calibrated_at": "2026-11-14T05:41:12Z",      provider's last_update_date, UTC
      "num_qubits": 156,
      "basis_gates": [...], "coupling_map": [[0, 1], ...],
      "configuration": {...},                        the parts of configuration() a replay can use
      "configuration_read": "same_day" | "later",    backfill reads today's configuration
      "operation_names": [...],                      the target's instructions (incl. control flow)
      "properties": {...},                           backend.properties().to_dict(), as JSON
      "noise": {                                     the calibration in units a noise model needs
        "num_qubits", "t1_us": [..], "t2_us": [..], "frequency_ghz": [..],
        "readout": [[error, duration_ns] | null, ..],
        "readout_asym": [[p(1|0), p(0|1)] | null, ..],
        "gates": {"cz": {"0_1": [error, duration_ns], ..}, "sx": {"0": [..]}, ..}
      }
    }

"noise" has the same shape as app/machine_pick.py's snapshot, so target_from_snapshot() rebuilds a
Qiskit Target from it. The canonical form is JSON with sorted keys, no spaces, UTF-8, datetimes as
UTC ISO strings and NaN/inf as null; its SHA-256 identifies the calibration.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import date, datetime, timezone
from typing import Any, Optional

FORMAT = "qlab-rewind-snapshot/1"
PROVIDER = "ibm"
MACHINE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,60}$")

# configuration() is large (pulse channels, Hamiltonians); these are what a replay or a reader uses.
CONFIG_KEYS = (
    "backend_name", "backend_version", "n_qubits", "basis_gates", "coupling_map", "dt", "dtm",
    "processor_type", "supported_instructions", "supported_features", "timing_constraints",
    "max_shots", "max_experiments", "conditional", "meas_levels", "rep_delay_range",
    "default_rep_delay", "online_date", "quantum_volume", "clops_h", "clops_v", "description",
)

_TIME_TO_US = {"s": 1e6, "ms": 1e3, "us": 1.0, "µs": 1.0, "ns": 1e-3}
_TIME_TO_NS = {"s": 1e9, "ms": 1e6, "us": 1e3, "µs": 1e3, "ns": 1.0}
_FREQ_TO_GHZ = {"ghz": 1.0, "mhz": 1e-3, "khz": 1e-6, "hz": 1e-9}


class CaptureError(ValueError):
    """The provider returned nothing to keep (no calibration)."""


# ---------------------------------------------------------------------------
# Canonical JSON
# ---------------------------------------------------------------------------

def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc)


def jsonable(x: Any) -> Any:
    """Plain JSON values: datetimes as UTC ISO text, NaN/inf as None, numpy scalars as Python."""
    if x is None or isinstance(x, (bool, str)):
        return x
    if isinstance(x, int):
        return int(x)
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, datetime):
        return iso(x)
    if isinstance(x, date):
        return x.isoformat()
    if isinstance(x, complex):
        return [jsonable(x.real), jsonable(x.imag)]
    if isinstance(x, dict):
        return {str(k): jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [jsonable(v) for v in x]
    if isinstance(x, (set, frozenset)):
        return sorted((jsonable(v) for v in x), key=lambda v: json.dumps(v, sort_keys=True))
    if hasattr(x, "item") and callable(x.item):  # numpy scalar
        try:
            return jsonable(x.item())
        except Exception:
            pass
    if hasattr(x, "tolist"):  # numpy array
        return jsonable(x.tolist())
    if hasattr(x, "to_dict"):
        return jsonable(x.to_dict())
    return str(x)


def canonical_bytes(record: dict[str, Any]) -> bytes:
    return json.dumps(jsonable(record), sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# From the provider's objects
# ---------------------------------------------------------------------------

def _num(x: Any) -> Optional[float]:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    f = float(x)
    return f if math.isfinite(f) else None


def _scaled(value: Any, unit: Any, table: dict[str, float], default: float) -> Optional[float]:
    v = _num(value)
    if v is None:
        return None
    factor = table.get(str(unit or "").strip().lower(), table.get(str(unit or "").strip(), None))
    return round(v * (default if factor is None else factor), 6)


def noise_from_properties(props: dict[str, Any], num_qubits: int) -> dict[str, Any]:
    """The noise view from properties().to_dict() (works for today's calibration and past dates)."""
    n = num_qubits
    t1: list[Optional[float]] = [None] * n
    t2: list[Optional[float]] = [None] * n
    freq: list[Optional[float]] = [None] * n
    ro_err: list[Optional[float]] = [None] * n
    ro_len: list[Optional[float]] = [None] * n
    p10: list[Optional[float]] = [None] * n  # prob_meas1_prep0
    p01: list[Optional[float]] = [None] * n  # prob_meas0_prep1
    faulty: list[int] = []
    for q, params in enumerate(props.get("qubits") or []):
        if q >= n:
            break
        for p in params or []:
            name, unit, val = p.get("name"), p.get("unit"), p.get("value")
            if name == "T1":
                t1[q] = _scaled(val, unit, _TIME_TO_US, 1.0)
            elif name == "T2":
                t2[q] = _scaled(val, unit, _TIME_TO_US, 1.0)
            elif name == "frequency":
                freq[q] = _scaled(val, unit, _FREQ_TO_GHZ, 1.0)
            elif name == "readout_error":
                ro_err[q] = _num(val)
            elif name == "readout_length":
                ro_len[q] = _scaled(val, unit, _TIME_TO_NS, 1.0)
            elif name == "prob_meas1_prep0":
                p10[q] = _num(val)
            elif name == "prob_meas0_prep1":
                p01[q] = _num(val)
            elif name == "operational" and _num(val) == 0:
                faulty.append(q)
    gates: dict[str, dict[str, list]] = {}
    for g in props.get("gates") or []:
        name, qubits = g.get("gate"), g.get("qubits") or []
        if not name or not qubits or any(not isinstance(q, int) or q >= n for q in qubits):
            continue
        err = dur = None
        for p in g.get("parameters") or []:
            if p.get("name") == "gate_error":
                err = _num(p.get("value"))
            elif p.get("name") == "gate_length":
                dur = _scaled(p.get("value"), p.get("unit"), _TIME_TO_NS, 1.0)
        gates.setdefault(str(name), {})["_".join(str(q) for q in qubits)] = [err, dur]
    readout = [None if ro_err[q] is None and ro_len[q] is None else [ro_err[q], ro_len[q]] for q in range(n)]
    asym = [None if p10[q] is None or p01[q] is None else [p10[q], p01[q]] for q in range(n)]
    return {"num_qubits": n, "t1_us": t1, "t2_us": t2, "frequency_ghz": freq, "readout": readout,
            "readout_asym": asym, "gates": gates, "faulty_qubits": sorted(set(faulty))}


def _noise_from_target(backend) -> dict[str, Any]:
    from ..machine_pick import snapshot_from_backend
    snap = snapshot_from_backend(backend)
    n = snap["num_qubits"]
    return {"num_qubits": n, "t1_us": snap["t1_us"], "t2_us": snap["t2_us"], "frequency_ghz": [None] * n,
            "readout": snap["readout"], "readout_asym": [None] * n, "gates": snap["gates"], "faulty_qubits": []}


def _properties_dict(props: Any) -> dict[str, Any]:
    if props is None:
        return {}
    if isinstance(props, dict):
        return props
    return props.to_dict()


def _config_dict(backend) -> dict[str, Any]:
    try:
        conf = backend.configuration()
    except Exception:
        return {}
    if conf is None:
        return {}
    d = conf if isinstance(conf, dict) else conf.to_dict()
    return {k: d[k] for k in CONFIG_KEYS if k in d}


def calibrated_at_of(props: Any) -> Optional[datetime]:
    lu = props.get("last_update_date") if isinstance(props, dict) else getattr(props, "last_update_date", None)
    if isinstance(lu, str):
        try:
            lu = parse_iso(lu)
        except ValueError:
            return None
    if not isinstance(lu, datetime):
        return None
    if lu.tzinfo is None:
        lu = lu.replace(tzinfo=timezone.utc)
    return lu.astimezone(timezone.utc).replace(microsecond=0)


def capture(backend, props: Any, same_day: bool = True) -> dict[str, Any]:
    """The record for one machine. props is backend.properties(...) (maybe for a past date)."""
    pd = _properties_dict(props)
    when = calibrated_at_of(props) if props is not None else None
    if not pd or when is None:
        raise CaptureError("the provider returned no calibration")
    conf = _config_dict(backend)
    target = None
    try:
        target = backend.target
    except Exception:
        target = None
    n = int(conf.get("n_qubits") or getattr(backend, "num_qubits", 0) or (target.num_qubits if target else 0)
            or len(pd.get("qubits") or []))
    noise = noise_from_properties(pd, n)
    if not noise["gates"] and target is not None and same_day:
        noise = _noise_from_target(backend)  # properties without gate data: today's target has it
    coupling = conf.get("coupling_map")
    if not coupling and target is not None:
        try:
            coupling = [list(e) for e in target.build_coupling_map().get_edges()]
        except Exception:
            coupling = None
    if not coupling:  # from the calibrated two-qubit gates
        coupling = sorted({tuple(int(x) for x in k.split("_")) for es in noise["gates"].values() for k in es if "_" in k})
    coupling = sorted([list(map(int, e)) for e in coupling])
    ops = sorted(target.operation_names) if target is not None else []
    basis = conf.get("basis_gates") or [o for o in ops if o not in ("measure", "delay", "reset", "barrier")
                                        and o not in ("if_else", "while_loop", "for_loop", "switch_case", "box")]
    return {
        "format": FORMAT,
        "provider": PROVIDER,
        "machine": str(backend.name),
        "calibrated_at": iso(when),
        "num_qubits": n,
        "basis_gates": sorted(basis),
        "coupling_map": coupling,
        "configuration": conf,
        "configuration_read": "same_day" if same_day else "later",
        "operation_names": ops,
        "properties": jsonable(pd),
        "noise": noise,
    }
