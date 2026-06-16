"""Timing Advisor — predict the best time to run experiments.

Mines calibration snapshots from existing runs to find when hardware performs best,
building hourly-of-week health score profiles.

Router prefix: /api/v1/timing
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/timing", tags=["timing_advisor"])

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---------------------------------------------------------------------------
# Analysis helpers
# ---------------------------------------------------------------------------

def _hour_of_week(dt: datetime) -> int:
    """Returns 0-167 (hour within the week, Monday=0)."""
    return dt.weekday() * 24 + dt.hour


def _compute_hourly_profile(runs: list) -> dict:
    """Group health scores by hour-of-week (0-167)."""
    profile: dict[int, list[float]] = {}
    for run in runs:
        if not run.created_at:
            continue
        results = run.results or {}
        health = results.get("health_score")
        if health is None:
            health = getattr(run, "health_score", None)
        if health is None:
            continue
        try:
            dt = run.created_at
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            h = _hour_of_week(dt)
            profile.setdefault(h, []).append(float(health))
        except Exception:
            pass
    return profile


def _safe_avg(lst: list) -> Optional[float]:
    if not lst:
        return None
    return sum(lst) / len(lst)


def _build_heatmap(profile: dict) -> list:
    """Build 7×24 heatmap: list of 7 days, each 24 hours, value=avg health or null."""
    heatmap = []
    for day in range(7):
        row = []
        for hour in range(24):
            key = day * 24 + hour

            scores = profile.get(key, [])
            row.append(round(_safe_avg(scores), 1) if scores else None)
        heatmap.append(row)
    return heatmap


def _next_good_window(profile: dict, threshold: float = 70.0) -> str:
    """Find the next upcoming hour-of-week (from now) that historically has avg >= threshold."""
    now = datetime.now(timezone.utc)
    current_how = _hour_of_week(now)

    # Search through the next 168 hours
    for offset in range(1, 169):
        candidate = (current_how + offset) % 168
        scores = profile.get(candidate, [])
        avg = _safe_avg(scores)
        if avg is not None and avg >= threshold:
            day_idx = candidate // 24
            hour = candidate % 24
            return f"{DAYS[day_idx]} {hour:02d}:00 UTC (avg health {avg:.1f})"

    return "No clear optimal window found in the next week"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/best-time/{backend}")
def best_time(backend: str, db: Session = Depends(get_db)):
    """Find optimal run time for a backend based on historical health scores."""
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend)
        .order_by(Run.created_at.desc())
        .limit(1000)
    ).all()

    if not runs:
        return {
            "backend": backend,
            "analysis_runs": 0,
            "best_times": [],
            "worst_times": [],
            "heatmap": [[None] * 24 for _ in range(7)],
            "recommendation": "No run history found for this backend.",
            "timezone_note": "All times in UTC. Adjust for your timezone.",
        }

    profile = _compute_hourly_profile(runs)

    # Compute per-hour-of-week averages
    hourly_summary = []
    for how, scores in profile.items():
        avg = _safe_avg(scores)
        if avg is not None:
            day_idx = how // 24
            hour = how % 24
            hourly_summary.append({
                "how": how,
                "day": DAYS[day_idx],
                "hour_utc": hour,
                "avg_health": round(avg, 1),
                "n_runs": len(scores),
            })

    hourly_summary.sort(key=lambda x: -x["avg_health"])
    best_times = [
        {k: v for k, v in h.items() if k != "how"}
        for h in hourly_summary[:5]
    ]

    worst_sorted = sorted(hourly_summary, key=lambda x: x["avg_health"])
    worst_times = [
        {k: v for k, v in h.items() if k != "how"}
        for h in worst_sorted[:5]
    ]

    heatmap = _build_heatmap(profile)

    # Build recommendation text
    recommendation = "Insufficient data for timing recommendations."
    if best_times and worst_times:
        b = best_times[0]
        w = worst_times[0]
        recommendation = (
            f"Best time to run: {b['day']} {b['hour_utc']:02d}:00-{b['hour_utc']+1:02d}:00 UTC "
            f"(avg health {b['avg_health']}). "
            f"Avoid: {w['day']} {w['hour_utc']:02d}:00-{w['hour_utc']+1:02d}:00 UTC "
            f"(avg health {w['avg_health']})."
        )

    # Count analysis runs (those with health scores)
    analysis_runs = sum(len(s) for s in profile.values())

    return {
        "backend": backend,
        "analysis_runs": analysis_runs,
        "best_times": best_times,
        "worst_times": worst_times,
        "heatmap": heatmap,
        "recommendation": recommendation,
        "timezone_note": "All times in UTC. Adjust for your timezone.",
    }


@router.get("/best-time/{backend}/now")
def should_run_now(backend: str, db: Session = Depends(get_db)):
    """Check if the current UTC time is a good window based on historical data."""
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend)
        .order_by(Run.created_at.desc())
        .limit(1000)
    ).all()

    now = datetime.now(timezone.utc)
    current_how = _hour_of_week(now)
    current_day = DAYS[now.weekday()]
    current_hour = now.hour

    if not runs:
        return {
            "should_run_now": True,
            "current_slot_avg_health": None,
            "recommendation": "No historical data. Run conditions unknown — proceed with caution.",
            "next_good_window": "Unknown",
        }

    profile = _compute_hourly_profile(runs)

    current_scores = profile.get(current_how, [])
    current_avg = _safe_avg(current_scores)

    # Compute global average for comparison
    all_scores = [s for scores in profile.values() for s in scores]
    global_avg = _safe_avg(all_scores) or 60.0

    if current_avg is None:
        should_run = True
        recommendation = (
            f"No historical data for {current_day} {current_hour:02d}:00 UTC. "
            "Conditions unknown — baseline assumed OK."
        )
    elif current_avg >= 75:
        should_run = True
        recommendation = (
            f"Good time to run. Historical avg health at {current_day} "
            f"{current_hour:02d}:00 UTC is {current_avg:.1f}. Proceed."
        )
    elif current_avg >= 55:
        should_run = True
        recommendation = (
            f"Moderate conditions. Historical avg health at {current_day} "
            f"{current_hour:02d}:00 UTC is {current_avg:.1f}. "
            "Consider error mitigation."
        )
    else:
        should_run = False
        recommendation = (
            f"Poor conditions. Historical avg health at {current_day} "
            f"{current_hour:02d}:00 UTC is {current_avg:.1f}. "
            "Consider waiting for a better window."
        )

    next_good = _next_good_window(profile)

    return {
        "should_run_now": should_run,
        "current_slot_avg_health": round(current_avg, 1) if current_avg is not None else None,
        "recommendation": recommendation,
        "next_good_window": next_good,
    }


@router.get("/weekly-forecast")
def weekly_forecast(db: Session = Depends(get_db)):
    """Return heatmap timing data for up to 5 backends with sufficient history."""
    runs = db.scalars(
        select(Run)
        .where(Run.backend.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(2000)
    ).all()

    # Group by backend
    by_backend: dict[str, list] = {}
    for run in runs:
        if run.backend:
            by_backend.setdefault(run.backend, []).append(run)

    forecast_results = []
    for backend, backend_runs in by_backend.items():
        profile = _compute_hourly_profile(backend_runs)
        run_count = sum(len(s) for s in profile.values())
        if run_count < 5:
            continue

        heatmap = _build_heatmap(profile)
        forecast_results.append({
            "backend": backend,
            "heatmap": heatmap,
            "analysis_runs": run_count,
        })

        if len(forecast_results) >= 5:
            break

    return {
        "backends": forecast_results,
        "timezone_note": "All times in UTC. Rows=Mon-Sun, Cols=0-23h.",
    }
