"""The harvester: every IBM machine's calibration, once a day, kept for good.

A machine's calibration of a given day can't be collected later from anywhere but IBM's own
history, so this runs whether or not anyone uses Rewind. It uses the hardware board's IBM access
(app/hardware_board.py: the server's QISKIT_IBM_TOKEN). Without a key it does nothing and the
status says so. The board's local preview (QLAB_HARDWARE_BOARD_SIMULATE=1, refused on Render)
harvests IBM's fake backends instead, stored with source "simulated" and never shown as real.

When it runs:
  * a background thread checks every 30 minutes and harvests when the last harvest is older than
    QLAB_REWIND_EVERY_HOURS (default 20);
  * the daily GitHub workflow (.github/workflows/rewind-harvest.yml) also asks for one, with the
    QLAB_REWIND_TRIGGER_TOKEN header, so it happens even if the server was asleep or restarted.
Repeats cost nothing: a calibration already stored (same machine, same calibrated_at) is skipped.

Backfill walks back in time with backend.properties(datetime=...), one day at a time per machine,
from the day before the earliest stored calibration. A day is a miss when IBM returns nothing, an
error, a calibration newer than the day asked for, or one already stored; it stops after
QLAB_REWIND_BACKFILL_MISSES (default 7) misses in a row or max_days days, waiting
QLAB_REWIND_BACKFILL_DELAY_S (default 2) seconds between requests. It starts on its own as soon as
there is a key (IBM keeps history only for machines still online, for an undocumented time, so
waiting loses data), 30 days per machine per pass, every 6 hours, until each machine's start of
history is found; state.json's "reach" records how far back each machine goes. The server owner
(or the trigger token) can also start one, one at a time.

Environment:
    QISKIT_IBM_TOKEN / QISKIT_IBM_INSTANCE   as for the hardware board
    QLAB_REWIND_DIR                          where files go (default <backend>/data/rewind)
    QLAB_REWIND_SIGNING_KEY                  manifest signing key (python -m app.rewind keygen)
    QLAB_REWIND_TRIGGER_TOKEN                lets the scheduled workflow start a harvest/backfill
    QLAB_REWIND_EVERY_HOURS                  default 20
    QLAB_REWIND_SCHEDULER                    "off" stops the background thread
    QLAB_REWIND_AUTO_BACKFILL                "off" stops the automatic backfill (default on)
    QLAB_REWIND_BACKFILL_MAX_DAYS / _MISSES / _DELAY_S   per pass: 30 days, 7 misses, 2 s
"""
from __future__ import annotations

import logging
import os
import threading
import time as _time
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from .. import hardware_board as hb
from . import store
from .snapshot import PROVIDER, CaptureError, calibrated_at_of, capture, iso

log = logging.getLogger("qlab.rewind")

TICK_S = 1800
LOCK_STALE_S = 3 * 3600


def configured() -> bool:
    return hb.configured()


def simulated() -> bool:
    return hb.simulated()


def source_name(backfill: bool = False) -> str:
    if simulated():
        return "simulated"
    return "backfill" if backfill else "harvest"


def every_hours() -> float:
    try:
        return max(1.0, float(os.getenv("QLAB_REWIND_EVERY_HOURS", "20")))
    except ValueError:
        return 20.0


def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, str(default))))
    except ValueError:
        return default


def _now() -> datetime:
    return datetime.now(timezone.utc)


def not_configured_reason() -> str:
    return ("This server has no IBM Quantum key (QISKIT_IBM_TOKEN), so no calibration is being collected. "
            "Nothing is made up in its place.")


# ---------------------------------------------------------------------------
# A lock across worker processes: a file made with O_EXCL
# ---------------------------------------------------------------------------

class _FileLock:
    def __init__(self, name: str) -> None:
        self.name = name
        self.path = None
        self.held = False

    def __enter__(self) -> bool:
        self.path = store.rewind_dir() / f".{self.name}.lock"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            if self.path.exists() and _time.time() - self.path.stat().st_mtime > LOCK_STALE_S:
                self.path.unlink()
        except OSError:
            pass
        try:
            fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {iso(_now())}".encode())
            os.close(fd)
            self.held = True
        except FileExistsError:
            self.held = False
        return self.held

    def __exit__(self, *exc: Any) -> None:
        if self.held and self.path is not None:
            try:
                self.path.unlink()
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Harvest
# ---------------------------------------------------------------------------

def _properties(backend, when: Optional[datetime] = None):
    if when is not None:
        return backend.properties(datetime=when)
    try:
        return backend.properties(refresh=True)
    except TypeError:
        return backend.properties()


