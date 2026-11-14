"""Rewind part 3: how close a replica comes to the real machine, measured on real hardware.

Once a week the server runs a fixed set of small circuits with known answers (BENCH_VERSION) on a
few real IBM machines, then replays exactly the same compiled circuits on the replica built from the
calibration that was in force when the job ran, and compares the two distributions with the
Hellinger fidelity. The method, its limits and the published numbers: docs/REWIND_METHOD.md and
GET /api/v1/rewind/accuracy.

It reuses the hardware board's IBM access, job submission, polling and job table
(app/hardware_board.py: submit_to, collect_pending, hardware_board_jobs rows with set_version
BENCH_VERSION), and the board's background thread, which runs tick() after its own. QPU time comes
from one budget shared with the board (app/qpu_budget.py).

Environment:
    QLAB_REWIND_BENCH_MACHINES_PER_WEEK       machines per weekly run (default 3; 0 = off)
    QLAB_REWIND_BENCH_CIRCUITS                circuits from the set per run (default 20, all)
    QLAB_REWIND_BENCH_SHOTS                   shots per circuit (default 4000)
    QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D  QPU seconds per rolling 28 days for the board and this
                                              benchmark together (default 480 of the plan's 600)
Without QISKIT_IBM_TOKEN nothing runs. The board's local preview (QLAB_HARDWARE_BOARD_SIMULATE=1,
refused on Render) runs the "hardware" side on IBM's fake backends; such results are marked
simulated and never shown as real.
"""
from __future__ import annotations

import base64
import functools
import hashlib
import io
import json
import logging
import math
import os
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .. import hardware_board as hb
from .. import qpu_budget
from . import store
from .snapshot import iso

log = logging.getLogger("qlab.rewind.bench")

BENCH_VERSION = "rewind-bench-1"
METHOD_VERSION = "rewind-accuracy-1"
SOURCE = "rewind-bench"
STATE_ID = 2  # hardware_board_state row for this schedule (row 1 is the board's)
EVERY_DAYS = 7.0
RETRY = timedelta(days=1)  # when nothing could be submitted (no fresh calibration, budget)
FRESH = timedelta(hours=48)  # a machine is chosen only with a calibration at most this old
SETTLE = timedelta(hours=36)  # wait this long for the harvest to store the calibration in force
ROLLING = timedelta(days=90)
POOR_MEDIAN = 0.9
NOT_MEASURED = "Not yet measured for this machine"
METHOD_URL = "https://github.com/soqlab/Q-lab/blob/main/docs/REWIND_METHOD.md"


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


def machines_per_week() -> int:
    return _int_env("QLAB_REWIND_BENCH_MACHINES_PER_WEEK", 3, 0, 20)


def circuits_per_run() -> int:
    return _int_env("QLAB_REWIND_BENCH_CIRCUITS", len(_SPECS), 1, len(_SPECS))


def shots() -> int:
    return _int_env("QLAB_REWIND_BENCH_SHOTS", 4000, 100, 100_000)


def configured() -> bool:
    return hb.configured()


def enabled() -> bool:
    return configured() and machines_per_week() > 0


def not_running_reason() -> Optional[str]:
    if not configured():
        return ("This server has no IBM Quantum key (QISKIT_IBM_TOKEN), so the benchmark does not run and "
                "nothing is measured. No numbers are made up in its place.")
    if machines_per_week() == 0:
        return "The benchmark is switched off on this server (QLAB_REWIND_BENCH_MACHINES_PER_WEEK=0)."
    return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# The benchmark set. Deterministic: no library randomness, fixed seeds, fixed gate lists. Change a
# circuit -> bump BENCH_VERSION (set_digest() pins the content in the tests).
# ---------------------------------------------------------------------------

_ONE_QUBIT_CLIFFORDS = ("h", "s", "sdg", "x", "y", "z", "sx", "sxdg")


