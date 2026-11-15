"""This run's circuit on this run's IBM machine, across time (app/time_dial.py).

    GET /api/v1/runs/{run_id}/timeline                 stored days, the run's own result, accuracy
    GET /api/v1/runs/{run_id}/timeline/replay?date=    replay on that stored day (Rewind, simulated)
    GET /api/v1/runs/{run_id}/timeline/forecast        which machine and hour for the coming days

The run is found with a Run query, which app/run_scope.py limits to runs the caller can see, plus
the same organisation check as GET /api/v1/runs/{run_id}. Replays and forecasts are cached; only a
cache miss counts against Rewind's replay limits (per account, or per address without one) or
Pick-the-machine's limit, and replays go through Rewind's one-at-a-time gate.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import time_dial as td
from ..database import get_db
from ..deps import Identity, get_identity
from ..models import Run
from ..rate_limit import pick_limiter, rewind_run_limiter, rewind_run_user_limiter
from ..rewind import replay as rp
from ..rewind import store

router = APIRouter(tags=["time-dial"])


def _run(db: Session, run_id: str, identity: Optional[Identity]) -> Run:
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    if identity and identity.org_id and run.org_id and run.org_id != identity.org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return run


def _http(exc: rp.ReplayError) -> HTTPException:
    headers = {"Retry-After": "10"} if exc.status == 503 else None
    return HTTPException(status_code=exc.status, detail=exc.message, headers=headers)


@router.get("/api/v1/runs/{run_id}/timeline")
def run_timeline(run_id: str, identity: Optional[Identity] = Depends(get_identity), db: Session = Depends(get_db)):
    return td.timeline(db, _run(db, run_id, identity))


@router.get("/api/v1/runs/{run_id}/timeline/replay")
def run_timeline_replay(run_id: str, request: Request, day: str = Query(alias="date", max_length=10),
                        identity: Optional[Identity] = Depends(get_identity), db: Session = Depends(get_db)):
    run = _run(db, run_id, identity)
    machine, why = td.machine_of(run)
    if machine is None:
        raise HTTPException(status_code=409, detail=td.REASONS[why])
    if not store.DATE_RE.match(day):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD.")
    try:
        d = date.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=422, detail="Not a calendar date.")
    row = td.snapshot_for(db, machine, d)
    if row is None:
        raise HTTPException(status_code=404, detail=f"No calibration of {machine} is stored for {day}; "
                                                    "the dial stops only on days that have one.")
    signed_in = identity is not None

    def charge() -> None:
        if signed_in and identity.user_id is not None:
            rewind_run_user_limiter.check(f"user:{identity.user_id}")
        else:
            rewind_run_limiter(request)

    try:
        return td.replay_at(db, run, machine, d, row, signed_in, charge)
    except rp.ReplayError as exc:
        raise _http(exc)


@router.get("/api/v1/runs/{run_id}/timeline/forecast")
def run_timeline_forecast(run_id: str, request: Request, identity: Optional[Identity] = Depends(get_identity),
                          db: Session = Depends(get_db)):
    run = _run(db, run_id, identity)
    machine, why = td.machine_of(run)
    if machine is None:
        raise HTTPException(status_code=409, detail=td.REASONS[why])
    try:
        return td.forecast(db, run, machine, lambda: pick_limiter(request))
    except rp.ReplayError as exc:
        raise _http(exc)
