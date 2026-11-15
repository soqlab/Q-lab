"""Why did this run give a wrong outcome? (app/why_failed.py, docs/WHY_METHOD.md)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..why_failed import WhyError, explain

router = APIRouter(prefix="/api/v1/runs", tags=["why"])


@router.get("/{run_id}/why")
def why_outcome(run_id: str, outcome: str = Query(..., max_length=200), db: Session = Depends(get_db)):
    """Which calibrated error sources make `outcome` (a measured bitstring) likely, by ablation."""
    # Run queries are scoped to the caller (app/run_scope.py): another user's run is a 404 here.
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    try:
        return explain(db, run, outcome)
    except WhyError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message)
