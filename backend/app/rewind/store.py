"""Where Rewind keeps calibration: gzip files under QLAB_REWIND_DIR, indexed in machine_snapshots,
and one manifest per UTC day listing what was stored that day, signed when the server has a key.

Layout under the directory (default: the backend's data directory, which on the hosted Q-Lab is
the persistent disk, + /rewind):

    ibm/ibm_fez/2026-11-14T054112Z.json.gz     one calibration (named by calibrated_at)
    manifests/2026-11-14.json                  the day's manifest
    state.json                                 the last harvest and backfill, for the status page

The snapshot files are never served: they are IBM's calibration data. Only the manifests (hashes,
machine names, dates, signature) and small derived summaries are public.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import tempfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import signing, verify
from .snapshot import MACHINE_RE, canonical_bytes, iso, parse_iso, sha256_hex

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SOURCES = ("harvest", "backfill", "simulated")


def rewind_dir() -> Path:
    raw = os.getenv("QLAB_REWIND_DIR", "").strip()
    if raw:
        return Path(raw)
    from ..database import DATA_DIR
    return DATA_DIR / "rewind"


def _utc(dt: datetime) -> datetime:
    return (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)).replace(microsecond=0)


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def storage_path(provider: str, machine: str, calibrated_at: datetime) -> str:
    if not MACHINE_RE.match(machine) or not MACHINE_RE.match(provider):
        raise ValueError(f"not a machine name: {machine!r}")
    return f"{provider}/{machine}/{_utc(calibrated_at).strftime('%Y-%m-%dT%H%M%SZ')}.json.gz"


def versions() -> dict[str, str]:
    from ..hardware_board import _versions
    return _versions()


def find(db: Session, provider: str, machine: str, calibrated_at: datetime):
    from ..models import MachineSnapshot
    return db.scalar(select(MachineSnapshot).where(
        MachineSnapshot.provider == provider, MachineSnapshot.machine == machine,
        MachineSnapshot.calibrated_at == _utc(calibrated_at)))


def save(db: Session, record: dict[str, Any], source: str, captured_at: Optional[datetime] = None):
    """Store a record unless that calibration is already stored. Returns (row, created)."""
    from ..models import MachineSnapshot

    if source not in SOURCES:
        raise ValueError(f"source must be one of {SOURCES}")
    provider, machine = record["provider"], record["machine"]
    cal = parse_iso(record["calibrated_at"])
    existing = find(db, provider, machine, cal)
    if existing is not None:
        return existing, False
    raw = canonical_bytes(record)
    gz = gzip.compress(raw, compresslevel=9, mtime=0)
    rel = storage_path(provider, machine, cal)
    _atomic_write(rewind_dir() / rel, gz)
    row = MachineSnapshot(provider=provider, machine=machine, captured_at=_utc(captured_at or datetime.now(timezone.utc)),
                          calibrated_at=cal, sha256=sha256_hex(raw), storage_path=rel, size_bytes=len(gz),
                          sdk_versions=versions(), source=source)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:  # another worker stored the same calibration a moment ago
        db.rollback()
        return find(db, provider, machine, cal), False
    return row, True


class SnapshotCorrupt(RuntimeError):
    """A stored file no longer matches the hash recorded for it."""


def read_bytes(row) -> bytes:
    return (rewind_dir() / row.storage_path).read_bytes()


def load(row) -> dict[str, Any]:
    raw = gzip.decompress(read_bytes(row))
    if sha256_hex(raw) != row.sha256:
        raise SnapshotCorrupt(f"{row.storage_path} does not match its recorded sha256")
    return json.loads(raw.decode("utf-8"))


# ---------------------------------------------------------------------------
# What is stored
# ---------------------------------------------------------------------------

def _visible_sources(include_simulated: bool) -> tuple[str, ...]:
    return SOURCES if include_simulated else ("harvest", "backfill")


def machines(db: Session, include_simulated: bool = False) -> list[dict[str, Any]]:
    from ..models import MachineSnapshot as M

    rows = db.execute(
        select(M.provider, M.machine, func.count(M.id), func.min(M.calibrated_at), func.max(M.calibrated_at))
        .where(M.source.in_(_visible_sources(include_simulated)))
        .group_by(M.provider, M.machine).order_by(M.provider, M.machine)
    ).all()
    out = []
    for provider, machine, count, first, last in rows:
        out.append({"provider": provider, "machine": machine, "snapshots": int(count),
                    "first_calibrated_at": iso(first), "last_calibrated_at": iso(last),
                    "first_date": _utc(first).date().isoformat(), "last_date": _utc(last).date().isoformat()})
    return out


def earliest(db: Session, provider: str, machine: str) -> Optional[datetime]:
    from ..models import MachineSnapshot as M
    v = db.scalar(select(func.min(M.calibrated_at)).where(M.provider == provider, M.machine == machine,
                                                          M.source.in_(("harvest", "backfill"))))
    return _utc(v) if v else None


def nearest(db: Session, machine: str, when: datetime, include_simulated: bool = False, provider: str = "ibm"):
    """The stored calibration closest in time to `when` (ties go to the earlier one)."""
    from ..models import MachineSnapshot as M
    when = _utc(when)
    base = select(M).where(M.provider == provider, M.machine == machine,
                           M.source.in_(_visible_sources(include_simulated)))
    before = db.scalar(base.where(M.calibrated_at <= when).order_by(M.calibrated_at.desc()).limit(1))
    after = db.scalar(base.where(M.calibrated_at > when).order_by(M.calibrated_at.asc()).limit(1))
    if before is None:
        return after
    if after is None:
        return before
    return before if (when - _utc(before.calibrated_at)) <= (_utc(after.calibrated_at) - when) else after


# ---------------------------------------------------------------------------
# Daily manifests
# ---------------------------------------------------------------------------

def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(0, 0), tzinfo=timezone.utc)
    return start, start + timedelta(days=1)


def day_entries(db: Session, day: date) -> list[dict[str, Any]]:
    """Everything stored (captured) on that UTC day, simulated previews excluded."""
    from ..models import MachineSnapshot as M
    start, end = _day_bounds(day)
    rows = db.scalars(select(M).where(M.captured_at >= start, M.captured_at < end,
                                      M.source.in_(("harvest", "backfill"))).order_by(M.storage_path)).all()
    return [{"path": r.storage_path, "sha256": r.sha256, "size_bytes": r.size_bytes, "provider": r.provider,
             "machine": r.machine, "calibrated_at": iso(r.calibrated_at), "source": r.source} for r in rows]


def _manifest_file(day: date) -> Path:
    return rewind_dir() / "manifests" / f"{day.isoformat()}.json"


def build_manifest(db: Session, day: date, now: Optional[datetime] = None) -> dict[str, Any]:
    """The day's manifest, signed if the server has a key; written to disk."""
    entries = day_entries(db, day)
    doc: dict[str, Any] = {"format": verify.MANIFEST_FORMAT, "date": day.isoformat(), "entries": entries,
                           "signature": None}
    s = signing.signer()
    if s is not None:
        signed_at = iso(now or datetime.now(timezone.utc))
        msg = verify.manifest_bytes(doc["date"], s.key_id, signed_at, entries)
        doc["signature"] = {"key": s.key_id, "signed_at": signed_at, **s.sign(msg), "public_key": s.public_key()}
    _atomic_write(_manifest_file(day), json.dumps(doc, sort_keys=True, indent=1).encode("utf-8"))
    return doc


