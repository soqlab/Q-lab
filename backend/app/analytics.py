"""Analytics backend — SQLite (default) or ClickHouse (set CLICKHOUSE_URL env var).

ClickHouse connection string format:
  CLICKHOUSE_URL=clickhouse://user:password@host:9000/database
  or HTTP: CLICKHOUSE_URL=http://user:password@host:8123/database
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

_CLICKHOUSE_URL = os.getenv("CLICKHOUSE_URL", "")
_USE_CLICKHOUSE = bool(_CLICKHOUSE_URL)


def _clickhouse_client():
    """Lazy ClickHouse client — only imported if CLICKHOUSE_URL is set."""
    try:
        import clickhouse_connect  # type: ignore
        return clickhouse_connect.get_client(dsn=_CLICKHOUSE_URL)
    except ImportError:
        raise RuntimeError("Install clickhouse-connect: pip install clickhouse-connect")


def get_timeseries(
    org_id: int | None,
    project_slug: str | None,
    backend: str | None,
    days: int,
    granularity: str,  # "hour" | "day" | "week"
    db,  # SQLAlchemy Session (used for SQLite path)
) -> list[dict[str, Any]]:
    """Return time-series run counts and avg health scores."""
    if _USE_CLICKHOUSE:
        return _clickhouse_timeseries(org_id, project_slug, backend, days, granularity)
    return _sqlite_timeseries(org_id, project_slug, backend, days, granularity, db)


# --- SQLite implementations ---------------------------------------------------

def _sqlite_timeseries(org_id, project_slug, backend, days, granularity, db):
    """Runs per time bucket. ORM query, so the caller's run visibility applies (app/run_scope.py)."""
    from datetime import timedelta

    from sqlalchemy import select

    from .models import Run

    since = datetime.now(timezone.utc) - timedelta(days=days)
    if db.bind.dialect.name == "sqlite":
        since = since.replace(tzinfo=None)  # SQLite stores naive UTC timestamps
    query = select(Run).where(Run.created_at >= since)
    if org_id:
        query = query.where(Run.org_id == org_id)
    if project_slug:
        query = query.where(Run.project_slug == project_slug)
    if backend:
        query = query.where(Run.backend == backend)

    def bucket_of(ts: datetime) -> str:
        if granularity == "hour":
            return ts.strftime("%Y-%m-%dT%H:00:00")
        if granularity == "week":
            return ts.strftime("%Y-W%W")
        return ts.strftime("%Y-%m-%d")

    buckets: dict[str, dict[str, Any]] = {}
    for run in db.scalars(query.order_by(Run.created_at)):
        b = buckets.setdefault(bucket_of(run.created_at), {
            "total": 0, "completed": 0, "failed": 0, "submitted": 0, "_health": []})
        b["total"] += 1
        if run.status in ("completed", "failed", "submitted"):
            b[run.status] += 1
        score = run.health_score
        if score is not None:
            b["_health"].append(score)

    out = []
    for key, b in buckets.items():
        health = b.pop("_health")
        avg = round(sum(health) / len(health), 2) if health else None
        # "bucket"/"run_count" are the original field names; "date"/"total" are what the dashboard reads.
        out.append({"date": key, "bucket": key, "run_count": b["total"], "avg_health": avg, **b})
    return out


# --- ClickHouse implementations -----------------------------------------------

def _clickhouse_timeseries(org_id, project_slug, backend, days, granularity):
    client = _clickhouse_client()
    trunc = {"hour": "toStartOfHour", "week": "toStartOfWeek", "day": "toStartOfDay"}.get(granularity, "toStartOfDay")
    conditions = [f"created_at >= now() - INTERVAL {days} DAY"]
    params = {}
    if org_id:
        conditions.append("org_id = {org_id:Int32}")
        params["org_id"] = org_id
    if project_slug:
        conditions.append("project_slug = {project_slug:String}")
        params["project_slug"] = project_slug
    if backend:
        conditions.append("backend = {backend:String}")
        params["backend"] = backend
    where = " AND ".join(conditions)
    result = client.query(f"""
        SELECT {trunc}(created_at) AS bucket, count() AS run_count, avg(health_score) AS avg_health
        FROM qlab_runs WHERE {where}
        GROUP BY bucket ORDER BY bucket
    """, parameters=params)
    return [{"bucket": str(r[0]), "run_count": r[1], "avg_health": round(r[2] or 0, 2)} for r in result.result_rows]

