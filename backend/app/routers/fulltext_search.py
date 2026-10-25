"""Full-text search across runs, circuit names, backends, and project slugs."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..database import DATABASE_URL, get_db
from ..run_scope import sql_visibility

router = APIRouter(prefix="/api/v1/search", tags=["search"])


@router.get("/fulltext")
def fulltext_search(
    q: str = Query(..., min_length=1, description="Search query (supports FTS5 prefix search with *)"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """FTS5-powered search across run IDs, circuit names, backends, and project slugs."""
    if not q.strip():
        return {"results": [], "total": 0, "query": q}

    # Hand-written SQL bypasses the ORM run filter, so the caller's visibility is applied here.
    visible, scope_params = sql_visibility("r")

    if DATABASE_URL.startswith("sqlite"):
        # FTS5 query — append * for prefix search
        fts_query = q.strip() + "*" if not q.strip().endswith("*") else q.strip()
        try:
            rows = db.execute(
                text(f"""
                    SELECT r.run_id, r.circuit_name, r.backend, r.project_slug,
                           r.status, r.created_at, r.tags,
                           bm25(runs_fts) AS score
                    FROM runs_fts
                    JOIN runs r ON runs_fts.rowid = r.id
                    WHERE runs_fts MATCH :q AND {visible}
                    ORDER BY bm25(runs_fts)
                    LIMIT :limit
                """),
                {"q": fts_query, "limit": limit, **scope_params},
            ).fetchall()
        except Exception:
            # FTS table not yet populated — fall back to LIKE
            rows = db.execute(
                text(f"""
                    SELECT r.run_id, r.circuit_name, r.backend, r.project_slug, r.status, r.created_at, r.tags, 0 as score
                    FROM runs r
                    WHERE (r.circuit_name LIKE :q OR r.backend LIKE :q OR r.project_slug LIKE :q OR r.run_id LIKE :q)
                      AND {visible}
                    ORDER BY r.created_at DESC LIMIT :limit
                """),
                {"q": f"%{q}%", "limit": limit, **scope_params},
            ).fetchall()
    else:
        # Postgres: use ILIKE (can upgrade to pg_trgm/GIN later)
        rows = db.execute(
            text(f"""
                SELECT r.run_id, r.circuit_name, r.backend, r.project_slug, r.status, r.created_at, r.tags, 0 as score
                FROM runs r
                WHERE (r.circuit_name ILIKE :q OR r.backend ILIKE :q OR r.project_slug ILIKE :q OR r.run_id ILIKE :q)
                  AND {visible}
                ORDER BY r.created_at DESC LIMIT :limit
            """),
            {"q": f"%{q}%", "limit": limit, **scope_params},
        ).fetchall()

    results = [
        {
            "run_id": r[0],
            "circuit_name": r[1],
            "backend": r[2],
            "project_slug": r[3],
            "status": r[4],
            "created_at": str(r[5]) if r[5] else None,
            "tags": r[6] if isinstance(r[6], list) else [],
            "score": float(r[7]) if r[7] else 0.0,
        }
        for r in rows
    ]
    return {"results": results, "total": len(results), "query": q}