def harvest(db: Session, now: Optional[datetime] = None) -> dict[str, Any]:
    """Store today's calibration of every machine the key sees. Safe to repeat."""
    now = now or _now()
    out: dict[str, Any] = {"started_at": iso(now), "stored": [], "skipped": [], "problems": []}
    if not configured():
        out["problems"].append(not_configured_reason())
        return out
    with _FileLock("harvest") as got:
        if not got:
            out["problems"].append("Another harvest is running.")
            return out
        src = source_name()
        try:
            backends = list(hb._provider().backends())
        except Exception as exc:
            out["problems"].append(f"IBM Quantum could not be reached ({type(exc).__name__}).")
            backends = []
        for b in sorted(backends, key=lambda x: str(getattr(x, "name", ""))):
            name = str(getattr(b, "name", "?"))
            try:
                record = capture(b, _properties(b), same_day=True)
                row, created = store.save(db, record, src, captured_at=now)
            except CaptureError as exc:
                out["problems"].append(f"{name}: {exc}")
                continue
            except Exception as exc:
                db.rollback()
                out["problems"].append(f"{name}: {type(exc).__name__}: {str(exc)[:200]}")
                continue
            (out["stored"] if created else out["skipped"]).append(
                {"machine": name, "calibrated_at": record["calibrated_at"], "sha256": row.sha256 if row else None})
        if out["stored"] and src != "simulated":
            store.build_manifest(db, now.date(), now=now)
    out["finished_at"] = iso(_now())
    store.write_state(last_harvest=out)
    log.info("rewind: harvest stored %d, skipped %d, problems %d", len(out["stored"]), len(out["skipped"]), len(out["problems"]))
    return out


def backfill_due(now: Optional[datetime] = None) -> bool:
    """Backfill runs on its own as soon as there is a key, until every machine's history start is found."""
    if simulated() or os.getenv("QLAB_REWIND_AUTO_BACKFILL", "").strip().lower() == "off":
        return False
    state = store.read_state()
    last = (state.get("backfill") or {}).get("finished_at")
    if last:
        try:
            if (now or _now()) - datetime.fromisoformat(last.replace("Z", "+00:00")) < timedelta(hours=6):
                return False
        except ValueError:
            pass
    reach = state.get("reach") or {}
    seen = {m["machine"] for m in (state.get("last_harvest") or {}).get("stored", []) + (state.get("last_harvest") or {}).get("skipped", [])}
    return not seen or any(not (reach.get(m) or {}).get("complete") for m in seen)


def harvest_due(now: Optional[datetime] = None) -> bool:
    last = (store.read_state().get("last_harvest") or {}).get("started_at")
    if not last:
        return True
    try:
        then = datetime.fromisoformat(last.replace("Z", "+00:00"))
    except ValueError:
        return True
    return (now or _now()) - then >= timedelta(hours=every_hours())


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------

def _day_end(day: date) -> datetime:
    return datetime.combine(day, time(23, 59, 59), tzinfo=timezone.utc)


def walk_back(fetch: Callable[[date], Any], keep: Callable[[Any], bool], start: date, max_days: int,
              miss_limit: int, delay_s: float = 0.0, stop: Optional[threading.Event] = None) -> dict[str, Any]:
    """The backfill loop, without IBM or storage: fetch(day) -> properties or None, keep(props) -> stored?

    A day is a miss when fetch returns None or raises, when the calibration is newer than the end of
    the day asked for, or when keep() did not store it (already there). Stops after miss_limit
    misses in a row, after max_days days, or when `stop` is set.
    """
    stored = misses = days = 0
    day = start
    oldest: Optional[str] = None
    reason = "max_days"
    while days < max_days:
        if stop is not None and stop.is_set():
            reason = "stopped"
            break
        days += 1
        hit = False
        try:
            props = fetch(day)
        except Exception as exc:
            log.info("rewind: backfill %s: %s", day, type(exc).__name__)
            props = None
        if props is not None:
            cal = calibrated_at_of(props)
            if cal is not None and cal <= _day_end(day) and keep(props):
                hit = True
                oldest = iso(cal)
        if hit:
            stored += 1
            misses = 0
        else:
            misses += 1
            if misses >= miss_limit:
                reason = f"{miss_limit} days in a row without new calibration"
                break
        day -= timedelta(days=1)
        if delay_s and days < max_days:
            if stop is not None:
                if stop.wait(delay_s):
                    reason = "stopped"
                    break
            else:
                _time.sleep(delay_s)
    return {"from": start.isoformat(), "to": (day + timedelta(days=1)).isoformat(), "days_asked": days,
            "stored": stored, "oldest_stored": oldest, "stopped_because": reason}


_backfill_lock = threading.Lock()
_backfill_stop = threading.Event()


