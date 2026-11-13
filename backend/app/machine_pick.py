"""Pick the machine before you run: what a circuit should score on each IBM machine, from calibration.

"On ibm_fez expect ~0.84; on ibm_torino ~0.71: qubit 3's readout error on ibm_torino is the weak point."

The calibration is the one the hardware board reads with the server's own IBM Quantum key
(app/hardware_board.py): each machine's target, with its coupling map, basis gates, per-gate and
readout errors and durations, and T1/T2 per qubit. Without a key there is no calibration and nothing
is estimated: the answer says so and returns no numbers. The board's simulated preview
(QLAB_HARDWARE_BOARD_SIMULATE=1, never on Render) gives IBM's fake backends, and every estimate made
from them is marked simulated.

The model, an estimated success probability (ESP), is a standard first-order estimate:

1. The circuit is transpiled for each machine with Qiskit's preset pass manager (optimization level 1,
   fixed seed) against a Target rebuilt from the calibration, so the layout prefers good qubits and
   the SWAPs routing adds are counted.
2. ESP = prod over gates (1 - e_gate) * prod over measured qubits (1 - e_readout)
         * prod over used qubits exp(-t_idle / T2eff),   T2eff = min(T2, 2 T1).
   t_idle is the time a qubit waits between its first operation and its last in an as-soon-as-possible
   schedule built from the calibrated durations. Gate errors (randomized benchmarking) already
   include decoherence during the gate, so only waiting time is charged.

It ignores crosstalk, leakage, coherent errors and drift since the calibration, so it is an
estimate to choose a machine with, not a prediction of the measured distribution.

If Qiskit can't be imported, an analytic estimate is used instead: the circuit's own gate counts
with each machine's median errors, no routing. It is labelled as such.
"""
from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import statistics
import threading
import time
from collections import OrderedDict, defaultdict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timezone
from typing import Any, Callable, Literal, Optional

from . import hardware_board as hb

log = logging.getLogger("qlab.machine_pick")

Level = Literal["plain", "standard", "expert"]

# Bounds on the work one request may cause.
MAX_QASM_BYTES = 64_000
MAX_QUBITS = 40          # active qubits, after idle wires are dropped
MAX_OPERATIONS = 4_000
MAX_TWO_QUBIT = 1_500
BUDGET_S = 30.0          # whole request: every machine's transpile shares it
SNAPSHOT_TTL_S = 900     # calibration read from IBM is reused for 15 minutes
OPTIMIZATION_LEVEL = 1
SEED_TRANSPILER = 7

_SKIP_OPS = {"measure", "delay", "reset", "barrier", "if_else", "while_loop", "for_loop", "switch_case", "box"}
_VIRTUAL = {"rz", "id", "delay", "barrier", "p", "u1"}  # no calibrated error by design (frame changes)


def _max_backends() -> int:
    try:
        return max(1, min(20, int(os.getenv("QLAB_PICK_MAX_BACKENDS", "8"))))
    except ValueError:
        return 8


class CircuitError(ValueError):
    """The circuit can't be read or is too big; the message says which, in plain words."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _num(x: Any) -> Optional[float]:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    f = float(x)
    return f if math.isfinite(f) else None


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _median(xs: list[Optional[float]]) -> Optional[float]:
    vals = [x for x in xs if isinstance(x, (int, float)) and math.isfinite(x)]
    return float(statistics.median(vals)) if vals else None


def _loss(err: float, n: int = 1) -> float:
    """-log of the success factor (1 - err)^n; err is clipped so one bad gate can't make it infinite."""
    return -n * math.log1p(-min(max(err, 0.0), 0.999999))


# ---------------------------------------------------------------------------
# Calibration snapshots: plain JSON, made from a backend's target
# ---------------------------------------------------------------------------

