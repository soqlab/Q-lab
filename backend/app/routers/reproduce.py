"""Reproduce this run (app/reproduce.py): the recipe, the script, and whether re-runs agreed.

GET /api/v1/runs/{id}/reproduce        the answer sentence, the commands, what is and isn't pinned,
                                       this run's reproductions (each compared) and, for a reproduction,
                                       its comparison with the original
GET /api/v1/runs/{id}/reproduce.py     the script (PEP 723 header: `uv run` installs the pinned versions)
GET /api/v1/runs/{id}/reproduce.ipynb  the same as a notebook
GET /api/v1/runs/{id}/reproduction     for a reproduction: did it agree with the original

Every run is found with a Run query, which app/run_scope.py limits to the caller's runs: another
tenant's run is a 404, and another tenant's reproductions are never listed or compared.
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import reproduce as rp
from ..database import get_db
from ..models import Run
from ..run_answer import LEVELS
from .build_info import backend_commit

router = APIRouter(tags=["reproduce"])


def _level(level: str) -> str:
    if level not in LEVELS:
        raise HTTPException(status_code=422, detail=f"level must be one of {', '.join(LEVELS)}")
    return level


def _run(db: Session, run_id: str) -> Run:
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _urls(request: Request) -> tuple[str, str]:
    api = (os.getenv("QLAB_API_URL") or "").strip() or str(request.base_url).rstrip("/")
    app = (os.getenv("QLAB_APP_URL") or "").strip()
    return api, app


def _recipe(run: Run) -> dict:
    return rp.recipe(run, sdk_ref=backend_commit())


@router.get("/api/v1/runs/{run_id}/reproduce")
def reproduce(run_id: str, request: Request, level: str = Query(default="standard"), db: Session = Depends(get_db)):
    level = _level(level)
    run = _run(db, run_id)
    rec = _recipe(run)
    api, app = _urls(request)
    cmd = rp.commands(run, rec)
    reps = rp.reproductions_of(db, run, level)
    agreed = sum(1 for r in reps if r["state"] == "reproduced")
    judged = sum(1 for r in reps if r["state"] in ("reproduced", "not_reproduced"))
    return {
        "run_id": run.run_id, "level": level,
        "sentence": rp.recipe_sentence(run, rec, level),
        "can_rerun": rec["source"] is not None,
        "commands": cmd,
        "requirements": rp.requirements(rec),
        "script_url": f"/api/v1/runs/{run.run_id}/reproduce.py",
        "notebook_url": f"/api/v1/runs/{run.run_id}/reproduce.ipynb",
        "notebook_cell": rp.script(run, rec, api_url=api, app_url=app, notebook=True) if rec["source"] else None,
        "pinned": rec["pinned"], "missing": rec["missing"], "cant_pin": rec["cant_pin"],
        "has_compiled": rec["compiled"] is not None,
        "reproductions": reps,
        "summary": None if not reps else (
            f"{agreed} of {judged} reproduction{'s' if judged != 1 else ''} agreed with this run." if judged
            else "Its reproductions can't be judged yet."),
        "reproduction_of": rp.original_of(db, run, level),
    }


@router.get("/api/v1/runs/{run_id}/reproduce.py")
def reproduce_script(run_id: str, request: Request, db: Session = Depends(get_db)):
    run = _run(db, run_id)
    rec = _recipe(run)
    api, app = _urls(request)
    body = rp.script(run, rec, api_url=api, app_url=app)
    return Response(content=body, media_type="text/x-python; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{rp.file_name(run)}"',
                             "Cache-Control": "private, no-store"})


@router.get("/api/v1/runs/{run_id}/reproduce.ipynb")
def reproduce_notebook(run_id: str, request: Request, db: Session = Depends(get_db)):
    run = _run(db, run_id)
    rec = _recipe(run)
    if rec["source"] is None:
        raise HTTPException(status_code=422, detail="No circuit source was recorded with this run, so it can't be re-run.")
    api, app = _urls(request)
    name = rp.file_name(run).replace(".py", ".ipynb")
    return Response(content=rp.notebook_json(run, rec, api_url=api, app_url=app), media_type="application/x-ipynb+json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "private, no-store"})


@router.get("/api/v1/runs/{run_id}/reproduction")
def reproduction(run_id: str, level: str = Query(default="standard"), db: Session = Depends(get_db)):
    level = _level(level)
    run = _run(db, run_id)
    out = rp.original_of(db, run, level)
    if out is None:
        return {"run_id": run.run_id, "state": "not_a_reproduction", "sentence": None}
    return out
