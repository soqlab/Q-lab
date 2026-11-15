"""Why did this run give a wrong outcome? Attribution of one measured bitstring to error sources.

Method (docs/WHY_METHOD.md, version METHOD_VERSION):

1. The calibration: the one the Q-Lab SDK captured with the run (backend.properties() when the job
   was submitted), or else the Rewind snapshot of the run's machine nearest the run's time, if one
   was calibrated within MAX_SNAPSHOT_GAP_H hours of it. Nothing else: no live provider call.
2. The circuit that ran: the transpiled circuit's QPY (physical qubits), checked against the run's
   fingerprint, or else the stored QASM when every gate in it is one the calibration lists on those
   exact qubits (that circuit is already in the machine's own gates and qubit numbers).
3. A noise model of that circuit from that calibration, as explicit channels after each gate, each
   tagged with the one error source it belongs to:
   - "readout q":      the reported readout error of measured qubit q (asymmetric when reported);
   - "gate a-b":       the depolarizing part of every two-qubit gate on the pair (a, b);
   - "gates on q":     the depolarizing part of every single-qubit gate on q;
   - "decoherence q":  thermal relaxation (T1, T2) of q during its gates, during explicit delays and
                       while it idles between two of its gates (as-soon-as-possible schedule).
   Per gate the depolarizing part is what is left of the reported gate error after its relaxation
   (the composition Rewind's replays use, app/rewind/replay.py).
4. Exact output probabilities (density matrix, no sampling) with every source on, with every source
   off (the noise-free answer), and with each source off in turn. Readout is applied to the
   probabilities analytically, so removing it costs nothing.
5. For a clicked bitstring b that the noise-free circuit never gives: each source's effect is how
   much b's modelled probability drops when only that source is removed. Shares are those drops over
   their sum. The answer also says how well the model reproduces what was measured, how additive the
   drops were, and a confidence level with its reasons.

It is a model: not modelled are crosstalk, leakage, coherent (over-rotation) errors, correlated
readout errors, drift during the job and idle time before a qubit's first gate or after its last.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np
from sqlalchemy.orm import Session

from .calibration_utils import per_qubit
from .run_diff import _load_qasm, _load_qpy, _matches_fingerprint, _qpy_after, counts_of

METHOD_VERSION = "why-ablation-1"
MAX_SNAPSHOT_GAP_H = 36
MAX_OPERATIONS = 800
MAX_BITSTRING = 64
IMPOSSIBLE = 1e-9  # a noise-free probability below this counts as "never"
NOT_MODELLED = [
    "crosstalk between neighbouring qubits",
    "leakage out of the qubit states",
    "coherent (over- or under-rotation) errors",
    "correlated readout errors between qubits",
    "drift between the calibration and the moment the job ran",
    "idle decoherence before a qubit's first gate or after its last",
]
_DELAY_TO_NS = {"s": 1e9, "ms": 1e6, "us": 1e3, "µs": 1e3, "ns": 1.0, "ps": 1e-3}
_FREE = {"barrier", "measure", "delay"}
_UNSUPPORTED = {"if_else", "while_loop", "for_loop", "switch_case", "box", "reset", "initialize"}


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


def max_qubits() -> int:
    """Active qubits after compiling: each simulation holds a 4^n density matrix."""
    return _int_env("QLAB_WHY_MAX_QUBITS", 8, 1, 10)


def max_work() -> float:
    """Bound on (number of simulations) x 4^qubits x operations for one explanation."""
    try:
        return max(1e6, float(os.getenv("QLAB_WHY_MAX_WORK", "2e9")))
    except ValueError:
        return 2e9


def time_limit_s() -> float:
    try:
        return max(1.0, float(os.getenv("QLAB_WHY_TIME_LIMIT_S", "30")))
    except ValueError:
        return 30.0


def limits() -> dict[str, Any]:
    return {"qubits": max_qubits(), "operations": MAX_OPERATIONS, "work": max_work(), "seconds": time_limit_s()}


class WhyError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class Unanswerable(Exception):
    """The run lacks something the method needs; `kind` and the message say what."""

    def __init__(self, kind: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.extra = extra


# ---------------------------------------------------------------------------
# The calibration
# ---------------------------------------------------------------------------

@dataclass
class Calibration:
    origin: str                     # "run" (captured with the run) | "rewind" (stored daily snapshot)
    t1: dict[int, float] = field(default_factory=dict)            # µs
    t2: dict[int, float] = field(default_factory=dict)            # µs
    readout: dict[int, tuple[float, float]] = field(default_factory=dict)   # (p(1|0), p(0|1))
    gates: dict[tuple[str, tuple[int, ...]], tuple[Optional[float], Optional[float]]] = field(default_factory=dict)
    calibrated_at: Optional[str] = None
    dated: bool = True              # False when the time is when it was read, not when it was calibrated
    note: str = ""
    sha256: Optional[str] = None
    coupling: list[tuple[int, int]] = field(default_factory=list)

    def gate(self, name: str, qubits: tuple[int, ...]):
        hit = self.gates.get((name, qubits))
        if hit is None and len(qubits) == 2:
            hit = self.gates.get((name, (qubits[1], qubits[0])))
        return hit

    def fingerprint(self) -> str:
        blob = json.dumps([self.origin, self.calibrated_at, sorted(self.t1.items()), sorted(self.t2.items()),
                           sorted(self.readout.items()), sorted((f"{k[0]}:{k[1]}", v) for k, v in self.gates.items())],
                          default=str)
        return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _f(x: Any) -> Optional[float]:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    v = float(x)
    return v if math.isfinite(v) else None


def _iso(dt: datetime) -> str:
    dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_time(text: Any) -> Optional[datetime]:
    if not isinstance(text, str) or not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _split_gate_key(key: str) -> Optional[tuple[str, tuple[int, ...]]]:
    parts = str(key).split("_")
    qs: list[int] = []
    while parts and parts[-1].isdigit():
        qs.insert(0, int(parts.pop()))
    if not parts or not qs:
        return None
    return "_".join(parts), tuple(qs)


def calibration_from_run(run: Any) -> Optional[Calibration]:
    cal = run.calibration if isinstance(run.calibration, dict) else {}
    out = Calibration(origin="run")

    def qubit_map(name: str) -> dict[int, float]:
        res = {}
        for k, v in per_qubit(cal.get(name)).items():
            if str(k).isdigit() and _f(v) is not None:
                res[int(k)] = float(v)
        return res

    out.t1, out.t2 = qubit_map("t1_us"), qubit_map("t2_us")
    out.readout = {q: (e, e) for q, e in qubit_map("readout_errors").items()}
    durations = {}
    for k, v in per_qubit(cal.get("gate_durations_us")).items():
        parsed = _split_gate_key(k)
        if parsed and _f(v) is not None:
            durations[parsed] = float(v) * 1000.0
    for k, v in per_qubit(cal.get("gate_errors")).items():
        parsed = _split_gate_key(k)
        if parsed and _f(v) is not None:
            out.gates[parsed] = (float(v), durations.get(parsed))
    if not (out.readout or out.gates):
        return None
    out.calibrated_at = cal.get("snapshot_time") if isinstance(cal.get("snapshot_time"), str) else None
    if cal.get("source") == "target":
        out.dated = False
        out.note = ("Captured with the run from the backend's target, which carries no calibration date: "
                    "Q-Lab knows when it was read, not when the machine was calibrated.")
    else:
        out.note = "Captured by the Q-Lab SDK from the machine's reported calibration when the job was submitted."
    out.coupling = sorted({tuple(sorted(qs)) for (_, qs) in out.gates if len(qs) == 2 and qs[0] != qs[1]})
    return out


def calibration_from_snapshot(record: dict[str, Any], row: Any) -> Calibration:
    noise = record.get("noise") or {}
    out = Calibration(origin="rewind")
    for name, target in (("t1_us", out.t1), ("t2_us", out.t2)):
        for q, v in enumerate(noise.get(name) or []):
            if _f(v) is not None:
                target[q] = float(v)
    asym = noise.get("readout_asym") or []
    for q, r in enumerate(noise.get("readout") or []):
        a = asym[q] if q < len(asym) else None
        if a and _f(a[0]) is not None and _f(a[1]) is not None:
            out.readout[q] = (float(a[0]), float(a[1]))
        elif r and _f(r[0]) is not None:
            out.readout[q] = (float(r[0]), float(r[0]))
    for name, entries in (noise.get("gates") or {}).items():
        for key, val in (entries or {}).items():
            try:
                qs = tuple(int(x) for x in str(key).split("_"))
            except ValueError:
                continue
            if val:
                out.gates[(str(name), qs)] = (_f(val[0]), _f(val[1]) if len(val) > 1 else None)
    cal = row.calibrated_at if row.calibrated_at.tzinfo else row.calibrated_at.replace(tzinfo=timezone.utc)
    out.calibrated_at = _iso(cal)
    out.sha256 = row.sha256
    out.coupling = sorted({tuple(sorted(int(x) for x in e)) for e in (record.get("coupling_map") or [])
                           if isinstance(e, (list, tuple)) and len(e) == 2 and e[0] != e[1]})
    return out


def _run_time(run: Any) -> datetime:
    t = run.created_at
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def find_calibration(db: Session, run: Any) -> Calibration:
    """The run's own calibration, else the Rewind snapshot of its machine from around its time."""
    own = calibration_from_run(run)
    if own is not None:
        return own
    machine = (run.backend or "").strip()
    from .rewind import store
    from .rewind.snapshot import MACHINE_RE
    when = _run_time(run)
    if machine and MACHINE_RE.match(machine):
        row = store.nearest(db, machine, when)
        if row is not None:
            cal_at = row.calibrated_at if row.calibrated_at.tzinfo else row.calibrated_at.replace(tzinfo=timezone.utc)
            gap_h = abs((cal_at - when).total_seconds()) / 3600.0
            if gap_h <= MAX_SNAPSHOT_GAP_H:
                try:
                    record = store.load(row)
                except (store.SnapshotCorrupt, OSError):
                    record = None
                if record is not None:
                    out = calibration_from_snapshot(record, row)
                    side = "before" if cal_at <= when else "after"
                    out.note = (f"This run carries no calibration, so Q-Lab used the calibration of {machine} that "
                                f"Rewind stored, calibrated {gap_h:.0f} h {side} the run.")
                    return out
            raise Unanswerable(
                "no_calibration",
                f"This run carries no calibration, and the nearest calibration of {machine} Q-Lab has stored is from "
                f"{cal_at.strftime('%Y-%m-%d %H:%M UTC')}, more than {MAX_SNAPSHOT_GAP_H} h from the run. Explaining "
                "it with another day's calibration would be guessing.",
                missing=["calibration from the day of the run"])
    raise Unanswerable(
        "no_calibration",
        "This run carries no calibration, and Q-Lab has no stored calibration of its machine from that day"
        + (f" ({machine})" if machine else "") + ". Runs recorded with the Q-Lab SDK on real hardware carry the "
        "machine's calibration; simulator runs have none. This server stores daily calibrations only when it "
        "has an IBM Quantum token configured.",
        missing=["calibration from the day of the run"])


