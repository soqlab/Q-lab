"""The hardware board: real IBM quantum computers' status, queue and calibration, plus a small fixed
benchmark run on them every few days, each result kept as a Q-Lab run.

Everything here uses the server's own IBM Quantum key (QISKIT_IBM_TOKEN, the free open plan is
enough). Without it the board says so and shows nothing: no numbers are ever made up.

Environment:
    QISKIT_IBM_TOKEN                 IBM Quantum API key. Without it the board is off.
    QISKIT_IBM_INSTANCE              the instance (CRN), if the account has more than one.
    QLAB_HARDWARE_BOARD_EVERY_DAYS   days between benchmarks (default 7; 0 = live status only).
    QLAB_HARDWARE_BOARD_BACKENDS     comma-separated machines to benchmark (default: up to
                                     QLAB_HARDWARE_BOARD_MAX operational ones, alphabetically).
    QLAB_HARDWARE_BOARD_MAX          default 3.
    QLAB_HARDWARE_BOARD_SCHEDULER    "off" stops the background thread (the API still works).
    QLAB_HARDWARE_BOARD_SIMULATE     "1" = local preview on IBM's fake backends with a simulator.
                                     Every result is marked simulated. Refused on Render.

Why results are read from hardware_board_jobs and not from the runs table: run rows can also be
written through the run API, so the board only trusts what this module wrote itself. The run rows
are the tracked copies, public through their share links.
"""
from __future__ import annotations

import hashlib
import logging
import os
import platform
import secrets
import statistics
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

log = logging.getLogger("qlab.hardware_board")

# ---------------------------------------------------------------------------
# The benchmark set. Every run on every machine uses exactly these circuits, so results compare
# across machines and over time. Change a circuit -> bump SET_VERSION: points recorded under
# different versions are never drawn on one line.
# ---------------------------------------------------------------------------

SET_VERSION = "2026.11-1"
# Four circuits x 1000 shots: a few seconds of QPU time per machine.
SHOTS = 1000
OPTIMIZATION_LEVEL = 1
SEED_TRANSPILER = 7
PROJECT = "hardware-board"
SOURCE = "hardware-board"
GIVE_UP_AFTER = timedelta(days=14)
LIVE_TTL_S = 300
LIVE_WAIT_S = 20.0
TICK_S = 600


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


def _mirror3():
    """A fixed 3-qubit layer, then its exact inverse: ideally always 000."""
    from qiskit import QuantumCircuit
    layer = QuantumCircuit(3)
    layer.h(0)
    layer.rx(0.7, 1)
    layer.ry(1.3, 2)
    layer.cx(0, 1)
    layer.rz(0.4, 1)
    layer.cx(1, 2)
    layer.s(0)
    layer.rx(2.1, 2)
    layer.cx(2, 0)
    qc = QuantumCircuit(3, name="mirror3")
    qc.compose(layer, inplace=True)
    qc.barrier()
    qc.compose(layer.inverse(), inplace=True)
    qc.measure_all()
    return qc


BENCHMARKS: list[dict[str, Any]] = [
    {"id": "bell", "title": "Bell pair", "qubits": 2,
     "description": "Two entangled qubits. Ideally half 00, half 11.",
     "build": _bell, "ideal": {"00": 0.5, "11": 0.5}},
    {"id": "ghz3", "title": "GHZ, 3 qubits", "qubits": 3,
     "description": "Three qubits all 0 or all 1 together. Ideally half 000, half 111.",
     "build": lambda: _ghz(3), "ideal": {"000": 0.5, "111": 0.5}},
    {"id": "ghz5", "title": "GHZ, 5 qubits", "qubits": 5,
     "description": "The same across five qubits in a chain. Errors add up with every link.",
     "build": lambda: _ghz(5), "ideal": {"00000": 0.5, "11111": 0.5}},
    {"id": "mirror3", "title": "Mirror, 3 qubits", "qubits": 3,
     "description": "A fixed layer of gates, then its exact inverse. Ideally always 000.",
     "build": _mirror3, "ideal": {"000": 1.0}},
]
BY_ID = {b["id"]: b for b in BENCHMARKS}