def snapshot_from_backend(backend, simulated: bool = False, status: Optional[dict] = None) -> dict[str, Any]:
    """Everything the estimate needs from one machine, as JSON (cacheable, testable without IBM)."""
    target = backend.target
    n = int(getattr(backend, "num_qubits", None) or target.num_qubits)
    props = target.qubit_properties or []
    t1: list[Optional[float]] = []
    t2: list[Optional[float]] = []
    for q in range(n):
        qp = props[q] if q < len(props) else None
        a, b = _num(getattr(qp, "t1", None)), _num(getattr(qp, "t2", None))
        t1.append(round(a * 1e6, 3) if a else None)
        t2.append(round(b * 1e6, 3) if b else None)
    gates: dict[str, dict[str, list]] = {}
    readout: list[Optional[list]] = [None] * n
    for name in getattr(target, "operation_names", []) or []:
        if name in _SKIP_OPS and name != "measure":
            continue
        try:
            items = list(target[name].items())
        except Exception:
            continue
        entries: dict[str, list] = {}
        for qargs, p in items:
            if not qargs or len(qargs) > 2:
                continue
            err = _num(getattr(p, "error", None)) if p is not None else None
            dur = _num(getattr(p, "duration", None)) if p is not None else None
            entries["_".join(str(q) for q in qargs)] = [err, round(dur * 1e9, 3) if dur else None]
        if name == "measure":
            for key, val in entries.items():
                q = int(key)
                if q < n:
                    readout[q] = val
        elif entries:
            gates[name] = entries
    last = None
    try:
        p = backend.properties()
        lu = getattr(p, "last_update_date", None) if p is not None else None
        last = _iso(lu) if isinstance(lu, datetime) else None
    except Exception:
        pass
    return {
        "backend": backend.name,
        "num_qubits": n,
        "last_update": last,
        "fetched_at": _iso(datetime.now(timezone.utc)),
        "simulated": bool(simulated),
        "operational": (status or {}).get("operational"),
        "pending_jobs": (status or {}).get("pending_jobs"),
        "t1_us": t1,
        "t2_us": t2,
        "readout": readout,
        "gates": gates,
    }


def target_from_snapshot(snap: dict[str, Any]):
    """A Qiskit Target with the snapshot's gates, errors and durations (for noise-aware transpiling)."""
    from qiskit.circuit import Measure
    from qiskit.circuit.library import get_standard_gate_name_mapping
    from qiskit.transpiler import InstructionProperties, QubitProperties, Target

    n = int(snap["num_qubits"])
    t1, t2 = snap.get("t1_us") or [], snap.get("t2_us") or []
    qprops = [QubitProperties(t1=(t1[q] * 1e-6 if q < len(t1) and t1[q] else None),
                              t2=(t2[q] * 1e-6 if q < len(t2) and t2[q] else None)) for q in range(n)]
    target = Target(num_qubits=n, qubit_properties=qprops)
    mapping = get_standard_gate_name_mapping()
    for name, entries in sorted((snap.get("gates") or {}).items()):
        gate = mapping.get(name)
        if gate is None or name in _SKIP_OPS:
            continue
        props = {}
        for key, (err, dur) in entries.items():
            qargs = tuple(int(x) for x in key.split("_"))
            if len(qargs) != gate.num_qubits or max(qargs) >= n:
                continue
            props[qargs] = InstructionProperties(error=err, duration=(dur * 1e-9 if dur else None))
        if props:
            target.add_instruction(gate, props)
    meas = {}
    for q, val in enumerate(snap.get("readout") or []):
        if val is not None and q < n:
            err, dur = val
            meas[(q,)] = InstructionProperties(error=err, duration=(dur * 1e-9 if dur else None))
    if meas:
        target.add_instruction(Measure(), meas)
    return target


# ---------------------------------------------------------------------------
# Reading the circuit
# ---------------------------------------------------------------------------

_QASM3_GATE_NAMES = {"phase": "p", "cphase": "cp", "U": "u", "CX": "cx"}