# ---------------------------------------------------------------------------
# The circuit that ran
# ---------------------------------------------------------------------------

def _physical_ok(circuit: Any, cal: Calibration) -> bool:
    """True when every gate (on its exact qubits) and every qubit is one the calibration lists."""
    two, hit, qubits = 0, 0, set()
    known = set(cal.readout) | set(cal.t1) | {q for (_, qs) in cal.gates for q in qs}
    for inst in circuit.data:
        if inst.operation.name == "barrier":
            continue
        qs = tuple(circuit.find_bit(q).index for q in inst.qubits)
        qubits.update(qs)
        if inst.operation.name in _FREE or inst.operation.name in ("rz", "id"):
            continue
        two += 1
        hit += cal.gate(inst.operation.name, qs) is not None
    if not qubits <= known:
        return False
    return hit == two


def executed_circuit(run: Any, cal: Calibration) -> tuple[Any, str]:
    fingerprint = run.fingerprint if isinstance(run.fingerprint, dict) else {}
    circuit = _load_qpy(_qpy_after(run))
    if circuit is not None and _matches_fingerprint(circuit, fingerprint):
        return circuit, "transpiled circuit (QPY) captured with the run"
    circuit = _load_qasm(run.qasm)
    if circuit is not None and _physical_ok(circuit, cal):
        return circuit, "stored circuit, already in the machine's gates and qubit numbers"
    raise Unanswerable(
        "no_layout",
        "Q-Lab didn't capture the compiled circuit of this run, so it can't tell which physical qubits and "
        "couplers ran it. Runs recorded with the Q-Lab SDK keep the compiled circuit; without it, pointing at "
        "a qubit would be a guess.",
        missing=["the compiled (transpiled) circuit"])


