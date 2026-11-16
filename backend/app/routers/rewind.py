"""Rewind's API (app/rewind/).

Public, no sign-in:
    GET  /api/v1/rewind/machines           what is collected: machines, snapshot counts, first/last day
    GET  /api/v1/rewind/pulse              the few facts soqlab.com shows: is it collecting, and each
                                           machine's latest calibration time (CORS: soqlab.com, no cookies)
    GET  /api/v1/rewind/manifests/{date}   that UTC day's signed manifest (hashes, never contents)
    GET  /api/v1/rewind/public-key         the key manifests are signed with
    POST /api/v1/rewind/run                replay a circuit on a machine as calibrated on a date
                                           (no account needed; lower limits without one), with its
                                           Hellinger fidelity against the noiseless distribution
    GET  /api/v1/rewind/machines/{m}/days  the days with a stored calibration of that machine
    GET  /api/v1/rewind/watch              each machine's medians over time (QPU Watch)
    POST /api/v1/rewind/compare            the same circuit on one calibration per month (up to 12),
    GET  /api/v1/rewind/compare/{job}      run in the background; poll for progress

Signed in:
    POST /api/v1/rewind/save               replay again and keep it as a run (marked simulated, never hardware)

Server owner, or the scheduled workflow with the X-Rewind-Trigger header (QLAB_REWIND_TRIGGER_TOKEN):
    POST /api/v1/rewind/harvest            harvest now (in the background)
    POST /api/v1/rewind/backfill           walk back through IBM's calibration history
"""
from __future__ import annotations

import hmac
import os
import threading
import time
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit, require_auth
from ..rewind import harvest as hv
from ..rate_limit import (rewind_compare_limiter, rewind_compare_user_limiter, rewind_pulse_limiter, rewind_run_limiter,
                          rewind_run_user_limiter)
from ..rewind import compare as cmp
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

# soqlab.com shows one line from this. Real (harvested or backfilled) calibrations only, never the
# simulated preview. Readable from those origins only, cached here and by the browser for 5 minutes.
PULSE_ORIGINS = ("https://soqlab.com", "https://www.soqlab.com")
PULSE_TTL_SECONDS = 300
PULSE_MAX_MACHINES = 5
_pulse_cache: dict[str, tuple[float, dict]] = {}
_pulse_lock = threading.Lock()


def _pulse_body(db: Session) -> dict:
    rows = store.machines(db, include_simulated=False)
    rows.sort(key=lambda m: m["last_calibrated_at"] or "", reverse=True)
    return {
        "collecting": hv.configured(),
        "machines": [{"machine": m["machine"], "last_calibrated_at": m["last_calibrated_at"]}
                     for m in rows[:PULSE_MAX_MACHINES]],
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": "Calibration times of IBM machines as stored by this server. Not affiliated with or endorsed by IBM.",
    }


@router.get("/api/v1/rewind/pulse", dependencies=[Depends(rewind_pulse_limiter)])
def pulse(request: Request, db: Session = Depends(get_db)):
    now = time.monotonic()
    with _pulse_lock:
        hit = _pulse_cache.get("body")
    if hit is None or hit[0] <= now:
        hit = (now + PULSE_TTL_SECONDS, _pulse_body(db))
        with _pulse_lock:
            _pulse_cache["body"] = hit
    headers = {"Cache-Control": f"public, max-age={PULSE_TTL_SECONDS}", "Vary": "Origin"}
    origin = request.headers.get("origin", "")
    if origin in PULSE_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
    return JSONResponse(hit[1], headers=headers)


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
        out = rp.run_limited(lambda: cmp.replay_with_ideal(db, body.machine, day, body.circuit, body.format, body.shots,
                                                           body.seed, signed_in=signed_in,
                                                           include_simulated=hv.simulated()))
    except rp.ReplayError as exc:
        raise _http(exc)
    return {**out, "limits": rp.limits(signed_in)}


