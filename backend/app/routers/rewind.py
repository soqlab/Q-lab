"""Rewind's API (app/rewind/).

Public, no sign-in:
    GET  /api/v1/rewind/machines           what is collected: machines, snapshot counts, first/last day
    GET  /api/v1/rewind/manifests/{date}   that UTC day's signed manifest (hashes, never contents)
    GET  /api/v1/rewind/public-key         the key manifests are signed with
    POST /api/v1/rewind/run                replay a circuit on a machine as calibrated on a date
                                           (no account needed; lower limits without one)

Server owner, or the scheduled workflow with the X-Rewind-Trigger header (QLAB_REWIND_TRIGGER_TOKEN):
    POST /api/v1/rewind/harvest            harvest now (in the background)
    POST /api/v1/rewind/backfill           walk back through IBM's calibration history
"""
from __future__ import annotations

import hmac
import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit
from ..rewind import harvest as hv
from ..rate_limit import rewind_run_limiter, rewind_run_user_limiter
from ..rewind import replay as rp
from ..rewind import signing, store
from ..rewind.snapshot import MACHINE_RE, PROVIDER

router = APIRouter(tags=["rewind"])


@router.get("/api/v1/rewind/machines")
def machines(db: Session = Depends(get_db)):
    include_sim = hv.simulated()
    rows = store.machines(db, include_simulated=include_sim)
    for m in rows:
        last = store.latest(db, m["provider"], m["machine"], include_simulated=include_sim)
        m["latest"] = store.summary(last) if last is not None else None
    state = store.read_state()
    last_harvest = state.get("last_harvest") or {}
    backfill = state.get("backfill") or {}
    return {
        "collecting": hv.configured(),
        "simulated": include_sim,
        "reason": None if hv.configured() else hv.not_configured_reason(),
        "every_hours": hv.every_hours(),
        "signing": signing.status(),
        "last_harvest": {k: last_harvest.get(k) for k in ("started_at", "finished_at")} | {
            "stored": len(last_harvest.get("stored") or []), "skipped": len(last_harvest.get("skipped") or []),
            "problems": (last_harvest.get("problems") or [])[:20]} if last_harvest else None,
        "backfill": {"running": bool(backfill.get("running")), "started_at": backfill.get("started_at"),
                     "finished_at": backfill.get("finished_at"),
                     "problems": (backfill.get("problems") or [])[:20]} if backfill else None,
        "history_reach": state.get("reach") or {},
        "machines": rows,
        "note": "Calibration data is IBM's and is not republished here: only machine names, dates, hashes "
                "and per-snapshot medians. Not affiliated with or endorsed by IBM.",
    }


@router.get("/api/v1/rewind/manifests/{day}")
def manifest(day: str, db: Session = Depends(get_db)):
    if not store.DATE_RE.match(day):
        raise HTTPException(status_code=422, detail="The date must be YYYY-MM-DD.")
    try:
        d = date.fromisoformat(day)
    except ValueError:
        raise HTTPException(status_code=422, detail="Not a calendar date.")
    doc = store.get_manifest(db, d)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Nothing was stored on {day}.")
    st = signing.status()
    return {**doc, "signed": doc.get("signature") is not None,
            "unsigned_reason": None if doc.get("signature") else st["reason"],
            "verify": "python backend/app/rewind/verify.py --date " + day}


@router.get("/api/v1/rewind/public-key")
def public_key():
    s = signing.signer()
    if s is None:
        return {"enabled": False, "reason": signing.status()["reason"], "public_key": None}
    return {"enabled": True, "reason": None, "public_key": s.public_key()}


def _authorized(identity: Optional[Identity], trigger: Optional[str]) -> str:
    expected = os.getenv("QLAB_REWIND_TRIGGER_TOKEN", "").strip()
    if trigger and expected and hmac.compare_digest(trigger.strip().encode(), expected.encode()):
        return "trigger"
    if identity is not None and identity.role == "owner":
        return "owner"
    raise HTTPException(status_code=403, detail="Only the server owner or the scheduled trigger can do this.")


@router.post("/api/v1/rewind/harvest", status_code=202)
def harvest_now(x_rewind_trigger: Optional[str] = Header(default=None),
                identity: Optional[Identity] = Depends(get_identity), db: Session = Depends(get_db)):
    who = _authorized(identity, x_rewind_trigger)
    if not hv.configured():
        raise HTTPException(status_code=409, detail=hv.not_configured_reason())
    from ..database import SessionLocal

    def job(s: Session) -> None:
        hv.harvest(s)
        if hv.backfill_due():
            hv.backfill(s)

    started = hv.start_in_background(job, SessionLocal)
    if who == "owner":
        log_audit(db, "rewind.harvest", "rewind", "harvest", identity=identity)
    return {"started": started, "reason": None if started else "A harvest or backfill is already running."}


class BackfillRequest(BaseModel):
    machine: Optional[str] = Field(default=None, max_length=61)
    max_days: Optional[int] = Field(default=None, ge=1, le=3650)
    miss_limit: Optional[int] = Field(default=None, ge=1, le=365)


@router.post("/api/v1/rewind/backfill", status_code=202)
def backfill_now(body: BackfillRequest, x_rewind_trigger: Optional[str] = Header(default=None),
                 identity: Optional[Identity] = Depends(get_identity), db: Session = Depends(get_db)):
    who = _authorized(identity, x_rewind_trigger)
    if not hv.configured():
        raise HTTPException(status_code=409, detail=hv.not_configured_reason())
    if body.machine and not MACHINE_RE.match(body.machine):
        raise HTTPException(status_code=422, detail="Not a machine name.")
    from ..database import SessionLocal
    started = hv.start_in_background(
        lambda s: hv.backfill(s, machine=body.machine, max_days=body.max_days, miss_limit=body.miss_limit), SessionLocal)
    if who == "owner":
        log_audit(db, "rewind.backfill", "rewind", body.machine or PROVIDER, identity=identity)
    return {"started": started, "reason": None if started else "A harvest or backfill is already running."}


class RunRequest(BaseModel):
    machine: str = Field(max_length=61)
    date: str = Field(max_length=10)
    circuit: str = Field(max_length=400_000)
    format: Optional[str] = Field(default=None, max_length=8)
    shots: int = 1024
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)


@router.post("/api/v1/rewind/run")
def run(body: RunRequest, request: Request, identity: Optional[Identity] = Depends(get_identity),
        db: Session = Depends(get_db)):
    signed_in = identity is not None
    if signed_in and identity.user_id is not None:
        rewind_run_user_limiter.check(f"user:{identity.user_id}")
    else:
        rewind_run_limiter(request)
    if not MACHINE_RE.match(body.machine):
        raise HTTPException(status_code=422, detail="Not a machine name.")
    if not store.DATE_RE.match(body.date):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD.")
    try:
        day = date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(status_code=422, detail="Not a calendar date.")
    try:
        out = rp.run_limited(lambda: rp.replay(db, body.machine, day, body.circuit, body.format, body.shots,
                                               body.seed, signed_in=signed_in, include_simulated=hv.simulated()))
    except rp.ReplayError as exc:
        headers = {"Retry-After": "10"} if exc.status == 503 else None
        raise HTTPException(status_code=exc.status, detail=exc.message, headers=headers)
    return {**out, "limits": rp.limits(signed_in)}


@router.on_event("startup")
def _start_rewind_scheduler() -> None:
    from ..database import SessionLocal
    hv.start_scheduler(SessionLocal)


@router.on_event("shutdown")
def _stop_rewind_scheduler() -> None:
    hv.stop_scheduler()
