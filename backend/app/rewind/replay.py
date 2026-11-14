"""The replica: a circuit run on Aer with a noise model built from one stored calibration.

Steps, all deterministic for the same input (fixed transpiler and simulator seeds):

1. The calibration nearest the date asked (store.nearest, measured from 12:00 UTC that day); the
   answer says which calibration was used and how far it is from the date.
2. The circuit (OpenQASM 2/3 via machine_pick.parse_circuit, or base64 QPY) is transpiled for that
   machine with machine_pick's Target rebuilt from the snapshot (its coupling map, basis gates,
   errors and durations; optimization level 1, seed 7), so layout and routing follow that day's
   calibration. Gates reported broken (error 1) are left out of the target, so they are not used.
3. Only the physical qubits the compiled circuit touches are simulated. Per gate on them:
   thermal relaxation over the gate's duration from T1/T2 (T2 capped at 2 T1), then a depolarizing
   channel sized so the gate's total average infidelity equals the reported gate error (the
   relaxation's share is subtracted first; the same composition as qiskit-aer's device models).
   Per measured qubit: a readout error, asymmetric when prob_meas1_prep0 / prob_meas0_prep1 were
   reported, otherwise symmetric.
4. AerSimulator: density matrix up to QLAB_REWIND_DENSITY_MAX qubits (one exact run, then sampled),
   statevector trajectories above it (each shot its own run, so the work is bounded up front).

An explicit delay instruction gets thermal relaxation over its duration, like a gate.

Not modelled: decoherence while a qubit waits between gates (other than in an explicit delay),
crosstalk, leakage, coherent (over-rotation) errors, and drift during the day. The answer lists
these. How close replicas come to the real machine is measured by a benchmark on real hardware
(app/rewind/bench.py, docs/REWIND_METHOD.md); each answer carries the latest result for its machine,
or accuracy null with a note when that machine has not been measured yet.

Rewind never sends a circuit to real hardware.
"""
from __future__ import annotations

import base64
import binascii
import io
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import date, datetime, time as dtime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from .. import machine_pick as mp
from . import store
from .snapshot import iso

SEED_SIMULATOR = 20261114
MAX_QPY_BYTES = 256_000
MAX_OPERATIONS = 4_000
MAX_TWO_QUBIT = 1_500
NOT_MODELLED = [
    "decoherence while a qubit waits between gates (explicit delays are modelled)",
    "crosstalk between neighbouring qubits",
    "leakage out of the qubit states",
    "coherent (over- or under-rotation) errors",
    "drift between the calibration and the time a real job would have run",
]
ACCURACY_NOTE = "Not yet measured for this machine"


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


# Measured on a GHZ circuit compiled for ibm_fez's calibration (Python 3.12, qiskit-aer 0.18.2,
# one thread), whole-process peak working set; the app itself takes about 215 MB before a run:
#   20 qubits, statevector, 100 shots: 271 MB, 110 s      24 qubits, 1 shot: 532 MB, 21 s per shot
#   10 qubits, density matrix, 4000 shots: 207 MB, 0.7 s  16 qubits, 200 shots: 20 s
# Shot branching is about 10x faster but its branches each hold a statevector: 16 qubits x 4000
# shots peaked at 572 MB, and 20 qubits x 400 shots crashed the process (segfault) with Aer's
# memory cap at 256 MB. So branching is off by default, 24 qubits does not fit the hosted 512 MB
# instance at all, and the work bound (about 1e8 per second here) keeps a replay near a minute.


def max_qubits() -> int:
    """Active qubits after compiling (default 20, about 16 MB per statevector; see above)."""
    return _int_env("QLAB_REWIND_MAX_QUBITS", 20, 1, 28)


def density_max() -> int:
    return _int_env("QLAB_REWIND_DENSITY_MAX", 10, 0, 12)


def max_shots(signed_in: bool) -> int:
    if signed_in:
        return _int_env("QLAB_REWIND_MAX_SHOTS", 8192, 1, 1_000_000)
    return min(max_shots(True), _int_env("QLAB_REWIND_MAX_SHOTS_ANON", 4096, 1, 1_000_000))