def qasm3_to_qasm2(text: str) -> str:
    """The common OpenQASM 3 subset (what qiskit.qasm3.dumps writes for gate circuits) as OpenQASM 2.

    Used when the server has no OpenQASM 3 importer. Classical control, inputs and timing are
    refused with a message rather than dropped.
    """
    out = []
    body = re.sub(r"//[^\n]*", "", text)
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    for raw in body.split(";"):
        s = " ".join(raw.split())
        while s.startswith("}") and out:  # the end of a gate body: no semicolon after it
            out[-1] += ";\n}"
            s = s[1:].strip()
        if not s:
            continue
        if s.startswith("OPENQASM"):
            out.append("OPENQASM 2.0")
            continue
        if s.startswith("include"):
            out.append('include "qelib1.inc"')
            continue
        if re.match(r"^(input|output|if|while|for|switch|box|delay|stretch|duration|def|let|const|float|int|uint|angle|bool)\b", s):
            raise CircuitError("This OpenQASM 3 circuit uses classical or timing features "
                               f"(“{s[:40]}”) that the estimate can't read. Paste the gate circuit only.")
        m = re.match(r"^qubit(?:\[(\d+)\])?\s+(\w+)$", s)
        if m:
            out.append(f"qreg {m.group(2)}[{m.group(1) or 1}]")
            continue
        m = re.match(r"^bit(?:\[(\d+)\])?\s+(\w+)$", s)
        if m:
            out.append(f"creg {m.group(2)}[{m.group(1) or 1}]")
            continue
        m = re.match(r"^(\w+(?:\[\d+\])?)\s*=\s*measure\s+(\w+(?:\[\d+\])?)$", s)
        if m:
            out.append(f"measure {m.group(2)} -> {m.group(1)}")
            continue
        m = re.match(r"^(\w+)(.*)$", s)
        if m and m.group(1) in _QASM3_GATE_NAMES:
            s = _QASM3_GATE_NAMES[m.group(1)] + m.group(2)
        out.append(s)
    return "".join(x + ("\n" if x.endswith("}") else ";\n") for x in out)


def parse_circuit(text: str):
    """A QuantumCircuit from OpenQASM 2 or 3 text, with idle qubits dropped. Raises CircuitError."""
    if not isinstance(text, str) or not text.strip():
        raise CircuitError("Paste an OpenQASM 2 or 3 circuit, or pick one of your runs.")
    if len(text.encode("utf-8")) > MAX_QASM_BYTES:
        raise CircuitError(f"The circuit text is over {MAX_QASM_BYTES // 1000} kB; the estimate takes smaller circuits.")
    from qiskit import qasm2

    is3 = bool(re.search(r"OPENQASM\s+3", text))
    circuit = None
    if is3:
        try:
            from qiskit import qasm3
            circuit = qasm3.loads(text)
        except Exception:
            circuit = None
        if circuit is None:
            text = qasm3_to_qasm2(text)
    if circuit is None:
        try:
            circuit = qasm2.loads(text, custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS)
        except Exception as exc:
            msg = str(exc).strip().splitlines()[0][:200] if str(exc).strip() else type(exc).__name__
            raise CircuitError(f"The circuit couldn't be read as OpenQASM {'3' if is3 else '2'}: {msg}")
    return compact(circuit)


def compact(circuit):
    """The same circuit on only the qubits it uses (an executed circuit can name every device qubit)."""
    from qiskit import QuantumCircuit

    used = sorted({circuit.find_bit(q).index for inst in circuit.data if inst.operation.name != "barrier"
                   for q in inst.qubits})
    if len(used) == circuit.num_qubits or not used:
        return circuit
    idx = {q: i for i, q in enumerate(used)}
    out = QuantumCircuit(len(used), circuit.num_clbits, name=circuit.name)
    for inst in circuit.data:
        qs = [circuit.find_bit(q).index for q in inst.qubits]
        if inst.operation.name == "barrier":
            keep = [idx[q] for q in qs if q in idx]
            if keep:
                out.barrier(*keep)
            continue
        out.append(inst.operation, [idx[q] for q in qs], [circuit.find_bit(c).index for c in inst.clbits])
    return out