# ---------------------------------------------------------------------------
# The noise model as tagged channels
# ---------------------------------------------------------------------------

def _relaxation(t1_us: Optional[float], t2_us: Optional[float], ns: float):
    from qiskit_aer.noise import thermal_relaxation_error
    t1 = t1_us * 1000.0 if t1_us else math.inf
    t2 = t2_us * 1000.0 if t2_us else math.inf
    if math.isinf(t1) and math.isinf(t2):
        return None
    return thermal_relaxation_error(t1, min(t2, 2 * t1), ns)


def gate_channels(err: Optional[float], dur_ns: Optional[float], t1s: list, t2s: list):
    """(relaxation per qubit (or None), depolarizing remainder (or None)) for one gate."""
    from qiskit.quantum_info import average_gate_fidelity
    from qiskit_aer.noise import depolarizing_error

    n = len(t1s)
    relax_each: list[Any] = [None] * n
    joint = None
    if dur_ns and dur_ns > 0:
        for i, (t1, t2) in enumerate(zip(t1s, t2s)):
            single = _relaxation(t1, t2, dur_ns)
            relax_each[i] = single
            if single is None:
                from qiskit_aer.noise import QuantumError
                from qiskit.circuit.library import IGate
                single = QuantumError(IGate())
            joint = single if joint is None else joint.expand(single)
    relax_fid = average_gate_fidelity(joint) if joint is not None else 1.0
    relax_infid = 1.0 - relax_fid
    depol = None
    if err is not None and err > relax_infid:
        dim = 2 ** n
        e = min(err, dim / (dim + 1))
        p = dim * (e - relax_infid) / (dim * relax_fid - 1)
        p = min(p, 4 ** n / (4 ** n - 1))
        if p > 1e-12:
            depol = depolarizing_error(p, n)
    return relax_each, depol


