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


def get_backend_stats(db) -> list[dict[str, Any]]:
    """Return per-backend run counts and avg health scores."""
    if _USE_CLICKHOUSE:
        return _clickhouse_backend_stats()
    return _sqlite_backend_stats(db)


def get_kpis(org_id: int | None, db) -> dict[str, Any]:
    """Return top-level KPIs: total runs, success rate, avg health, active projects."""
    if _USE_CLICKHOUSE:
        return _clickhouse_kpis(org_id)
    return _sqlite_kpis(org_id, db)


# --- SQLite implementations ---------------------------------------------------

def _sqlite_timeseries(org_id, project_slug, backend, days, granularity, db):
    from sqlalchemy import text
    if granularity == "hour":
        fmt = "strftime('%Y-%m-%dT%H:00:00', created_at)"
    elif granularity == "week":
        fmt = "strftime('%Y-W%W', created_at)"
    else:
        fmt = "strftime('%Y-%m-%d', created_at)"

    conditions = [f"created_at >= datetime('now', '-{days} days')"]
    params: dict = {}
    if org_id:
        conditions.append("org_id = :org_id")
        params["org_id"] = org_id
    if project_slug:
        conditions.append("project_slug = :project_slug")
        params["project_slug"] = project_slug
    if backend:
        conditions.append("backend = :backend")
        params["backend"] = backend

    where = " AND ".join(conditions)
    rows = db.execute(text(f"""
        SELECT {fmt} as bucket,
               COUNT(*) as run_count,
               AVG(CAST(json_extract(results, '$.health_score') AS REAL)) as avg_health
        FROM runs WHERE {where}
        GROUP BY bucket ORDER BY bucket
    """), params).fetchall()

    return [{"bucket": r[0], "run_count": r[1], "avg_health": round(r[2] or 0, 2)} for r in rows]


def _sqlite_backend_stats(db):
    from sqlalchemy import text
    rows = db.execute(text("""
        SELECT backend, COUNT(*) as runs,
               AVG(CAST(json_extract(results, '$.health_score') AS REAL)) as avg_health,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as successes
        FROM runs WHERE backend IS NOT NULL
        GROUP BY backend ORDER BY runs DESC LIMIT 20
    """)).fetchall()
    return [{"backend": r[0], "runs": r[1], "avg_health": round(r[2] or 0, 2), "success_rate": round((r[3] or 0) / max(r[1], 1), 3)} for r in rows]


def _sqlite_kpis(org_id, db):
    from sqlalchemy import text
    q = db.execute(text(f"""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as success,
               AVG(CAST(json_extract(results, '$.health_score') AS REAL)) as avg_health
        FROM runs {"WHERE org_id = :oid" if org_id else ""}
    """), {"oid": org_id} if org_id else {}).fetchone()
    total, success, avg_health = q[0] or 0, q[1] or 0, q[2] or 0
    projects = db.execute(text("SELECT COUNT(DISTINCT slug) FROM projects")).scalar() or 0
    return {"total_runs": total, "success_rate": round(success / max(total, 1), 3), "avg_health": round(avg_health, 2), "active_projects": projects}


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


def _clickhouse_backend_stats():
    client = _clickhouse_client()
    result = client.query("""
        SELECT backend, count() AS runs, avg(health_score) AS avg_health,
               countIf(status='completed') / count() AS success_rate
        FROM qlab_runs WHERE backend != ''
        GROUP BY backend ORDER BY runs DESC LIMIT 20
    """)
    return [{"backend": r[0], "runs": r[1], "avg_health": round(r[2] or 0, 2), "success_rate": round(r[3] or 0, 3)} for r in result.result_rows]


def _clickhouse_kpis(org_id):
    client = _clickhouse_client()
    cond = f"WHERE org_id = {org_id}" if org_id else ""
    result = client.query(f"SELECT count(), countIf(status='completed'), avg(health_score) FROM qlab_runs {cond}")
    r = result.result_rows[0]
    total, success, avg_h = r[0], r[1], r[2]
    projects = client.query(f"SELECT uniq(project_slug) FROM qlab_runs {cond}").result_rows[0][0]
    return {"total_runs": total, "success_rate": round(success / max(total, 1), 3), "avg_health": round(avg_h or 0, 2), "active_projects": projects}
