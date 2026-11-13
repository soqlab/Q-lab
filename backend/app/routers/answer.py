"""Answer-first views: a run's one-sentence answer, a project's run timeline, and the one input.

All Run queries here are scoped to the caller by app/run_scope.py, so nothing reveals runs the
caller couldn't open anyway.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..drift import timeline_marks as drift_marks
from ..deps import Identity, get_identity
from ..models import Project, Run
from ..run_answer import LEVELS, Level, answer, ideal_distribution, measure

router = APIRouter(tags=["answer"])

_HEX = re.compile(r"^[0-9a-f]{8,64}$")
_BACKEND = re.compile(r"^[a-z][a-z0-9_-]{1,60}$")
TIMELINE_LIMIT = 500


def _level(level: str) -> Level:
    if level not in LEVELS:
        raise HTTPException(status_code=422, detail=f"level must be one of {', '.join(LEVELS)}")
    return level  # type: ignore[return-value]


@router.get("/api/v1/runs/{run_id}/answer")
def run_answer(run_id: str, level: str = Query(default="standard"), db: Session = Depends(get_db)):
    """The sentence a run's page opens with, and the facts behind it."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return answer(db, run, _level(level))


@router.get("/api/v1/runs/public/{share_token}/answer")
def public_run_answer(share_token: str, level: str = Query(default="standard"), db: Session = Depends(get_db)):
    """The answer for a shared run. It is compared only with the same owner's other shared runs,
    so a public page never reveals anything about runs that weren't shared."""
    run = db.scalar(select(Run).where(Run.share_token == share_token))
    if run is None or not share_token:
        raise HTTPException(status_code=404, detail="run not found")

    def shared_by_same_owner(r: Run) -> bool:
        return bool(r.share_token) and r.created_by_user_id == run.created_by_user_id and r.org_id == run.org_id

    out = answer(db, run, _level(level), allowed=shared_by_same_owner)
    if out.get("previous"):
        out["previous"]["share_token"] = db.scalar(select(Run.share_token).where(Run.run_id == out["previous"]["run_id"]))
    return out


@router.get("/api/v1/projects/{slug}/timeline")
def project_timeline(slug: str, db: Session = Depends(get_db), identity: Optional[Identity] = Depends(get_identity)):
    """Every run of a project you can see, oldest first, each with its headline measure."""
    runs = db.scalars(
        select(Run).where(Run.project_slug == slug).order_by(Run.created_at.desc()).limit(TIMELINE_LIMIT)
    ).all()
    project = db.scalar(select(Project).where(Project.slug == slug))
    mine = project is not None and identity is not None and project.created_by_user_id == identity.user_id
    if not runs and not mine:
        raise HTTPException(status_code=404, detail="project not found")
    total = db.scalar(select(func.count()).select_from(Run).where(Run.project_slug == slug)) or 0
    # The ideal distribution depends only on the circuit: work it out once per circuit.
    ideals: dict[str, Any] = {}
    items = []
    # Same circuit, same backend, result moved beyond shot noise (app/drift.py): marked on the strip.
    marks = drift_marks(list(reversed(runs)))
    for r in reversed(runs):
        key = (r.fingerprint or {}).get("qasm_sha256") or r.qasm or ""
        known = None
        if r.qasm and not (r.results or {}).get("ideal"):
            if key not in ideals:
                ideals[key] = ideal_distribution(r)
            known = ideals[key]
        m = measure(r, known)
        items.append({
            "run_id": r.run_id,
            "circuit_name": r.circuit_name,
            "circuit_hash": (r.fingerprint or {}).get("qasm_sha256"),
            "backend": r.backend,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "num_qubits": (r.fingerprint or {}).get("num_qubits"),
            "depth": (r.fingerprint or {}).get("depth"),
            "measure": None if m is None else {"kind": m["kind"], "value": round(m["value"], 6)},
            "drift": marks.get(r.run_id),
        })
    return {
        "slug": slug,
        "name": project.name if project else slug,
        "total": total,
        "shown": len(items),
        "truncated": total > len(items),
        "runs": items,
    }


def _ago(run: Run) -> str:
    return run.created_at.isoformat() if run.created_at else ""


@router.get("/api/v1/lookup")
def lookup(q: str = Query(min_length=1, max_length=200), db: Session = Depends(get_db),
           identity: Optional[Identity] = Depends(get_identity)):
    """What a typed string is: a run id, a circuit hash, a project, a backend or a circuit name.

    Each match carries the address of the page that shows it.
    """
    text = q.strip()
    low = text.lower()
    out: list[dict[str, Any]] = []

    def add(kind: str, title: str, href: str, hint: str) -> None:
        if not any(m["href"] == href for m in out):
            out.append({"kind": kind, "title": title, "href": href, "hint": hint})

    if len(text) >= 6:
        for r in db.scalars(select(Run).where(Run.run_id.startswith(text)).order_by(Run.created_at.desc()).limit(5)):
            add("run", r.circuit_name or r.run_id, f"/runs/{r.run_id}",
                f"Run {r.run_id[:12]} · {r.backend or 'no backend'} · {_ago(r)[:10]}")

    if _HEX.match(low):
        # Circuit hashes live inside a JSON column: scan the caller's recent runs.
        hits = [r for r in db.scalars(select(Run).order_by(Run.created_at.desc()).limit(5000))
                if str((r.fingerprint or {}).get("qasm_sha256") or "").startswith(low)]
        if hits:
            h = hits[0].fingerprint["qasm_sha256"]
            add("circuit", hits[0].circuit_name or f"Circuit {h[:12]}", f"/runs?circuit={h}",
                f"Circuit {h[:12]} · {len(hits)} run{'s' if len(hits) != 1 else ''}")
            add("run", hits[0].circuit_name or hits[0].run_id, f"/runs/{hits[0].run_id}",
                f"Latest run of circuit {h[:12]}")

    for p in db.scalars(select(Project).where(or_(func.lower(Project.slug).contains(low),
                                                  func.lower(Project.name).contains(low))).limit(20)):
        n = db.scalar(select(func.count()).select_from(Run).where(Run.project_slug == p.slug)) or 0
        mine = identity is not None and p.created_by_user_id == identity.user_id
        if n or mine:
            add("project", p.name or p.slug, f"/projects/{p.slug}/timeline", f"Project · {n} run{'s' if n != 1 else ''}")
        if len([m for m in out if m["kind"] == "project"]) >= 5:
            break

    if _BACKEND.match(low):
        rows = db.execute(select(Run.backend, func.count()).where(func.lower(Run.backend).contains(low))
                          .group_by(Run.backend).order_by(func.count().desc()).limit(5)).all()
        for name, n in rows:
            if name:
                add("backend", name, f"/runs?backend={name}", f"Backend · {n} of your runs")
        if low.startswith(("ibm_", "ibm")) or rows:
            for name, _ in rows or [(low, 0)]:
                if name and name.startswith("ibm"):
                    add("hardware", f"{name} on the hardware board", f"/hardware/{name}", "Live status, queue and benchmark history")

    for r in db.scalars(select(Run).where(func.lower(Run.circuit_name).contains(low))
                        .order_by(Run.created_at.desc()).limit(5)):
        add("run", r.circuit_name or r.run_id, f"/runs/{r.run_id}",
            f"Run {r.run_id[:12]} · {r.backend or 'no backend'} · {_ago(r)[:10]}")

    return {"q": text, "matches": out[:20]}