@dataclass
class Source:
    key: str
    kind: str          # readout | gate_2q | gate_1q | decoherence
    qubits: tuple[int, ...]
    value: dict[str, Any]


@dataclass
class Prepared:
    n: int                                    # simulated qubits
    physical: list[int]                       # simulated qubit i = physical[i]
    ops: list[tuple[Any, list[int], list[tuple[str, Any, list[int]]]]]   # (operation, qubits, [(source, error, qubits)])
    measured: list[tuple[int, int]]           # (clbit, local qubit), sorted by clbit
    num_clbits: int
    sources: dict[str, Source]
    readout: dict[int, tuple[float, float]]   # local qubit -> (p10, p01)
    uncalibrated: list[str]
    facts: dict[str, Any]


def prepare(circuit: Any, cal: Calibration) -> Prepared:
    from .rewind.replay import localize

    names = {i.operation.name for i in circuit.data}
    bad = names & _UNSUPPORTED
    if bad:
        raise Unanswerable("unsupported", f"The circuit uses {', '.join(sorted(bad))}; this explanation handles "
                           "circuits that measure once at the end, without resets or classical control.")
    if getattr(circuit, "parameters", None) and len(circuit.parameters):
        raise Unanswerable("unsupported", "The captured circuit still has unbound parameters, so its gates aren't known.")
    local, physical = localize(circuit)
    n = len(physical)
    ops_count = sum(1 for i in local.data if i.operation.name != "barrier")
    if n > max_qubits():
        raise Unanswerable("too_large", f"The run used {n} qubits; this explanation simulates up to {max_qubits()} "
                           "exactly, and an approximate answer would hide which qubit is to blame.",
                           limits=limits())
    if ops_count > MAX_OPERATIONS:
        raise Unanswerable("too_large", f"The run's circuit has {ops_count} operations; this explanation takes up to "
                           f"{MAX_OPERATIONS}.", limits=limits())

    sources: dict[str, Source] = {}
    clock = [0.0] * n
    started = [False] * n
    measured: dict[int, int] = {}
    done = [False] * n       # measured already
    ops: list = []
    uncalibrated: set[str] = set()
    cache: dict = {}
    has_durations = False

    def t1(q: int) -> Optional[float]:
        return cal.t1.get(physical[q])

    def t2(q: int) -> Optional[float]:
        return cal.t2.get(physical[q])

    def deco(q: int) -> str:
        key = f"decoherence:{physical[q]}"
        if key not in sources:
            sources[key] = Source(key, "decoherence", (physical[q],), {"t1_us": t1(q), "t2_us": t2(q)})
        return key

    for inst in local.data:
        op = inst.operation
        name = op.name
        qs = [local.find_bit(q).index for q in inst.qubits]
        if name == "barrier":
            continue
        if name == "measure":
            q, c = qs[0], local.find_bit(inst.clbits[0]).index
            if c in measured or done[q]:
                raise Unanswerable("unsupported", "The circuit measures a qubit or writes a classical bit more than "
                                   "once; this explanation handles one measurement per qubit at the end.")
            measured[c] = q
            done[q] = True
            continue
        if any(done[q] for q in qs):
            raise Unanswerable("unsupported", "The circuit acts on a qubit after measuring it; this explanation "
                               "handles circuits that measure once at the end.")
        channels: list[tuple[str, Any, list[int]]] = []
        if name == "delay":
            unit = getattr(op, "unit", "dt")
            dur = float(op.params[0]) if op.params else 0.0
            ns = dur * _DELAY_TO_NS[unit] if unit in _DELAY_TO_NS else None
            q = qs[0]
            if ns and ns > 0:
                err = _relaxation(t1(q), t2(q), ns)
                if err is not None:
                    channels.append((deco(q), err, [q]))
                clock[q] += ns
            elif dur > 0:
                uncalibrated.add("delay (in dt)")
            started[q] = True
            ops.append((None, qs, channels))
            continue
        pq = tuple(physical[q] for q in qs)
        start = max(clock[q] for q in qs)
        for q in qs:   # idling between two of this qubit's gates
            gap = start - clock[q]
            if started[q] and gap > 0:
                err = _relaxation(t1(q), t2(q), gap)
                if err is not None:
                    channels.append((deco(q), err, [q]))
        hit = cal.gate(name, pq)
        dur = 0.0
        if hit is None:
            if name not in ("rz", "id", "global_phase") and len(qs) <= 2:
                uncalibrated.add(f"{name} on {'-'.join(map(str, pq))}")
        else:
            err, dur_ns = hit
            dur = dur_ns or 0.0
            has_durations = has_durations or dur > 0
            ck = (name, pq)
            if ck not in cache:
                cache[ck] = gate_channels(err, dur_ns, [t1(q) for q in qs], [t2(q) for q in qs])
            relax_each, depol = cache[ck]
            for i, q in enumerate(qs):
                if relax_each[i] is not None:
                    channels.append((deco(q), relax_each[i], [q]))
            if depol is not None:
                if len(qs) == 2:
                    a, b = sorted(pq)
                    key = f"gate:{a}-{b}"
                    sources.setdefault(key, Source(key, "gate_2q", (a, b), {"gate": name, "error": None}))
                    prev = sources[key].value.get("error")
                    sources[key].value["error"] = err if prev is None else max(prev, err or 0)
                elif len(qs) == 1:
                    key = f"gates1q:{pq[0]}"
                    sources.setdefault(key, Source(key, "gate_1q", pq, {"errors": {}}))
                    sources[key].value["errors"][name] = err
                else:
                    key = f"gate:{'-'.join(map(str, pq))}"
                    sources.setdefault(key, Source(key, "gate_2q", pq, {"gate": name, "error": err}))
                channels.append((key, depol, qs))
        for q in qs:
            clock[q] = start + dur
            started[q] = True
        ops.append((op, qs, channels))

    if not measured:
        raise Unanswerable("unsupported", "The circuit measures nothing, so there's no outcome to explain.")
    readout: dict[int, tuple[float, float]] = {}
    for c, q in measured.items():
        r = cal.readout.get(physical[q])
        if r and (r[0] > 0 or r[1] > 0):
            readout[q] = (min(max(r[0], 0.0), 1.0), min(max(r[1], 0.0), 1.0))
            key = f"readout:{physical[q]}"
            sources[key] = Source(key, "readout", (physical[q],), {"p1_given_0": readout[q][0], "p0_given_1": readout[q][1],
                                                                   "error": (readout[q][0] + readout[q][1]) / 2})
        elif r is None:
            uncalibrated.add(f"readout of qubit {physical[q]}")
    facts = {"physical_qubits": physical, "operations": ops_count, "depth": local.depth(),
             "two_qubit_gates": sum(1 for o in ops if o[0] is not None and len(o[1]) == 2),
             "durations_known": has_durations}
    return Prepared(n=n, physical=physical, ops=ops, measured=sorted(measured.items()),
                    num_clbits=local.num_clbits, sources=sources, readout=readout,
                    uncalibrated=sorted(uncalibrated), facts=facts)