METRICS = [
    {"id": "hellinger", "title": "Hellinger fidelity",
     "description": "How close the measured distribution is to the ideal one (1 = identical, 0 = nothing in common)."},
    {"id": "success", "title": "Ideal-outcome probability",
     "description": "Share of shots that landed on an outcome the noise-free circuit can produce."},
]


def hellinger_fidelity(counts: dict[str, int], ideal: dict[str, float]) -> float:
    """(sum_x sqrt(p(x) q(x)))^2, the same definition as qiskit.quantum_info.hellinger_fidelity."""
    total = sum(counts.values())
    if total <= 0:
        return 0.0
    bc = sum((counts.get(k, 0) / total) ** 0.5 * v ** 0.5 for k, v in ideal.items())
    return bc * bc


def success(counts: dict[str, int], ideal: dict[str, float]) -> float:
    total = sum(counts.values())
    if total <= 0:
        return 0.0
    return sum(counts.get(k, 0) for k in ideal) / total


def public_set() -> dict[str, Any]:
    return {
        "version": SET_VERSION,
        "shots": SHOTS,
        "circuits": [{k: b[k] for k in ("id", "title", "qubits", "description", "ideal")} for b in BENCHMARKS],
        "metrics": METRICS,
    }


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:  # SQLite hands back naive datetimes
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def simulated() -> bool:
    """Local preview only. Never on Render, whatever the environment says."""
    return os.getenv("QLAB_HARDWARE_BOARD_SIMULATE", "").strip() == "1" and not os.getenv("RENDER")


def configured() -> bool:
    return bool(os.getenv("QISKIT_IBM_TOKEN", "").strip()) or simulated()


def every_days() -> float:
    raw = os.getenv("QLAB_HARDWARE_BOARD_EVERY_DAYS", "7").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 7.0


def benchmark_enabled() -> bool:
    return configured() and every_days() > 0


def _max_backends() -> int:
    try:
        return max(1, int(os.getenv("QLAB_HARDWARE_BOARD_MAX", "3")))
    except ValueError:
        return 3


def _chosen_names() -> list[str]:
    return [n.strip() for n in os.getenv("QLAB_HARDWARE_BOARD_BACKENDS", "").split(",") if n.strip()]


# ---------------------------------------------------------------------------
# IBM access. Tests replace `provider` with a stand-in.
# ---------------------------------------------------------------------------

class _IBM:
    """The real thing: IBM's client library, signed in with the server's key."""

    def __init__(self) -> None:
        self._service = None
        self._lock = threading.Lock()

    def service(self):
        with self._lock:
            if self._service is None:
                from qiskit_ibm_runtime import QiskitRuntimeService
                kw: dict[str, Any] = {"channel": "ibm_quantum_platform", "token": os.environ["QISKIT_IBM_TOKEN"].strip()}
                if os.getenv("QISKIT_IBM_INSTANCE", "").strip():
                    kw["instance"] = os.environ["QISKIT_IBM_INSTANCE"].strip()
                self._service = QiskitRuntimeService(**kw)
            return self._service

    def backends(self) -> list:
        return list(self.service().backends(simulator=False))

    def backend(self, name: str):
        return self.service().backend(name)

    def job(self, job_id: str):
        return self.service().job(job_id)


class LostSimulatedJob(Exception):
    """A preview job lives only in the process that ran it."""


class _Simulated:
    """IBM's fake backends (snapshots of real machines' calibration) on a local simulator."""

    def __init__(self) -> None:
        self._jobs: dict[str, Any] = {}

    def backends(self) -> list:
        from qiskit_ibm_runtime.fake_provider import FakeFez, FakeSherbrooke, FakeTorino
        return [FakeFez(), FakeSherbrooke(), FakeTorino()]

    def backend(self, name: str):
        for b in self.backends():
            if b.name == name:
                return b
        raise KeyError(name)

    def remember(self, job) -> None:
        self._jobs[job.job_id()] = job

    def job(self, job_id: str):
        if job_id not in self._jobs:
            raise LostSimulatedJob("This simulated job ran in a server process that has since stopped.")
        return self._jobs[job_id]


