"""Institution-wide administrative dashboard.

Aggregates across all departments for institution-level reporting.

Endpoints
---------
GET /api/v1/institute/overview    - institution-wide KPI stats
GET /api/v1/institute/leaderboard - researchers ranked by activity
GET /api/v1/institute/report      - monthly institutional report (JSON + HTML)
GET /api/v1/institute/budget      - QPU cost breakdown by department
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity
from ..health_score import compute_health_score
from ..models import Run, User
from ..store import store_list

router = APIRouter(prefix="/api/v1/institute-admin", tags=["institute-admin"])

_DEPT_NAMESPACE = "org_departments"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_health(run: Run) -> Optional[float]:
    rd = {
        "results": run.results or {},
        "calibration": run.calibration or {},
        "fingerprint": run.fingerprint or {},
    }
    h = compute_health_score(rd)
    return round(h, 1) if h is not None else None


def _qpu_seconds(run: Run) -> float:
    shots = int((run.execution or {}).get("shots", 0))
    return shots * 0.00001


def _format_qpu_time(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.1f}s"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m"
    return f"{seconds / 3600:.2f}h"


def _get_all_departments(db: Session) -> list[dict[str, Any]]:
    return store_list(db, _DEPT_NAMESPACE)


def _all_member_ids(departments: list[dict[str, Any]]) -> set[str]:
    ids: set[str] = set()
    for dept in departments:
        for uid in dept.get("member_ids", []):
            ids.add(str(uid))
    return ids


def _dept_for_user(uid: str, departments: list[dict[str, Any]]) -> Optional[str]:
    for dept in departments:
        if uid in [str(m) for m in dept.get("member_ids", [])]:
            return dept.get("name")
    return None


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


@router.get("/overview")
def institute_overview(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    """Institution-wide KPI stats."""
    departments = _get_all_departments(db)
    member_ids = _all_member_ids(departments)
    total_members = len(member_ids)

    # Also count all DB users
    all_users = list(db.scalars(select(User)).all())
    total_members = max(total_members, len(all_users))

    all_runs = list(db.scalars(select(Run)).all())
    total_runs = len(all_runs)
    completed = [r for r in all_runs if r.status == "completed"]
    success_rate = round(len(completed) / total_runs, 4) if total_runs else 0.0

    health_scores: list[float] = []
    qpu_total = 0.0
    for r in all_runs:
        h = _run_health(r)
        if h is not None:
            health_scores.append(h)
        qpu_total += _qpu_seconds(r)

    avg_health = round(sum(health_scores) / len(health_scores), 1) if health_scores else None

    # Runs this month
    now = datetime.now(timezone.utc)
    this_month = now.strftime("%Y-%m")
    runs_this_month = sum(
        1 for r in all_runs
        if r.created_at and (
            r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
        ).strftime("%Y-%m") == this_month
    )

    return {
        "total_members": total_members,
        "total_runs": total_runs,
        "runs_this_month": runs_this_month,
        "total_departments": len(departments),
        "completed_runs": len(completed),
        "success_rate": success_rate,
        "avg_health_score": avg_health,
        "total_qpu_seconds": round(qpu_total, 2),
        "total_qpu_time_formatted": _format_qpu_time(qpu_total),
        "generated_at": now.isoformat(),
    }


# ---------------------------------------------------------------------------
# Leaderboard
# ---------------------------------------------------------------------------


@router.get("/leaderboard")
def institute_leaderboard(
    limit: int = Query(default=20, ge=1, le=100),
    sort_by: str = Query(default="runs", pattern="^(runs|health|qpu_time)$"),
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    """Researchers ranked by runs, health score, or QPU time."""
    departments = _get_all_departments(db)
    all_runs = list(db.scalars(select(Run)).all())
    all_users = list(db.scalars(select(User)).all())

    # Build user_id → stats map
    stats_by_user: dict[int, dict[str, Any]] = {}
    for user in all_users:
        stats_by_user[user.id] = {
            "user_id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "department": _dept_for_user(str(user.id), departments),
            "runs": 0,
            "completed": 0,
            "health_sum": 0.0,
            "health_count": 0,
            "qpu_seconds": 0.0,
            "publications": 0,
        }

    for run in all_runs:
        uid = run.created_by_user_id
        if uid is None or uid not in stats_by_user:
            continue
        entry = stats_by_user[uid]
        entry["runs"] += 1
        if run.status == "completed":
            entry["completed"] += 1
        h = _run_health(run)
        if h is not None:
            entry["health_sum"] += h
            entry["health_count"] += 1
        entry["qpu_seconds"] += _qpu_seconds(run)

    leaderboard: list[dict] = []
    for entry in stats_by_user.values():
        avg_h = (
            round(entry["health_sum"] / entry["health_count"], 1)
            if entry["health_count"]
            else None
        )
        leaderboard.append({
            "user_id": entry["user_id"],
            "name": entry["name"],
            "email": entry["email"],
            "role": entry["role"],
            "department": entry["department"],
            "runs": entry["runs"],
            "completed_runs": entry["completed"],
            "avg_health_score": avg_h,
            "qpu_seconds": round(entry["qpu_seconds"], 2),
            "qpu_time_formatted": _format_qpu_time(entry["qpu_seconds"]),
            "success_rate": round(entry["completed"] / entry["runs"], 4) if entry["runs"] else 0.0,
        })

    # Sort
    def _sort_key(e: dict) -> float:
        if sort_by == "runs":
            return -e["runs"]
        if sort_by == "health":
            return -(e["avg_health_score"] or 0.0)
        return -e["qpu_seconds"]

    leaderboard.sort(key=_sort_key)
    leaderboard = leaderboard[:limit]
    for rank, entry in enumerate(leaderboard, start=1):
        entry["rank"] = rank

    return {
        "leaderboard": leaderboard,
        "total_researchers": len(stats_by_user),
        "sort_by": sort_by,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Budget breakdown
# ---------------------------------------------------------------------------

# Estimated cost per QPU shot in USD (approximate)
_COST_PER_SHOT_USD = 0.00001


@router.get("/budget")
def institute_budget(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> dict:
    """QPU cost breakdown by department."""
    departments = _get_all_departments(db)
    all_runs = list(db.scalars(select(Run)).all())

    # Build user → dept map
    user_to_dept: dict[str, str] = {}
    user_to_dept_id: dict[str, str] = {}
    for dept in departments:
        for uid in dept.get("member_ids", []):
            user_to_dept[str(uid)] = dept.get("name", "Unknown")
            user_to_dept_id[str(uid)] = dept.get("id", "")

    # Aggregate cost by department
    dept_costs: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"shots": 0, "runs": 0, "cost_usd": 0.0}
    )
    unassigned = {"shots": 0, "runs": 0, "cost_usd": 0.0}

    for run in all_runs:
        uid = str(run.created_by_user_id) if run.created_by_user_id else None
        shots = int((run.execution or {}).get("shots", 0))
        cost = shots * _COST_PER_SHOT_USD
        if uid and uid in user_to_dept:
            dname = user_to_dept[uid]
            dept_costs[dname]["shots"] += shots
            dept_costs[dname]["runs"] += 1
            dept_costs[dname]["cost_usd"] = round(dept_costs[dname]["cost_usd"] + cost, 6)
        else:
            unassigned["shots"] += shots
            unassigned["runs"] += 1
            unassigned["cost_usd"] = round(unassigned["cost_usd"] + cost, 6)

    breakdown: list[dict] = []
    for dname, vals in dept_costs.items():
        breakdown.append({
            "department": dname,
            "runs": vals["runs"],
            "total_shots": vals["shots"],
            "cost_usd": vals["cost_usd"],
            "cost_formatted": f"${vals['cost_usd']:.4f}",
        })

    if unassigned["runs"] > 0:
        breakdown.append({
            "department": "Unassigned",
            "runs": unassigned["runs"],
            "total_shots": unassigned["shots"],
            "cost_usd": unassigned["cost_usd"],
            "cost_formatted": f"${unassigned['cost_usd']:.4f}",
        })

    breakdown.sort(key=lambda x: -x["cost_usd"])

    total_cost = sum(d["cost_usd"] for d in breakdown)
    for entry in breakdown:
        entry["pct_of_total"] = round(entry["cost_usd"] / total_cost * 100, 1) if total_cost else 0.0

    return {
        "breakdown": breakdown,
        "total_cost_usd": round(total_cost, 6),
        "total_cost_formatted": f"${total_cost:.4f}",
        "cost_model": f"${_COST_PER_SHOT_USD:.5f} per shot (estimated)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Monthly institutional report
# ---------------------------------------------------------------------------


@router.get("/report")
def institute_report(
    format: str = Query(default="json", pattern="^(json|html)$"),
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
) -> Any:
    """Generate a monthly institutional report."""
    now = datetime.now(timezone.utc)
    departments = _get_all_departments(db)
    all_runs = list(db.scalars(select(Run)).all())
    all_users = list(db.scalars(select(User)).all())

    # This-month filter
    this_month = now.strftime("%Y-%m")

    def _in_month(run: Run) -> bool:
        if not run.created_at:
            return False
        ts = run.created_at if run.created_at.tzinfo else run.created_at.replace(tzinfo=timezone.utc)
        return ts.strftime("%Y-%m") == this_month

    month_runs = [r for r in all_runs if _in_month(r)]
    month_completed = [r for r in month_runs if r.status == "completed"]

    health_scores: list[float] = []
    qpu_total = 0.0
    for r in month_runs:
        h = _run_health(r)
        if h is not None:
            health_scores.append(h)
        qpu_total += _qpu_seconds(r)
    avg_health = round(sum(health_scores) / len(health_scores), 1) if health_scores else None

    # Per-department summary
    user_to_dept_name: dict[str, str] = {}
    for dept in departments:
        for uid in dept.get("member_ids", []):
            user_to_dept_name[str(uid)] = dept.get("name", "Unknown")

    dept_summary: dict[str, dict] = defaultdict(lambda: {"runs": 0, "completed": 0, "health_sum": 0.0, "health_count": 0, "qpu_seconds": 0.0})
    for run in month_runs:
        uid = str(run.created_by_user_id) if run.created_by_user_id else None
        dname = user_to_dept_name.get(uid or "", "Unassigned")
        dept_summary[dname]["runs"] += 1
        if run.status == "completed":
            dept_summary[dname]["completed"] += 1
        h = _run_health(run)
        if h is not None:
            dept_summary[dname]["health_sum"] += h
            dept_summary[dname]["health_count"] += 1
        dept_summary[dname]["qpu_seconds"] += _qpu_seconds(run)

    dept_report = []
    for dname, vals in dept_summary.items():
        avg_h = round(vals["health_sum"] / vals["health_count"], 1) if vals["health_count"] else None
        dept_report.append({
            "department": dname,
            "runs": vals["runs"],
            "completed": vals["completed"],
            "avg_health_score": avg_h,
            "qpu_time_formatted": _format_qpu_time(vals["qpu_seconds"]),
        })
    dept_report.sort(key=lambda x: -x["runs"])

    report_data: dict[str, Any] = {
        "period": this_month,
        "generated_at": now.isoformat(),
        "institution": "My Institution",
        "summary": {
            "total_members": len(all_users),
            "total_departments": len(departments),
            "runs_this_month": len(month_runs),
            "completed_this_month": len(month_completed),
            "success_rate": round(len(month_completed) / len(month_runs), 4) if month_runs else 0.0,
            "avg_health_score": avg_health,
            "total_qpu_time_formatted": _format_qpu_time(qpu_total),
        },
        "by_department": dept_report,
        "all_time": {
            "total_runs": len(all_runs),
            "total_members": len(all_users),
            "total_departments": len(departments),
        },
    }

    if format == "html":
        return HTMLResponse(content=_render_html_report(report_data))

    return report_data


def _render_html_report(data: dict[str, Any]) -> str:
    s = data["summary"]
    dept_rows = "".join(
        f"<tr><td>{d['department']}</td><td>{d['runs']}</td><td>{d['completed']}</td>"
        f"<td>{d['avg_health_score'] if d['avg_health_score'] is not None else '—'}</td>"
        f"<td>{d['qpu_time_formatted']}</td></tr>"
        for d in data["by_department"]
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Institutional Report — {data['period']}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: system-ui, sans-serif; font-size: 13pt; color: #111; padding: 32px 48px; }}
  h1 {{ font-size: 20pt; margin-bottom: 4px; }}
  h2 {{ font-size: 14pt; margin: 24px 0 8px; border-bottom: 2px solid #6366f1; padding-bottom: 4px; color: #6366f1; }}
  .kpi-strip {{ display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }}
  .kpi {{ border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 22px; min-width: 120px; text-align: center; background: #f8fafc; }}
  .kpi-val {{ font-size: 24pt; font-weight: 700; color: #6366f1; }}
  .kpi-lbl {{ font-size: 10pt; color: #64748b; margin-top: 2px; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 11pt; }}
  th {{ background: #6366f1; color: #fff; padding: 8px 12px; text-align: left; }}
  td {{ padding: 6px 12px; border-bottom: 1px solid #e2e8f0; }}
  tr:nth-child(even) td {{ background: #f8fafc; }}
  .footer {{ margin-top: 32px; font-size: 10pt; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }}
  .print-btn {{ background: #6366f1; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 12pt; font-weight: 600; float: right; }}
  @media print {{ .print-btn {{ display: none; }} }}
</style>
</head>
<body>
<button class="print-btn" onclick="window.print()">Print / PDF</button>
<h1>Institutional Report</h1>
<div style="color:#64748b;margin-top:4px;">Period: {data['period']} &nbsp;·&nbsp; Generated: {data['generated_at'][:19]} UTC</div>

<h2>Summary</h2>
<div class="kpi-strip">
  <div class="kpi"><div class="kpi-val">{s['total_members']}</div><div class="kpi-lbl">Members</div></div>
  <div class="kpi"><div class="kpi-val">{s['total_departments']}</div><div class="kpi-lbl">Departments</div></div>
  <div class="kpi"><div class="kpi-val">{s['runs_this_month']}</div><div class="kpi-lbl">Runs (this month)</div></div>
  <div class="kpi"><div class="kpi-val">{s['completed_this_month']}</div><div class="kpi-lbl">Completed</div></div>
  <div class="kpi"><div class="kpi-val">{f"{s['success_rate']*100:.1f}%"}</div><div class="kpi-lbl">Success Rate</div></div>
  <div class="kpi"><div class="kpi-val">{s['avg_health_score'] if s['avg_health_score'] is not None else '—'}</div><div class="kpi-lbl">Avg Health</div></div>
  <div class="kpi"><div class="kpi-val">{s['total_qpu_time_formatted']}</div><div class="kpi-lbl">QPU Time</div></div>
</div>

<h2>By Department</h2>
<table>
  <thead>
    <tr><th>Department</th><th>Runs</th><th>Completed</th><th>Avg Health</th><th>QPU Time</th></tr>
  </thead>
  <tbody>
    {dept_rows if dept_rows else '<tr><td colspan="5" style="color:#94a3b8">No data for this period</td></tr>'}
  </tbody>
</table>

<div class="footer">Generated by Q-Lab Experiment Tracking Platform</div>
</body>
</html>"""