def _pick(seed: int, i: int, n: int) -> int:
    """A deterministic choice in range(n): the same on every machine and Python version."""
    return int.from_bytes(hashlib.sha256(f"{seed}:{i}".encode()).digest()[:8], "big") % n


def _bell():
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(2, name="bell")
    qc.h(0)
    qc.cx(0, 1)
    qc.measure_all()
    return qc


def _ghz(n: int):
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(n, name=f"ghz{n}")
    qc.h(0)
    for i in range(n - 1):
        qc.cx(i, i + 1)
    qc.measure_all()
    return qc


def _qft_body(n: int):
    """The textbook QFT with final swaps: |x> -> sum_y e^(2 pi i x y / 2^n) |y> / sqrt(2^n)."""
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(n, name=f"qft{n}")
    for j in reversed(range(n)):
        qc.h(j)
        for k in reversed(range(j)):
            qc.cp(math.pi / 2 ** (j - k), k, j)
    for i in range(n // 2):
        qc.swap(i, n - 1 - i)
    return qc


def _qft_on_basis(n: int, x: int):
    """QFT applied to the basis state |x>: every outcome equally likely."""
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(n, name=f"qft{n}_x{x}")
    for q in range(n):
        if (x >> q) & 1:
            qc.x(q)
    qc.compose(_qft_body(n), inplace=True)
    qc.measure_all()
    return qc


def _qft_inverse_to_basis(n: int, x: int):
    """Prepare QFT|x> as a product state (H then a phase on each qubit), then apply the inverse QFT:
    ideally always x. Exercises the QFT's controlled phases with a sharp answer."""
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(n, name=f"iqft{n}_x{x}")
    for q in range(n):
        qc.h(q)
        qc.p(2 * math.pi * x * 2 ** q / 2 ** n, q)
    qc.barrier()
    qc.compose(_qft_body(n).inverse(), inplace=True)
    qc.measure_all()
    return qc


def _mirror(width: int, depth: int, seed: int):
    """depth random Clifford layers (two one-qubit Cliffords per qubit, then CX on a random pairing),
    then their exact inverse, then X on a seeded bitstring: ideally always that bitstring."""
    from qiskit import QuantumCircuit
    layers = QuantumCircuit(width)
    i = 0
    for _ in range(depth):
        for q in range(width):
            for _g in range(2):
                getattr(layers, _ONE_QUBIT_CLIFFORDS[_pick(seed, i, len(_ONE_QUBIT_CLIFFORDS))])(q)
                i += 1
        order = list(range(width))
        for k in range(width - 1, 0, -1):  # Fisher-Yates with the deterministic picker
            j = _pick(seed, i, k + 1)
            i += 1
            order[k], order[j] = order[j], order[k]
        for a in range(0, width - 1, 2):
            layers.cx(order[a], order[a + 1])
        layers.barrier()
    qc = QuantumCircuit(width, name=f"mirror_w{width}_d{depth}")
    qc.compose(layers, inplace=True)
    qc.compose(layers.inverse(), inplace=True)
    qc.barrier()
    flips = [q for q in range(width) if _pick(seed, i + q, 2)] or [_pick(seed, i + width, width)]
    for q in flips:  # never all zeros, so "nothing happened" can't pass for the right answer
        qc.x(q)
    qc.measure_all()
    return qc


def _idle_relax(us: float):
    """Excite, wait, measure: ideally always 1; energy relaxation (T1) pulls it towards 0."""
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(1, name="idle_t1")
    qc.x(0)
    qc.delay(us, 0, unit="us")
    qc.measure_all()
    return qc


def _idle_echo(us: float):
    """A Hahn echo: H, wait, X, wait, H. Ideally always 0; dephasing (T2) pulls it towards 50/50."""
    from qiskit import QuantumCircuit
    qc = QuantumCircuit(1, name="idle_echo")
    qc.h(0)
    qc.delay(us / 2, 0, unit="us")
    qc.x(0)
    qc.delay(us / 2, 0, unit="us")
    qc.h(0)
    qc.measure_all()
    return qc


def _spec(cid: str, title: str, qubits: int, description: str, build: Callable[[], Any]) -> dict[str, Any]:
    return {"id": cid, "title": title, "qubits": qubits, "description": description, "build": build}


_SPECS: list[dict[str, Any]] = [
    _spec("bell", "Bell pair", 2, "Two entangled qubits: half 00, half 11.", _bell),
    *[_spec(f"ghz{n}", f"GHZ, {n} qubits", n, f"{n} qubits all 0 or all 1 together.", (lambda n=n: _ghz(n)))
      for n in (3, 4, 5, 6, 8, 10)],
    _spec("qft3", "QFT, 3 qubits, on |101>", 3, "The quantum Fourier transform of a basis state: every outcome "
          "equally likely.", lambda: _qft_on_basis(3, 5)),
    _spec("iqft3", "Inverse QFT, 3 qubits, to |101>", 3, "A Fourier state taken back by the inverse QFT: "
          "always 101.", lambda: _qft_inverse_to_basis(3, 5)),
    _spec("iqft4", "Inverse QFT, 4 qubits, to |1011>", 4, "The same on 4 qubits: always 1011.",
          lambda: _qft_inverse_to_basis(4, 11)),
    *[_spec(f"mirror_w{w}_d{d}", f"Mirror, {w} qubits, {d} layers", w,
            f"{d} random Clifford layers, then their inverse, then a fixed bit flip pattern: always one known "
            "bitstring.", (lambda w=w, d=d, s=s: _mirror(w, d, s)))
      for w, d, s in ((2, 4, 101), (3, 4, 102), (3, 8, 103), (4, 4, 104), (4, 8, 105), (5, 6, 106),
                      (6, 4, 107), (6, 8, 108))],
    _spec("idle_t1", "Idle 40 µs after X", 1, "Excite one qubit, wait 40 µs, measure: always 1 without "
          "relaxation (T1).", lambda: _idle_relax(40.0)),
    _spec("idle_echo", "Echo over 40 µs", 1, "A Hahn echo spread over 40 µs: always 0 without dephasing (T2).",
          lambda: _idle_echo(40.0)),
]
BY_ID = {s["id"]: s for s in _SPECS}
_ideal_cache: dict[str, dict[str, float]] = {}


def ideal_of(cid: str) -> dict[str, float]:
    """The noise-free outcome distribution, computed exactly (delays are waits, i.e. identity)."""
    hit = _ideal_cache.get(cid)
    if hit is not None:
        return hit
    from qiskit import QuantumCircuit
    from qiskit.quantum_info import Statevector

    qc = BY_ID[cid]["build"]()
    bare = QuantumCircuit(qc.num_qubits)
    for inst in qc.data:
        if inst.operation.name not in ("measure", "barrier", "delay"):
            bare.append(inst.operation, [qc.find_bit(q).index for q in inst.qubits])
    probs = Statevector(bare).probabilities_dict()
    out = {str(k): round(float(v), 9) for k, v in sorted(probs.items()) if v > 1e-9}
    _ideal_cache[cid] = out
    return out


def bench_set(n: Optional[int] = None) -> list[dict[str, Any]]:
    """The first n circuits of the set (all by default), with their ideal answers."""
    specs = _SPECS[: (n or circuits_per_run())]
    return [{**s, "ideal": ideal_of(s["id"])} for s in specs]


def _canonical(qc) -> list:
    return [[inst.operation.name, [qc.find_bit(q).index for q in inst.qubits],
             [round(float(p), 12) for p in inst.operation.params]] for inst in qc.data]


@functools.lru_cache(maxsize=1)
def set_digest() -> str:
    """SHA-256 of every circuit's operations, qubits and parameters, in order."""
    doc = [[s["id"], _canonical(s["build"]())] for s in _SPECS]
    return hashlib.sha256(json.dumps(doc, separators=(",", ":")).encode()).hexdigest()


def public_set() -> dict[str, Any]:
    return {"version": BENCH_VERSION, "digest": set_digest(), "shots": shots(), "circuits_per_run": circuits_per_run(),
            "circuits": [{k: s[k] for k in ("id", "title", "qubits", "description", "ideal")} for s in bench_set(len(_SPECS))]}


# ---------------------------------------------------------------------------
# Comparing distributions
# ---------------------------------------------------------------------------

def hellinger(p: dict[str, float], q: dict[str, float]) -> float:
    """Hellinger fidelity (sum_x sqrt(p(x) q(x)))^2 between two distributions given as counts or
    probabilities (each is normalized first); qiskit.quantum_info.hellinger_fidelity's definition."""
    sp, sq = float(sum(p.values())), float(sum(q.values()))
    if sp <= 0 or sq <= 0:
        return 0.0
    bc = sum(math.sqrt((p[k] / sp) * (q[k] / sq)) for k in p.keys() & q.keys() if p[k] > 0 and q[k] > 0)
    return min(1.0, bc * bc)


def _median(xs: list[float]) -> Optional[float]:
    return round(float(statistics.median(xs)), 6) if xs else None


# ---------------------------------------------------------------------------
# Choosing machines and submitting (through the hardware board's pipeline)
# ---------------------------------------------------------------------------

def _visible(include_simulated: bool) -> tuple[str, ...]:
    return ("harvest", "backfill", "simulated") if include_simulated else ("harvest", "backfill")


def fresh(db: Session, machine: str, now: datetime, include_simulated: bool) -> bool:
    """A calibration of the machine is stored and recent enough to build its replica from. A
    simulated preview's fake machines never recalibrate, so for them it is how recently it was read."""
    row = store.latest(db, "ibm", machine, include_simulated=include_simulated)
    if row is None:
        return False
    when = _aware(row.captured_at if row.source == "simulated" else row.calibrated_at)
    return now - when <= FRESH


def last_benchmarked(db: Session) -> dict[str, datetime]:
    from ..models import HardwareBoardJob as J
    rows = db.execute(select(J.backend, func.max(J.submitted_at)).where(J.set_version.like("rewind-bench%"))
                      .group_by(J.backend)).all()
    return {name: _aware(when) for name, when in rows}


def choose(db: Session, p, now: datetime, n: int, min_qubits: int) -> list:
    """Round robin: operational machines with a fresh calibration, least recently benchmarked first."""
    sim = hb.simulated()
    last = last_benchmarked(db)
    never = datetime(1970, 1, 1, tzinfo=timezone.utc)
    found = []
    for b in p.backends():
        try:
            if b.num_qubits < min_qubits or not b.status().operational:
                continue
        except Exception:
            continue
        if fresh(db, str(b.name), now, sim):
            found.append(b)
    found.sort(key=lambda b: (last.get(str(b.name), never), str(b.name)))
    return found[:n]


def _note(db: Session, message: str) -> None:
    hb._note(db, message, state_id=STATE_ID)


def _set_next_due(db: Session, when: datetime) -> None:
    from ..models import HardwareBoardState
    db.execute(update(HardwareBoardState).where(HardwareBoardState.id == STATE_ID).values(next_due=when))
    db.commit()


def submit(db: Session, now: Optional[datetime] = None) -> dict[str, Any]:
    """One run: the set on up to machines_per_week() machines, each job only if the budget allows."""
    now = now or _now()
    out: dict[str, Any] = {"submitted": [], "problems": []}
    circuits = bench_set()
    n_shots = shots()
    sim = hb.simulated()
    try:
        p = hb._provider()
        machines = choose(db, p, now, max(1, machines_per_week()), max(c["qubits"] for c in circuits))
    except Exception as exc:
        out["problems"].append(f"IBM Quantum could not be reached ({type(exc).__name__}).")
        machines = []
    if not machines and not out["problems"]:
        out["problems"].append("No operational machine with a calibration from the last "
                               f"{int(FRESH.total_seconds() // 3600)} hours, so nothing was submitted.")
    est = qpu_budget.estimate_seconds(len(circuits), n_shots)
    for b in machines:
        held = qpu_budget.reserve(db, SOURCE, str(b.name), est, simulated=sim, now=now)
        if held is None:
            out["problems"].append(f"{b.name}: not submitted; about {est:g} s more would take the server past its "
                                   f"shared QPU budget of {qpu_budget.budget_seconds():g} s per 28 days "
                                   f"({qpu_budget.used_seconds(db, sim, now):g} s used).")
            break
        try:
            row = hb.submit_to(db, b, sim, benchmarks=circuits, set_version=BENCH_VERSION, shots=n_shots, keep_isa=True)
            qpu_budget.attach(db, held, row.job_id)
            out["submitted"].append({"machine": row.backend, "job_id": row.job_id, "estimated_seconds": est})
        except Exception as exc:
            db.rollback()
            qpu_budget.release(db, held)
            out["problems"].append(f"{b.name}: not submitted ({type(exc).__name__}: {str(exc)[:200]})")
    parts = []
    if out["submitted"]:
        parts.append("Submitted to " + ", ".join(s["machine"] for s in out["submitted"]) + ".")
    parts += out["problems"]
    _note(db, " ".join(parts))
    if not out["submitted"]:
        _set_next_due(db, now + RETRY)
    return out


# ---------------------------------------------------------------------------
# Results: the hardware side (called by hardware_board.collect_pending), then the replica side
# ---------------------------------------------------------------------------

def _executed_at(job, fallback: datetime) -> datetime:
    """When the job ran on the machine (IBM's 'running' timestamp), else when it was collected."""
    try:
        ts = ((job.metrics() or {}).get("timestamps") or {}).get("running")
        if isinstance(ts, str) and ts:
            return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)
        if isinstance(ts, datetime):
            return _aware(ts)
    except Exception:
        pass
    return fallback


