"""Rewind's screen helpers: the ideal (noiseless) distribution, the same circuit across time, and
per-machine median series for QPU Watch.

* ideal_distribution: the circuit without noise on Aer's statevector simulator (exact
  probabilities, not samples), for the Hellinger fidelity of a replay. Capped like a replay: up to
  the replay's qubit limit and work bound; a circuit that measures mid-way has no single ideal
  distribution, and says so.
* Compare across time: one replay per month (the last stored calibration of each month, up to 12
  months), run one after another in a background thread through the same one-at-a-time gate as
  /run. Progress is written to a small JSON file per job under QLAB_REWIND_DIR/jobs, so a poll
  lands on the same answer whichever worker serves it. One comparison runs at a time per process.
* watch: per-machine medians over time (one point per day: that day's last calibration). Only
  medians, never snapshot contents (IBM's data is not republished).
"""
from __future__ import annotations

import json
import math
import secrets
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import replay as rp
from . import store
from .snapshot import iso

MAX_MONTHS = 12
JOB_RE_LEN = 16
JOB_TTL_S = 24 * 3600
BUSY_RETRIES = 60
BUSY_WAIT_S = 3.0
TOP = 8


# ---------------------------------------------------------------------------
# The ideal distribution and the Hellinger fidelity
# ---------------------------------------------------------------------------

def _norm(key: str) -> str:
    return key.replace(" ", "")


def ideal_distribution(circuit, signed_in: bool = False) -> tuple[Optional[dict[str, float]], Optional[str]]:
    """({bitstring: probability}, None) or (None, why not). Bitstrings as Aer writes counts
    (clbit 0 rightmost), without register spaces."""
    from qiskit import QuantumCircuit, transpile
    from qiskit_aer import AerSimulator

    n = circuit.num_qubits
    if n > rp.max_qubits():
        return None, f"The ideal distribution is computed up to {rp.max_qubits()} qubits."
    ops = [i for i in circuit.data if i.operation.name != "barrier"]
    if 2 ** n * max(1, len(ops)) > rp.max_work(signed_in):
        return None, "The ideal distribution would take too long to compute here."
    measured: dict[int, int] = {}      # clbit -> qubit
    touched_after: set[int] = set()
    for inst in reversed(ops):
        qs = [circuit.find_bit(q).index for q in inst.qubits]
        if inst.operation.name == "measure":
            if qs[0] in touched_after:
                return None, "The circuit measures part-way through, so there is no single ideal distribution to compare with."
            measured.setdefault(circuit.find_bit(inst.clbits[0]).index, qs[0])
        else:
            if inst.clbits:
                return None, "The circuit uses classical bits outside measurement, so its ideal distribution isn't computed."
            touched_after.update(qs)
    if not measured:
        return None, "The circuit measures nothing."
    body = QuantumCircuit(n)
    for inst in ops:
        if inst.operation.name == "measure":
            continue
        body.append(inst.operation, [circuit.find_bit(q).index for q in inst.qubits])
    clbits = sorted(measured)
    body.save_probabilities(qubits=[measured[c] for c in clbits], label="p")
    sim = AerSimulator(method="statevector", max_parallel_threads=1, max_memory_mb=rp.max_memory_mb())
    try:
        result = sim.run(transpile(body, sim, optimization_level=0)).result()
        probs = result.data(0)["p"]
    except Exception as exc:
        return None, f"The ideal distribution couldn't be computed ({type(exc).__name__})."
    width = circuit.num_clbits
    out: dict[str, float] = {}
    for i, p in enumerate(probs):
        p = float(p)
        if p < 1e-12:
            continue
        bits = ["0"] * width
        for k, c in enumerate(clbits):
            if (i >> k) & 1:
                bits[width - 1 - c] = "1"
        key = "".join(bits)
        out[key] = out.get(key, 0.0) + p
    return out, None


def hellinger_fidelity(counts: dict[str, int], ideal: dict[str, float]) -> Optional[float]:
    """(Σ √(p·q))², as qiskit.quantum_info.hellinger_fidelity."""
    shots = sum(counts.values())
    if not shots or not ideal:
        return None
    bc = sum(math.sqrt(ideal.get(_norm(k), 0.0) * v / shots) for k, v in counts.items())
    return round(min(1.0, bc * bc), 6)


def ideal_share(counts: dict[str, int], ideal: dict[str, float]) -> Optional[float]:
    """Share of shots on outcomes the ideal circuit can give (probability above 0.1%)."""
    shots = sum(counts.values())
    if not shots or not ideal:
        return None
    support = {k for k, p in ideal.items() if p >= 1e-3}
    return round(sum(v for k, v in counts.items() if _norm(k) in support) / shots, 6)


def top(dist: dict[str, float], k: int = TOP) -> list[list[Any]]:
    return [[key, round(v, 6)] for key, v in sorted(dist.items(), key=lambda kv: (-kv[1], kv[0]))[:k]]