def _gate_sources(prep: Prepared) -> list[str]:
    return sorted(k for k, s in prep.sources.items() if s.kind != "readout")


def work_estimate(prep: Prepared) -> float:
    sims = 2 + len(_gate_sources(prep))
    instructions = sum(1 + len(ch) for _, _, ch in prep.ops)
    return sims * (4 ** prep.n) * max(1, instructions)


def probabilities(prep: Prepared, off: set[str], noiseless: bool = False) -> np.ndarray:
    """Exact probabilities of the measured qubits (before readout), bit i = i-th measured clbit."""
    from qiskit import QuantumCircuit
    from qiskit_aer import AerSimulator
    import qiskit_aer.library  # noqa: F401  (registers save_probabilities)

    qc = QuantumCircuit(prep.n)
    for op, qs, channels in prep.ops:
        if op is not None:
            qc.append(op, qs)
        if noiseless:
            continue
        for key, err, eqs in channels:
            if key not in off:
                qc.append(err.to_instruction(), eqs)
    qc.save_probabilities([q for _, q in prep.measured], label="p")
    sim = AerSimulator(method="density_matrix", max_parallel_threads=1, max_parallel_experiments=1,
                       fusion_enable=True, max_memory_mb=512)
    result = sim.run(qc, shots=1).result()
    if not result.success:
        raise WhyError(500, f"The simulator failed: {getattr(result, 'status', '')}"[:300])
    p = np.asarray(result.data(0)["p"], dtype=float)
    p = np.clip(p, 0.0, None)
    s = p.sum()
    return p / s if s > 0 else p


def prob_of(p: np.ndarray, index_bits: list[int], readout: list[Optional[tuple[float, float]]]) -> float:
    """P(observing bits) given the pre-readout distribution p and per-bit readout errors."""
    m = len(index_bits)
    if m == 0:
        return float(p.sum())
    t = p.reshape([2] * m)          # axis 0 is the highest bit (bit m-1)
    for i in range(m - 1, -1, -1):  # contract the highest remaining bit (always axis 0)
        b = index_bits[i]
        r = readout[i]
        if r is None:
            row = np.array([1.0, 0.0]) if b == 0 else np.array([0.0, 1.0])
        else:
            p10, p01 = r
            row = np.array([1 - p10, p01]) if b == 0 else np.array([p10, 1 - p01])
        t = np.tensordot(row, t, axes=([0], [0]))
    return float(t)


# ---------------------------------------------------------------------------
# Cache and limits
# ---------------------------------------------------------------------------

