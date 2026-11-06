"""Why two runs differ: shot noise, compiler changes or calibration drift (see app/run_diff.py)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..run_diff import explain_difference

router = APIRouter(prefix="/api/v1/runs", tags=["compare"])


def _run(db: Session, run_id: str) -> Run:
    # Run queries are scoped to the caller (app/run_scope.py): another user's run is a 404 here.
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


@router.get("/{run_a}/explain-diff/{run_b}")
def explain_diff(run_a: str, run_b: str, db: Session = Depends(get_db)):
    """Observed difference between two runs' counts, and which captured factors explain it."""
    return explain_difference(_run(db, run_a), _run(db, run_b))
