"""Passive Randomized Benchmarking — Novel Feature A.

Extracts RB-style gate fidelity estimates from *regular stored experiments*
without any dedicated probe circuits.

How it works
────────────
Standard RB requires you to submit random Clifford circuits of increasing
length, measure survival probability, and fit F(d) = A·p^d + B.

Here we use the same model but source the (depth, fidelity) data-points
from whatever circuits users already ran, treating success_probability (or
a calibration-derived estimate) as the fidelity proxy.

This is valid when:
  - Circuits vary in depth across runs (which almost always happens naturally)
  - We group by backend, so hardware noise is approximately constant
  - We acknowledge this is an *effective* / *empirical* depolarizing rate,
    not a true Clifford-universal RB number

Output
──────
  • Fitted decay: F(d) = A·p^d + B
  • Effective gate fidelity r_f = 1 − EPC
  • Error per Clifford (EPC) = (d/(d+1))·(1−p), d = 2^n_qubits
  • SPAM parameters A (contrast), B (floor)
  • Trend: improving / stable / degrading over time
  • Overlay: raw data-points + fitted curve (as sparkline arrays)
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["passive_rb"])

_MIN_POINTS = 5


# ──────────────────────────────────────────────────────────────────────
# Math helpers (no scipy)
# ──────────────────────────────────────────────────────────────────────

def _safe(v, default=0.0) -> float:
    try:
        return float(v or default)
    except Exception:
        return default


def _linregress(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """OLS linear regression; returns (slope, intercept, r²)."""
    n = len(xs)
    if n < 2:
        return 0.0, 0.0, 0.0
    mx, my = sum(xs) / n, sum(ys) / n
    ss_xy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    ss_xx = sum((x - mx) ** 2 for x in xs)
    if ss_xx == 0:
        return 0.0, my, 0.0
    slope = ss_xy / ss_xx
    intercept = my - slope * mx
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return slope, intercept, r2


def _fit_rb_decay(
    depths: list[int], fidelities: list[float]
) -> dict:
    """
    Fit F(d) = A·p^d + B by linearising:
       log(F − B) ≈ log(A) + d·log(p)
    with B estimated as the tail mean (min fidelity plateau).
    """
    if len(depths) < _MIN_POINTS:
        return {}

    # Estimate B as the 10th-percentile fidelity (SPAM floor)
    sorted_f = sorted(fidelities)
    b_est = sorted_f[max(0, len(sorted_f) // 10)]
    b_est = max(0.0, min(b_est, 0.45))  # clamp: must be < 0.5 for single-qubit

    # Linearise
    log_ys, lin_xs = [], []
    for d, f in zip(depths, fidelities):
        val = f - b_est
        if val > 1e-6:
            log_ys.append(math.log(val))
            lin_xs.append(float(d))

    if len(log_ys) < 3:
        return {}

    slope, log_a, r2 = _linregress(lin_xs, log_ys)

    p = math.exp(slope)           # depolarizing parameter (0 < p < 1)
    a = math.exp(log_a)           # contrast
    p = max(0.0, min(1.0, p))

    return {"p": p, "A": round(a, 4), "B": round(b_est, 4), "r2": round(r2, 4)}


def _epc(p: float, n_qubits: float) -> float:
    """Error per Clifford from depolarizing parameter p."""
    d = 2 ** n_qubits
    return round((d - 1) / d * (1 - p), 6)


def _gate_fidelity(epc: float) -> float:
    return round(1.0 - epc, 6)


def _trend(fidelities_chron: list[float]) -> str:
    if len(fidelities_chron) < 4:
        return "insufficient_data"
    mid = len(fidelities_chron) // 2
    early = sum(fidelities_chron[:mid]) / mid
    late  = sum(fidelities_chron[mid:]) / (len(fidelities_chron) - mid)
    delta = late - early
    if delta > 0.04:
        return "improving"
    if delta < -0.04:
        return "degrading"
    return "stable"


def _sparkline(depths: list[int], fidelities: list[float], fit: dict, n_pts=40) -> dict:
    if not fit:
        return {"raw": [], "fitted": []}
    p, a, b = fit["p"], fit["A"], fit["B"]
    d_min, d_max = min(depths), max(depths)
    if d_max == d_min:
        return {"raw": [], "fitted": []}
    raw = [{"d": d, "f": round(f, 4)} for d, f in zip(depths, fidelities)]
    step = (d_max - d_min) / max(1, n_pts - 1)
    fitted = [
        {"d": round(d_min + i * step), "f": round(a * (p ** (d_min + i * step)) + b, 4)}
        for i in range(n_pts)
    ]
    return {"raw": raw, "fitted": fitted}


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/backends/{backend}/passive-rb")
def passive_rb(
    backend: str,
    limit: int = Query(default=200, ge=20, le=2000),
    db: Session = Depends(get_db),
):
    """
    Passive Randomized Benchmarking: extract gate fidelity from stored run history.
    """
    runs = db.execute(
        select(Run)
        .where(Run.backend == backend, Run.fingerprint.isnot(None))
        .order_by(Run.created_at.asc())
        .limit(limit)
    ).scalars().all()

    if len(runs) < _MIN_POINTS:
        raise HTTPException(422, f"Need ≥ {_MIN_POINTS} runs on '{backend}' — only {len(runs)} found.")

    # Extract data-points
    depths, fidelities, timestamps, n_qubits_list = [], [], [], []
    for r in runs:
        fp  = r.fingerprint or {}
        res = r.results or {}
        d   = _safe(fp.get("depth"), 0)
        nq  = _safe(fp.get("num_qubits"), 1)
        sp  = _safe(res.get("success_probability"), None)
        if d < 2 or sp is None or sp <= 0:
            continue
        depths.append(int(d))
        fidelities.append(float(sp))
        n_qubits_list.append(float(nq))
        timestamps.append(r.created_at.isoformat() if r.created_at else None)

    if len(depths) < _MIN_POINTS:
        raise HTTPException(422, "Not enough runs with success_probability data for RB fit.")

    avg_nq = sum(n_qubits_list) / len(n_qubits_list)
    fit    = _fit_rb_decay(depths, fidelities)

    if not fit:
        raise HTTPException(422, "Exponential fit failed — depth range may be too narrow.")

    p   = fit["p"]
    epc = _epc(p, avg_nq)
    rf  = _gate_fidelity(epc)

    # Chronological fidelity trend
    trend = _trend(fidelities)

    # Early vs late window analysis
    mid = len(fidelities) // 2
    early_mean = sum(fidelities[:mid]) / max(1, mid)
    late_mean  = sum(fidelities[mid:]) / max(1, len(fidelities) - mid)

    spark = _sparkline(depths, fidelities, fit)

    narrative = (
        f"Passive RB on '{backend}' over {len(depths)} runs "
        f"(avg {avg_nq:.1f} qubits). "
        f"Effective depolarizing parameter p = {p:.4f}, "
        f"error per Clifford EPC = {epc:.4f}, "
        f"gate fidelity r_f = {rf:.4f}. "
        f"Trend: {trend}. "
        + (f"Fidelity improved {(late_mean-early_mean)*100:+.1f}% over the observation window."
           if trend != "stable" else "Fidelity stable over the observation window.")
    )

    return {
        "backend":           backend,
        "n_runs_used":       len(depths),
        "avg_n_qubits":      round(avg_nq, 2),
        "fit": {
            "p":   round(p, 6),
            "A":   fit["A"],
            "B":   fit["B"],
            "r2":  fit["r2"],
        },
        "epc":               epc,
        "gate_fidelity":     rf,
        "process_infidelity": round(1 - rf, 6),
        "trend":             trend,
        "early_mean_fidelity": round(early_mean, 4),
        "late_mean_fidelity":  round(late_mean, 4),
        "sparkline":         spark,
        "narrative":         narrative,
        "computed_at":       datetime.now(timezone.utc).isoformat(),
    }