_CACHE: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
_CACHE_LOCK = threading.Lock()
_CACHE_SIZE = 16


def _cache_get(key: str) -> Optional[dict[str, Any]]:
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit is not None:
            _CACHE.move_to_end(key)
        return hit


def _cache_put(key: str, value: dict[str, Any]) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = value
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)


def clear_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


_gate = threading.BoundedSemaphore(1)
_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qlab-why")


def _limited(fn):
    if not _gate.acquire(blocking=False):
        raise WhyError(503, "Q-Lab is working out another explanation; try again in a few seconds.")

    def work():
        try:
            return fn()
        finally:
            _gate.release()

    fut = _pool.submit(work)
    try:
        return fut.result(timeout=time_limit_s())
    except FutureTimeout:
        raise WhyError(504, f"Working this out took longer than {time_limit_s():.0f} s. Q-Lab keeps going in the "
                            "background; ask again in a minute.")


# ---------------------------------------------------------------------------
# The answer
# ---------------------------------------------------------------------------

def _normalise_outcome(outcome: str) -> str:
    bits = "".join(str(outcome or "").split())
    if not bits or len(bits) > MAX_BITSTRING or set(bits) - {"0", "1"}:
        raise WhyError(422, f"outcome must be a bitstring of 0s and 1s, up to {MAX_BITSTRING} bits.")
    return bits


def _observed(counts: dict[str, int], bits: str) -> tuple[int, int]:
    total = sum(counts.values())
    k = sum(v for key, v in counts.items() if "".join(key.split()).zfill(len(bits)) == bits)
    return k, total


def _label(src: Source) -> str:
    v = src.value
    if src.kind == "readout":
        return f"qubit {src.qubits[0]}'s readout error ({v['error'] * 100:.1f}%)"
    if src.kind == "gate_2q":
        e = v.get("error")
        tail = f" ({e * 100:.2f}% per gate)" if isinstance(e, (int, float)) else ""
        return f"the {v.get('gate', 'two-qubit')} gate between qubits {src.qubits[0]} and {src.qubits[1]}{tail}"
    if src.kind == "gate_1q":
        errs = [e for e in v.get("errors", {}).values() if isinstance(e, (int, float))]
        tail = f" (up to {max(errs) * 100:.2f}% per gate)" if errs else ""
        return f"single-qubit gates on qubit {src.qubits[0]}{tail}"
    t1, t2 = v.get("t1_us"), v.get("t2_us")
    parts = [f"T1 {t1:.0f} µs" if t1 else None, f"T2 {t2:.0f} µs" if t2 else None]
    tail = f" ({', '.join(p for p in parts if p)})" if any(parts) else ""
    return f"qubit {src.qubits[0]}'s decoherence{tail}"


def _model(db: Session, run: Any) -> dict[str, Any]:
    """Everything that doesn't depend on the clicked outcome, cached per run and calibration."""
    cal = find_calibration(db, run)
    circuit, circuit_source = executed_circuit(run, cal)
    prep = prepare(circuit, cal)
    key = f"{run.run_id}|{cal.fingerprint()}|{METHOD_VERSION}"
    hit = _cache_get(key)
    if hit is not None:
        return {**hit, "cached": True}
    work = work_estimate(prep)
    if work > max_work():
        raise Unanswerable("too_large", f"Explaining this run needs about {work:.1e} units of simulation; this server "
                           f"allows {max_work():.1e} per explanation ({prep.n} qubits, {prep.facts['operations']} "
                           "operations).", limits=limits())

    def compute() -> dict[str, Any]:
        started = time.monotonic()
        base = probabilities(prep, set())
        ideal = probabilities(prep, set(), noiseless=True)
        ablated = {k: probabilities(prep, {k}) for k in _gate_sources(prep)}
        value = {"cal": cal, "prep": prep, "circuit_source": circuit_source, "base": base, "ideal": ideal,
                 "ablated": ablated, "seconds": round(time.monotonic() - started, 3), "answers": {}}
        _cache_put(key, value)   # kept even if the request timed out, so asking again is instant
        return value

    return {**_limited(compute), "cached": False}


