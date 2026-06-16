"""VQE/QAOA Convergence Analyzer — statistical analysis of step-indexed metrics."""

import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run, RunMetric

router = APIRouter(prefix="/api/v1/runs", tags=["convergence"])

_ENERGY_KEYWORDS = {"energy", "cost", "expectation", "objective", "loss", "vqe", "qaoa",
                    "hamiltonian", "ev", "eigenvalue", "fidelity_val", "expectation_value"}
_SMOOTHING_WINDOW = 5


def _is_energy_like(name: str) -> bool:
    n = name.lower()
    return any(kw in n for kw in _ENERGY_KEYWORDS)


def _ewma(values: list[float], alpha: float = 0.2) -> list[float]:
    """Exponentially-weighted moving average."""
    if not values:
        return []
    sm = [values[0]]
    for v in values[1:]:
        sm.append(alpha * v + (1 - alpha) * sm[-1])
    return sm


def _convergence_rate(values: list[float], window: int = 10) -> float | None:
    """Slope of last `window` steps (negative = decreasing = converging for minimisation)."""
    if len(values) < window:
        return None
    ys = values[-window:]
    n = len(ys)
    xs = list(range(n))
    x_mean = sum(xs) / n
    y_mean = sum(ys) / n
    num = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    den = sum((x - x_mean) ** 2 for x in xs)
    return num / den if den else 0.0


def _variance(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return sum((v - mean) ** 2 for v in values) / (len(values) - 1)


def _detect_convergence(values: list[float], tol: float = 1e-4, window: int = 10) -> dict:
    if len(values) < window:
        return {"converged": False, "verdict": "insufficient_data", "plateau_step": None}
    last_vals = values[-window:]
    spread = max(last_vals) - min(last_vals)
    if spread < tol:
        plateau_step = len(values) - window
        return {"converged": True, "verdict": "converged", "plateau_step": plateau_step, "spread": round(spread, 8)}
    rate = _convergence_rate(values)
    if rate is not None and abs(rate) < tol * 10:
        return {"converged": False, "verdict": "plateauing", "plateau_step": None, "spread": round(spread, 8)}
    return {"converged": False, "verdict": "converging" if (rate or 0) < 0 else "diverging",
            "plateau_step": None, "spread": round(spread, 8)}


@router.get("/{run_id}/convergence")
def convergence_analysis(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")

    metrics = db.scalars(
        select(RunMetric)
        .where(RunMetric.run_id == run_id)
        .where(RunMetric.step.isnot(None))
        .order_by(RunMetric.step.asc(), RunMetric.logged_at.asc())
    ).all()

    if not metrics:
        return {
            "run_id": run_id,
            "has_convergence_data": False,
            "message": "No step-indexed metrics found. Use qlab.log_metric() with a step parameter.",
            "series": [],
        }

    # Group by name
    by_name: dict[str, list[tuple[int, float]]] = {}
    for m in metrics:
        by_name.setdefault(m.name, []).append((m.step, m.value))  # type: ignore[arg-type]

    # Build series — energy-like first, then everything else
    energy_names = sorted([k for k in by_name if _is_energy_like(k)])
    other_names = sorted([k for k in by_name if not _is_energy_like(k)])

    series = []
    for name in energy_names + other_names:
        pts = sorted(by_name[name], key=lambda x: x[0])
        steps = [p[0] for p in pts]
        values = [p[1] for p in pts]
        smoothed = _ewma(values)
        rate = _convergence_rate(values)
        variance = _variance(values[-20:] if len(values) > 20 else values)
        conv_result = _detect_convergence(values)

        series.append({
            "name": name,
            "is_energy": _is_energy_like(name),
            "steps": steps,
            "values": [round(v, 8) for v in values],
            "smoothed": [round(v, 8) for v in smoothed],
            "stats": {
                "initial": round(values[0], 8) if values else None,
                "final": round(values[-1], 8) if values else None,
                "best": round(min(values), 8),
                "worst": round(max(values), 8),
                "improvement": round(values[0] - values[-1], 8) if len(values) >= 2 else None,
                "improvement_pct": round((values[0] - values[-1]) / abs(values[0]) * 100, 2)
                    if len(values) >= 2 and values[0] != 0 else None,
                "variance": round(variance, 8),
                "total_steps": len(values),
                "convergence_rate_per_step": round(rate, 8) if rate is not None else None,
            },
            "convergence": conv_result,
        })

    # Overall prognosis
    energy_series = [s for s in series if s["is_energy"]]
    if energy_series:
        main = energy_series[0]
        prognosis = main["convergence"]["verdict"]
        best_energy = main["stats"]["best"]
        improvement = main["stats"]["improvement"]
    else:
        prognosis = "no_energy_metric"
        best_energy = None
        improvement = None

    return {
        "run_id": run_id,
        "has_convergence_data": True,
        "algorithm_hint": run.circuit_name,
        "total_steps": max((s["stats"]["total_steps"] for s in series), default=0),
        "prognosis": prognosis,
        "best_energy": best_energy,
        "total_improvement": improvement,
        "series": series,
    }