def record_hardware(db: Session, row, counts_list: list[dict[str, int]], job=None, now: Optional[datetime] = None) -> None:
    """Keep the hardware counts on the job row and queue the replica comparison."""
    from ..models import RewindAccuracy

    now = now or _now()
    results = []
    for meta, counts in zip(row.circuits, counts_list):
        ideal = ideal_of(meta["circuit"]) if meta["circuit"] in BY_ID else {}
        results.append({"circuit": meta["circuit"], "counts": dict(sorted(counts.items())),
                        "hellinger": round(hellinger(counts, ideal), 6) if ideal else None})
    row.results = results
    row.status = "done"
    row.provider_status = "DONE"
    row.finished_at = now
    if db.scalar(select(RewindAccuracy).where(RewindAccuracy.job_id == row.job_id)) is None:
        db.add(RewindAccuracy(job_id=row.job_id, machine=row.backend, bench_version=row.set_version,
                              simulated=bool(row.simulated), status="waiting",
                              executed_at=_executed_at(job, now) if job is not None else now,
                              shots=row.shots, n_circuits=len(results), circuits=[]))
    db.commit()


def in_force(db: Session, machine: str, when: datetime, include_simulated: bool):
    """The latest stored calibration made at or before `when`: the one the machine ran with."""
    from ..models import MachineSnapshot as M
    return db.scalar(select(M).where(M.provider == "ibm", M.machine == machine, M.calibrated_at <= when,
                                     M.source.in_(_visible(include_simulated)))
                     .order_by(M.calibrated_at.desc()).limit(1))


