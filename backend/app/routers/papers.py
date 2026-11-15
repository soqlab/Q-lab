"""Reproduce a paper (app/papers/).

Public, no sign-in (lower limits without one):
    GET  /api/v1/papers/status    what a run can use here: stored IBM calibrations, or only the ideal simulator
    POST /api/v1/papers/find      an arXiv id or link -> the paper and the OpenQASM circuits in its files
    POST /api/v1/papers/run       run one circuit on a machine's replica (Rewind) or the ideal simulator,
                                  with the paper's reported numbers compared if given
    POST /api/v1/papers/compare   compare a run's counts with reported numbers again (no new run)

Signed in:
    POST /api/v1/papers/save      run again (same inputs, same counts) and keep it as a run marked simulated

Code from papers is never executed; only OpenQASM is read (app/papers/circuits.py).
"""
from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit, require_auth
from ..papers import compare as pc
from ..papers import run as pr
from ..papers import service
from ..rate_limit import (papers_find_limiter, papers_find_user_limiter, read_limiter, rewind_run_limiter,
                          rewind_run_user_limiter)
from ..rewind import harvest as hv
from ..rewind import replay as rp
from ..rewind import store
from ..rewind.snapshot import MACHINE_RE

router = APIRouter(tags=["papers"])

NOT_AFFILIATED = "Machine replicas use IBM-published calibration. Not affiliated with or endorsed by IBM or arXiv."


def _limit(request: Request, identity: Optional[Identity], anon, user) -> None:
    if identity is not None and identity.user_id is not None:
        user.check(f"user:{identity.user_id}")
    else:
        anon(request)


@router.get("/api/v1/papers/status")
def status(db: Session = Depends(get_db), identity: Optional[Identity] = Depends(get_identity)):
    include_sim = hv.simulated()
    machines = []
    for m in store.machines(db, include_simulated=include_sim):
        machines.append({"machine": m["machine"], "snapshots": m["snapshots"], "first_date": m["first_date"],
                         "last_date": m["last_date"]})
    return {
        "calibration_available": bool(machines),
        "simulated": include_sim,
        "machines": machines,
        "reason": None if machines else (pr.NO_CALIBRATION if not hv.configured() else
                                         "This server collects IBM calibration but hasn't stored any yet; "
                                         "runs use the ideal (noiseless) simulator until it has."),
        "ideal_label": pr.IDEAL_LABEL,
        "limits": rp.limits(identity is not None),
        "note": NOT_AFFILIATED,
    }


class FindRequest(BaseModel):
    paper: str = Field(max_length=300)


@router.post("/api/v1/papers/find")
def find(body: FindRequest, request: Request, identity: Optional[Identity] = Depends(get_identity)):
    try:
        arxiv_id = service.parse_id(body.paper)
    except service.PaperError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)
    if service.cached(arxiv_id) is None:
        _limit(request, identity, papers_find_limiter, papers_find_user_limiter)
    try:
        return service.find(arxiv_id)
    except service.PaperError as exc:
        headers = {"Retry-After": "10"} if exc.status == 503 else None
        raise HTTPException(status_code=exc.status, detail=exc.message, headers=headers)


class Reported(BaseModel):
    kind: Literal["probability", "fidelity", "distribution"]
    value: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    outcomes: Optional[list[str]] = Field(default=None, max_length=64)
    distribution: Optional[dict[str, float]] = None
    label: Optional[str] = Field(default=None, max_length=200)
    extracted: bool = False


class RunRequest(BaseModel):
    circuit: str = Field(max_length=70_000)
    machine: Optional[str] = Field(default=None, max_length=61)
    date: Optional[str] = Field(default=None, max_length=10)
    shots: int = 1024
    seed: Optional[int] = Field(default=None, ge=0, le=2**31 - 1)
    reported: Optional[Reported] = None


def _day(raw: Optional[str]) -> Optional[date]:
    if not raw:
        return None
    if not store.DATE_RE.match(raw):
        raise HTTPException(status_code=422, detail="date must be YYYY-MM-DD.")
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="Not a calendar date.")


def _reported(r: Optional[Reported]) -> Optional[dict[str, Any]]:
    if r is None:
        return None
    d = r.model_dump()
    if r.kind in ("probability", "fidelity") and r.value is None:
        raise HTTPException(status_code=422, detail="Give the reported value, between 0 and 1.")
    if r.kind == "distribution" and (not r.distribution or len(r.distribution) > 4096):
        raise HTTPException(status_code=422, detail="Give the reported distribution (up to 4096 outcomes).")
    return d