def check_size(circuit) -> dict[str, Any]:
    ops = [i for i in circuit.data if i.operation.name != "barrier"]
    two = sum(1 for i in ops if len(i.qubits) == 2)
    multi = [i.operation.name for i in ops if len(i.qubits) > 2]
    facts = {"num_qubits": circuit.num_qubits, "operations": len(ops), "two_qubit_gates": two,
             "measured": sum(1 for i in ops if i.operation.name == "measure"), "depth": circuit.depth()}
    if circuit.num_qubits > MAX_QUBITS:
        raise CircuitError(f"The circuit uses {circuit.num_qubits} qubits; the estimate takes up to {MAX_QUBITS}.")
    if len(ops) > MAX_OPERATIONS:
        raise CircuitError(f"The circuit has {len(ops)} operations; the estimate takes up to {MAX_OPERATIONS}.")
    if two > MAX_TWO_QUBIT:
        raise CircuitError(f"The circuit has {two} two-qubit gates; the estimate takes up to {MAX_TWO_QUBIT}.")
    facts["multi_qubit_gates"] = len(multi)
    return facts


def normalize_text(text: str) -> str:
    """Circuit text without comments, with whitespace normalised: equal for the same circuit."""
    t = re.sub(r"//[^\n]*", "", text or "")
    t = re.sub(r"/\*.*?\*/", "", t, flags=re.S)
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s*([;,{}()\[\]=<>])\s*", r"\1", t)
    return re.sub(r"\s*->\s*", "->", t)