provider: Any = None
_provider_lock = threading.Lock()


def _provider():
    global provider
    with _provider_lock:
        if provider is None:
            provider = _Simulated() if simulated() else _IBM()
        return provider


def _status_name(status: Any) -> str:
    s = getattr(status, "name", status)
    return str(s).split(".")[-1].upper()


# ---------------------------------------------------------------------------
# Live status: status, queue, calibration summary. Cached, fetched in the background.
# ---------------------------------------------------------------------------

def _median(xs: list[Optional[float]]) -> Optional[float]:
    vals = [x for x in xs if isinstance(x, (int, float)) and x == x]
    return round(float(statistics.median(vals)), 6) if vals else None


def _two_qubit_ops(target) -> list[str]:
    out = []
    for name in getattr(target, "operation_names", []) or []:
        try:
            qargs = list(target[name].keys())
        except Exception:
            continue
        if name not in ("measure", "delay", "reset") and qargs and qargs[0] is not None and len(qargs[0]) == 2:
            out.append(name)
    return out


def _last_update(backend) -> Optional[str]:
    try:
        props = backend.properties()
    except Exception:
        return None
    lu = getattr(props, "last_update_date", None) if props is not None else None
    return _iso(lu) if isinstance(lu, datetime) else None


def calibration_summary(backend, qubits: Optional[list[int]] = None) -> dict[str, Any]:
    """Medians over the given qubits (all qubits if None) and the couplers between them."""
    target = backend.target
    n = getattr(backend, "num_qubits", None) or target.num_qubits
    use = set(range(n)) if qubits is None else set(qubits)
    t1, t2, ro, e2 = [], [], [], []
    props = target.qubit_properties or []
    for q in sorted(use):
        qp = props[q] if q < len(props) else None
        if qp is not None:
            t1.append(qp.t1 * 1e6 if getattr(qp, "t1", None) else None)
            t2.append(qp.t2 * 1e6 if getattr(qp, "t2", None) else None)
        try:
            p = target["measure"][(q,)]
            ro.append(p.error if p is not None else None)
        except Exception:
            pass
    for name in _two_qubit_ops(target):
        for qargs, p in target[name].items():
            if p is not None and qargs and set(qargs) <= use:
                e2.append(p.error)
    return {
        "last_update": _last_update(backend),
        "t1_us_median": _median(t1),
        "t2_us_median": _median(t2),
        "readout_error_median": _median(ro),
        "two_qubit_error_median": _median(e2),
    }


def per_qubit_calibration(backend) -> list[dict[str, Any]]:
    target = backend.target
    props = target.qubit_properties or []
    out = []
    for q in range(backend.num_qubits):
        qp = props[q] if q < len(props) else None
        try:
            p = target["measure"][(q,)]
            ro = p.error if p is not None else None
        except Exception:
            ro = None
        out.append({
            "qubit": q,
            "t1_us": round(qp.t1 * 1e6, 3) if qp is not None and getattr(qp, "t1", None) else None,
            "t2_us": round(qp.t2 * 1e6, 3) if qp is not None and getattr(qp, "t2", None) else None,
            "readout_error": round(ro, 6) if isinstance(ro, float) else None,
        })
    return out


def _describe(backend, detail: bool = False) -> dict[str, Any]:
    status = backend.status()
    d: dict[str, Any] = {
        "name": backend.name,
        "num_qubits": backend.num_qubits,
        "operational": bool(getattr(status, "operational", False)),
        "status_msg": getattr(status, "status_msg", None),
        "pending_jobs": getattr(status, "pending_jobs", None),
    }
    try:
        d["calibration"] = calibration_summary(backend)
    except Exception as exc:  # a machine without calibration data still has a status
        d["calibration"] = None
        d["calibration_error"] = f"{type(exc).__name__}"
    if detail:
        try:
            d["qubits"] = per_qubit_calibration(backend)
        except Exception:
            d["qubits"] = None
    return d