def _http(exc: rp.ReplayError) -> HTTPException:
    headers = {"Retry-After": "10"} if exc.status == 503 else None
    return HTTPException(status_code=exc.status, detail=exc.message, headers=headers)


def _day(raw: str) -> date:
    if not store.DATE_RE.match(raw):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD.")
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Not a calendar date.")


def _machine(name: str) -> str:
    if not MACHINE_RE.match(name):
        raise HTTPException(status_code=422, detail="Not a machine name.")
    return name


@router.get("/api/v1/rewind/machines/{machine}/days")
def stored_days(machine: str, db: Session = Depends(get_db)):
    """Days a replay can be asked for, each with the calibration it would use."""
    days = cmp.stored_days(db, _machine(machine), hv.simulated())
    return {"machine": machine, "simulated": hv.simulated(), "days": days,
            "monthly": cmp.monthly_days(db, machine, hv.simulated())}


@router.get("/api/v1/rewind/watch")
def watch(days: int = Query(default=30, ge=1, le=3650), db: Session = Depends(get_db)):
    """Each machine's medians over the last `days` days stored (one point per day). Medians only:
    the calibration itself is IBM's and is not republished."""
    include_sim = hv.simulated()
    out = []
    for m in store.machines(db, include_simulated=include_sim):
        pts = cmp.series(db, m["machine"], include_sim, days)
        out.append({"machine": m["machine"], "snapshots": m["snapshots"], "first_date": m["first_date"],
                    "last_date": m["last_date"], "latest": pts[-1] if pts else None, "series": pts})
    return {"collecting": hv.configured(), "simulated": include_sim,
            "reason": None if hv.configured() else hv.not_configured_reason(), "days": days,
            "metrics": list(cmp.METRICS), "machines": out,
            "note": "Medians across each machine's qubits and gates, from IBM-published calibration. "
                    "Not affiliated with or endorsed by IBM."}


class CompareRequest(BaseModel):
    machine: str = Field(max_length=61)
    circuit: str = Field(max_length=400_000)
    format: Optional[str] = Field(default=None, max_length=8)
    shots: int = 1024
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)
    months: int = Field(default=cmp.MAX_MONTHS, ge=2, le=cmp.MAX_MONTHS)


@router.post("/api/v1/rewind/compare", status_code=202)
def compare(body: CompareRequest, request: Request, identity: Optional[Identity] = Depends(get_identity),
            db: Session = Depends(get_db)):
    signed_in = identity is not None
    _machine(body.machine)
    cap = rp.max_shots(signed_in)
    if body.shots < 1 or body.shots > cap:
        raise HTTPException(status_code=422, detail=f"shots must be between 1 and {cap}"
                            + ("" if signed_in else " without an account") + ".")
    days = cmp.monthly_days(db, body.machine, hv.simulated(), body.months)
    if len(days) < 2:
        n = len(days)
        raise HTTPException(status_code=409, detail=f"Comparing across time needs calibrations of {body.machine} "
                                                    f"from at least two months; {n} month{'' if n == 1 else 's'} stored.")
    try:
        circuit = cmp.parse_for_ideal(body.circuit, body.format)
        rp.check_circuit(circuit, rp.max_qubits())
    except rp.ReplayError as exc:
        raise _http(exc)
    if cmp.busy():
        raise HTTPException(status_code=503, detail="Another comparison is running; try again in a minute.",
                            headers={"Retry-After": "60"})
    if signed_in and identity.user_id is not None:
        rewind_compare_user_limiter.check(f"user:{identity.user_id}")
    else:
        rewind_compare_limiter(request)
    from ..database import SessionLocal
    from ..rewind import bench
    accuracy, note = bench.accuracy_for(db, body.machine, include_simulated=hv.simulated())
    doc = cmp.start_compare(body.machine, days, body.circuit, body.format, body.shots, body.seed, signed_in,
                            hv.simulated(), SessionLocal, circuit, accuracy, note)
    if doc is None:
        raise HTTPException(status_code=503, detail="Another comparison is running; try again in a minute.",
                            headers={"Retry-After": "60"})
    return doc


