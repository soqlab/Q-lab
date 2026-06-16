"""Health score trend over time — by backend or project.

Returns a time-series of health scores so the frontend can show
quality degradation / improvement trends.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from ..database import get_db
from ..health_score import compute_health_score
from ..models import Run

router = APIRouter(prefix="/api/v1/analytics", tags=["health_trend"])


def _bucket_key(dt: datetime, granularity: str) -> str:
    if granularity == "hour":
        return dt.strftime("%Y-%m-%dT%H:00")
    if granularity == "week":
        # ISO week Monday
        monday = dt - timedelta(days=dt.weekday())
        return monday.strftime("%Y-%m-%d")
    return dt.strftime("%Y-%m-%d")  # day default


@router.get("/health-trend")
def health_trend(
    backend: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    days: int = Query(30, ge=1, le=365),
    granularity: str = Query("day", regex="^(hour|day|week)$"),
    db: Session = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)

    conditions = [Run.created_at >= since, Run.status == "completed"]
    if backend:
        conditions.append(Run.backend == backend)
    if project:
        conditions.append(Run.project_slug == project)

    runs = db.scalars(
        select(Run).where(and_(*conditions)).order_by(Run.created_at.asc()).limit(2000)
    ).all()

    # Bucket by granularity
    buckets: dict[str, list[float]] = {}
    for run in runs:
        rd = {
            "run_id": run.run_id,
            "backend": run.backend,
            "fingerprint": run.fingerprint or {},
            "calibration": run.calibration or {},
            "shadow_results": run.shadow_results or {},
            "results": run.results or {},
            "status": run.status,
        }
        hs = compute_health_score(rd)
        if hs is None:
            continue
        dt = run.created_at
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        key = _bucket_key(dt, granularity)
        buckets.setdefault(key, []).append(float(hs))

    points = []
    for key in sorted(buckets):
        vals = buckets[key]
        points.append({
            "date": key,
            "avg_health": round(sum(vals) / len(vals), 2),
            "min_health": min(vals),
            "max_health": max(vals),
            "run_count": len(vals),
            "p25": sorted(vals)[max(0, int(len(vals) * 0.25) - 1)],
            "p75": sorted(vals)[min(len(vals) - 1, int(len(vals) * 0.75))],
        })

    # Compute trend (linear regression slope)
    trend_slope: float | None = None
    if len(points) >= 3:
        n = len(points)
        xs = list(range(n))
        ys = [p["avg_health"] for p in points]
        xbar = sum(xs) / n
        ybar = sum(ys) / n
        denom = sum((x - xbar) ** 2 for x in xs)
        if denom:
            trend_slope = round(sum((xs[i] - xbar) * (ys[i] - ybar) for i in range(n)) / denom, 4)

    return {
        "backend": backend,
        "project": project,
        "days": days,
        "granularity": granularity,
        "total_runs": len(runs),
        "points": points,
        "trend_slope": trend_slope,
        "trend_direction": (
            "improving" if (trend_slope or 0) > 0.1
            else "degrading" if (trend_slope or 0) < -0.1
            else "stable"
        ),
    }
