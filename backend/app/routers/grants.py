"""Grant Compliance Reporting.

Generates comprehensive data packages for NSF/DOE/DARPA grant reports,
linking Q-Lab projects and runs to funding sources.
"""

from __future__ import annotations

import secrets
import string
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..health_score import compute_health_score
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/grants", tags=["grants"])

_NAMESPACE = "grants"
_ID_CHARS = string.ascii_lowercase + string.digits


def _new_grant_id() -> str:
    return "grn_" + "".join(secrets.choice(_ID_CHARS) for _ in range(16))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class GrantCreate(BaseModel):
    name: str = Field(..., max_length=500)
    agency: str = Field(..., pattern="^(NSF|DOE|DARPA|NIH|EU-H2020|Other)$")
    grant_number: str = Field(..., max_length=120)
    pi_name: str = Field(..., max_length=200)
    institution: str = Field(..., max_length=300)
    start_date: str  # ISO date string
    end_date: str    # ISO date string
    project_slugs: list[str] = Field(default_factory=list)
    budget_qpu_credits: Optional[int] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_health(run: Run) -> float | None:
    rd = {
        "results": run.results or {},
        "calibration": run.calibration or {},
        "fingerprint": run.fingerprint or {},
    }
    h = compute_health_score(rd)
    return round(h, 1) if h is not None else None


def _parse_date(s: str) -> datetime | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:len(fmt)], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _run_in_period(run: Run, start: datetime | None, end: datetime | None) -> bool:
    if run.created_at is None:
        return False
    ts = run.created_at
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    if start and ts < start:
        return False
    if end and ts > end:
        return False
    return True


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.post("")
def create_grant(body: GrantCreate, db: Session = Depends(get_db)):
    grant_id = _new_grant_id()
    now = datetime.now(timezone.utc).isoformat()
    data: dict[str, Any] = {
        "grant_id": grant_id,
        "name": body.name,
        "agency": body.agency,
        "grant_number": body.grant_number,
        "pi_name": body.pi_name,
        "institution": body.institution,
        "start_date": body.start_date,
        "end_date": body.end_date,
        "project_slugs": body.project_slugs,
        "budget_qpu_credits": body.budget_qpu_credits,
        "created_at": now,
    }
    store_put(db, _NAMESPACE, grant_id, data)
    return data


@router.get("")
def list_grants(db: Session = Depends(get_db)):
    return store_list(db, _NAMESPACE)


@router.get("/{grant_id}")
def get_grant(grant_id: str, db: Session = Depends(get_db)):
    grant = store_get(db, _NAMESPACE, grant_id)
    if grant is None:
        raise HTTPException(404, "Grant not found")
    return grant


@router.delete("/{grant_id}")
def delete_grant(grant_id: str, db: Session = Depends(get_db)):
    if not store_delete(db, _NAMESPACE, grant_id):
        raise HTTPException(404, "Grant not found")
    return {"deleted": True, "grant_id": grant_id}


# ---------------------------------------------------------------------------
# Report generation helpers
# ---------------------------------------------------------------------------