def normalized_hash(text: str) -> str:
    """SHA-256 of normalize_text(text)."""
    return hashlib.sha256(normalize_text(text).encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# The estimate on one machine
# ---------------------------------------------------------------------------

def _pct(x: float) -> str:
    return f"{x * 100:.1f}%" if x * 100 < 10 else f"{x * 100:.0f}%"


def score_isa(isa, snap: dict[str, Any]) -> dict[str, Any]:
    """ESP of a transpiled circuit under a snapshot, with what costs the most."""
    gates = snap.get("gates") or {}
    readout = snap.get("readout") or []
    t1s, t2s = snap.get("t1_us") or [], snap.get("t2_us") or []
    ready: dict[int, float] = defaultdict(float)
    first: dict[int, float] = {}
    last: dict[int, float] = {}
    busy: dict[int, float] = defaultdict(float)
    losses = {"two_qubit": 0.0, "one_qubit": 0.0, "readout": 0.0, "idle": 0.0}
    per_gate: dict[tuple, list] = {}       # (name, qubits) -> [count, err, loss]
    per_1q: dict[int, list] = {}           # qubit -> [count, loss]
    per_ro: dict[int, list] = {}           # qubit -> [err, loss]
    missing: set[str] = set()
    two_q = 0

    for inst in isa.data:
        name = inst.operation.name
        qs = tuple(isa.find_bit(q).index for q in inst.qubits)
        if not qs:
            continue
        if name == "barrier":
            t = max(ready[q] for q in qs)
            for q in qs:
                ready[q] = t
            continue
        key = "_".join(str(q) for q in qs)
        if name == "measure":
            entry = readout[qs[0]] if qs[0] < len(readout) else None
        else:
            entry = (gates.get(name) or {}).get(key)
        err, dur = (entry if entry is not None else (None, None))
        if err is None and name not in _VIRTUAL:
            missing.add(f"{name} on {key.replace('_', '-')}")
        err = err or 0.0
        dur = dur or 0.0
        start = max(ready[q] for q in qs)
        for q in qs:
            first.setdefault(q, start)
            ready[q] = start + dur
            last[q] = start + dur
            busy[q] += dur
        loss = _loss(err)
        if name == "measure":
            losses["readout"] += loss
            per_ro[qs[0]] = [err, per_ro.get(qs[0], [0, 0.0])[1] + loss]
        elif len(qs) >= 2:
            two_q += 1
            losses["two_qubit"] += loss
            g = per_gate.setdefault((name, qs), [0, err, 0.0])
            g[0] += 1
            g[2] += loss
        else:
            losses["one_qubit"] += loss
            c = per_1q.setdefault(qs[0], [0, 0.0])
            c[0] += 1
            c[1] += loss

    per_idle: dict[int, list] = {}
    for q in first:
        idle_ns = max(0.0, (last[q] - first[q]) - busy[q])
        t1 = t1s[q] if q < len(t1s) else None
        t2 = t2s[q] if q < len(t2s) else None
        limits = [x for x in (t2, 2 * t1 if t1 else None) if x]
        if not limits or idle_ns <= 0:
            continue
        t2eff_ns = min(limits) * 1000.0
        loss = idle_ns / t2eff_ns
        losses["idle"] += loss
        per_idle[q] = [idle_ns / 1000.0, min(limits), loss]

    total = sum(losses.values())
    esp = math.exp(-total)
    # The single worst place.
    cands: list[tuple[float, dict[str, Any]]] = []
    for (name, qs), (count, err, loss) in per_gate.items():
        cands.append((loss, {"kind": "two_qubit_gate", "gate": name, "qubits": list(qs), "count": count, "error": err,
                             "text": f"the {name} gate between qubits {qs[0]} and {qs[1]}",
                             "detail": f"used {count}×, {_pct(err)} error each"}))
    for q, (err, loss) in per_ro.items():
        cands.append((loss, {"kind": "readout", "qubits": [q], "error": err,
                             "text": f"qubit {q}'s readout error", "detail": f"{_pct(err)}"}))
    for q, (count, loss) in per_1q.items():
        cands.append((loss, {"kind": "one_qubit_gates", "qubits": [q], "count": count,
                             "text": f"the single-qubit gates on qubit {q}", "detail": f"{count} gates"}))
    for q, (idle_us, t2eff, loss) in per_idle.items():
        cands.append((loss, {"kind": "idle", "qubits": [q], "idle_us": round(idle_us, 3), "t2_us": t2eff,
                             "text": f"qubit {q} waiting idle",
                             "detail": f"{idle_us:.2f} µs idle against T2 {t2eff:.0f} µs"}))
    cands.sort(key=lambda c: -c[0])
    weak = None
    if cands and cands[0][0] > 0:
        loss, weak = cands[0]
        weak = {**weak, "share_of_loss": round(loss / total, 4) if total else None}
    labels = {"two_qubit": "two-qubit gates", "one_qubit": "single-qubit gates", "readout": "readout",
              "idle": "decoherence while idle"}
    dom = max(losses, key=lambda k: losses[k]) if total > 0 else None
    duration_ns = max(ready.values()) if ready else 0.0
    return {
        "esp": round(esp, 6),
        "factors": {k: round(math.exp(-v), 6) for k, v in losses.items()},
        "dominant": None if dom is None else {"source": dom, "label": labels[dom],
                                              "share_of_loss": round(losses[dom] / total, 4)},
        "weak_point": weak,
        "transpiled": {
            "depth": isa.depth(), "two_qubit_gates": two_q, "operations": sum(1 for i in isa.data if i.operation.name != "barrier"),
            "duration_us": round(duration_ns / 1000.0, 3), "physical_qubits": sorted(first),
        },
        "missing_errors": sorted(missing)[:20],
    }


def transpile_for(circuit, snap: dict[str, Any]):
    from qiskit.transpiler import generate_preset_pass_manager

    target = target_from_snapshot(snap)
    pm = generate_preset_pass_manager(optimization_level=OPTIMIZATION_LEVEL, target=target,
                                      seed_transpiler=SEED_TRANSPILER)
    return pm.run(circuit)


def estimate_one(circuit, snap: dict[str, Any]) -> dict[str, Any]:
    """Transpile and score on one machine. Errors come back as a reason, not an exception."""
    base = {"backend": snap["backend"], "num_qubits": snap["num_qubits"],
            "calibrated_at": snap.get("last_update"), "read_at": snap.get("fetched_at"),
            "simulated": bool(snap.get("simulated")), "operational": snap.get("operational"),
            "pending_jobs": snap.get("pending_jobs")}
    if circuit.num_qubits > snap["num_qubits"]:
        return {**base, "esp": None, "method": None,
                "reason": f"needs {circuit.num_qubits} qubits; {snap['backend']} has {snap['num_qubits']}"}
    try:
        isa = transpile_for(circuit, snap)
    except ImportError:
        return {**base, **analytic_estimate(circuit, snap), "method": "analytic"}
    except Exception as exc:
        msg = str(exc).strip().splitlines()[0][:160] if str(exc).strip() else type(exc).__name__
        return {**base, "esp": None, "method": None, "reason": f"couldn't be compiled for this machine ({msg})"}
    return {**base, **score_isa(isa, snap), "method": "transpiled"}


def analytic_estimate(circuit, snap: dict[str, Any]) -> dict[str, Any]:
    """No Qiskit transpiler: the circuit's own gate counts, each machine's median errors, no routing."""
    e1 = _median([v[0] for name, es in (snap.get("gates") or {}).items() for k, v in es.items()
                  if "_" not in k and name not in _VIRTUAL]) or 0.0
    e2 = _median([v[0] for es in (snap.get("gates") or {}).values() for k, v in es.items() if "_" in k]) or 0.0
    ero = _median([v[0] for v in (snap.get("readout") or []) if v]) or 0.0
    ops = [i for i in circuit.data if i.operation.name not in ("barrier",)]
    n2 = sum(1 for i in ops if len(i.qubits) >= 2)
    nm = sum(1 for i in ops if i.operation.name == "measure")
    n1 = len(ops) - n2 - nm
    losses = {"two_qubit": _loss(e2, n2), "one_qubit": _loss(e1, n1), "readout": _loss(ero, nm), "idle": 0.0}
    total = sum(losses.values())
    labels = {"two_qubit": "two-qubit gates", "one_qubit": "single-qubit gates", "readout": "readout", "idle": "idle"}
    dom = max(losses, key=lambda k: losses[k]) if total > 0 else None
    return {
        "esp": round(math.exp(-total), 6),
        "factors": {k: round(math.exp(-v), 6) for k, v in losses.items()},
        "dominant": None if dom is None else {"source": dom, "label": labels[dom], "share_of_loss": round(losses[dom] / total, 4)},
        "weak_point": None,
        "transpiled": None,
        "missing_errors": [],
    }


# ---------------------------------------------------------------------------
# Calibration source: the hardware board's IBM access, cached
# ---------------------------------------------------------------------------

_snap_lock = threading.Lock()
_snaps: dict[str, tuple[float, dict[str, Any]]] = {}
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="qlab-pick")
# At most two estimates at once on the whole server: each can transpile for several machines.
_busy = threading.BoundedSemaphore(2)