class _LiveCache:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.data: Optional[dict[str, Any]] = None
        self.at = 0.0
        self.future: Optional[Future] = None
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="qlab-board-live")

    def reset(self) -> None:
        with self.lock:
            self.data, self.at, self.future = None, 0.0, None


_live = _LiveCache()


def _fetch_live() -> dict[str, Any]:
    p = _provider()
    backends = []
    errors = []
    for b in p.backends():
        try:
            backends.append(_describe(b))
        except Exception as exc:
            errors.append(f"{getattr(b, 'name', '?')}: {type(exc).__name__}")
    backends.sort(key=lambda x: x["name"])
    return {
        "fetched_at": _iso(_now()),
        "error": "; ".join(errors) or None,
        "backends": backends,
        "simulated": simulated(),
    }


def live_status(wait_s: float = LIVE_WAIT_S) -> dict[str, Any]:
    """The latest live reading. Waits at most wait_s for a fresh one, then returns what it has."""
    empty = {"fetched_at": None, "error": None, "backends": [], "simulated": simulated()}
    if not configured():
        return empty
    with _live.lock:
        fresh = _live.data is not None and time.monotonic() - _live.at < LIVE_TTL_S
        if fresh:
            return _live.data  # type: ignore[return-value]
        if _live.future is None or _live.future.done():
            _live.future = _live.pool.submit(_fetch_live)
        fut = _live.future
    try:
        data = fut.result(timeout=wait_s)
    except TimeoutError:
        with _live.lock:
            old = _live.data
        out = dict(old or empty)
        out["error"] = "IBM Quantum is slow to answer; showing the last reading." if old else "Still waiting for IBM Quantum to answer. Reload in a moment."
        return out
    except Exception as exc:
        log.warning("hardware board: live status failed: %s", type(exc).__name__)
        with _live.lock:
            if _live.future is fut:
                _live.future = None
            old = _live.data
        out = dict(old or empty)
        out["error"] = f"IBM Quantum could not be reached ({type(exc).__name__})."
        return out
    with _live.lock:
        if _live.future is fut:
            _live.data, _live.at = data, time.monotonic()
    return data


def live_backend(name: str) -> Optional[dict[str, Any]]:
    """One machine with per-qubit calibration, not cached (it is one call, on a detail page)."""
    if not configured():
        return None
    fut = _live.pool.submit(lambda: _describe(_provider().backend(name), detail=True))
    try:
        return fut.result(timeout=LIVE_WAIT_S)
    except Exception as exc:
        return {"name": name, "error": f"IBM Quantum did not return this machine ({type(exc).__name__})."}


# ---------------------------------------------------------------------------
# Scheduling: one row says when the next benchmark is due; claiming it is a conditional UPDATE.
# ---------------------------------------------------------------------------

def _state(db: Session, first_due: Optional[datetime] = None):
    """The state row, made on first use; the first benchmark is due at once (or at first_due)."""
    from .models import HardwareBoardState
    row = db.get(HardwareBoardState, 1)
    if row is None:
        try:
            row = HardwareBoardState(id=1, next_due=first_due or _now())
            db.add(row)
            db.commit()
        except IntegrityError:  # another worker made it first
            db.rollback()
            row = db.get(HardwareBoardState, 1)
    return row


def claim_due(db: Session, now: Optional[datetime] = None, force: bool = False) -> bool:
    """True for exactly one caller when a benchmark is due; it then moves next_due forward."""
    from .models import HardwareBoardState
    now = now or _now()
    _state(db, first_due=now)
    days = every_days() or 7.0
    stmt = update(HardwareBoardState).where(HardwareBoardState.id == 1)
    if not force:
        stmt = stmt.where(HardwareBoardState.next_due <= now)
    res = db.execute(stmt.values(next_due=now + timedelta(days=days), last_submitted=now))
    db.commit()
    return res.rowcount == 1


def _note(db: Session, message: str) -> None:
    row = _state(db)
    row.last_message = message[:2000]
    db.commit()


# ---------------------------------------------------------------------------
# Submitting and collecting
# ---------------------------------------------------------------------------