def _build_report_data(grant: dict, db: Session) -> dict:
    project_slugs: list[str] = grant.get("project_slugs") or []
    start_dt = _parse_date(grant.get("start_date", ""))
    end_dt = _parse_date(grant.get("end_date", ""))

    # Fetch runs for all grant projects
    if project_slugs:
        runs_q = db.scalars(
            select(Run).where(Run.project_slug.in_(project_slugs))
        ).all()
    else:
        runs_q = []

    # Filter by date range
    runs = [r for r in runs_q if _run_in_period(r, start_dt, end_dt)]

    # Compute aggregate stats
    total_runs = len(runs)
    successful = [r for r in runs if r.status == "completed"]
    successful_runs = len(successful)
    success_rate = round(successful_runs / total_runs, 4) if total_runs else 0.0

    backends_seen: set[str] = set()
    circuits_seen: set[str] = set()
    total_shots = 0
    health_scores: list[float] = []

    for r in runs:
        if r.backend:
            backends_seen.add(r.backend)
        if r.circuit_name:
            circuits_seen.add(r.circuit_name)
        shots = (r.execution or {}).get("shots", 0)
        if shots:
            total_shots += int(shots)
        h = _run_health(r)
        if h is not None:
            health_scores.append(h)

    avg_health = round(sum(health_scores) / len(health_scores), 1) if health_scores else None

    # Group by month
    by_month_map: dict[str, dict] = defaultdict(lambda: {"runs": 0, "shots": 0})
    for r in runs:
        if r.created_at:
            ts = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
            month_key = ts.strftime("%Y-%m")
            by_month_map[month_key]["runs"] += 1
            by_month_map[month_key]["shots"] += int((r.execution or {}).get("shots", 0))
    by_month = [{"month": m, **v} for m, v in sorted(by_month_map.items())]

    # Group by project
    by_project_map: dict[str, dict] = defaultdict(lambda: {"runs": 0, "shots": 0})
    for r in runs:
        slug = r.project_slug or "unknown"
        by_project_map[slug]["runs"] += 1
        by_project_map[slug]["shots"] += int((r.execution or {}).get("shots", 0))
    by_project = [{"slug": slug, **v} for slug, v in by_project_map.items()]

    # Group by backend
    by_backend_map: dict[str, dict] = defaultdict(lambda: {"runs": 0, "health_sum": 0.0, "health_count": 0})
    for r in runs:
        backend = r.backend or "unknown"
        by_backend_map[backend]["runs"] += 1
        h = _run_health(r)
        if h is not None:
            by_backend_map[backend]["health_sum"] += h
            by_backend_map[backend]["health_count"] += 1
    by_backend = [
        {
            "backend": b,
            "runs": v["runs"],
            "avg_health": round(v["health_sum"] / v["health_count"], 1) if v["health_count"] else None,
        }
        for b, v in by_backend_map.items()
    ]

    # Run list (first 200)
    run_list = [
        {
            "run_id": r.run_id,
            "circuit_name": r.circuit_name,
            "backend": r.backend,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "health_score": _run_health(r),
            "shots": int((r.execution or {}).get("shots", 0)),
        }
        for r in sorted(runs, key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)[:200]
    ]

    return {
        "grant": grant,
        "report_generated_at": datetime.now(timezone.utc).isoformat(),
        "reporting_period": {
            "start": grant.get("start_date"),
            "end": grant.get("end_date"),
        },
        "summary": {
            "total_runs": total_runs,
            "successful_runs": successful_runs,
            "success_rate": success_rate,
            "total_shots": total_shots,
            "unique_backends": len(backends_seen),
            "unique_circuits": len(circuits_seen),
            "avg_health_score": avg_health,
        },
        "by_month": by_month,
        "by_project": by_project,
        "by_backend": by_backend,
        "run_list": run_list,
        "data_management_statement": (
            "All experimental data tracked via Q-Lab (https://github.com/qlab). "
            "Raw circuit data, calibration snapshots, and result histograms archived. "
            "DOIs available for key experiments."
        ),
        "reproducibility_note": (
            "Each run includes full QASM circuit, hardware calibration snapshot, "
            "transpiler settings, and result provenance."
        ),
    }


# ---------------------------------------------------------------------------
# Report endpoints
# ---------------------------------------------------------------------------

@router.get("/{grant_id}/report")
def get_report(grant_id: str, db: Session = Depends(get_db)):
    grant = store_get(db, _NAMESPACE, grant_id)
    if grant is None:
        raise HTTPException(404, "Grant not found")
    return _build_report_data(grant, db)