def load_snapshots(wait_s: float = 25.0) -> dict[str, Any]:
    """The calibration of every operational machine the server's key sees (up to QLAB_PICK_MAX_BACKENDS).

    {"available": bool, "simulated": bool, "snapshots": [...], "problems": [...], "message": str|None}
    """
    if not hb.configured():
        return {"available": False, "simulated": False, "snapshots": [], "problems": [],
                "message": "no_key"}
    live = hb.live_status()
    machines = [b for b in live.get("backends", []) if b.get("operational")]
    machines = sorted(machines, key=lambda b: b["name"])[:_max_backends()]
    now = time.monotonic()
    out, problems, todo = [], [], []
    with _snap_lock:
        for m in machines:
            hit = _snaps.get(m["name"])
            if hit and now - hit[0] < SNAPSHOT_TTL_S:
                out.append({**hit[1], "operational": m.get("operational"), "pending_jobs": m.get("pending_jobs")})
            else:
                todo.append(m)
    sim = hb.simulated()

    def fetch(m: dict) -> dict[str, Any]:
        return snapshot_from_backend(hb._provider().backend(m["name"]), simulated=sim, status=m)

    futures = [(m, _pool.submit(fetch, m)) for m in todo]
    deadline = time.monotonic() + wait_s
    for m, fut in futures:
        try:
            snap = fut.result(timeout=max(0.1, deadline - time.monotonic()))
        except FutureTimeout:
            problems.append(f"{m['name']}: IBM was too slow to return its calibration")
            continue
        except Exception as exc:
            problems.append(f"{m['name']}: calibration unavailable ({type(exc).__name__})")
            continue
        with _snap_lock:
            _snaps[m["name"]] = (time.monotonic(), snap)
        out.append(snap)
    out.sort(key=lambda s: s["backend"])
    message = None
    if not out:
        message = live.get("error") or ("no_machines" if not machines else "no_calibration")
    return {"available": bool(out), "simulated": sim, "snapshots": out, "problems": problems, "message": message}