def time_limit_s() -> float:
    try:
        return max(1.0, float(os.getenv("QLAB_REWIND_TIME_LIMIT_S", "60")))
    except ValueError:
        return 60.0


def max_work(signed_in: bool) -> float:
    """Bound on shots x operations x 2^qubits for a trajectory run (4^qubits x operations for a
    density matrix). Default 3e9: about 30 s here, more on a smaller server."""
    try:
        w = float(os.getenv("QLAB_REWIND_MAX_WORK", "3e9"))
    except ValueError:
        w = 3e9
    return w if signed_in else w / 2


def branching() -> bool:
    """Aer's shot branching (QLAB_REWIND_SHOT_BRANCHING=on): about 10x faster, but memory grows with
    the branches and it crashed under a memory cap (see above). Off unless the server has room."""
    return os.getenv("QLAB_REWIND_SHOT_BRANCHING", "").strip().lower() == "on"


def max_memory_mb() -> int:
    """Aer's own memory cap for one replay (it refuses a run that needs more)."""
    return _int_env("QLAB_REWIND_MAX_MEMORY_MB", 256, 16, 65536)


def limits(signed_in: bool) -> dict[str, Any]:
    return {"qubits": max_qubits(), "shots": max_shots(signed_in), "operations": MAX_OPERATIONS,
            "two_qubit_gates": MAX_TWO_QUBIT, "seconds": time_limit_s(), "density_matrix_up_to": density_max(),
            "work": max_work(signed_in)}


def label(machine: str, calibrated_at: datetime) -> str:
    return (f"Simulated from IBM-published calibration of {machine} as of {calibrated_at.date().isoformat()}; "
            "not affiliated with or endorsed by IBM.")


class ReplayError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# The circuit
# ---------------------------------------------------------------------------

def read_circuit(text: str, fmt: Optional[str] = None):
    """A QuantumCircuit from OpenQASM 2/3 text or base64 QPY, idle qubits dropped."""
    if not isinstance(text, str) or not text.strip():
        raise ReplayError(422, "Give a circuit: OpenQASM 2 or 3 text, or base64-encoded QPY.")
    fmt = (fmt or "").lower() or ("qasm" if "OPENQASM" in text[:2000] else "qpy")
    if fmt == "qasm":
        try:
            return mp.parse_circuit(text)
        except mp.CircuitError as exc:
            raise ReplayError(422, str(exc).replace("the estimate", "Rewind"))
    if fmt != "qpy":
        raise ReplayError(422, "format must be qasm or qpy.")
    try:
        raw = base64.b64decode("".join(text.split()).encode("ascii"), validate=True)
    except (binascii.Error, UnicodeEncodeError, ValueError):
        raise ReplayError(422, "The circuit is neither OpenQASM text nor valid base64 QPY.")
    if len(raw) > MAX_QPY_BYTES:
        raise ReplayError(422, f"The QPY file is over {MAX_QPY_BYTES // 1000} kB.")
    from qiskit import qpy
    try:
        circuits = qpy.load(io.BytesIO(raw))
    except Exception as exc:
        raise ReplayError(422, f"The QPY data couldn't be read ({type(exc).__name__}).")
    if len(circuits) != 1:
        raise ReplayError(422, f"The QPY data holds {len(circuits)} circuits; send one.")
    return mp.compact(circuits[0])


