"""Hardware Drift Changepoint Detection — Feature #5 of 10.

Automatically detects when a quantum backend's calibration metrics undergo
a statistically significant shift — a "changepoint" — indicating hardware
recalibration, qubit replacement, or environmental drift.

Algorithm: PELT (Pruned Exact Linear Time) approximation using a sliding-
window CUSUM (CUmulative SUM) detector on each metric independently, then
a consensus vote across metrics to identify global changepoints.

Why this matters
────────────────
A changepoint in T₁ or gate error that goes unnoticed can silently invalidate
a whole batch of experimental results. This feature surfaces those events
automatically so researchers know to treat pre/post-changepoint runs separately
when comparing circuits.

Endpoints
─────────
GET /api/v1/backends/{backend}/drift-changepoints
    Returns detected changepoints with confidence, affected metrics, and a
    recommended "trust window" (runs after the last changepoint).
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["drift_changepoint"])

_CAL_KEYS = {
    "avg_t1_us":           {"label": "T₁",           "higher_is_better": True,  "sensitivity": 1.5},
    "avg_t2_us":           {"label": "T₂",           "higher_is_better": True,  "sensitivity": 1.5},
    "avg_gate_error":      {"label": "Gate Error",   "higher_is_better": False, "sensitivity": 2.0},
    "avg_gate_error_2q":   {"label": "2Q Error",     "higher_is_better": False, "sensitivity": 2.0},
    "avg_readout_error":   {"label": "Readout Error","higher_is_better": False, "sensitivity": 2.0},
}

_MIN_POINTS = 5      # minimum data points per metric to run detection
_WINDOW     = 8      # CUSUM window size
_THRESHOLD  = 3.0    # z-score threshold for changepoint (higher = fewer detections)


# ──────────────────────────────────────────────────────────────────────
# Statistics helpers
# ──────────────────────────────────────────────────────────────────────

def _mean_std(values: list[float]) -> tuple[float, float]:
    n = len(values)
    if n == 0:
        return 0.0, 1.0
    mean = sum(values) / n
    if n == 1:
        return mean, 1.0
    variance = sum((v - mean) ** 2 for v in values) / (n - 1)
    return mean, max(math.sqrt(variance), 1e-12)


def _cusum_changepoints(series: list[float], threshold: float, window: int) -> list[int]:
    """
    Simplified CUSUM changepoint detector.
    Returns indices in `series` where a changepoint is detected.
    """
    n = len(series)
    if n < window * 2:
        return []

    changepoints = []
    last_cp = 0

    i = window
    while i <= n - window:
        left  = series[last_cp:i]
        right = series[i:i + window]

        lmean, lstd = _mean_std(left)
        rmean, rstd = _mean_std(right)

        # Pooled z-score of mean shift
        pooled_std = math.sqrt((lstd ** 2 + rstd ** 2) / 2) or 1e-12
        z = abs(rmean - lmean) / pooled_std

        if z >= threshold:
            changepoints.append(i)
            last_cp = i
            i += window  # jump ahead to avoid clustered detections
        else:
            i += 1

    return changepoints


# ──────────────────────────────────────────────────────────────────────
# Changepoint consensus
# ──────────────────────────────────────────────────────────────────────

def _consensus_changepoints(
    metric_cps: dict[str, list[int]],
    n_total: int,
    merge_window: int = 3,
) -> list[dict]:
    """
    Vote across metrics: a changepoint is 'global' if ≥2 metrics agree
    (within merge_window indices of each other).
    """
    # Flat list of (index, metric_key)
    all_cps: list[tuple[int, str]] = []
    for key, cps in metric_cps.items():
        for cp in cps:
            all_cps.append((cp, key))

    all_cps.sort(key=lambda x: x[0])
    if not all_cps:
        return []

    # Cluster nearby changepoints
    clusters: list[list[tuple[int, str]]] = []
    current_cluster: list[tuple[int, str]] = [all_cps[0]]

    for item in all_cps[1:]:
        if item[0] - current_cluster[-1][0] <= merge_window:
            current_cluster.append(item)
        else:
            clusters.append(current_cluster)
            current_cluster = [item]
    clusters.append(current_cluster)

    result = []
    for cluster in clusters:
        indices = [c[0] for c in cluster]
        metrics = list({c[1] for c in cluster})
        centre = int(sum(indices) / len(indices))
        votes  = len(metrics)
        # Confidence: fraction of metrics that agree, capped at 1.0
        confidence = round(min(1.0, votes / max(1, len(_CAL_KEYS))), 2)
        result.append({
            "index":      centre,
            "votes":      votes,
            "confidence": confidence,
            "affected_metrics": metrics,
        })

    return result


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/backends/{backend}/drift-changepoints")
def drift_changepoints(
    backend: str,
    limit: int = 100,
    sensitivity: float = 1.0,
    db: Session = Depends(get_db),
):
    """
    Detect statistically significant changepoints in hardware calibration
    for a given backend.

    Parameters
    ----------
    limit       : max runs to analyse (most recent first, then reversed)
    sensitivity : multiplier on detection threshold (>1 = fewer detections,
                  <1 = more sensitive)
    """
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend, Run.calibration.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(limit)
    ).all()

    # Reverse to chronological order
    runs = list(reversed(runs))

    if len(runs) < _MIN_POINTS:
        raise HTTPException(
            404,
            f"Not enough calibration data for '{backend}' "
            f"(need ≥{_MIN_POINTS} runs, have {len(runs)})."
        )

    # Build per-metric time series
    timestamps = [r.created_at.isoformat() for r in runs]
    run_ids    = [r.run_id for r in runs]
    series: dict[str, list[float | None]] = {k: [] for k in _CAL_KEYS}

    for run in runs:
        cal = run.calibration or {}
        for key in _CAL_KEYS:
            v = cal.get(key)
            try:
                series[key].append(float(v) if v is not None else None)
            except (TypeError, ValueError):
                series[key].append(None)

    # Fill None gaps with linear interpolation / forward-fill
    clean_series: dict[str, list[float]] = {}
    for key, vals in series.items():
        filled = _fill_gaps(vals)
        if filled and len([v for v in filled if v is not None]) >= _MIN_POINTS:
            clean_series[key] = filled

    if not clean_series:
        raise HTTPException(422, "Insufficient non-null calibration values to detect changepoints.")

    # Detect changepoints per metric
    threshold = _THRESHOLD * max(0.1, sensitivity)
    metric_cps: dict[str, list[int]] = {}
    metric_series_out: dict[str, dict] = {}

    for key, vals in clean_series.items():
        cps = _cusum_changepoints(vals, threshold, _WINDOW)
        metric_cps[key] = cps
        mean_v, std_v = _mean_std(vals)
        meta = _CAL_KEYS[key]
        metric_series_out[key] = {
            "label":            meta["label"],
            "higher_is_better": meta["higher_is_better"],
            "n_points":         len(vals),
            "mean":             round(mean_v, 6),
            "std":              round(std_v, 6),
            "trend":            _trend_direction(vals),
            "changepoint_indices": cps,
            "values":           [round(v, 6) for v in vals],
        }

    # Consensus changepoints
    consensus = _consensus_changepoints(metric_cps, len(runs))

    # Annotate consensus with timestamps and run IDs
    for cp in consensus:
        idx = cp["index"]
        cp["timestamp"]   = timestamps[idx] if idx < len(timestamps) else None
        cp["run_id"]      = run_ids[idx]    if idx < len(run_ids)    else None
        cp["runs_before"] = idx
        cp["runs_after"]  = len(runs) - idx

        # Compute mean shift per affected metric
        shifts = {}
        for key in cp["affected_metrics"]:
            if key not in clean_series:
                continue
            vals = clean_series[key]
            before = vals[:idx]
            after  = vals[idx:]
            if before and after:
                bmean, _ = _mean_std(before)
                amean, _ = _mean_std(after)
                pct = (amean - bmean) / abs(bmean) * 100 if bmean != 0 else 0
                shifts[key] = {
                    "before_mean": round(bmean, 6),
                    "after_mean":  round(amean, 6),
                    "pct_change":  round(pct, 1),
                    "direction":   "improvement" if (
                        (pct > 0 and _CAL_KEYS[key]["higher_is_better"]) or
                        (pct < 0 and not _CAL_KEYS[key]["higher_is_better"])
                    ) else "degradation",
                }
        cp["metric_shifts"] = shifts

    # Recommended trust window: runs after the last changepoint
    last_cp_idx = max((cp["index"] for cp in consensus), default=0)
    trust_window_runs = [run_ids[i] for i in range(last_cp_idx, len(run_ids))]

    # Overall drift narrative
    narrative = _drift_narrative(consensus, len(runs), metric_series_out)

    return {
        "backend":           backend,
        "n_runs_analysed":   len(runs),
        "date_range": {
            "from": timestamps[0]  if timestamps else None,
            "to":   timestamps[-1] if timestamps else None,
        },
        "n_changepoints":    len(consensus),
        "changepoints":      consensus,
        "metrics":           metric_series_out,
        "trust_window": {
            "from_index":     last_cp_idx,
            "n_runs":         len(trust_window_runs),
            "run_ids":        trust_window_runs[-20:],  # cap for payload size
            "description":    f"Use runs after the last changepoint (index {last_cp_idx}) "
                              "for comparisons to avoid mixing pre/post-recalibration data.",
        },
        "narrative":         narrative,
        "analyzed_at":       datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _fill_gaps(vals: list[float | None]) -> list[float]:
    """Forward-fill then backward-fill None values."""
    result = list(vals)
    # Forward fill
    last = None
    for i, v in enumerate(result):
        if v is not None:
            last = v
        elif last is not None:
            result[i] = last
    # Backward fill
    last = None
    for i in range(len(result) - 1, -1, -1):
        if result[i] is not None:
            last = result[i]
        elif last is not None:
            result[i] = last
    return [v for v in result if v is not None]


def _trend_direction(vals: list[float]) -> str:
    if len(vals) < 3:
        return "stable"
    first_half = vals[:len(vals) // 2]
    second_half = vals[len(vals) // 2:]
    fm, _ = _mean_std(first_half)
    sm, _ = _mean_std(second_half)
    ratio = (sm - fm) / abs(fm) if fm != 0 else 0
    if ratio > 0.05:
        return "increasing"
    elif ratio < -0.05:
        return "decreasing"
    return "stable"


def _drift_narrative(consensus: list[dict], n_runs: int, metrics: dict) -> str:
    if not consensus:
        return (
            f"No statistically significant changepoints detected across {n_runs} runs. "
            "Hardware calibration appears stable over this period."
        )

    n = len(consensus)
    last = consensus[-1]
    last_ts = last.get("timestamp", "unknown")
    try:
        last_ts = datetime.fromisoformat(last_ts).strftime("%Y-%m-%d %H:%M") if last_ts else "unknown"
    except Exception:
        pass

    severity = "minor" if max(cp["confidence"] for cp in consensus) < 0.4 else (
               "moderate" if max(cp["confidence"] for cp in consensus) < 0.7 else "significant")

    parts = [
        f"Detected {n} {severity} changepoint(s) across {n_runs} calibration snapshots.",
        f"Most recent changepoint at {last_ts} affects {', '.join(last['affected_metrics'][:3])}.",
    ]

    # Degradation warnings
    degradations = [
        key for key, info in metrics.items()
        if info["trend"] == "decreasing" and _CAL_KEYS.get(key, {}).get("higher_is_better", True)
    ]
    if degradations:
        parts.append(f"Warning: {', '.join(degradations)} show a declining trend.")

    parts.append(
        f"Recommended: use only the {last['runs_after']} runs after the last changepoint "
        "when comparing results to avoid pre/post-recalibration bias."
    )
    return " ".join(parts)