def _compare(out: dict[str, Any], reported: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if reported is None:
        return None
    try:
        return pc.compare(out, reported)
    except (pc.CompareError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _run(db: Session, body: RunRequest, signed_in: bool) -> dict[str, Any]:
    if body.machine and not MACHINE_RE.match(body.machine):
        raise HTTPException(status_code=422, detail="Not a machine name.")
    try:
        return pr.run(db, body.circuit, body.machine, _day(body.date), body.shots, body.seed, signed_in)
    except rp.ReplayError as exc:
        headers = {"Retry-After": "10"} if exc.status == 503 else None
        raise HTTPException(status_code=exc.status, detail=exc.message, headers=headers)


@router.post("/api/v1/papers/run")
def run(body: RunRequest, request: Request, identity: Optional[Identity] = Depends(get_identity),
        db: Session = Depends(get_db)):
    _limit(request, identity, rewind_run_limiter, rewind_run_user_limiter)
    reported = _reported(body.reported)
    out = _run(db, body, identity is not None)
    return {**out, "comparison": _compare(out, reported), "limits": rp.limits(identity is not None), "note": NOT_AFFILIATED}


class CompareResult(BaseModel):
    counts: dict[str, int]
    shots: int = Field(ge=1, le=1_000_000)
    mode: Literal["ideal", "calibrated"]
    ideal: Optional[dict[str, Any]] = None


class CompareRequest(BaseModel):
    result: CompareResult
    reported: Reported


@router.post("/api/v1/papers/compare")
def compare(body: CompareRequest, request: Request):
    read_limiter(request)
    if len(body.result.counts) > 65_536:
        raise HTTPException(status_code=422, detail="Too many outcomes.")
    ideal = body.result.ideal or {}
    fid = ideal.get("hellinger_fidelity")
    result = {"counts": body.result.counts, "shots": body.result.shots, "mode": body.result.mode,
              "ideal": {"hellinger_fidelity": fid if isinstance(fid, (int, float)) and 0 <= fid <= 1 else None,
                        "reason": str(ideal.get("reason") or "")[:300] or None}}
    return _compare(result, _reported(body.reported))


class SaveRequest(RunRequest):
    arxiv_id: str = Field(max_length=40)
    title: Optional[str] = Field(default=None, max_length=400)
    origin: Optional[str] = Field(default=None, max_length=300)
    source: Optional[str] = Field(default=None, max_length=200)
    project: Optional[str] = Field(default=None, max_length=120)
    name: Optional[str] = Field(default=None, max_length=200)


@router.post("/api/v1/papers/save")
def save(body: SaveRequest, request: Request, identity: Identity = Depends(require_auth),
         db: Session = Depends(get_db)):
    """Run again (the same inputs give the same counts) and keep it as a run, marked simulated, with
    the paper, the circuit's origin, the reported numbers and the verdict in context.paper."""
    import hashlib
    import uuid
    from datetime import datetime, timezone

    from sqlalchemy import select

    from ..main import RunPayload, _project_visible, _upsert_run
    from ..models import Project

    _limit(request, identity, rewind_run_limiter, rewind_run_user_limiter)
    try:
        arxiv_id = service.parse_id(body.arxiv_id)
    except service.PaperError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)
    slug = (body.project or "").strip() or None
    if slug:
        existing = db.scalar(select(Project).where(Project.slug == slug))
        if existing is not None and not _project_visible(db, existing, identity):
            raise HTTPException(status_code=403, detail="That project isn't yours.")
    reported = _reported(body.reported)
    out = _run(db, body, True)
    comparison = _compare(out, reported)
    facts = out["circuit"]
    calibrated = out["mode"] == "calibrated"
    paper = {"arxiv_id": arxiv_id, "url": f"https://arxiv.org/abs/{arxiv_id}", "title": (body.title or "").strip() or None,
             "origin": body.origin, "source": body.source, "mode": out["mode"], "label": out["label"],
             "reported": reported, "comparison": comparison, "real_hardware": False,
             "ideal": {k: (out.get("ideal") or {}).get(k) for k in ("hellinger_fidelity", "share_on_ideal_outcomes")}}
    context: dict[str, Any] = {"paper": paper}
    if calibrated:
        context["rewind"] = {"machine": out["machine"], "requested_date": out["requested_date"], "snapshot": out["snapshot"],
                             "label": out["label"], "accuracy": out["accuracy"], "accuracy_note": out["accuracy_note"],
                             "real_hardware": False, "notes": out["notes"], "ideal": paper["ideal"]}
    payload = RunPayload(
        run_id=f"paper-{uuid.uuid4().hex[:20]}",
        circuit_name=(body.name or "").strip() or f"arXiv {arxiv_id}" + (f" · {body.origin}" if body.origin else ""),
        qasm=body.circuit,
        backend=f"rewind:{out['machine']}" if calibrated else "aer_simulator",
        fingerprint={"num_qubits": facts["num_qubits"], "depth": facts["depth"], "size": facts["operations"],
                     "qasm_sha256": hashlib.sha256(body.circuit.encode("utf-8")).hexdigest()},
        context=context,
        parameters={},
        execution={"shots": out["shots"], "simulator": "qiskit-aer",
                   "method": out["noise_model"]["method"] if calibrated else "ideal",
                   "real_hardware": False, "seed_simulator": out["seeds"]["simulator"],
                   "seed_transpiler": out["seeds"]["transpiler"]},
        transpiler={**out["transpiled"]} if calibrated else {},
        results={"counts": out["counts"]},
        project=slug,
        tags=["paper", "simulated", f"arxiv:{arxiv_id}"] + (["rewind"] if calibrated else ["ideal"]),
        status="completed",
        created_at=datetime.now(timezone.utc),
    )
    saved = _upsert_run(db, payload, identity)
    log_audit(db, "paper.saved", "run", saved.run_id, identity=identity, request=request)
    return {"run_id": saved.run_id, "url": f"/runs/{saved.run_id}", "label": out["label"], "comparison": comparison}