def check_circuit(circuit, max_q: int) -> dict[str, Any]:
    ops = [i for i in circuit.data if i.operation.name != "barrier"]
    names = {i.operation.name for i in ops}
    flow = names & {"if_else", "while_loop", "for_loop", "switch_case", "box"}
    if flow:
        raise ReplayError(422, f"Classical control flow ({', '.join(sorted(flow))}) can't be replayed yet.")
    two = sum(1 for i in ops if len(i.qubits) == 2)
    if circuit.num_qubits > max_q:
        raise ReplayError(422, f"The circuit uses {circuit.num_qubits} qubits; Rewind replays up to {max_q}.")
    if len(ops) > MAX_OPERATIONS:
        raise ReplayError(422, f"The circuit has {len(ops)} operations; Rewind takes up to {MAX_OPERATIONS}.")
    if two > MAX_TWO_QUBIT:
        raise ReplayError(422, f"The circuit has {two} two-qubit gates; Rewind takes up to {MAX_TWO_QUBIT}.")
    return {"num_qubits": circuit.num_qubits, "operations": len(ops), "two_qubit_gates": two,
            "depth": circuit.depth(), "measured": sum(1 for i in ops if i.operation.name == "measure")}


# ---------------------------------------------------------------------------
# The noise model
# ---------------------------------------------------------------------------

def usable_view(noise: dict[str, Any]) -> dict[str, Any]:
    """The snapshot's noise view without gates reported broken (error >= 1), for transpiling."""
    gates = {}
    for name, entries in (noise.get("gates") or {}).items():
        kept = {k: v for k, v in entries.items() if not (v and v[0] is not None and v[0] >= 1.0)}
        if kept:
            gates[name] = kept
    return {**noise, "gates": gates}


def _relaxation(t1_us: Optional[float], t2_us: Optional[float], duration_ns: float):
    from qiskit_aer.noise import thermal_relaxation_error
    t1 = t1_us * 1000.0 if t1_us else math.inf
    t2 = t2_us * 1000.0 if t2_us else math.inf
    t2 = min(t2, 2 * t1)
    return thermal_relaxation_error(t1, t2, duration_ns)


def gate_error(err: Optional[float], duration_ns: Optional[float], t1s: list, t2s: list) -> tuple[Any, dict[str, bool]]:
    """(QuantumError | None, {"thermal_relaxation", "depolarizing"}) for one gate on `qubits`.

    t1s/t2s are the gate's qubits' values in µs, in qubit order (first = least significant).
    """
    from qiskit.quantum_info import average_gate_fidelity
    from qiskit_aer.noise import depolarizing_error

    n = len(t1s)
    relax = None
    if duration_ns and duration_ns > 0:
        for t1, t2 in zip(t1s, t2s):
            single = _relaxation(t1, t2, duration_ns)
            relax = single if relax is None else relax.expand(single)
    relax_fid = average_gate_fidelity(relax) if relax is not None else 1.0
    relax_infid = 1.0 - relax_fid
    depol = None
    if err is not None and err > relax_infid:
        dim = 2 ** n
        e = min(err, dim / (dim + 1))
        p = dim * (e - relax_infid) / (dim * relax_fid - 1)
        p = min(p, 4 ** n / (4 ** n - 1))
        if p > 0:
            depol = depolarizing_error(p, n)
    if depol is not None and relax is not None:
        combined = depol.compose(relax)
    else:
        combined = depol or relax
    return combined, {"thermal_relaxation": relax is not None, "depolarizing": depol is not None}


