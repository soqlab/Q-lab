"""Cross-run anomaly detection — z-score flagging vs peer runs on same backend."""

from __future__ import annotations

import math
import statistics

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..health_score import compute_health_score
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["anomaly"])

_METRICS = [
    "health_score",
    "depth",
    "size",
    "non_clifford_ratio",
    "tvd",
]


def _safe_float(val) -> float | None:
    try:
        f = float(val)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _run_vector(run: Run) -> dict[str, float | None]:
    fp = run.fingerprint or {}
    shadow = run.shadow_results or {}
    rd = {
        "run_id": run.run_id,
        "backend": run.backend,
        "fingerprint": fp,
        "calibration": run.calibration or {},
        "shadow_results": shadow,
        "results": run.results or {},
        "status": run.status,
    }
    hs = compute_health_score(rd)
    tvd = _safe_float(shadow.get("tvd"))
    return {
        "health_score": _safe_float(hs),
        "depth": _safe_float(fp.get("depth")),
        "size": _safe_float(fp.get("size")),
        "non_clifford_ratio": _safe_float(fp.get("non_clifford_ratio")),
        "tvd": tvd,
    }


def _z_score(value: float, mu: float, sigma: float) -> float:
    return (value - mu) / sigma if sigma else 0.0


def _percentile_rank(value: float, population: list[float]) -> float:
    if not population:
        return 50.0
    return round(sum(1 for x in population if x <= value) / len(population) * 100, 1)


@router.get("/{run_id}/anomaly")
def get_anomaly(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    # Gather peers: last 200 completed runs on same backend, excluding this run
    peers = db.scalars(
        select(Run)
        .where(Run.backend == run.backend, Run.run_id != run_id, Run.status == "completed")
        .order_by(Run.created_at.desc())
        .limit(200)
    ).all()

    if len(peers) < 5:
        return {
            "run_id": run_id,
            "backend": run.backend,
            "peer_count": len(peers),
            "sufficient_peers": False,
            "is_anomaly": False,
            "anomaly_score": 0.0,
            "z_scores": {},
            "percentiles": {},
            "flags": [],
        }

    # Build population vectors
    peer_vecs = [_run_vector(p) for p in peers]
    current_vec = _run_vector(run)

    z_scores: dict[str, float] = {}
    percentiles: dict[str, float] = {}
    flags: list[dict] = []

    for metric in _METRICS:
        cur_val = current_vec.get(metric)
        pop = [v for p in peer_vecs if (v := p.get(metric)) is not None]
        if cur_val is None or len(pop) < 5:
            continue

        mu = statistics.mean(pop)
        sigma = statistics.stdev(pop) if len(pop) >= 2 else 0.0
        z = _z_score(cur_val, mu, sigma)
        pct = _percentile_rank(cur_val, pop)

        z_scores[metric] = round(z, 3)
        percentiles[metric] = pct

        label = metric.replace("_", " ")
        direction = "high" if z > 0 else "low"

        if abs(z) >= 3.0:
            flags.append({
                "metric": metric, "label": label, "z_score": round(z, 3),
                "percentile": pct, "severity": "critical", "direction": direction,
                "message": f"{label} is {direction} outlier (z={z:.2f}, p{int(pct)})",
            })
        elif abs(z) >= 2.0:
            flags.append({
                "metric": metric, "label": label, "z_score": round(z, 3),
                "percentile": pct, "severity": "warning", "direction": direction,
                "message": f"{label} is unusually {direction} (z={z:.2f}, p{int(pct)})",
            })

    anomaly_score = max((abs(z_scores[m]) for m in z_scores), default=0.0)
    is_anomaly = any(f["severity"] == "critical" for f in flags)
    flags.sort(key=lambda f: abs(f["z_score"]), reverse=True)

    return {
        "run_id": run_id,
        "backend": run.backend,
        "peer_count": len(peers),
        "sufficient_peers": True,
        "is_anomaly": is_anomaly,
        "anomaly_score": round(anomaly_score, 3),
        "z_scores": z_scores,
        "percentiles": percentiles,
        "flags": flags,
    }
