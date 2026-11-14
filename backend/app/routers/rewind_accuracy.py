"""Rewind's accuracy: how close replicas come to real hardware (app/rewind/bench.py).

Public, no sign-in:
    GET  /api/v1/rewind/accuracy          per machine: median and worst Hellinger fidelity between real
                                          hardware and replica (latest run and a rolling window), every
                                          circuit's fidelities and the raw counts of our own benchmark
                                          jobs, the benchmark set, schedule and QPU budget

Server owner, or the scheduled workflow with the X-Rewind-Trigger header:
    POST /api/v1/rewind/bench/run-now     submit the benchmark now (still within the QPU budget)
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit
from ..rewind import bench
from .rewind import _authorized

router = APIRouter(tags=["rewind"])


@router.get("/api/v1/rewind/accuracy")
def accuracy(db: Session = Depends(get_db)):
    return bench.report(db)


@router.post("/api/v1/rewind/bench/run-now")
def run_now(x_rewind_trigger: Optional[str] = Header(default=None),
            identity: Optional[Identity] = Depends(get_identity), db: Session = Depends(get_db)):
    who = _authorized(identity, x_rewind_trigger)
    if not bench.configured():
        raise HTTPException(status_code=409, detail=bench.not_running_reason())
    result = bench.tick(db, force=True)
    if who == "owner":
        log_audit(db, "rewind.bench.run_now", "rewind", ",".join(s["job_id"] for s in result["submitted"]) or "none",
                  identity=identity)
    return result