def _settled(db: Session, acc, now: datetime) -> bool:
    """Has a harvest run since the job did, so the calibration in force then is stored by now?"""
    if acc.simulated or now - _aware(acc.executed_at) >= SETTLE:
        return True
    from ..models import MachineSnapshot as M
    later = db.scalar(select(func.count(M.id)).where(M.provider == "ibm", M.machine == acc.machine,
                                                     M.captured_at >= acc.executed_at,
                                                     M.source.in_(_visible(False))))
    return bool(later)


def _load_isa(b64: str):
    from qiskit import qpy
    return qpy.load(io.BytesIO(base64.b64decode(b64)))[0]


def replica_counts(record: dict[str, Any], isa, shots_: int, dt_s: Optional[float] = None) -> tuple[dict[str, int], dict[str, Any]]:
    """The compiled circuit as it ran on hardware, on the replica of that calibration."""
    from . import replay as rp

    local, physical = rp.localize(isa)
    model, _summary = rp.build_noise_model(record, physical)
    local, delays = rp.relax_delays(local, record, physical, dt_s)
    method = "density_matrix" if len(physical) <= rp.density_max() else "statevector"
    counts = rp.simulate(local, model, shots_, rp.SEED_SIMULATOR, method)
    two_q = sum(1 for i in local.data if len(i.qubits) == 2 and i.operation.name != "barrier")
    return counts, {"physical_qubits": physical, "two_qubit_gates": two_q, "depth": local.depth(), "method": method,
                    "delays_relaxed": delays}


