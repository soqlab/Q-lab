from typing import Any, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..health_score import compute_health_score
from ..models import Run, RunMetric

router = APIRouter(prefix="/api/v1/sweeps", tags=["sweeps"])


def _run_light(run: Run) -> dict[str, Any]:
    return {
        "run_id": run.run_id,
        "circuit_name": run.circuit_name,
        "backend": run.backend,
        "status": run.status,
        "fingerprint": run.fingerprint or {},
        "parameters": run.parameters or {},
        "results": run.results or {},
        "context": run.context or {},
        "calibration": run.calibration or {},
        "transpiler": run.transpiler or {},
        "timing": run.timing or {},
        "tags": run.tags or [],
        "project": run.project_slug,
        "created_at": run.created_at.isoformat(),
    }


@router.get("/analyze")
def analyze_sweep(
    project: str,
    x_param: str = Query(..., description="Numeric parameter key from run.parameters"),
    y_metric: str = Query(
        ...,
        description="'health_score', 'depth', 'num_qubits', 'gate_count', 'success_probability', or a RunMetric name",
    ),
    db: Session = Depends(get_db),
):
    runs = db.scalars(
        select(Run).where(Run.project_slug == project).order_by(Run.created_at.asc())
    ).all()

    run_ids = [r.run_id for r in runs]

    # For custom RunMetric names, gather the last logged value per run
    metric_by_run: dict[str, float] = {}
    builtin = {"health_score", "depth", "num_qubits", "gate_count", "success_probability"}
    if y_metric not in builtin and run_ids:
        rows = db.scalars(
            select(RunMetric)
            .where(RunMetric.run_id.in_(run_ids), RunMetric.name == y_metric)
            .order_by(RunMetric.logged_at.asc())
        ).all()
        for row in rows:
            metric_by_run[row.run_id] = row.value

    points: list[dict[str, Any]] = []
    for run in runs:
        params = run.parameters or {}
        x_raw = params.get(x_param)
        if x_raw is None:
            continue
        try:
            x_val = float(x_raw)
        except (TypeError, ValueError):
            continue

        y_val: Optional[float] = None
        rd = _run_light(run)

        if y_metric == "health_score":
            y_val = compute_health_score(rd)
        elif y_metric == "depth":
            v = (run.fingerprint or {}).get("depth")
            y_val = float(v) if v is not None else None
        elif y_metric == "num_qubits":
            v = (run.fingerprint or {}).get("num_qubits")
            y_val = float(v) if v is not None else None
        elif y_metric == "gate_count":
            v = (run.fingerprint or {}).get("size")
            y_val = float(v) if v is not None else None
        elif y_metric == "success_probability":
            v = (run.results or {}).get("success_probability")
            y_val = float(v) if v is not None else None
        else:
            y_val = metric_by_run.get(run.run_id)

        if y_val is None:
            continue

        points.append({
            "run_id": run.run_id,
            "circuit_name": run.circuit_name,
            "x": x_val,
            "y": y_val,
            "status": run.status,
            "backend": run.backend,
            "created_at": run.created_at.isoformat(),
        })

    # Discover available numeric x parameters across all project runs
    available_x: set[str] = set()
    for run in runs:
        for k, v in (run.parameters or {}).items():
            try:
                float(v)
                available_x.add(k)
            except (TypeError, ValueError):
                pass

    # Discover RunMetric names for this project
    metric_names: list[str] = []
    if run_ids:
        metric_names = list(
            db.scalars(
                select(RunMetric.name).where(RunMetric.run_id.in_(run_ids)).distinct()
            ).all()
        )

    return {
        "project": project,
        "x_param": x_param,
        "y_metric": y_metric,
        "total_runs": len(runs),
        "matched_points": len(points),
        "points": sorted(points, key=lambda p: p["x"]),
        "available_x_params": sorted(available_x),
        "available_y_metrics": sorted(builtin | set(metric_names)),
    }


@router.get("/projects/{project}/params")
def list_sweep_params(project: str, db: Session = Depends(get_db)):
    """Discover numeric parameters and available metrics for a project."""
    runs = db.scalars(select(Run).where(Run.project_slug == project)).all()
    run_ids = [r.run_id for r in runs]

    available_x: set[str] = set()
    for run in runs:
        for k, v in (run.parameters or {}).items():
            try:
                float(v)
                available_x.add(k)
            except (TypeError, ValueError):
                pass

    metric_names: list[str] = []
    if run_ids:
        metric_names = list(
            db.scalars(
                select(RunMetric.name).where(RunMetric.run_id.in_(run_ids)).distinct()
            ).all()
        )

    builtin = {"health_score", "depth", "num_qubits", "gate_count", "success_probability"}
    return {
        "project": project,
        "run_count": len(runs),
        "available_x_params": sorted(available_x),
        "available_y_metrics": sorted(builtin | set(metric_names)),
    }