@router.get("/{grant_id}/report.pdf", response_class=HTMLResponse)
def get_report_pdf(grant_id: str, db: Session = Depends(get_db)):
    grant = store_get(db, _NAMESPACE, grant_id)
    if grant is None:
        raise HTTPException(404, "Grant not found")

    data = _build_report_data(grant, db)
    s = data["summary"]
    g = data["grant"]

    # Build monthly table rows
    month_rows = "".join(
        f"<tr><td>{m['month']}</td><td>{m['runs']}</td><td>{m['shots']:,}</td></tr>"
        for m in data["by_month"]
    )

    # Build backend table rows
    backend_rows = "".join(
        f"<tr><td>{b['backend']}</td><td>{b['runs']}</td><td>{b['avg_health'] if b['avg_health'] is not None else '—'}</td></tr>"
        for b in data["by_backend"]
    )

    # Build run list rows (first 50 for print)
    run_rows = "".join(
        f"<tr><td>{r['run_id'][:12]}…</td><td>{r['circuit_name'] or '—'}</td><td>{r['backend'] or '—'}</td>"
        f"<td>{r['status']}</td><td>{r['health_score'] if r['health_score'] is not None else '—'}</td>"
        f"<td>{(r['created_at'] or '')[:10]}</td></tr>"
        for r in data["run_list"][:50]
    )

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Grant Report — {g['name']}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #111; background: #fff; padding: 32px 48px; }}
  @media print {{ body {{ font-size: 11pt; padding: 0; }} .no-print {{ display: none; }} }}
  h1 {{ font-size: 20pt; font-weight: bold; margin-bottom: 4px; }}
  h2 {{ font-size: 13pt; font-weight: bold; margin: 24px 0 8px; border-bottom: 1px solid #888; padding-bottom: 4px; }}
  .meta-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin: 16px 0; font-size: 11pt; }}
  .meta-grid dt {{ color: #555; font-weight: bold; }}
  .kpi-strip {{ display: flex; gap: 24px; flex-wrap: wrap; margin: 16px 0; }}
  .kpi {{ border: 1px solid #ccc; border-radius: 6px; padding: 12px 20px; min-width: 120px; text-align: center; }}
  .kpi-val {{ font-size: 22pt; font-weight: bold; color: #003366; }}
  .kpi-lbl {{ font-size: 9pt; color: #555; margin-top: 2px; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 10pt; }}
  th {{ background: #003366; color: #fff; padding: 6px 10px; text-align: left; }}
  td {{ padding: 5px 10px; border-bottom: 1px solid #e0e0e0; }}
  tr:nth-child(even) td {{ background: #f5f7fa; }}
  .notice {{ background: #fffbea; border: 1px solid #e0c050; border-radius: 6px; padding: 10px 14px; font-size: 10pt; margin: 12px 0; }}
  .statement {{ font-size: 10pt; color: #444; line-height: 1.5; margin: 8px 0; }}
  .print-btn {{ position: fixed; top: 16px; right: 16px; background: #003366; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 13pt; font-weight: bold; }}
  @page {{ margin: 20mm 15mm; }}
  .page-break {{ page-break-before: always; }}
</style>
</head>
<body>
<button class="no-print print-btn" onclick="window.print()">Print / Save as PDF</button>

<div style="border-bottom:3px solid #003366;padding-bottom:14px;margin-bottom:18px;">
  <h1>{g['name']}</h1>
  <div style="font-size:11pt;color:#555;margin-top:4px;">Compliance Report — Q-Lab Experiment Tracking System</div>
</div>

<div class="notice">
  <strong>Note:</strong> To save as PDF, use your browser's Print function (Ctrl+P / Cmd+P) and choose "Save as PDF" as the destination.
</div>

<dl class="meta-grid">
  <dt>Agency</dt><dd>{g['agency']}</dd>
  <dt>Grant Number</dt><dd>{g['grant_number']}</dd>
  <dt>Principal Investigator</dt><dd>{g['pi_name']}</dd>
  <dt>Institution</dt><dd>{g['institution']}</dd>
  <dt>Period Start</dt><dd>{g['start_date']}</dd>
  <dt>Period End</dt><dd>{g['end_date']}</dd>
  <dt>Projects Covered</dt><dd>{', '.join(g['project_slugs']) or 'None specified'}</dd>
  <dt>Budget (QPU Credits)</dt><dd>{g['budget_qpu_credits'] if g['budget_qpu_credits'] is not None else 'Not specified'}</dd>
  <dt>Report Generated</dt><dd>{data['report_generated_at'][:19]} UTC</dd>
</dl>

<h2>Executive Summary</h2>
<div class="kpi-strip">
  <div class="kpi"><div class="kpi-val">{s['total_runs']}</div><div class="kpi-lbl">Total Runs</div></div>
  <div class="kpi"><div class="kpi-val">{s['successful_runs']}</div><div class="kpi-lbl">Successful</div></div>
  <div class="kpi"><div class="kpi-val">{s['success_rate']*100:.1f}%</div><div class="kpi-lbl">Success Rate</div></div>
  <div class="kpi"><div class="kpi-val">{s['total_shots']:,}</div><div class="kpi-lbl">Total Shots</div></div>
  <div class="kpi"><div class="kpi-val">{s['unique_backends']}</div><div class="kpi-lbl">Backends Used</div></div>
  <div class="kpi"><div class="kpi-val">{s['unique_circuits']}</div><div class="kpi-lbl">Unique Circuits</div></div>
  <div class="kpi"><div class="kpi-val">{s['avg_health_score'] if s['avg_health_score'] is not None else '—'}</div><div class="kpi-lbl">Avg Health Score</div></div>
</div>

<h2>Monthly Activity</h2>
<table>
  <thead><tr><th>Month</th><th>Runs</th><th>Shots</th></tr></thead>
  <tbody>{month_rows if month_rows else '<tr><td colspan="3" style="color:#888">No data in period</td></tr>'}</tbody>
</table>

<h2>Backend Utilization</h2>
<table>
  <thead><tr><th>Backend</th><th>Runs</th><th>Avg Health Score</th></tr></thead>
  <tbody>{backend_rows if backend_rows else '<tr><td colspan="3" style="color:#888">No data</td></tr>'}</tbody>
</table>

<div class="page-break"></div>
<h2>Run List (most recent 50)</h2>
<table>
  <thead><tr><th>Run ID</th><th>Circuit</th><th>Backend</th><th>Status</th><th>Health</th><th>Date</th></tr></thead>
  <tbody>{run_rows if run_rows else '<tr><td colspan="6" style="color:#888">No runs in period</td></tr>'}</tbody>
</table>

<h2>Data Management Statement</h2>
<p class="statement">{data['data_management_statement']}</p>

<h2>Reproducibility Statement</h2>
<p class="statement">{data['reproducibility_note']}</p>

<div style="margin-top:32px;border-top:1px solid #ccc;padding-top:12px;font-size:9pt;color:#888;">
  Generated by Q-Lab Experiment Tracking Platform &nbsp;·&nbsp; {data['report_generated_at'][:10]}
</div>
</body>
</html>"""

    return HTMLResponse(content=html)


@router.post("/{grant_id}/tag-run/{run_id}")
def tag_run_to_grant(grant_id: str, run_id: str, db: Session = Depends(get_db)):
    grant = store_get(db, _NAMESPACE, grant_id)
    if grant is None:
        raise HTTPException(404, "Grant not found")

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    slugs: list[str] = grant.get("project_slugs") or []
    run_slug = run.project_slug
    was_already_tagged = run_slug in slugs if run_slug else False
    if run_slug and not was_already_tagged:
        slugs.append(run_slug)
        grant["project_slugs"] = slugs
        store_put(db, _NAMESPACE, grant_id, grant)

    return {
        "grant_id": grant_id,
        "run_id": run_id,
        "project_slug": run_slug,
        "project_slugs": slugs,
        "already_tagged": was_already_tagged,
    }