def compare(db: Session, acc, job_row, now: Optional[datetime] = None) -> None:
    now = now or _now()
    when = _aware(acc.executed_at)
    snap = in_force(db, acc.machine, when, acc.simulated)
    rule = "in force when the job ran"
    if snap is None:
        snap = store.nearest(db, acc.machine, when, include_simulated=acc.simulated)
        rule = "nearest (none stored from before the job)"
    if snap is None:
        acc.status, acc.error = "error", "No calibration of this machine is stored, so there is no replica to compare."
        db.commit()
        return
    record = store.load(snap)
    hw = {r["circuit"]: r for r in job_row.results or []}
    out, fids = [], []
    for meta in job_row.circuits:
        cid = meta["circuit"]
        h = hw.get(cid)
        if not h or not meta.get("isa_qpy"):
            continue
        rep, facts = replica_counts(record, _load_isa(meta["isa_qpy"]), acc.shots, meta.get("dt"))
        ideal = ideal_of(cid) if cid in BY_ID else {}
        f = round(hellinger(h["counts"], rep), 6)
        fids.append(f)
        out.append({"circuit": cid, "hardware_vs_replica": f,
                    "hardware_vs_ideal": round(hellinger(h["counts"], ideal), 6) if ideal else None,
                    "replica_vs_ideal": round(hellinger(rep, ideal), 6) if ideal else None,
                    "hardware_counts": h["counts"], "replica_counts": rep, **facts})
    acc.circuits = out
    acc.n_circuits = len(out)
    acc.median = _median(fids)
    acc.worst = round(min(fids), 6) if fids else None
    acc.snapshot_sha256 = snap.sha256
    acc.snapshot_calibrated_at = snap.calibrated_at
    acc.snapshot_rule = rule
    acc.measured_at = now
    acc.status = "done" if fids else "error"
    acc.error = None if fids else "No circuit of this job could be compared."
    db.commit()


