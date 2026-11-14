"""The server's real-QPU allowance, shared by everything that submits jobs with its IBM key.

IBM's open plan gives 10 minutes of QPU time per rolling 28 days. Two things here spend it: the
hardware board's benchmark (app/hardware_board.py) and Rewind's accuracy benchmark
(app/rewind/bench.py). Both ask this module before each submission, so together they stay under
one cap.

Accounting: a row in qpu_usage per job, written before submitting with IBM's own estimate formula
(about 2 s per job + 0.00035 s per execution, an execution being one shot of one circuit), and
updated with the usage IBM reports once the job ends. The rolling sum counts the reported usage
where there is one and the estimate otherwise. Board jobs submitted before this ledger existed are
counted from hardware_board_jobs with the same estimate.

Environment:
    QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D   the shared cap (default 480 of IBM's 600, leaving
                                               headroom for estimates that come in low)
"""
from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select, text
from sqlalchemy.orm import Session

WINDOW = timedelta(days=28)
PLAN_SECONDS = 600
PER_JOB_S = 2.0
PER_EXECUTION_S = 0.00035

_lock = threading.Lock()


def budget_seconds() -> float:
    try:
        return max(0.0, float(os.getenv("QLAB_REWIND_BENCH_BUDGET_SECONDS_PER_28D", "480")))
    except ValueError:
        return 480.0


def estimate_seconds(circuits: int, shots: int) -> float:
    """IBM's estimate for one Sampler job: 2 s + 0.00035 s x (circuits x shots)."""
    return round(PER_JOB_S + PER_EXECUTION_S * max(0, int(circuits)) * max(0, int(shots)), 3)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def used_seconds(db: Session, simulated: bool = False, now: Optional[datetime] = None) -> float:
    """QPU seconds spent (or reserved) in the 28 days up to now."""
    from .models import HardwareBoardJob, QpuUsage

    now = now or _now()
    since = now - WINDOW
    rows = db.scalars(select(QpuUsage).where(QpuUsage.reserved_at >= since,
                                             QpuUsage.simulated.is_(bool(simulated)))).all()
    total = sum(r.actual_seconds if r.actual_seconds is not None else r.estimated_seconds for r in rows)
    known = {r.job_id for r in rows if r.job_id}
    # Board jobs from before the ledger: the same estimate, from what was submitted.
    older = db.scalars(select(HardwareBoardJob).where(HardwareBoardJob.submitted_at >= since,
                                                      HardwareBoardJob.simulated.is_(bool(simulated)))).all()
    for job in older:
        if job.job_id not in known:
            total += estimate_seconds(len(job.circuits or []), job.shots)
    return round(total, 3)


def reserve(db: Session, source: str, machine: str, estimate: float, simulated: bool = False,
            now: Optional[datetime] = None):
    """A ledger row for a job about to be submitted, or None when it would exceed the budget."""
    from .models import QpuUsage

    with _lock:
        if db.get_bind().dialect.name == "postgresql":  # several instances: one reservation at a time
            db.execute(text("SELECT pg_advisory_xact_lock(7351010)"))
        used = used_seconds(db, simulated, now)
        if used + estimate > budget_seconds():
            db.rollback()
            return None
        row = QpuUsage(source=source, machine=machine, simulated=bool(simulated), reserved_at=now or _now(),
                       estimated_seconds=float(estimate))
        db.add(row)
        db.commit()
        return row


def attach(db: Session, row, job_id: str) -> None:
    row.job_id = str(job_id)
    db.commit()


def release(db: Session, row) -> None:
    """The job was not submitted after all."""
    try:
        db.delete(row)
        db.commit()
    except Exception:
        db.rollback()


def record_actual(db: Session, job_id: str, seconds: Optional[float]) -> None:
    from .models import QpuUsage

    if seconds is None:
        return
    for row in db.scalars(select(QpuUsage).where(QpuUsage.job_id == str(job_id))).all():
        row.actual_seconds = float(seconds)
    db.commit()


def usage_of(job) -> Optional[float]:
    """QPU seconds IBM reports for a finished job (None when it doesn't say, e.g. a local simulator)."""
    try:
        v = job.usage()
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    except Exception:
        pass
    try:
        q = ((job.metrics() or {}).get("usage") or {}).get("quantum_seconds")
        if isinstance(q, (int, float)) and not isinstance(q, bool):
            return float(q)
    except Exception:
        pass
    return None


def status(db: Session, simulated: bool = False) -> dict[str, Any]:
    used = used_seconds(db, simulated)
    cap = budget_seconds()
    return {"window_days": WINDOW.days, "budget_seconds": cap, "plan_seconds": PLAN_SECONDS,
            "used_seconds": used, "remaining_seconds": round(max(0.0, cap - used), 3),
            "estimate": f"{PER_JOB_S:g} s per job + {PER_EXECUTION_S:g} s per shot of each circuit",
            "shared_with": ["hardware board", "Rewind accuracy benchmark"]}
