"""Wall mode: one sentence and one number for an office display, read with a display link.

Three things a display can show (the admin picks one per link):

- last_run: the team's latest run with results. The number is the share of its shots that landed on
  outcomes the noise-free circuit can produce (app/run_answer.py; when the ideal isn't known, the share
  of the most common outcome, and the label says so). The sentence is that run's answer sentence.
- runs_week: how many runs were recorded in the last 7 days, and on how many machines.
- drift: on how many of the team's machines the latest run of a circuit moved more than shot noise
  explains, compared with the previous run of the same circuit there (app/drift.py). Simulators are
  left out: their results don't drift. When no machine has re-run a circuit there is no number.

Everything is read under the link creator's run scope (app/run_scope.py), so a display shows exactly
what its creator may see and nothing more. When there is nothing to show, it says so; it never
shows a made-up value.
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Run
from .run_diff import counts_of

METRICS: dict[str, str] = {
    "last_run": "How the latest run matched the ideal",
    "runs_week": "Runs in the last 7 days",
    "drift": "Machines whose results moved (drift alarm)",
}
DEFAULT_METRIC = "last_run"

_WEEK = timedelta(days=7)
_DRIFT_WINDOW = timedelta(days=30)
_MAX_MACHINES = 12
_SCAN = 400
_CACHE_TTL = 30.0
_CACHE_MAX = 256
_SIM_WORDS = ("simulator", "aer", "fake", "statevector", "stabilizer")

_lock = threading.Lock()
_cache: "OrderedDict[tuple, tuple[float, dict]]" = OrderedDict()


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    d = _utc(dt)
    return d.isoformat().replace("+00:00", "Z") if d else None


def is_simulator(backend: Optional[str]) -> bool:
    b = (backend or "").lower()
    return not b or any(w in b for w in _SIM_WORDS)


def _pct(x: float) -> str:
    return f"{round(x * 100):d}%"


def _latest_with_counts(db: Session, q) -> Optional[Run]:
    for r in db.scalars(q.order_by(Run.created_at.desc(), Run.id.desc()).limit(_SCAN)):
        if counts_of(r):
            return r
    return None


def _last_run(db: Session, now: datetime) -> dict[str, Any]:
    from .run_answer import answer

    run = _latest_with_counts(db, select(Run))
    if run is None:
        return {"value": None, "display": None, "label": "no run with results yet",
                "sentence": "No run with results has been recorded yet, so there is nothing to show.",
                "state": "empty"}
    a = answer(db, run, "standard")
    m = a.get("measure") or {}
    if m.get("kind") == "ideal_share":
        label = "of shots on the expected outcomes"
    else:
        label = "of shots gave the most common result (no ideal to compare with)"
    value = m.get("value")
    return {"value": round(value, 4) if isinstance(value, (int, float)) else None,
            "display": _pct(value) if isinstance(value, (int, float)) else None,
            "label": label, "sentence": a.get("sentence") or "", "state": "ok",
            "subject": {"backend": run.backend, "circuit": run.circuit_name, "created_at": _iso(run.created_at)}}


def _runs_week(db: Session, now: datetime) -> dict[str, Any]:
    since = now - _WEEK
    rows = db.execute(select(Run.backend, func.count(Run.id)).where(Run.created_at >= since)
                      .group_by(Run.backend)).all()
    total = sum(n for _, n in rows)
    machines = sorted(((b, n) for b, n in rows if b), key=lambda bn: (-bn[1], bn[0]))
    label = "run in the last 7 days" if total == 1 else "runs in the last 7 days"
    if total == 0:
        sentence = "No runs were recorded in the last 7 days."
    else:
        k = len(machines)
        on = f" on {k} machine{'' if k == 1 else 's'}" if k else ""
        top = f"; most on {machines[0][0]} ({machines[0][1]})" if k > 1 else (f", all on {machines[0][0]}" if k == 1 else "")
        sentence = f"Your team recorded {total} run{'' if total == 1 else 's'}{on} in the last 7 days{top}."
    return {"value": total, "display": str(total), "label": label, "sentence": sentence, "state": "ok"}


def _drift(db: Session, now: datetime) -> dict[str, Any]:
    from .drift import drift_for

    since = now - _DRIFT_WINDOW
    recent = db.execute(select(Run.backend, func.max(Run.created_at)).where(Run.created_at >= since, Run.backend.is_not(None))
                        .group_by(Run.backend)).all()
    machines = [b for b, _ in sorted(recent, key=lambda bt: _utc(bt[1]) or now, reverse=True) if not is_simulator(b)][:_MAX_MACHINES]
    checked: list[tuple[str, dict]] = []
    for backend in machines:
        run = _latest_with_counts(db, select(Run).where(Run.backend == backend))
        if run is None:
            continue
        d = drift_for(db, run, "plain")
        if d.get("state") in ("drifted", "steady"):
            checked.append((backend, d))
    drifted = [(b, d) for b, d in checked if d["state"] == "drifted"]
    if not checked:
        return {"value": None, "display": None, "label": "nothing to check yet",
                "sentence": ("No machine has run the same circuit twice in the last 30 days, "
                             "so there is nothing to check for drift yet."), "state": "empty"}
    n = len(checked)
    label = (f"of {n} machine{'' if n == 1 else 's'}: results moved more than chance")
    if not drifted:
        sentence = (f"Results held on {'the one machine' if n == 1 else f'all {n} machines'} that re-ran a circuit: "
                    "the differences are what shot noise alone gives.")
    else:
        names = ", ".join(b for b, _ in drifted[:3]) + (" and others" if len(drifted) > 3 else "")
        first = drifted[0][1].get("sentence") or ""
        sentence = f"Drift on {names}. {first}".strip()
    return {"value": len(drifted), "display": str(len(drifted)), "label": label, "sentence": sentence,
            "state": "alarm" if drifted else "ok"}


_BUILDERS = {"last_run": _last_run, "runs_week": _runs_week, "drift": _drift}


def _signature(db: Session) -> tuple:
    """Changes when the runs the wall reads change (new, edited or removed)."""
    n, top_id, newest, received = db.execute(
        select(func.count(Run.id), func.max(Run.id), func.max(Run.created_at), func.max(Run.received_at))).one()
    return (n, top_id, _iso(newest), _iso(received))


def wall_data(db: Session, link_id: int, metric: str, now: Optional[datetime] = None) -> dict[str, Any]:
    """The payload a display shows. Must be called inside run_scope.scoped_as(creator)."""
    now = now or datetime.now(timezone.utc)
    metric = metric if metric in _BUILDERS else DEFAULT_METRIC
    sig = _signature(db)
    # The 7-day and 30-day windows slide, so a cached value lasts at most _CACHE_TTL.
    key = (link_id, metric, sig)
    mono = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit is not None and mono - hit[0] < _CACHE_TTL:
            _cache.move_to_end(key)
            return hit[1]
    body = _BUILDERS[metric](db, now)
    payload = {"metric": metric, "metric_label": METRICS[metric], **body,
               "data_as_of": sig[2], "newest_run_at": sig[2]}
    with _lock:
        _cache[key] = (mono, payload)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return payload


def etag_of(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return 'W/"' + hashlib.sha256(raw.encode()).hexdigest()[:32] + '"'


def reset_cache() -> None:
    with _lock:
        _cache.clear()