def reset_cache() -> None:
    with _snap_lock:
        _snaps.clear()
    with _result_lock:
        _results.clear()


# ---------------------------------------------------------------------------
# The answer
# ---------------------------------------------------------------------------

_result_lock = threading.Lock()
_results: "OrderedDict[tuple, dict[str, Any]]" = OrderedDict()
_RESULTS_MAX = 128


def _approx(x: float) -> str:
    return "<0.01" if x < 0.005 else f"{x:.2f}"


def _weak_text(weak: Optional[dict], level: Level) -> Optional[str]:
    if not weak:
        return None
    if level == "expert":
        return f"{weak['text']} ({weak['detail']})"
    return weak["text"]


def _stamp(iso: Optional[str]) -> str:
    if not iso:
        return "an unrecorded time"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def no_calibration_answer(source: dict[str, Any]) -> dict[str, Any]:
    msg = source.get("message")
    if msg == "no_key":
        sentence = ("There is no calibration to estimate from: this server has no IBM Quantum key, so it can't read any "
                    "machine's calibration. Nothing is estimated until the server's owner connects one.")
        todo = ("Server owner: create a free API key at quantum.cloud.ibm.com (the open plan is enough) and set it as "
                "QISKIT_IBM_TOKEN in the backend's environment. Estimates work as soon as the hardware board can read the machines.")
    elif msg == "no_machines":
        sentence = "There is no calibration to estimate from: no IBM machine is online for this server's key right now."
        todo = "Try again later; the hardware board shows which machines are up."
    else:
        sentence = ("There is no calibration to estimate from right now: IBM Quantum didn't return any machine's calibration"
                    + (f" ({msg})." if msg and msg not in ("no_calibration",) else "."))
        todo = "Try again in a minute."
    return {"available": False, "sentence": sentence, "todo": todo, "ranked": [], "unavailable": [],
            "problems": source.get("problems") or [], "simulated": bool(source.get("simulated")), "basis": None}