def backfill(db: Session, machine: Optional[str] = None, max_days: Optional[int] = None,
             miss_limit: Optional[int] = None, delay_s: Optional[float] = None) -> dict[str, Any]:
    """Walk back for one machine or every machine the key sees. One backfill at a time.

    How far back each machine's history went is kept in state.json ("reach"). Without a machine
    named, machines whose start of history was already found are left out.
    """
    max_days = max_days or _int_env("QLAB_REWIND_BACKFILL_MAX_DAYS", 30, 1, 3650)
    miss_limit = miss_limit or _int_env("QLAB_REWIND_BACKFILL_MISSES", 7, 1, 365)
    delay_s = _float_env("QLAB_REWIND_BACKFILL_DELAY_S", 2.0) if delay_s is None else delay_s
    out: dict[str, Any] = {"started_at": iso(_now()), "machines": {}, "problems": []}
    if not configured():
        out["problems"].append(not_configured_reason())
        return out
    if simulated():
        out["problems"].append("IBM's fake backends have no calibration history, so a simulated preview can't backfill.")
        return out
    if not _backfill_lock.acquire(blocking=False):
        out["problems"].append("A backfill is already running.")
        return out
    try:
        with _FileLock("backfill") as got:
            if not got:
                out["problems"].append("A backfill is already running.")
                return out
            p = hb._provider()
            if machine:
                backends = [p.backend(machine)]
            else:
                backends = sorted(p.backends(), key=lambda x: str(x.name))
            store.write_state(backfill={"running": True, **out})
            reach = dict(store.read_state().get("reach") or {})
            for b in backends:
                name = str(b.name)
                if not machine and (reach.get(name) or {}).get("complete"):
                    continue
                first = store.earliest(db, PROVIDER, name)
                start = (first.date() if first else _now().date()) - (timedelta(days=1) if first else timedelta(0))

                def fetch(day: date, b=b):
                    return _properties(b, _day_end(day))

                def keep(props, b=b) -> bool:
                    try:
                        _row, created = store.save(db, capture(b, props, same_day=False), "backfill")
                    except Exception:
                        db.rollback()
                        return False
                    return created

                res = walk_back(fetch, keep, start, max_days, miss_limit, delay_s, _backfill_stop)
                out["machines"][name] = res
                oldest = store.earliest(db, PROVIDER, name)
                reach[name] = {"oldest_calibrated_at": iso(oldest) if oldest else None,
                               "complete": res["stopped_because"].endswith("without new calibration"),
                               "checked_at": iso(_now()), "stopped_because": res["stopped_because"]}
                store.write_state(reach=reach)
            stored_any = any(m["stored"] for m in out["machines"].values())
            if stored_any:
                store.build_manifest(db, _now().date())
    except Exception as exc:
        db.rollback()
        out["problems"].append(f"{type(exc).__name__}: {str(exc)[:200]}")
    finally:
        out["finished_at"] = iso(_now())
        store.write_state(backfill={"running": False, **out})
        _backfill_lock.release()
    return out


def probe(backend, days: int = 30, step: int = 1, sleep_s: float = 1.0) -> list[dict[str, Any]]:
    """Read-only: what IBM returns for each past day (nothing is stored). For the CLI."""
    out = []
    today = _now().date()
    for i in range(0, days, max(1, step)):
        day = today - timedelta(days=i)
        try:
            props = _properties(backend, _day_end(day))
            cal = calibrated_at_of(props) if props is not None else None
            out.append({"day": day.isoformat(), "calibrated_at": iso(cal) if cal else None,
                        "ok": cal is not None and cal <= _day_end(day)})
        except Exception as exc:
            out.append({"day": day.isoformat(), "calibrated_at": None, "ok": False, "error": type(exc).__name__})
        if sleep_s:
            _time.sleep(sleep_s)
    return out


# ---------------------------------------------------------------------------
# Running in the background
# ---------------------------------------------------------------------------

_run_lock = threading.Lock()
_thread: Optional[threading.Thread] = None
_stop = threading.Event()


def start_in_background(fn: Callable[[Session], Any], session_factory: Callable[[], Session]) -> bool:
    """Run fn(db) on its own thread unless the same kind of job is running. True if started."""

    def run() -> None:
        try:
            with session_factory() as db:
                fn(db)
        except Exception as exc:
            log.warning("rewind: background job failed: %s: %s", type(exc).__name__, str(exc)[:300])
        finally:
            _run_lock.release()

    if not _run_lock.acquire(blocking=False):
        return False
    threading.Thread(target=run, name="qlab-rewind-job", daemon=True).start()
    return True


def _loop(session_factory: Callable[[], Session]) -> None:
    while not _stop.is_set():
        try:
            if (harvest_due() or backfill_due()) and _run_lock.acquire(blocking=False):
                try:
                    with session_factory() as db:
                        if harvest_due():
                            harvest(db)
                        if backfill_due():
                            backfill(db)
                finally:
                    _run_lock.release()
        except Exception as exc:
            log.warning("rewind: harvest tick failed: %s: %s", type(exc).__name__, str(exc)[:300])
        _stop.wait(TICK_S)


def start_scheduler(session_factory: Callable[[], Session]) -> bool:
    global _thread
    if not configured() or os.getenv("QLAB_REWIND_SCHEDULER", "").strip().lower() == "off":
        return False
    if _thread is not None and _thread.is_alive():
        return True
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(session_factory,), name="qlab-rewind", daemon=True)
    _thread.start()
    return True


def stop_scheduler() -> None:
    _stop.set()
    _backfill_stop.set()
