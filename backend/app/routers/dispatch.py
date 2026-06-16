"""Calibration-Gated Dispatch Queue — Feature #4.

Holds run-intents in a JSON sidecar file until the target backend's latest
calibration meets user-defined quality thresholds. When all thresholds pass
the entry is automatically released and an optional webhook fires.
"""

from __future__ import annotations

import json
import os
import pathlib
import secrets
import string
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/dispatch", tags=["dispatch"])

_QUEUE_FILE = pathlib.Path(os.getenv("QLAB_DATA_DIR", "data")) / "dispatch_queue.json"
_ID_CHARS = string.ascii_lowercase + string.digits

# ---------------------------------------------------------------------------
# Threshold → calibration field mapping
# ---------------------------------------------------------------------------
# Each entry: (cal_key, comparison)  where comparison is "gte" or "lte"
_THRESHOLD_MAP: dict[str, tuple[str, str]] = {
    "min_t1_us":          ("avg_t1_us",          "gte"),
    "min_t2_us":          ("avg_t2_us",          "gte"),
    "max_gate_error_1q":  ("avg_gate_error",      "lte"),
    "max_gate_error_2q":  ("avg_gate_error_2q",   "lte"),
    "max_readout_error":  ("avg_readout_error",   "lte"),
}


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class ThresholdSpec(BaseModel):
    min_t1_us:         Optional[float] = None
    min_t2_us:         Optional[float] = None
    max_gate_error_1q: Optional[float] = None
    max_gate_error_2q: Optional[float] = None
    max_readout_error: Optional[float] = None


class EnqueueBody(BaseModel):
    circuit_name: str = Field(..., max_length=255)
    backend:      str = Field(..., max_length=255)
    run_id:       Optional[str]          = None
    thresholds:   ThresholdSpec          = Field(default_factory=ThresholdSpec)
    webhook_url:  Optional[str]          = Field(None, max_length=2000)
    notes:        Optional[str]          = Field(None, max_length=2000)


# ---------------------------------------------------------------------------
# Queue persistence helpers
# ---------------------------------------------------------------------------

def _load_queue() -> list[dict]:
    try:
        if _QUEUE_FILE.exists():
            return json.loads(_QUEUE_FILE.read_text())
        return []
    except Exception:
        return []


def _save_queue(entries: list[dict]) -> None:
    try:
        _QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
        _QUEUE_FILE.write_text(json.dumps(entries, indent=2))
    except Exception:
        pass


def _new_entry_id() -> str:
    return "dq_" + "".join(secrets.choice(_ID_CHARS) for _ in range(16))


# ---------------------------------------------------------------------------
# Calibration helpers
# ---------------------------------------------------------------------------