def compare_pending(db: Session, now: Optional[datetime] = None) -> int:
    from ..models import HardwareBoardJob, RewindAccuracy

    now = now or _now()
    done = 0
    for acc in db.scalars(select(RewindAccuracy).where(RewindAccuracy.status == "waiting")).all():
        if not _settled(db, acc, now):
            continue
        job_row = db.scalar(select(HardwareBoardJob).where(HardwareBoardJob.job_id == acc.job_id))
        try:
            if job_row is None:
                raise LookupError("the hardware job is no longer stored")
            compare(db, acc, job_row, now)
            done += acc.status == "done"
        except Exception as exc:
            db.rollback()
            acc.status, acc.error = "error", f"The replica could not be run ({type(exc).__name__}: {str(exc)[:200]})."
            acc.measured_at = now
            db.commit()
            log.warning("rewind bench: compare %s failed: %s", acc.job_id, type(exc).__name__)
    return done


def tick(db: Session, force: bool = False, now: Optional[datetime] = None) -> dict[str, Any]:
    """Submit the weekly run when due (or forced), then compare finished jobs with their replicas.
    Finished jobs are collected by the hardware board's own tick (hardware_board.collect_pending)."""
    out: dict[str, Any] = {"submitted": [], "problems": [], "compared": 0}
    if not configured():
        return out
    now = now or _now()
    if (enabled() or force) and hb.claim_due(db, now=now, force=force, state_id=STATE_ID, days=EVERY_DAYS):
        out.update(submit(db, now))
    out["compared"] = compare_pending(db, now)
    return out