def build_noise_model(record: dict[str, Any], physical: list[int]) -> tuple[Any, dict[str, Any]]:
    """An Aer NoiseModel on the qubits `physical` (renumbered 0..k-1 in that order) and its summary."""
    from qiskit_aer.noise import NoiseModel, ReadoutError

    noise = usable_view(record["noise"])
    t1, t2 = noise.get("t1_us") or [], noise.get("t2_us") or []
    index = {p: i for i, p in enumerate(physical)}
    basis = sorted(set(record.get("basis_gates") or []) | {"measure"})
    model = NoiseModel(basis_gates=[b for b in basis if b not in ("measure", "delay", "reset")])
    counts = {"thermal_relaxation": 0, "depolarizing": 0, "readout": 0, "readout_asymmetric": 0}
    by_gate: dict[str, int] = {}
    for name, entries in sorted((noise.get("gates") or {}).items()):
        if name in ("measure", "reset", "delay", "barrier"):
            continue
        for key, val in entries.items():
            qs = [int(x) for x in key.split("_")]
            if not val or any(q not in index for q in qs):
                continue
            err, dur = val
            e, kinds = gate_error(err, dur, [t1[q] if q < len(t1) else None for q in qs],
                                  [t2[q] if q < len(t2) else None for q in qs])
            if e is None:
                continue
            model.add_quantum_error(e, name, [index[q] for q in qs], warnings=False)
            by_gate[name] = by_gate.get(name, 0) + 1
            for k, v in kinds.items():
                counts[k] += int(v)
    readout = noise.get("readout") or []
    asym = noise.get("readout_asym") or []
    for p in physical:
        a = asym[p] if p < len(asym) else None
        r = readout[p] if p < len(readout) else None
        if a and a[0] is not None and a[1] is not None:
            p10, p01 = float(a[0]), float(a[1])
            counts["readout_asymmetric"] += 1
        elif r and r[0] is not None:
            p10 = p01 = float(r[0])
        else:
            continue
        if p10 == 0 and p01 == 0:
            continue
        model.add_readout_error(ReadoutError([[1 - p10, p10], [p01, 1 - p01]]), [index[p]])
        counts["readout"] += 1

    def med(xs: list) -> Optional[float]:
        vals = sorted(float(x) for x in xs if isinstance(x, (int, float)))
        return round(vals[len(vals) // 2], 6) if vals else None

    summary = {
        "physical_qubits": list(physical),
        "channels": counts,
        "gates_with_errors": by_gate,
        "basis_gates": record.get("basis_gates"),
        "t1_us": {str(p): t1[p] if p < len(t1) else None for p in physical},
        "t2_us": {str(p): t2[p] if p < len(t2) else None for p in physical},
        "readout_error_median": med([readout[p][0] for p in physical if p < len(readout) and readout[p]]),
        "model": "thermal relaxation (T1, T2, gate duration) + depolarizing (rest of the reported gate error) "
                 "+ readout error, per gate and qubit",
        "not_modelled": NOT_MODELLED,
    }
    return model, summary


# ---------------------------------------------------------------------------
# Compiling and running
# ---------------------------------------------------------------------------

def transpile(circuit, record: dict[str, Any]):
    view = {**usable_view(record["noise"]), "num_qubits": record["num_qubits"]}
    try:
        return mp.transpile_for(circuit, view)
    except Exception as exc:
        msg = str(exc).strip().splitlines()[0][:200] if str(exc).strip() else type(exc).__name__
        raise ReplayError(422, f"The circuit couldn't be compiled for {record['machine']}: {msg}")


def localize(isa) -> tuple[Any, list[int]]:
    """The compiled circuit on only the physical qubits it touches, and which ones they are."""
    from qiskit import QuantumCircuit

    used = sorted({isa.find_bit(q).index for inst in isa.data if inst.operation.name != "barrier"
                   for q in inst.qubits})
    idx = {p: i for i, p in enumerate(used)}
    out = QuantumCircuit(len(used), isa.num_clbits, name=isa.name)
    for inst in isa.data:
        qs = [isa.find_bit(q).index for q in inst.qubits]
        if inst.operation.name == "barrier":
            keep = [idx[q] for q in qs if q in idx]
            if keep:
                out.barrier(*keep)
            continue
        out.append(inst.operation, [idx[q] for q in qs], [isa.find_bit(c).index for c in inst.clbits])
    return out, used


_DELAY_TO_NS = {"s": 1e9, "ms": 1e6, "us": 1e3, "µs": 1e3, "ns": 1.0, "ps": 1e-3}


def relax_delays(local, record: dict[str, Any], physical: list[int], dt_s: Optional[float] = None) -> tuple[Any, int]:
    """The circuit with each delay replaced by thermal relaxation over its duration on that qubit
    (T1/T2 from the calibration), and how many were replaced. A delay counted in dt needs dt
    (the machine's sample time, from the calibration's configuration unless given); without it the
    delay is left as an ideal wait."""
    if not any(i.operation.name == "delay" for i in local.data):
        return local, 0
    from qiskit import QuantumCircuit

    noise = record.get("noise") or {}
    t1, t2 = noise.get("t1_us") or [], noise.get("t2_us") or []
    dt = dt_s if dt_s else (record.get("configuration") or {}).get("dt")
    out = QuantumCircuit(*local.qregs, *local.cregs, name=local.name)
    done = 0
    for inst in local.data:
        op = inst.operation
        if op.name != "delay":
            out.append(op, inst.qubits, inst.clbits)
            continue
        unit = getattr(op, "unit", "dt")
        dur = float(op.params[0]) if op.params else 0.0
        ns = dur * dt * 1e9 if unit == "dt" and dt else dur * _DELAY_TO_NS[unit] if unit in _DELAY_TO_NS else None
        if not ns or ns <= 0:
            out.append(op, inst.qubits, inst.clbits)
            continue
        q = local.find_bit(inst.qubits[0]).index
        pq = physical[q]
        err = _relaxation(t1[pq] if pq < len(t1) else None, t2[pq] if pq < len(t2) else None, ns)
        out.append(err.to_instruction(), inst.qubits)
        done += 1
    return out, done


def simulate(local, model, shots: int, seed: int, method: str) -> dict[str, int]:
    from qiskit_aer import AerSimulator

    threads = _int_env("QLAB_REWIND_THREADS", 1, 1, 16)
    sim = AerSimulator(method=method, noise_model=model, seed_simulator=seed, max_parallel_threads=threads,
                       max_parallel_experiments=1, max_parallel_shots=threads, shot_branching_enable=branching(),
                       max_memory_mb=max_memory_mb())
    try:
        result = sim.run(local, shots=shots).result()
    except Exception as exc:
        result, status = None, str(exc)
    else:
        status = "" if result.success else str(getattr(result, "status", "")) + " " + str(
            getattr(result.results[0], "status", "") if result.results else "")
    if result is None or not result.success:
        if "memory" in status.lower():
            raise ReplayError(422, f"This circuit needs more memory than a replay may use here ({max_memory_mb()} MB).")
        raise ReplayError(500, f"The simulator failed: {status}"[:300])
    return {str(k): int(v) for k, v in sorted(result.get_counts(0).items())}


def versions() -> dict[str, str]:
    return store.versions()


def requested_time(day: date) -> datetime:
    return datetime.combine(day, dtime(12, 0), tzinfo=timezone.utc)


def _gap_note(day: date, cal: datetime) -> tuple[float, str]:
    gap = (cal - requested_time(day)).total_seconds() / 86400.0
    when = cal.strftime("%Y-%m-%d %H:%M UTC")
    if cal.date() == day:
        return round(gap, 3), f"Used the calibration of {when}, from the day asked."
    days = abs((cal.date() - day).days)
    side = "before" if cal.date() < day else "after"
    return round(gap, 3), (f"No calibration is stored for {day.isoformat()}: used the nearest one, {when}, "
                           f"{days} day{'s' if days != 1 else ''} {side}.")


def replay(db: Session, machine: str, day: date, circuit_text: str, fmt: Optional[str] = None, shots: int = 1024,
           seed: Optional[int] = None, signed_in: bool = False, include_simulated: bool = False) -> dict[str, Any]:
    """Everything except the concurrency gate and time limit (see run_limited)."""
    cap = max_shots(signed_in)
    if not isinstance(shots, int) or shots < 1 or shots > cap:
        raise ReplayError(422, f"shots must be between 1 and {cap}" + ("" if signed_in else " without an account") + ".")
    row = store.nearest(db, machine, requested_time(day), include_simulated=include_simulated)
    if row is None:
        raise ReplayError(404, f"No calibration of {machine} is stored, so it can't be replayed. "
                               "GET /api/v1/rewind/machines lists the machines that can.")
    try:
        record = store.load(row)
    except store.SnapshotCorrupt as exc:
        raise ReplayError(500, str(exc))
    except OSError:
        raise ReplayError(500, "The stored calibration file is missing on this server.")

    circuit = read_circuit(circuit_text, fmt)
    notes = []
    if not any(i.operation.name == "measure" for i in circuit.data):
        circuit.measure_all()
        notes.append("The circuit measured nothing, so every qubit was measured at the end.")
    facts = check_circuit(circuit, max_qubits())
    if circuit.num_qubits > record["num_qubits"]:
        raise ReplayError(422, f"The circuit needs {circuit.num_qubits} qubits; {machine} has {record['num_qubits']}.")

    isa = transpile(circuit, record)
    local, physical = localize(isa)
    if len(physical) > max_qubits():
        raise ReplayError(422, f"Compiled for {machine} the circuit touches {len(physical)} qubits (routing adds some); "
                               f"Rewind replays up to {max_qubits()}.")
    n = len(physical)
    ops = sum(1 for i in local.data if i.operation.name != "barrier")
    method = "density_matrix" if n <= density_max() else "statevector"
    work = (4 ** n * ops) if method == "density_matrix" else (shots * ops * 2 ** n)
    if work > max_work(signed_in):
        raise ReplayError(422, f"This would take too long on this server ({n} qubits, {ops} operations, {shots} shots). "
                               "Use fewer shots or a smaller circuit.")
    model, summary = build_noise_model(record, physical)
    summary["method"] = method
    local, delays = relax_delays(local, record, physical)
    summary["delays_relaxed"] = delays
    seed = SEED_SIMULATOR if seed is None else int(seed)
    started = time.monotonic()
    counts = simulate(local, model, shots, seed, method)
    cal = row.calibrated_at if row.calibrated_at.tzinfo else row.calibrated_at.replace(tzinfo=timezone.utc)
    gap, note = _gap_note(day, cal)
    two_q = sum(1 for i in local.data if len(i.qubits) == 2 and i.operation.name != "barrier")
    from . import bench
    accuracy, accuracy_note = bench.accuracy_for(db, machine, include_simulated=include_simulated)
    return {
        "label": label(machine, cal),
        "machine": machine,
        "requested_date": day.isoformat(),
        "snapshot": {"calibrated_at": iso(cal), "sha256": row.sha256, "source": row.source,
                     "gap_days": gap, "note": note, "manifest_date": row.captured_at.date().isoformat()},
        "counts": counts,
        "shots": shots,
        "seeds": {"simulator": seed, "transpiler": mp.SEED_TRANSPILER},
        "circuit": facts,
        "transpiled": {"physical_qubits": physical, "depth": local.depth(), "operations": ops,
                       "two_qubit_gates": two_q, "optimization_level": mp.OPTIMIZATION_LEVEL},
        "noise_model": summary,
        "software": versions(),
        "seconds": round(time.monotonic() - started, 3),
        "accuracy": accuracy,
        "accuracy_note": accuracy_note,
        "real_hardware": False,
        "notes": notes,
    }


_gate: Optional[threading.BoundedSemaphore] = None
_gate_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="qlab-rewind-run")


def _semaphore() -> threading.BoundedSemaphore:
    global _gate
    with _gate_lock:
        if _gate is None:
            _gate = threading.BoundedSemaphore(_int_env("QLAB_REWIND_CONCURRENCY", 1, 1, 2))
        return _gate


def run_limited(fn) -> dict[str, Any]:
    """fn() if a slot is free, within the time limit. The slot stays taken until fn really ends,
    so a run that overran still counts against concurrency."""
    gate = _semaphore()
    if not gate.acquire(blocking=False):
        raise ReplayError(503, "Rewind is busy with another replay; try again in a few seconds.")

    def work():
        try:
            return fn()
        finally:
            gate.release()

    fut = _pool.submit(work)
    try:
        return fut.result(timeout=time_limit_s())
    except FutureTimeout:
        raise ReplayError(504, f"The replay took longer than {time_limit_s():.0f} s; use fewer shots or a smaller circuit.")