def ideal_summary(circuit, counts: dict[str, int], signed_in: bool) -> dict[str, Any]:
    dist, reason = ideal_distribution(circuit, signed_in)
    if dist is None:
        return {"available": False, "reason": reason, "hellinger_fidelity": None, "share_on_ideal_outcomes": None,
                "top": [], "outcomes": None}
    return {"available": True, "reason": None, "hellinger_fidelity": hellinger_fidelity(counts, dist),
            "share_on_ideal_outcomes": ideal_share(counts, dist), "top": top(dist),
            "outcomes": sum(1 for p in dist.values() if p >= 1e-3),
            "method": "noiseless statevector (Aer), exact probabilities"}


def parse_for_ideal(text: str, fmt: Optional[str]):
    """The circuit as the replay reads it (measured at the end when it measured nothing)."""
    qc = rp.read_circuit(text, fmt)
    if not any(i.operation.name == "measure" for i in qc.data):
        qc.measure_all()
    return qc


def replay_with_ideal(db: Session, machine: str, day: date, text: str, fmt: Optional[str], shots: int,
                      seed: Optional[int], signed_in: bool, include_simulated: bool) -> dict[str, Any]:
    out = rp.replay(db, machine, day, text, fmt, shots, seed, signed_in=signed_in, include_simulated=include_simulated)
    out["ideal"] = ideal_summary(parse_for_ideal(text, fmt), out["counts"], signed_in)
    return out


# ---------------------------------------------------------------------------
# Dates stored for a machine
# ---------------------------------------------------------------------------

def _rows(db: Session, machine: str, include_simulated: bool, since: Optional[datetime] = None):
    from ..models import MachineSnapshot as M
    sources = store.SOURCES if include_simulated else ("harvest", "backfill")
    q = select(M).where(M.provider == "ibm", M.machine == machine, M.source.in_(sources))
    if since is not None:
        q = q.where(M.calibrated_at >= since)
    return db.scalars(q.order_by(M.calibrated_at.asc())).all()


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def stored_days(db: Session, machine: str, include_simulated: bool) -> list[dict[str, str]]:
    """One entry per UTC day with a stored calibration: the day and the calibration a replay of that
    day uses (the one nearest 12:00 UTC)."""
    by_day: dict[str, datetime] = {}
    for r in _rows(db, machine, include_simulated):
        cal = _utc(r.calibrated_at)
        d = cal.date().isoformat()
        noon = rp.requested_time(cal.date())
        if d not in by_day or abs(cal - noon) < abs(by_day[d] - noon):
            by_day[d] = cal
    return [{"date": d, "calibrated_at": iso(by_day[d])} for d in sorted(by_day)]


def monthly_days(db: Session, machine: str, include_simulated: bool, months: int = MAX_MONTHS) -> list[str]:
    """The last stored day of each of the most recent `months` months that have one, oldest first."""
    last: dict[str, str] = {}
    for d in stored_days(db, machine, include_simulated):
        last[d["date"][:7]] = d["date"]
    return [last[m] for m in sorted(last)[-months:]]


# ---------------------------------------------------------------------------
# Compare across time: a background job, its progress in a file
# ---------------------------------------------------------------------------

_running = threading.Lock()


def _jobs_dir():
    return store.rewind_dir() / "jobs"


def _job_path(job: str):
    if len(job) != JOB_RE_LEN or not all(c.isalnum() or c in "-_" for c in job):
        raise ValueError("not a job id")
    return _jobs_dir() / f"{job}.json"


_jobs: dict[str, str] = {}     # job id -> its JSON, in this process
_jobs_lock = threading.Lock()


def _write(doc: dict[str, Any]) -> None:
    """Keep the job's state here and in its file (for a poll that lands on another worker). The file
    is best effort: on Windows a replace can fail while a reader has it open; the next write retries."""
    raw = json.dumps(doc, sort_keys=True)
    with _jobs_lock:
        _jobs[doc["job"]] = raw
    for _ in range(3):
        try:
            store._atomic_write(_job_path(doc["job"]), raw.encode("utf-8"))
            return
        except OSError:
            time.sleep(0.05)