def _neighbourhood(cal: Calibration, prep: Prepared, highlight: dict[str, float]) -> dict[str, Any]:
    used = set(prep.physical)
    edges = cal.coupling
    near = set(used)
    for a, b in edges:
        if a in used or b in used:
            near.update((a, b))
    sub = sorted({(a, b) for a, b in edges if a in near and b in near})
    nodes = sorted(near)
    pos: dict[int, tuple[float, float]] = {}
    if nodes:
        import rustworkx as rx
        g = rx.PyGraph()
        idx = {q: g.add_node(q) for q in nodes}
        for a, b in sub:
            g.add_edge(idx[a], idx[b], None)
        layout = rx.spring_layout(g, seed=7, num_iter=200)
        xs = [layout[idx[q]][0] for q in nodes]
        ys = [layout[idx[q]][1] for q in nodes]
        span_x, span_y = (max(xs) - min(xs)) or 1.0, (max(ys) - min(ys)) or 1.0
        for q in nodes:
            x, y = layout[idx[q]]
            pos[q] = (round((x - min(xs)) / span_x, 4), round((y - min(ys)) / span_y, 4))
    qubit_share: dict[int, float] = {}
    edge_share: dict[str, float] = {}
    for key, share in highlight.items():
        kind, _, rest = key.partition(":")
        if kind == "gate":
            a, b = (int(x) for x in rest.split("-")[:2])
            ek = f"{min(a, b)}-{max(a, b)}"
            edge_share[ek] = edge_share.get(ek, 0.0) + share
        else:
            q = int(rest)
            qubit_share[q] = qubit_share.get(q, 0.0) + share
    return {
        "source": ("coupling map stored with the machine's calibration" if cal.origin == "rewind" and cal.coupling
                   else "pairs with a calibrated two-qubit gate"),
        "nodes": [{"qubit": q, "x": pos.get(q, (0.5, 0.5))[0], "y": pos.get(q, (0.5, 0.5))[1], "used": q in used,
                   "share": round(qubit_share.get(q, 0.0), 4)} for q in nodes],
        "edges": [{"a": a, "b": b, "share": round(edge_share.get(f"{a}-{b}", 0.0), 4)} for a, b in sub],
        "partial": len(edges) > len(sub),
    }


def _confidence(cal: Calibration, prep: Prepared, model_p: float, k: int, total: int, additivity: Optional[float],
                cal_gap_h: Optional[float]) -> tuple[str, list[str], dict[str, Any]]:
    reasons: list[str] = []
    level = 2  # 2 high, 1 medium, 0 low

    def lower(to: int, why: str) -> None:
        nonlocal level
        level = min(level, to)
        reasons.append(why)

    observed = k / total if total else 0.0
    agreement: dict[str, Any] = {"observed": round(observed, 6), "modelled": round(model_p, 6), "ratio": None, "z": None}
    if total:
        sd = math.sqrt(max(total * model_p * (1 - model_p), 1.0))
        z = (k - total * model_p) / sd
        agreement["z"] = round(z, 2)
        if model_p > 0:
            agreement["ratio"] = round(observed / model_p, 3)
        if abs(z) > 3 and (model_p == 0 or not 0.5 <= observed / model_p <= 2.0):
            if observed > model_p:
                lower(0, f"The model gives this outcome {model_p * 100:.2f}% but {observed * 100:.2f}% of shots landed "
                         "on it: most of it comes from something the model doesn't include.")
            else:
                lower(1, f"The model expects this outcome more often ({model_p * 100:.2f}%) than measured "
                         f"({observed * 100:.2f}%): the calibration may overstate some errors.")
    if k < 10:
        lower(1, f"Only {k} shot{'s' if k != 1 else ''} landed on this outcome, so its measured rate is rough.")
    if not cal.dated:
        lower(1, "The calibration has no date, so it may not be the one in force when the job ran.")
    if cal.origin == "rewind":
        lower(1, "The calibration is the machine's stored daily one, not one captured with the run.")
    elif cal_gap_h is not None and cal_gap_h > MAX_SNAPSHOT_GAP_H:
        lower(1, f"The machine was calibrated {cal_gap_h:.0f} h before the run; it may have drifted.")
    if additivity is not None and not 0.7 <= additivity <= 1.3:
        lower(1, "Removing sources one at a time doesn't add up to the whole effect: they interact, so the shares "
                 "are approximate.")
    if prep.uncalibrated:
        lower(1, f"Some operations have no reported error ({', '.join(prep.uncalibrated[:4])}"
                 f"{'…' if len(prep.uncalibrated) > 4 else ''}); they count as perfect in the model.")
    if not prep.facts.get("durations_known"):
        lower(1, "Gate durations weren't captured, so decoherence during gates and idling isn't in the model.")
    if not reasons:
        reasons.append("Same-day calibration, the circuit that ran, and the model matches what was measured for "
                       "this outcome.")
    return ("low", "medium", "high")[level], reasons, agreement