@router.get("/api/v1/rewind/compare/{job}")
def compare_progress(job: str):
    try:
        doc = cmp.read_job(job)
    except ValueError:
        raise HTTPException(status_code=422, detail="Not a comparison id.")
    if doc is None:
        raise HTTPException(status_code=404, detail="No such comparison here (they are kept for a day).")
    return doc


class SaveRequest(RunRequest):
    project: Optional[str] = Field(default=None, max_length=120)
    name: Optional[str] = Field(default=None, max_length=200)


@router.post("/api/v1/rewind/save")
def save(body: SaveRequest, request: Request, identity: Identity = Depends(require_auth),
         db: Session = Depends(get_db)):
    """Replay again (the same inputs give the same counts) and keep it as a run. The run is marked
    as a simulation everywhere it shows: backend "rewind:<machine>", tags rewind and simulated, and
    context.rewind with the calibration's sha256."""
    import hashlib
    import uuid
    from datetime import datetime, timezone

    from sqlalchemy import select

    from ..main import RunPayload, _project_visible, _upsert_run
    from ..models import Project

    if identity.user_id is not None:
        rewind_run_user_limiter.check(f"user:{identity.user_id}")
    _machine(body.machine)
    day = _day(body.date)
    slug = (body.project or "").strip() or None
    if slug:
        existing = db.scalar(select(Project).where(Project.slug == slug))
        if existing is not None and not _project_visible(db, existing, identity):
            raise HTTPException(status_code=403, detail="That project isn't yours.")
    try:
        out = rp.run_limited(lambda: cmp.replay_with_ideal(db, body.machine, day, body.circuit, body.format, body.shots,
                                                           body.seed, signed_in=True, include_simulated=hv.simulated()))
    except rp.ReplayError as exc:
        raise _http(exc)
    is_qasm = (body.format or "").lower() == "qasm" or "OPENQASM" in body.circuit[:2000]
    qasm = body.circuit if is_qasm else None
    facts = out["circuit"]
    payload = RunPayload(
        run_id=f"rewind-{uuid.uuid4().hex[:20]}",
        circuit_name=(body.name or "").strip() or f"Rewind replay on {body.machine}",
        qasm=qasm,
        backend=f"rewind:{body.machine}",
        fingerprint={"num_qubits": facts["num_qubits"], "depth": facts["depth"], "size": facts["operations"],
                     **({"qasm_sha256": hashlib.sha256(qasm.encode("utf-8")).hexdigest()} if qasm else {})},
        context={"rewind": {"machine": body.machine, "requested_date": out["requested_date"], "snapshot": out["snapshot"],
                            "label": out["label"], "accuracy": out["accuracy"], "accuracy_note": out["accuracy_note"],
                            "real_hardware": False, "notes": out["notes"],
                            "ideal": {k: out["ideal"].get(k) for k in ("hellinger_fidelity", "share_on_ideal_outcomes")}}},
        parameters={},
        execution={"shots": out["shots"], "simulator": "qiskit-aer", "method": out["noise_model"]["method"],
                   "real_hardware": False, "seed_simulator": out["seeds"]["simulator"],
                   "seed_transpiler": out["seeds"]["transpiler"]},
        transpiler={**out["transpiled"]},
        results={"counts": out["counts"]},
        project=slug,
        tags=["rewind", "simulated"],
        status="completed",
        created_at=datetime.now(timezone.utc),
    )
    run = _upsert_run(db, payload, identity)
    log_audit(db, "rewind.saved", "run", run.run_id, identity=identity, request=request)
    return {"run_id": run.run_id, "url": f"/runs/{run.run_id}", "label": out["label"], "snapshot": out["snapshot"]}


@router.on_event("startup")
def _start_rewind_scheduler() -> None:
    from ..database import SessionLocal
    hv.start_scheduler(SessionLocal)


@router.on_event("shutdown")
def _stop_rewind_scheduler() -> None:
    hv.stop_scheduler()