def _versions() -> dict[str, str]:
    import qiskit
    out = {"python": platform.python_version(), "qiskit": qiskit.__version__}
    for mod in ("qiskit_ibm_runtime", "qiskit_aer"):
        try:
            out[mod] = __import__(mod).__version__
        except Exception:
            pass
    return out


def _qasm(circuit) -> str:
    from qiskit import qasm2
    return qasm2.dumps(circuit)


def _fingerprint(circuit, qasm: str) -> dict[str, Any]:
    """The same fields and hash as the SDK (qlab_sdk/qlab/fingerprint.py)."""
    non_clifford = {"t", "tdg", "ccx", "rx", "ry", "rz", "u", "u1", "u2", "u3", "p"}
    counts = {k: int(v) for k, v in circuit.count_ops().items()}
    total = sum(counts.values())
    nc = sum(v for k, v in counts.items() if k.lower() in non_clifford)
    return {
        "num_qubits": circuit.num_qubits,
        "num_clbits": circuit.num_clbits,
        "depth": circuit.depth(),
        "size": circuit.size(),
        "gate_counts": counts,
        "non_clifford_count": nc,
        "non_clifford_ratio": nc / total if total else 0,
        "qasm_sha256": hashlib.sha256(qasm.encode("utf-8")).hexdigest(),
    }


def _calibration_for(backend, isa, physical: list[int]) -> dict[str, Any]:
    """The SDK's calibration shape, limited to the qubits and couplers this circuit used."""
    target = backend.target
    props = target.qubit_properties or []
    t1, t2, ro, gate_errors = {}, {}, {}, {}
    for q in physical:
        qp = props[q] if q < len(props) else None
        if qp is not None and getattr(qp, "t1", None):
            t1[str(q)] = qp.t1 * 1e6
        if qp is not None and getattr(qp, "t2", None):
            t2[str(q)] = qp.t2 * 1e6
        try:
            p = target["measure"][(q,)]
            if p is not None and p.error is not None:
                ro[str(q)] = p.error
        except Exception:
            pass
    pairs = set()
    for inst in isa.data:
        if len(inst.qubits) == 2 and inst.operation.name not in ("barrier", "measure", "delay", "reset"):
            pair = tuple(isa.find_bit(b).index for b in inst.qubits)
            pairs.add((inst.operation.name, pair))
    for name, pair in sorted(pairs):
        try:
            p = target[name][pair]
            if p is not None and p.error is not None:
                gate_errors[f"{name}_{pair[0]}_{pair[1]}"] = p.error
        except Exception:
            pass
    now = _iso(_now())
    cal: dict[str, Any] = {
        "t1_us": t1, "t2_us": t2, "readout_errors": ro, "gate_errors": gate_errors,
        "last_update": _last_update(backend) or now, "snapshot_time": now, "source": "target",
    }
    cal["summary"] = {
        "t1_us_median": _median(list(t1.values())),
        "t2_us_median": _median(list(t2.values())),
        "readout_error_median": _median(list(ro.values())),
        "two_qubit_error_median": _median(list(gate_errors.values())),
    }
    return cal


def choose_backends(p) -> list:
    names = _chosen_names()
    if names:
        out = []
        for n in names:
            try:
                out.append(p.backend(n))
            except Exception as exc:
                log.warning("hardware board: %s unavailable: %s", n, type(exc).__name__)
        return out
    found = []
    for b in p.backends():
        try:
            if b.num_qubits >= 5 and b.status().operational:
                found.append(b)
        except Exception:
            continue
    # Alphabetical, so the same machines are picked run after run while they stay available.
    return sorted(found, key=lambda b: b.name)[:_max_backends()]