def _get_latest_calibration(backend: str, db: Session) -> dict | None:
    """Return calibration dict from the most recent run that has one."""
    run = db.scalar(
        select(Run)
        .where(Run.backend == backend, Run.calibration.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(1)
    )
    if run is None:
        return None
    cal = run.calibration
    if not cal:
        return None
    return cal


def _thresholds_met(thresholds: dict[str, Any], cal: dict) -> tuple[bool, list[str]]:
    """Check whether calibration satisfies all thresholds.

    Returns (all_met: bool, failed_checks: list[str]).
    """
    failures: list[str] = []
    for th_key, (cal_key, cmp) in _THRESHOLD_MAP.items():
        th_val = thresholds.get(th_key)
        if th_val is None:
            continue
        cal_val = cal.get(cal_key)
        if cal_val is None:
            failures.append(f"{cal_key} not present in calibration")
            continue
        if cmp == "gte" and cal_val < th_val:
            failures.append(f"{cal_key}={cal_val} < required {th_val}")
        elif cmp == "lte" and cal_val > th_val:
            failures.append(f"{cal_key}={cal_val} > allowed {th_val}")
    return len(failures) == 0, failures


# ---------------------------------------------------------------------------
# Webhook delivery
# ---------------------------------------------------------------------------

def _fire_webhook(url: str, payload: dict) -> None:
    try:
        httpx.post(url, json=payload, timeout=5.0)
    except Exception:
        pass


def _build_webhook_payload(entry: dict, cal: dict | None) -> dict:
    return {
        "event": "dispatch.released",
        "entry_id": entry["id"],
        "circuit_name": entry["circuit_name"],
        "backend": entry["backend"],
        "released_at": entry.get("released_at"),
        "release_reason": entry.get("release_reason"),
        "calibration": cal,
    }


# ---------------------------------------------------------------------------
# Core release logic (mutates entry dict in-place)
# ---------------------------------------------------------------------------

def _release_entry(entry: dict, reason: str, cal: dict | None) -> None:
    entry["status"] = "released"
    entry["released_at"] = datetime.now(timezone.utc).isoformat()
    entry["release_reason"] = reason
    entry["calibration_at_release"] = cal


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/queue", status_code=201)
def enqueue(body: EnqueueBody, db: Session = Depends(get_db)):
    """Add a circuit intent to the dispatch queue.

    Immediately checks the latest calibration; releases the entry if
    thresholds are already met.
    """
    entries = _load_queue()
    th_dict = body.thresholds.model_dump(exclude_none=True)

    cal = _get_latest_calibration(body.backend, db)
    all_met, failures = _thresholds_met(th_dict, cal or {})

    entry: dict[str, Any] = {
        "id":          _new_entry_id(),
        "circuit_name": body.circuit_name,
        "backend":     body.backend,
        "run_id":      body.run_id,
        "thresholds":  th_dict,
        "webhook_url": body.webhook_url,
        "notes":       body.notes,
        "status":      "pending",
        "queued_at":   datetime.now(timezone.utc).isoformat(),
        "released_at":           None,
        "release_reason":        None,
        "calibration_at_release": None,
    }

    if all_met:
        _release_entry(entry, "calibration_met_at_enqueue", cal)
        if body.webhook_url:
            _fire_webhook(body.webhook_url, _build_webhook_payload(entry, cal))

    entries.append(entry)
    _save_queue(entries)

    return {
        "entry_id":       entry["id"],
        "status":         entry["status"],
        "queued_at":      entry["queued_at"],
        "released_at":    entry.get("released_at"),
        "release_reason": entry.get("release_reason"),
        "calibration_failures": failures if not all_met else [],
    }


@router.get("/queue")
def list_queue(
    backend: Optional[str] = None,
    status:  Optional[str] = Query(None, pattern="^(pending|released|cancelled)$"),
):
    """List queue entries with optional filters."""
    entries = _load_queue()
    filtered = entries
    if backend:
        filtered = [e for e in filtered if e.get("backend") == backend]
    if status:
        filtered = [e for e in filtered if e.get("status") == status]

    pending  = sum(1 for e in entries if e.get("status") == "pending")
    released = sum(1 for e in entries if e.get("status") == "released")

    return {
        "total":    len(entries),
        "pending":  pending,
        "released": released,
        "entries":  filtered,
    }


@router.post("/check")
def check_all(db: Session = Depends(get_db)):
    """Re-evaluate all pending entries against the latest calibration.

    Fires webhooks for newly released entries.
    Returns a summary of what changed.
    """
    entries = _load_queue()
    checked = 0
    newly_released: list[str] = []

    # Group pending entries by backend to avoid redundant DB queries
    backend_cal_cache: dict[str, dict | None] = {}

    for entry in entries:
        if entry.get("status") != "pending":
            continue
        checked += 1
        backend = entry["backend"]

        if backend not in backend_cal_cache:
            backend_cal_cache[backend] = _get_latest_calibration(backend, db)
        cal = backend_cal_cache[backend]

        all_met, _ = _thresholds_met(entry.get("thresholds", {}), cal or {})
        if all_met:
            _release_entry(entry, "calibration_met_at_check", cal)
            newly_released.append(entry["id"])
            if entry.get("webhook_url"):
                _fire_webhook(entry["webhook_url"], _build_webhook_payload(entry, cal))

    _save_queue(entries)
    still_pending = sum(1 for e in entries if e.get("status") == "pending")

    return {
        "checked":       checked,
        "released":      len(newly_released),
        "released_ids":  newly_released,
        "still_pending": still_pending,
    }


@router.delete("/queue/{entry_id}", status_code=200)
def cancel_entry(entry_id: str):
    """Cancel a pending queue entry."""
    entries = _load_queue()
    for entry in entries:
        if entry["id"] == entry_id:
            if entry["status"] != "pending":
                raise HTTPException(409, f"Cannot cancel entry with status '{entry['status']}'")
            entry["status"] = "cancelled"
            _save_queue(entries)
            return {"entry_id": entry_id, "status": "cancelled"}
    raise HTTPException(404, "Queue entry not found")


@router.post("/queue/{entry_id}/release")
def manual_release(entry_id: str, db: Session = Depends(get_db)):
    """Manually release a pending entry regardless of calibration state."""
    entries = _load_queue()
    for entry in entries:
        if entry["id"] == entry_id:
            if entry["status"] != "pending":
                raise HTTPException(409, f"Entry status is already '{entry['status']}'")
            cal = _get_latest_calibration(entry["backend"], db)
            _release_entry(entry, "manual_release", cal)
            if entry.get("webhook_url"):
                _fire_webhook(entry["webhook_url"], _build_webhook_payload(entry, cal))
            _save_queue(entries)
            return {
                "entry_id":    entry_id,
                "status":      "released",
                "released_at": entry["released_at"],
                "release_reason": "manual_release",
            }
    raise HTTPException(404, "Queue entry not found")