# ---------------------------------------------------------------------------
# What is published
# ---------------------------------------------------------------------------

def _rows(db: Session, include_simulated: bool, machine: Optional[str] = None) -> list:
    from ..models import RewindAccuracy as A
    q = select(A).where(A.status == "done").order_by(A.executed_at.asc(), A.id.asc())
    if not include_simulated:
        q = q.where(A.simulated.is_(False))
    if machine:
        q = q.where(A.machine == machine)
    return list(db.scalars(q).all())


def _run(r, detail: bool) -> dict[str, Any]:
    d = {"job_id": r.job_id, "bench_version": r.bench_version, "executed_at": iso(_aware(r.executed_at)),
         "compared_at": iso(_aware(r.measured_at)) if r.measured_at else None, "shots": r.shots,
         "n_circuits": r.n_circuits, "median": r.median, "worst": r.worst, "simulated": bool(r.simulated),
         "snapshot": {"sha256": r.snapshot_sha256, "rule": r.snapshot_rule,
                      "calibrated_at": iso(_aware(r.snapshot_calibrated_at)) if r.snapshot_calibrated_at else None}}
    keys = ("circuit", "hardware_vs_replica", "hardware_vs_ideal", "replica_vs_ideal")
    if detail:
        keys += ("hardware_counts", "replica_counts", "physical_qubits", "two_qubit_gates", "depth")
    d["circuits"] = [{k: c.get(k) for k in keys} for c in r.circuits or []]
    return d


def machine_summaries(db: Session, include_simulated: bool = False, now: Optional[datetime] = None) -> list[dict[str, Any]]:
    now = now or _now()
    by: dict[str, list] = {}
    for r in _rows(db, include_simulated):
        by.setdefault(r.machine, []).append(r)
    out = []
    for machine, rows in sorted(by.items()):
        latest = rows[-1]
        recent = [r for r in rows if now - _aware(r.executed_at) <= ROLLING]
        fids = [c["hardware_vs_replica"] for r in recent for c in (r.circuits or []) if c.get("hardware_vs_replica") is not None]
        out.append({
            "machine": machine,
            "latest": _run(latest, detail=True),
            "window": {"days": ROLLING.days, "runs": len(recent), "n_circuits": len(fids), "median": _median(fids),
                       "worst": round(min(fids), 6) if fids else None,
                       "from": iso(_aware(recent[0].executed_at)) if recent else None,
                       "to": iso(_aware(recent[-1].executed_at)) if recent else None},
            "runs": [_run(r, detail=False) for r in rows],
        })
    return out


def _f(x: float) -> str:
    """Two decimals, or three when two would round a poor match up to the threshold."""
    s = f"{x:.2f}"
    return f"{x:.3f}" if x < POOR_MEDIAN and float(s) >= POOR_MEDIAN else s


def _day(dt: datetime) -> str:
    return f"{dt.day} {dt.strftime('%b %Y')}"


def note_for(machine: str, median: float, worst: float, n: int, when: datetime, simulated: bool = False) -> str:
    what = "the simulated machine (a local preview, not real hardware)" if simulated else "real hardware"
    if median < POOR_MEDIAN:
        return (f"On {machine}, replicas did not match {what} well: median Hellinger fidelity {_f(median)} "
                f"(worst {_f(worst)}) on our {n}-circuit benchmark, {_day(when)}. Treat replays of this "
                "machine as rough; the real machine was noisier or behaved differently than its calibration says.")
    return (f"On {machine}, replicas matched {what} with median Hellinger fidelity {_f(median)} "
            f"(worst {_f(worst)}) on our {n}-circuit benchmark, {_day(when)}.")