def submit_to(db: Session, backend, is_sim: bool):
    """Transpile the set for one machine, submit one job, and record it as pending."""
    from qiskit.transpiler import generate_preset_pass_manager
    from qiskit_ibm_runtime import SamplerV2

    from .models import HardwareBoardJob

    pm = generate_preset_pass_manager(optimization_level=OPTIMIZATION_LEVEL, backend=backend, seed_transpiler=SEED_TRANSPILER)
    isas, meta = [], []
    for b in BENCHMARKS:
        logical = b["build"]()
        qasm = _qasm(logical)
        isa = pm.run(logical)
        physical = list(isa.layout.final_index_layout()) if isa.layout else list(range(b["qubits"]))
        two_q = sum(1 for inst in isa.data if len(inst.qubits) == 2 and inst.operation.name not in ("barrier", "measure"))
        isas.append(isa)
        meta.append({
            "circuit": b["id"],
            "qasm": qasm,
            "fingerprint": _fingerprint(logical, qasm),
            "qubits_used": physical,
            "transpiler": {
                "settings": {"optimization_level": OPTIMIZATION_LEVEL, "seed_transpiler": SEED_TRANSPILER},
                "transpiled_depth": isa.depth(),
                "transpiled_size": isa.size(),
                "two_qubit_gates": two_q,
                "physical_qubits": physical,
                "gate_counts": {k: int(v) for k, v in isa.count_ops().items()},
            },
            "calibration": _calibration_for(backend, isa, physical),
        })
    # A simulated preview is seeded, so it gives the same counts every time (and tests are stable).
    sampler = SamplerV2(mode=backend, options={"simulator": {"seed_simulator": 20261113}}) if is_sim else SamplerV2(mode=backend)
    job = sampler.run(isas, shots=SHOTS)
    p = _provider()
    if isinstance(p, _Simulated):
        p.remember(job)
    row = HardwareBoardJob(
        job_id=str(job.job_id()), backend=backend.name, backend_qubits=backend.num_qubits,
        set_version=SET_VERSION, shots=SHOTS, simulated=is_sim, status="pending",
        submitted_at=_now(), circuits=meta, results=[], versions=_versions(),
    )
    db.add(row)
    db.commit()
    log.info("hardware board: %s job %s submitted", backend.name, row.job_id)
    return row


def submit_benchmark(db: Session) -> list:
    p = _provider()
    rows, problems = [], []
    backends = choose_backends(p)
    if not backends:
        _note(db, "No operational IBM machine was available to this key, so no benchmark was submitted.")
        return []
    for b in backends:
        try:
            rows.append(submit_to(db, b, simulated()))
        except Exception as exc:
            db.rollback()
            problems.append(f"{b.name}: not submitted ({type(exc).__name__}: {str(exc)[:200]})")
    _note(db, "; ".join(problems) if problems else f"Submitted to {', '.join(r.backend for r in rows)}.")
    return rows


def _counts_of(pub_result) -> dict[str, int]:
    data = pub_result.data
    reg = getattr(data, "meas", None)
    if reg is None:  # a differently named register: take the only one
        names = [n for n in dir(data) if not n.startswith("_")]
        reg = getattr(data, names[0])
    return {str(k): int(v) for k, v in reg.get_counts().items()}