def explain(db: Session, run: Any, outcome: str) -> dict[str, Any]:
    bits = _normalise_outcome(outcome)
    base_answer: dict[str, Any] = {"run_id": run.run_id, "outcome": bits, "method": METHOD_VERSION,
                                   "method_doc": "docs/WHY_METHOD.md", "is_model": True, "not_modelled": NOT_MODELLED}
    counts = counts_of(run)
    if not counts:
        return {**base_answer, "status": "no_counts",
                "message": "This run has no measured counts to explain."}
    try:
        m = _model(db, run)
    except Unanswerable as exc:
        return {**base_answer, "status": exc.kind, "message": exc.message, **exc.extra}
    prep: Prepared = m["prep"]
    cal: Calibration = m["cal"]
    width = max(len("".join(k.split())) for k in counts)
    if len(bits) < width:
        bits = bits.zfill(width)
    base_answer["outcome"] = bits
    k, total = _observed(counts, bits)
    if len(bits) != prep.num_clbits and len(bits) != width:
        raise WhyError(422, f"This run's outcomes have {prep.num_clbits} bits; {bits} has {len(bits)}.")
    cached_answer = m["answers"].get(bits)
    if cached_answer is not None:
        return {**cached_answer, "cached": True}

    # bits[-1 - c] is classical bit c
    def bit(c: int) -> int:
        return int(bits[-1 - c]) if c < len(bits) else 0

    unmeasured_ones = [c for c in range(len(bits)) if bit(c) == 1 and c not in {c2 for c2, _ in prep.measured}]
    index_bits = [bit(c) for c, _ in prep.measured]
    ro_all = [prep.readout.get(q) for _, q in prep.measured]
    ideal_p = prob_of(m["ideal"], index_bits, [None] * len(index_bits)) if not unmeasured_ones else 0.0
    model_p = prob_of(m["base"], index_bits, ro_all) if not unmeasured_ones else 0.0

    cal_time = _parse_time(cal.calibrated_at)
    cal_gap_h = abs((_run_time(run) - cal_time).total_seconds()) / 3600.0 if cal_time else None
    answer: dict[str, Any] = {
        **base_answer,
        "observed": {"count": k, "shots": total, "share": round(k / total, 6) if total else None},
        "noise_free_probability": round(ideal_p, 9),
        "modelled_probability": round(model_p, 9),
        "calibration": {"origin": cal.origin, "calibrated_at": cal.calibrated_at, "dated": cal.dated,
                        "note": cal.note, "sha256": cal.sha256,
                        "hours_from_run": round(cal_gap_h, 1) if cal_gap_h is not None else None,
                        "label": ("Calibration published by the machine's provider; Q-Lab is not affiliated "
                                  "with IBM." if (run.backend or "").startswith("ibm") else None)},
        "circuit": {"source": m["circuit_source"], **prep.facts},
        "limits": limits(),
        "seconds": m["seconds"],
        "cached": m["cached"],
    }
    if unmeasured_ones:
        answer.update(status="unsupported", message="This outcome sets a classical bit that no measurement writes.")
        return answer
    if ideal_p > IMPOSSIBLE:
        answer.update(status="expected_outcome",
                      message=(f"The noise-free circuit gives {bits} {ideal_p * 100:.1f}% of the time, so it isn't a "
                               "wrong outcome. Click an outcome the noise-free circuit never gives."))
        m["answers"][bits] = answer
        return answer

    drops: dict[str, float] = {}
    for key, src in prep.sources.items():
        if src.kind == "readout":
            local_q = prep.physical.index(src.qubits[0])
            ro = [None if q == local_q else r for (_, q), r in zip(prep.measured, ro_all)]
            without = prob_of(m["base"], index_bits, ro)
        else:
            without = prob_of(m["ablated"][key], index_bits, ro_all)
        drops[key] = model_p - without
    positive = {k2: d for k2, d in drops.items() if d > 0}
    total_drop = sum(positive.values())
    excess = model_p - ideal_p
    additivity = (total_drop / excess) if excess > 1e-12 else None
    level, reasons, agreement = _confidence(cal, prep, model_p, k, total, additivity, cal_gap_h)
    if total_drop <= 1e-15:
        answer.update(status="unexplained", confidence="low", confidence_reasons=reasons, agreement=agreement,
                      sources=[], message=("None of the calibrated error sources makes this outcome more likely in "
                                           "the model, so Q-Lab can't point at a cause."),
                      coupling_map=_neighbourhood(cal, prep, {}))
        m["answers"][bits] = answer
        return answer
    ranked = sorted(positive.items(), key=lambda kv: -kv[1])
    rows = []
    for key, d in ranked[:12]:
        src = prep.sources[key]
        share = d / total_drop
        if share < 0.01 and rows:
            break
        rows.append({"key": key, "kind": src.kind, "qubits": list(src.qubits), "value": src.value,
                     "label": _label(src), "share": round(share, 4), "probability_drop": round(d, 9)})
    top = rows[0]
    headline = (f"{_label(prep.sources[top['key']])[0].upper()}{_label(prep.sources[top['key']])[1:]} explains "
                f"~{top['share'] * 100:.0f}% of this outcome in the model.")
    answer.update(
        status="explained",
        headline=headline,
        sources=rows,
        confidence=level,
        confidence_reasons=reasons,
        agreement=agreement,
        additivity=round(additivity, 3) if additivity is not None else None,
        coupling_map=_neighbourhood(cal, prep, {r["key"]: r["share"] for r in rows}),
        message=("Shares come from removing one error source at a time from a noise model built from the "
                 "calibration; they say where the model puts the blame, not a measurement of the machine."),
    )
    m["answers"][bits] = answer
    return answer
