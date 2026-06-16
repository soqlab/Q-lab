from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RunMetric

router = APIRouter(prefix="/api/v1/runs", tags=["metrics"])


class MetricPoint(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    value: float
    step: Optional[int] = None


class MetricsBatch(BaseModel):
    metrics: list[MetricPoint] = Field(..., min_length=1, max_length=500)


def _point_out(m: RunMetric) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "value": m.value,
        "step": m.step,
        "logged_at": m.logged_at.isoformat(),
    }


@router.post("/{run_id}/metrics", status_code=201)
def log_metrics(
    run_id: str,
    payload: MetricsBatch,
    db: Session = Depends(get_db),
):
    """Log one or many scalar metrics to a run. No auth required — SDK-facing."""
    rows = [
        RunMetric(
            run_id=run_id,
            name=p.name,
            value=p.value,
            step=p.step,
            logged_at=datetime.now(timezone.utc),
        )
        for p in payload.metrics
    ]
    db.add_all(rows)
    db.commit()
    return {"logged": len(rows)}


@router.get("/{run_id}/metrics")
def get_metrics(
    run_id: str,
    db: Session = Depends(get_db),
):
    """
    Returns metrics grouped by name.
    Each group is sorted by step (if present) then by logged_at.
    """
    rows = db.scalars(
        select(RunMetric)
        .where(RunMetric.run_id == run_id)
        .order_by(RunMetric.name, RunMetric.step, RunMetric.logged_at)
    ).all()

    grouped: dict[str, list] = defaultdict(list)
    for row in rows:
        grouped[row.name].append(_point_out(row))

    # Summary: last value of each metric
    summary = {name: points[-1]["value"] for name, points in grouped.items()}

    return {
        "run_id": run_id,
        "metrics": grouped,
        "summary": summary,
        "total_points": len(rows),
    }


@router.delete("/{run_id}/metrics")
def clear_metrics(
    run_id: str,
    name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Delete all metrics for a run (or just one named metric)."""
    q = select(RunMetric).where(RunMetric.run_id == run_id)
    if name:
        q = q.where(RunMetric.name == name)
    rows = db.scalars(q).all()
    for row in rows:
        db.delete(row)
    db.commit()
    return {"deleted": len(rows)}