def _record_runs(db: Session, row, counts_list: list[dict[str, int]]) -> list[dict[str, Any]]:
    """Turn each circuit's counts into a Q-Lab run with a public share link."""
    from .models import Project, Run

    if db.scalar(select(Project).where(Project.slug == PROJECT)) is None:
        db.add(Project(slug=PROJECT, name="Hardware board",
                       description="A fixed benchmark set run on real IBM quantum computers by this server."))
        db.flush()
    project = db.scalar(select(Project).where(Project.slug == PROJECT))
    finished = _now()
    results, new_runs = [], []
    for meta, counts in zip(row.circuits, counts_list):
        ideal = BY_ID[meta["circuit"]]["ideal"]
        h = round(hellinger_fidelity(counts, ideal), 6)
        s = round(success(counts, ideal), 6)
        run_id = f"hwb-{row.job_id}-{meta['circuit']}"
        run = db.scalar(select(Run).where(Run.run_id == run_id))
        if run is None:
            run = Run(run_id=run_id, created_at=_aware(row.submitted_at))
            db.add(run)
        run.circuit_name = f"{BY_ID[meta['circuit']]['title']} (hardware board)"
        run.qasm = meta["qasm"]
        run.backend = row.backend
        run.status = "completed"
        run.project_slug = PROJECT
        run.project = project
        run.org_id = None
        run.created_by_user_id = None
        run.tags = [PROJECT, row.set_version, meta["circuit"]] + (["simulated"] if row.simulated else [])
        run.fingerprint = meta["fingerprint"]
        run.transpiler = meta["transpiler"]
        run.calibration = meta["calibration"]
        run.parameters = {"shots": row.shots}
        run.execution = {"job_id": row.job_id, "shots": row.shots, "primitive": "SamplerV2", "status": "DONE"}
        run.timing = {"submit_time": _iso(row.submitted_at), "result_time": _iso(finished)}
        run.results = {"counts": dict(sorted(counts.items())), "shots": sum(counts.values()),
                       "success_probability": s, "hellinger_fidelity": h, "ideal": ideal}
        run.context = {"source": SOURCE, "set_version": row.set_version, "simulated": bool(row.simulated),
                       "versions": row.versions, "backend_qubits": row.backend_qubits}
        run.created_at = _aware(row.submitted_at)
        if not run.share_token:
            run.share_token = secrets.token_urlsafe(24)
        new_runs.append(run)
        results.append({"circuit": meta["circuit"], "counts": dict(sorted(counts.items())), "hellinger": h,
                        "success": s, "run_id": run_id, "share_token": run.share_token})
    row.results = results
    row.status = "done"
    row.provider_status = "DONE"
    row.finished_at = finished
    db.commit()
    _announce(new_runs)
    return results


def _announce(runs: list) -> None:
    try:
        from .events import publish_sync
        from .main import _run_to_dict
        for r in runs:
            publish_sync("run.created", _run_to_dict(r, include_health=True))
    except Exception:  # the board never fails because a dashboard isn't listening
        pass


def collect_pending(db: Session, now: Optional[datetime] = None) -> dict[str, int]:
    from .models import HardwareBoardJob

    now = now or _now()
    p = _provider()
    done = still = failed = 0
    for row in db.scalars(select(HardwareBoardJob).where(HardwareBoardJob.status == "pending")).all():
        if now - _aware(row.submitted_at) > GIVE_UP_AFTER:
            row.status, row.error, row.finished_at = "abandoned", f"No result after {GIVE_UP_AFTER.days} days; given up.", now
            db.commit()
            failed += 1
            continue
        try:
            job = p.job(row.job_id)
            status = _status_name(job.status())
        except LostSimulatedJob as exc:
            row.status, row.error, row.finished_at = "error", str(exc), now
            db.commit()
            failed += 1
            continue
        except Exception as exc:
            row.provider_status = "UNREACHABLE"
            row.error = f"Could not ask IBM about this job ({type(exc).__name__})."
            db.commit()
            still += 1
            continue
        row.provider_status = status
        if status in ("DONE", "COMPLETED"):
            try:
                result = job.result()
                counts = [_counts_of(result[i]) for i in range(len(row.circuits))]
            except Exception as exc:
                row.status, row.error, row.finished_at = "error", f"Result could not be read ({type(exc).__name__}).", now
                db.commit()
                failed += 1
                continue
            row.error = None
            _record_runs(db, row, counts)
            done += 1
        elif status in ("ERROR", "FAILED", "CANCELLED", "CANCELED"):
            msg = ""
            try:
                msg = str(job.error_message() or "")
            except Exception:
                pass
            row.status = "cancelled" if status.startswith("CANCEL") else "error"
            row.error = (msg or f"IBM reported {status}.")[:2000]
            row.finished_at = now
            db.commit()
            failed += 1
        else:
            db.commit()
            still += 1
    return {"done": done, "pending": still, "failed": failed}


def tick(db: Session, force: bool = False) -> dict[str, Any]:
    """One pass: submit a benchmark if one is due (or forced), then collect finished jobs."""
    out: dict[str, Any] = {"submitted": [], "collected": None}
    if not configured():
        return out
    if (benchmark_enabled() or force) and claim_due(db, force=force):
        out["submitted"] = [r.job_id for r in submit_benchmark(db)]
    out["collected"] = collect_pending(db)
    return out


