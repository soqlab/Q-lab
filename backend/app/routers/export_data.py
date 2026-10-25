"""Data Export — download run data as CSV or JSON.

Endpoints:
  GET /api/v1/export/runs/csv      — all runs as CSV
  GET /api/v1/export/runs/json     — all runs as JSON
  GET /api/v1/export/runs/{run_id} — single run full JSON
  GET /api/v1/export/project/{slug}/csv  — project runs CSV
  GET /api/v1/export/calibration/{backend}/csv
"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/export", tags=["export"])

_RUN_CSV_FIELDS = [
    "run_id", "backend", "status", "shots", "health_score",
    "success_probability", "created_at", "tags", "project_slug",
]


def _run_to_row(run: Run) -> dict:
    res = run.results or {}
    return {
        "run_id": run.run_id,
        "backend": run.backend,
        "status": run.status,
        "shots": run.shots,
        "health_score": run.health_score,
        "success_probability": res.get("success_probability", ""),
        "created_at": run.created_at.isoformat() if run.created_at else "",
        "tags": "|".join(run.tags or []),
        "project_slug": run.project_slug or "",
    }


def _runs_to_csv(runs: list[Run]) -> str:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_RUN_CSV_FIELDS)
    writer.writeheader()
    for r in runs:
        writer.writerow(_run_to_row(r))
    return buf.getvalue()


def _query_runs(db: Session, project_slug: Optional[str] = None,
                backend: Optional[str] = None, limit: int = 5000):
    q = select(Run).order_by(Run.created_at.desc())
    if project_slug:
        q = q.where(Run.project_slug == project_slug)
    if backend:
        q = q.where(Run.backend == backend)
    return db.scalars(q.limit(limit)).all()


@router.get("/runs/csv")
def export_runs_csv(
    project: Optional[str] = None,
    backend: Optional[str] = None,
    limit: int = Query(default=5000, ge=1, le=50000),
    db: Session = Depends(get_db),
):
    runs = _query_runs(db, project, backend, limit)
    csv_data = _runs_to_csv(runs)
    filename = f"qlab_runs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/runs/json")
def export_runs_json(
    project: Optional[str] = None,
    backend: Optional[str] = None,
    limit: int = Query(default=5000, ge=1, le=50000),
    db: Session = Depends(get_db),
):
    runs = _query_runs(db, project, backend, limit)
    data = [_run_to_row(r) for r in runs]
    filename = f"qlab_runs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    return Response(
        content=json.dumps({"count": len(data), "runs": data}, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/runs/{run_id}")
def export_single_run(run_id: str, db: Session = Depends(get_db)):
    """Full JSON export of a single run including results, calibration, fingerprint."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")
    payload = {
        "run_id": run.run_id,
        "backend": run.backend,
        "status": run.status,
        "shots": run.shots,
        "health_score": run.health_score,
        "tags": run.tags,
        "project_slug": run.project_slug,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "results": run.results,
        "calibration": run.calibration,
        "fingerprint": run.fingerprint,
        "qasm": run.qasm,
        "context": run.context,
        "parameters": run.parameters,
        "execution": run.execution,
        "transpiler": run.transpiler,
        "timing": run.timing,
    }
    filename = f"qlab_run_{run_id}.json"
    return Response(
        content=json.dumps(payload, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/project/{slug}/csv")
def export_project_csv(slug: str, limit: int = 5000, db: Session = Depends(get_db)):
    runs = _query_runs(db, project_slug=slug, limit=limit)
    csv_data = _runs_to_csv(runs)
    filename = f"qlab_project_{slug}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/calibration/{backend}/csv")
def export_calibration_csv(backend: str, limit: int = 1000, db: Session = Depends(get_db)):
    """Export calibration snapshot data for a backend."""
    runs = _query_runs(db, backend=backend, limit=limit)
    runs_with_cal = [r for r in runs if r.calibration]

    buf = io.StringIO()
    fields = ["run_id", "backend", "created_at", "avg_gate_error", "avg_readout_error",
              "avg_t1_us", "avg_t2_us", "health_score"]
    writer = csv.DictWriter(buf, fieldnames=fields)
    writer.writeheader()
    for r in runs_with_cal:
        cal = r.calibration or {}
        writer.writerow({
            "run_id": r.run_id,
            "backend": r.backend,
            "created_at": r.created_at.isoformat() if r.created_at else "",
            "avg_gate_error": cal.get("avg_gate_error", ""),
            "avg_readout_error": cal.get("avg_readout_error", ""),
            "avg_t1_us": cal.get("avg_t1_us", ""),
            "avg_t2_us": cal.get("avg_t2_us", ""),
            "health_score": r.health_score or "",
        })
    filename = f"qlab_cal_{backend}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