def accuracy_for(db: Session, machine: str, include_simulated: bool = False) -> tuple[Optional[dict[str, Any]], str]:
    """(accuracy, accuracy_note) for a replay's answer: the latest measurement of that machine."""
    try:
        rows = _rows(db, include_simulated, machine)
    except Exception:  # never fail a replay over its accuracy line
        db.rollback()
        return None, NOT_MEASURED
    if not rows:
        return None, NOT_MEASURED
    latest = rows[-1]
    when = _aware(latest.executed_at)
    recent = [r for r in rows if _now() - _aware(r.executed_at) <= ROLLING]
    fids = [c["hardware_vs_replica"] for r in recent for c in (r.circuits or []) if c.get("hardware_vs_replica") is not None]
    acc = {"median": latest.median, "worst": latest.worst, "n_circuits": latest.n_circuits,
           "measured_at": iso(when), "bench_version": latest.bench_version, "method_version": METHOD_VERSION,
           "job_id": latest.job_id, "simulated": bool(latest.simulated), "poor_match": latest.median < POOR_MEDIAN,
           "window": {"days": ROLLING.days, "runs": len(recent), "n_circuits": len(fids), "median": _median(fids),
                      "worst": round(min(fids), 6) if fids else None},
           "details": "/api/v1/rewind/accuracy", "method": METHOD_URL}
    return acc, note_for(machine, latest.median, latest.worst, latest.n_circuits, when, bool(latest.simulated))


def report(db: Session) -> dict[str, Any]:
    from ..models import HardwareBoardJob, HardwareBoardState, RewindAccuracy

    sim = hb.simulated()
    state = db.get(HardwareBoardState, STATE_ID)
    q = select(HardwareBoardJob).where(HardwareBoardJob.set_version.like("rewind-bench%"),
                                       HardwareBoardJob.status == "pending")
    if not sim:
        q = q.where(HardwareBoardJob.simulated.is_(False))
    pending = [{"machine": r.backend, "job_id": r.job_id, "submitted": iso(_aware(r.submitted_at)),
                "status": r.provider_status or "SUBMITTED"} for r in db.scalars(q).all()]
    wq = select(RewindAccuracy).where(RewindAccuracy.status.in_(("waiting", "error")))
    if not sim:
        wq = wq.where(RewindAccuracy.simulated.is_(False))
    other = [{"machine": r.machine, "job_id": r.job_id, "status": r.status, "executed_at": iso(_aware(r.executed_at)),
              "error": r.error} for r in db.scalars(wq.order_by(RewindAccuracy.executed_at.desc()).limit(20)).all()]
    return {
        "method_version": METHOD_VERSION,
        "method": METHOD_URL,
        "running": enabled(),
        "simulated": sim,
        "reason": not_running_reason(),
        "metric": "Hellinger fidelity between the real machine's and the replica's outcome distributions for the "
                  "same compiled circuits, shots and qubits (1 = identical, 0 = nothing in common).",
        "poor_below": POOR_MEDIAN,
        "bench": public_set(),
        "schedule": {"every_days": EVERY_DAYS, "machines_per_run": machines_per_week(),
                     "next_due": iso(_aware(state.next_due)) if state and enabled() else None,
                     "last_submitted": iso(_aware(state.last_submitted)) if state and state.last_submitted else None,
                     "last_message": state.last_message if state else None},
        "budget": qpu_budget.status(db, sim),
        "pending": pending,
        "not_compared": other,
        "machines": machine_summaries(db, include_simulated=sim),
        "caveats": [
            "Replicas are expected to look better than reality: the noise model has no crosstalk, leakage, "
            "coherent errors, idle decoherence between gates, or drift within the day.",
            "Both sides are finite samples, so even a perfect replica scores slightly under 1.",
            "Calibration data is IBM's and is not republished here; the hardware counts are from this server's "
            "own benchmark jobs. Not affiliated with or endorsed by IBM.",
        ],
    }