def get_manifest(db: Session, day: date) -> Optional[dict[str, Any]]:
    """The stored manifest; rebuilt if missing, if the day's entries changed, or if it is unsigned and
    a key is now set. None when nothing was stored that day."""
    path = _manifest_file(day)
    doc = None
    if path.exists():
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            doc = None
    entries = day_entries(db, day)
    if not entries and doc is None:
        return None
    current = sorted((e["path"], e["sha256"]) for e in entries)
    stale = doc is None or sorted((e["path"], e["sha256"]) for e in doc.get("entries") or []) != current
    if stale or (doc.get("signature") is None and signing.signer() is not None):
        doc = build_manifest(db, day)
    return doc


def read_state() -> dict[str, Any]:
    try:
        return json.loads((rewind_dir() / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_state(**changes: Any) -> dict[str, Any]:
    state = read_state()
    state.update(changes)
    _atomic_write(rewind_dir() / "state.json", json.dumps(state, sort_keys=True, indent=1).encode("utf-8"))
    return state


_summary_cache: dict[str, dict[str, Any]] = {}


def summary(row) -> dict[str, Any]:
    """Per-snapshot medians (the only part of the calibration that is shown publicly)."""
    hit = _summary_cache.get(row.sha256)
    if hit is not None:
        return hit
    import statistics

    def med(xs: list) -> Optional[float]:
        vals = [float(x) for x in xs if isinstance(x, (int, float)) and not isinstance(x, bool)]
        return round(statistics.median(vals), 6) if vals else None

    try:
        noise = load(row).get("noise") or {}
    except Exception:
        return {"calibrated_at": iso(row.calibrated_at), "available": False}
    two = [v[0] for es in (noise.get("gates") or {}).values() for k, v in es.items() if "_" in k and v and v[0] is not None
           and v[0] < 1.0]
    out = {"calibrated_at": iso(row.calibrated_at), "available": True,
           "t1_us_median": med(noise.get("t1_us") or []), "t2_us_median": med(noise.get("t2_us") or []),
           "readout_error_median": med([r[0] for r in noise.get("readout") or [] if r]),
           "two_qubit_error_median": med(two)}
    if len(_summary_cache) > 512:
        _summary_cache.clear()
    _summary_cache[row.sha256] = out
    return out


def latest(db: Session, provider: str, machine: str, include_simulated: bool = False):
    from ..models import MachineSnapshot as M
    return db.scalar(select(M).where(M.provider == provider, M.machine == machine,
                                     M.source.in_(_visible_sources(include_simulated)))
                     .order_by(M.calibrated_at.desc()).limit(1))