# ---------------------------------------------------------------------------
# The background thread
# ---------------------------------------------------------------------------

_thread: Optional[threading.Thread] = None
_stop = threading.Event()


def _loop(session_factory: Callable[[], Session]) -> None:
    while not _stop.is_set():
        try:
            with session_factory() as db:
                result = tick(db)
                if result["submitted"] or (result["collected"] or {}).get("done"):
                    log.info("hardware board: %s", result)
        except Exception as exc:
            log.warning("hardware board: tick failed: %s: %s", type(exc).__name__, str(exc)[:300])
        _stop.wait(TICK_S)


def start_scheduler(session_factory: Callable[[], Session]) -> bool:
    global _thread
    if not configured() or os.getenv("QLAB_HARDWARE_BOARD_SCHEDULER", "").strip().lower() == "off":
        return False
    if _thread is not None and _thread.is_alive():
        return True
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(session_factory,), name="qlab-hardware-board", daemon=True)
    _thread.start()
    return True


def stop_scheduler() -> None:
    _stop.set()


# ---------------------------------------------------------------------------
# What the board shows
# ---------------------------------------------------------------------------

def _run_points(rows: list) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        by_c = {m["circuit"]: m for m in row.circuits}
        for r in row.results:
            m = by_c.get(r["circuit"], {})
            out.append({
                "run_id": r["run_id"],
                "share_token": r["share_token"],
                "backend": row.backend,
                "circuit": r["circuit"],
                "set_version": row.set_version,
                "created_at": _iso(row.submitted_at),
                "completed_at": _iso(row.finished_at),
                "job_id": row.job_id,
                "hellinger": r["hellinger"],
                "success": r["success"],
                "shots": row.shots,
                "qubits_used": m.get("qubits_used"),
                "two_qubit_gates": (m.get("transpiler") or {}).get("two_qubit_gates"),
                "transpiled_depth": (m.get("transpiler") or {}).get("transpiled_depth"),
                "calibration": {**((m.get("calibration") or {}).get("summary") or {}),
                                "last_update": (m.get("calibration") or {}).get("last_update")},
                "simulated": bool(row.simulated),
            })
    return out


def board(db: Session, backend: Optional[str] = None) -> dict[str, Any]:
    from .models import HardwareBoardJob, HardwareBoardState

    q = select(HardwareBoardJob).order_by(HardwareBoardJob.submitted_at.asc())
    if backend:
        q = q.where(HardwareBoardJob.backend == backend)
    if not simulated():  # a preview's results never show on a real board
        q = q.where(HardwareBoardJob.simulated.is_(False))
    rows = db.scalars(q).all()
    state = db.get(HardwareBoardState, 1)
    pending = [r for r in rows if r.status == "pending"]
    ended = [r for r in rows if r.status in ("error", "cancelled", "abandoned")][-10:]
    live = live_status() if configured() else {"fetched_at": None, "error": None, "backends": [], "simulated": False}
    if backend:
        detail = live_backend(backend)
        live = {**live, "backends": [b for b in live.get("backends", []) if b["name"] == backend], "detail": detail}
    return {
        "configured": configured(),
        "simulated": simulated(),
        "live": live,
        "benchmark": {
            "enabled": benchmark_enabled(),
            **{k: v for k, v in public_set().items() if k != "shots"},
            "shots": SHOTS,
            "every_days": every_days(),
            "next_due": _iso(state.next_due) if state and benchmark_enabled() else None,
            "last_submitted": _iso(state.last_submitted) if state else None,
            "last_message": state.last_message if state else None,
            "pending": [{"backend": r.backend, "job_id": r.job_id, "submitted": _iso(r.submitted_at),
                         "status": r.provider_status or "SUBMITTED"} for r in pending],
            "ended": [{"backend": r.backend, "job_id": r.job_id, "submitted": _iso(r.submitted_at),
                       "status": r.status, "error": r.error} for r in ended],
        },
        "runs": _run_points([r for r in rows if r.status == "done"]),
    }