def read_job(job: str) -> Optional[dict[str, Any]]:
    path = _job_path(job)  # ValueError for a malformed id
    with _jobs_lock:
        raw = _jobs.get(job)
    if raw is not None:
        return json.loads(raw)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _sweep_old() -> None:
    """Keep the last 50 finished jobs in memory and a day of files."""
    with _jobs_lock:
        for k in [k for k, v in _jobs.items() if json.loads(v).get("status") != "running"][:-50]:
            del _jobs[k]
    d = _jobs_dir()
    if not d.exists():
        return
    cutoff = time.time() - JOB_TTL_S
    for p in d.glob("*.json"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            pass


def busy() -> bool:
    return _running.locked()


def _now() -> str:
    return iso(datetime.now(timezone.utc))


def _gated(fn: Callable[[], Any]) -> Any:
    """fn() through the replay gate, waiting while another replay holds it."""
    for attempt in range(BUSY_RETRIES):
        try:
            return rp.run_limited(fn)
        except rp.ReplayError as exc:
            if exc.status == 503 and attempt < BUSY_RETRIES - 1:
                time.sleep(BUSY_WAIT_S)
                continue
            raise
    raise rp.ReplayError(503, "Rewind stayed busy.")


def start_compare(machine: str, days: list[str], text: str, fmt: Optional[str], shots: int, seed: Optional[int],
                  signed_in: bool, include_simulated: bool, session_factory: Callable[[], Session],
                  circuit, accuracy: Optional[dict[str, Any]] = None,
                  accuracy_note: Optional[str] = None) -> Optional[dict[str, Any]]:
    """Start the job in the background; None when another comparison is running here."""
    if not _running.acquire(blocking=False):
        return None
    _sweep_old()
    job = secrets.token_urlsafe(12)[:JOB_RE_LEN]
    while len(job) < JOB_RE_LEN:
        job += "0"
    doc: dict[str, Any] = {
        "job": job, "machine": machine, "status": "running", "shots": shots, "started_at": _now(), "finished_at": None,
        "ideal": {"available": None, "reason": None, "top": []},
        "results": [{"date": d, "status": "pending"} for d in days],
        "accuracy": accuracy, "accuracy_note": accuracy_note or rp.ACCURACY_NOTE, "real_hardware": False,
        "label": f"Simulated from IBM-published calibrations of {machine}; not affiliated with or endorsed by IBM.",
    }
    try:
        _write(doc)
    except Exception:
        _running.release()
        raise

    ideal: Optional[dict[str, float]] = None

    def one(day: str) -> dict[str, Any]:
        with session_factory() as db:
            out = rp.replay(db, machine, date.fromisoformat(day), text, fmt, shots, seed, signed_in=signed_in,
                            include_simulated=include_simulated)
        counts = out["counts"]
        return {"date": day, "status": "ok", "snapshot": {k: out["snapshot"][k] for k in ("calibrated_at", "sha256", "gap_days")},
                "hellinger_fidelity": hellinger_fidelity(counts, ideal) if ideal else None,
                "share_on_ideal_outcomes": ideal_share(counts, ideal) if ideal else None,
                "top": top({k: v / out["shots"] for k, v in counts.items()}, 4), "seconds": out["seconds"]}

    def work() -> None:
        nonlocal ideal
        try:
            try:
                ideal, reason = _gated(lambda: ideal_distribution(circuit, signed_in))
            except rp.ReplayError as exc:
                ideal, reason = None, exc.message
            doc["ideal"] = {"available": ideal is not None, "reason": reason, "top": top(ideal) if ideal else []}
            _write(doc)
            for i, day in enumerate(days):
                doc["results"][i] = {"date": day, "status": "running"}
                _write(doc)
                try:
                    res = _gated(lambda d=day: one(d))
                except rp.ReplayError as exc:
                    res = {"date": day, "status": "error", "error": exc.message}
                except Exception as exc:  # one month failing must not lose the rest
                    res = {"date": day, "status": "error", "error": type(exc).__name__}
                doc["results"][i] = res
                _write(doc)
            doc["status"] = "done"
        except Exception as exc:
            doc["status"] = "failed"
            doc["error"] = type(exc).__name__
        finally:
            doc["finished_at"] = _now()
            try:
                _write(doc)
            finally:
                _running.release()

    threading.Thread(target=work, name="qlab-rewind-compare", daemon=True).start()
    return doc


# ---------------------------------------------------------------------------
# QPU Watch: medians over time
# ---------------------------------------------------------------------------

_medians: dict[str, dict[str, Any]] = {}
METRICS = ("t1_us_median", "t2_us_median", "two_qubit_error_median", "readout_error_median")


def medians(row) -> dict[str, Any]:
    hit = _medians.get(row.sha256)
    if hit is None:
        hit = store.summary(row)
        if hit.get("available"):
            if len(_medians) > 20_000:
                _medians.clear()
            _medians[row.sha256] = hit
    return hit


def series(db: Session, machine: str, include_simulated: bool, days: int) -> list[dict[str, Any]]:
    """One point per UTC day over the last `days` days of what is stored (that day's last calibration)."""
    rows = _rows(db, machine, include_simulated)
    if not rows:
        return []
    end = _utc(rows[-1].calibrated_at)
    start = end - timedelta(days=days)
    per_day: dict[str, Any] = {}
    for r in rows:
        cal = _utc(r.calibrated_at)
        if cal >= start:
            per_day[cal.date().isoformat()] = r
    out = []
    for d in sorted(per_day):
        m = medians(per_day[d])
        if not m.get("available"):
            continue
        out.append({"date": d, "calibrated_at": m["calibrated_at"], **{k: m.get(k) for k in METRICS}})
    return out

