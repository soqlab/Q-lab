"""Parameter landscape analysis — energy landscape for VQE/QAOA sweeps.

Reads RunMetric records and pairs them into 2D grid or scatter data
for visualizing the energy surface over parameter space.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run, RunMetric

router = APIRouter(prefix="/api/v1/runs", tags=["landscape"])

_ENERGY_KEYWORDS = {"energy", "cost", "expectation", "objective", "loss", "eigenvalue"}


def _is_energy_like(name: str) -> bool:
    return any(k in name.lower() for k in _ENERGY_KEYWORDS)


def _safe_float(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


@router.get("/{run_id}/landscape")
def get_landscape(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    metrics = db.scalars(
        select(RunMetric)
        .where(RunMetric.run_id == run_id)
        .order_by(RunMetric.name, RunMetric.step)
    ).all()

    if not metrics:
        return {"run_id": run_id, "has_landscape_data": False, "series": [], "param_names": []}

    # Group by name
    by_name: dict[str, list[tuple[float | None, float | None]]] = {}
    for m in metrics:
        step_val = _safe_float(m.step)
        val = _safe_float(m.value)
        by_name.setdefault(m.name, []).append((step_val, val))

    # Split: energy-like metrics = y-axis, step-indexed numeric = x-axis parameter
    energy_series = {k: v for k, v in by_name.items() if _is_energy_like(k)}
    param_series = {k: v for k, v in by_name.items() if not _is_energy_like(k) and any(s is not None for s, _ in v)}

    if not energy_series:
        return {"run_id": run_id, "has_landscape_data": False, "series": [], "param_names": []}

    # Build 1D landscape: step → energy for each energy series
    landscape_series = []
    for name, pts in energy_series.items():
        valid = [(s, v) for s, v in pts if s is not None and v is not None]
        if len(valid) < 2:
            continue
        valid.sort(key=lambda x: x[0])
        xs = [p[0] for p in valid]
        ys = [p[1] for p in valid]

        min_y = min(ys)
        min_x = xs[ys.index(min_y)]
        landscape_series.append({
            "name": name,
            "x_values": xs,
            "y_values": ys,
            "x_label": "step",
            "y_label": name,
            "min_value": min_y,
            "min_at_step": min_x,
            "point_count": len(valid),
            "x_range": [min(xs), max(xs)],
            "y_range": [min(ys), max(ys)],
        })

    # If we also have parameter series with same step count as energy,
    # try to build a 2D landscape cross-run sweep
    grid_2d = None
    if len(param_series) >= 1 and len(energy_series) >= 1:
        # Pick first param + first energy as the 2D landscape
        p_name = next(iter(param_series))
        e_name = next(iter(energy_series))
        p_pts = {s: v for s, v in param_series[p_name] if s is not None}
        e_pts_map = {s: v for s, v in energy_series[e_name] if s is not None}

        # Join on step
        joined = [(step, p_pts[step], e_pts_map[step]) for step in p_pts if step in e_pts_map and p_pts[step] is not None and e_pts_map[step] is not None]

        if len(joined) >= 4:
            joined.sort(key=lambda x: x[1])  # sort by param value
            grid_2d = {
                "param_name": p_name,
                "energy_name": e_name,
                "points": [{"step": s, "param": p, "energy": e} for s, p, e in joined],
                "min_energy": min(e for _, _, e in joined),
                "min_param": min(p for _, p, _ in joined if p == min(e for _, _, e in joined)),
            }

    return {
        "run_id": run_id,
        "has_landscape_data": len(landscape_series) > 0,
        "series": landscape_series,
        "param_names": list(param_series.keys()),
        "grid_2d": grid_2d,
    }
