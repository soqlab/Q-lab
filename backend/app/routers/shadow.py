from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Any, Dict

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["shadow"])


class ShadowPayload(BaseModel):
    sim_counts: Dict[str, int]
    noise_model_summary: Dict[str, Any] = {}
    tvd: float
    shots: int
    sim_backend: str = "AerSimulator"


@router.post("/{run_id}/shadow")
def store_shadow(run_id: str, payload: ShadowPayload, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    run.shadow_results = {
        "sim_counts": payload.sim_counts,
        "noise_model_summary": payload.noise_model_summary,
        "tvd": round(payload.tvd, 6),
        "shots": payload.shots,
        "sim_backend": payload.sim_backend,
    }
    db.commit()
    return {"stored": True, "run_id": run_id, "tvd": payload.tvd}


@router.get("/{run_id}/shadow")
def get_shadow(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")

    sr = run.shadow_results
    if not sr:
        raise HTTPException(status_code=404, detail="No shadow simulation for this run")

    tvd: float = sr.get("tvd", 1.0)
    if tvd < 0.10:
        interpretation = "Excellent agreement — circuit is operating close to ideal"
        level = "ok"
    elif tvd < 0.25:
        interpretation = "Moderate deviation — noise is measurable but not dominant"
        level = "warn"
    else:
        interpretation = "High deviation — QPU noise is significantly distorting results"
        level = "danger"

    # Pull real QPU counts from the run's stored results
    real_counts: Dict[str, int] = {}
    results = run.results or {}
    if isinstance(results.get("counts"), dict):
        real_counts = {str(k): int(v) for k, v in results["counts"].items()}

    return {
        "run_id": run_id,
        "has_shadow": True,
        "sim_counts": sr.get("sim_counts", {}),
        "real_counts": real_counts,
        "tvd": tvd,
        "tvd_interpretation": interpretation,
        "tvd_level": level,
        "noise_model_summary": sr.get("noise_model_summary", {}),
        "shots": sr.get("shots"),
        "sim_backend": sr.get("sim_backend"),
    }