def estimate(circuit, source: dict[str, Any], level: Level = "standard", circuit_key: Optional[str] = None) -> dict[str, Any]:
    """Rank the machines in `source` for `circuit`. Bounded by BUDGET_S; cached per circuit and calibration."""
    if not source.get("available"):
        return no_calibration_answer(source)
    snaps = source["snapshots"]
    key = None
    if circuit_key:
        key = (circuit_key, tuple((s["backend"], s.get("fetched_at"), s.get("last_update")) for s in snaps))
        with _result_lock:
            hit = _results.get(key)
            if hit is not None:
                _results.move_to_end(key)
                return phrase(hit, level)

    deadline = time.monotonic() + BUDGET_S
    futures = [(s, _pool.submit(estimate_one, circuit, s)) for s in snaps]
    rows = []
    for s, fut in futures:
        try:
            rows.append(fut.result(timeout=max(0.1, deadline - time.monotonic())))
        except FutureTimeout:
            fut.cancel()
            rows.append({"backend": s["backend"], "num_qubits": s["num_qubits"], "esp": None, "method": None,
                         "calibrated_at": s.get("last_update"), "read_at": s.get("fetched_at"),
                         "simulated": bool(s.get("simulated")),
                         "reason": f"took longer than {BUDGET_S:.0f} s to compile, so it was left out"})
    facts = {
        "available": True,
        "simulated": bool(source.get("simulated")),
        "problems": source.get("problems") or [],
        "ranked": sorted([r for r in rows if r.get("esp") is not None], key=lambda r: (-r["esp"], r["backend"])),
        "unavailable": [r for r in rows if r.get("esp") is None],
    }
    if key is not None:
        with _result_lock:
            _results[key] = facts
            while len(_results) > _RESULTS_MAX:
                _results.popitem(last=False)
    return phrase(facts, level)


def phrase(facts: dict[str, Any], level: Level) -> dict[str, Any]:
    """The answer sentence for a ranking, at the dial's level. Facts are the same at every level."""
    out = {**facts, "level": level}
    ranked = facts["ranked"]
    stamps = sorted({r.get("calibrated_at") or r.get("read_at") for r in ranked if r.get("calibrated_at") or r.get("read_at")})
    analytic = any(r.get("method") == "analytic" for r in ranked)
    basis = "Estimate"
    if stamps:
        basis += (f" from calibration at {_stamp(stamps[0])}" if len(stamps) == 1
                  else f" from calibration between {_stamp(stamps[0])} and {_stamp(stamps[-1])}")
    basis += ", not a measurement"
    basis += (": median errors without compiling (Qiskit's transpiler isn't available on this server)." if analytic
              else ": the circuit compiled for each machine, then gate, readout and idle errors multiplied.")
    if facts.get("simulated"):
        basis = "SIMULATED PREVIEW: IBM's fake backends, not real machines. " + basis
    out["basis"] = basis
    if not ranked:
        why = "; ".join(f"{r['backend']} {r.get('reason', 'no estimate')}" for r in facts["unavailable"][:3])
        out["sentence"] = "None of the machines could take this circuit" + (f": {why}." if why else ".")
        return out
    best = ranked[0]
    if len(ranked) == 1:
        weak = _weak_text(best.get("weak_point"), level)
        if level == "plain":
            s = f"Only {best['backend']} can be estimated: about {round(best['esp'] * 100)}% of runs should come out error-free there"
            s += f", and {weak} costs the most." if weak else "."
        else:
            s = f"On {best['backend']} expect ≈{_approx(best['esp'])}"
            s += f"; {weak} is the weak point." if weak else "."
        out["sentence"] = s
        return out
    second = ranked[1]
    weak = _weak_text(second.get("weak_point"), level)
    if level == "plain":
        s = (f"Run it on {best['backend']}: about {round(best['esp'] * 100)}% of runs should come out error-free there, "
             f"against {round(second['esp'] * 100)}% on {second['backend']}")
        s += f", where {weak} costs the most." if weak else "."
    else:
        s = f"On {best['backend']} expect ≈{_approx(best['esp'])}; on {second['backend']} ≈{_approx(second['esp'])}"
        s += f": {weak} on {second['backend']} is the weak point." if weak else "."
        if len(ranked) > 2:
            s += f" {len(ranked)} machines compared."
    out["sentence"] = s
    return out


def run_with_budget(fn: Callable[[], dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Run fn if fewer than two estimates are running; None when the server is busy."""
    if not _busy.acquire(blocking=False):
        return None
    try:
        return fn()
    finally:
        _busy.release()
