"""Automated Experiment Campaigns.

A campaign is a named group of runs that share a parameter grid.
Researchers define the axes (e.g. backend × shots × optimization_level),
the SDK submits all combinations under the same campaign_id, and Q-Lab
aggregates the results into a sweep dashboard.
"""

from __future__ import annotations

import itertools
import secrets
import string
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_auth
from ..models import Campaign, Run
from ..health_score import compute_health_score

router = APIRouter(prefix="/api/v1/campaigns", tags=["campaigns"])

_ID_CHARS = string.ascii_lowercase + string.digits


def _new_campaign_id() -> str:
    return "cmp_" + "".join(secrets.choice(_ID_CHARS) for _ in range(16))


class GridAxis(BaseModel):
    name: str = Field(..., description="Parameter name, e.g. 'shots' or 'backend'")
    values: list[Any] = Field(..., min_length=1, max_length=50)


class CampaignCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    project: Optional[str] = Field(None, max_length=120)
    grid: list[GridAxis] = Field(..., min_length=1, max_length=10)
    tags: list[str] = Field(default_factory=list, max_length=20)


def _grid_combinations(grid: list[GridAxis]) -> list[dict[str, Any]]:
    """Expand grid axes into all combinations."""
    if not grid:
        return [{}]
    names = [axis.name for axis in grid]
    value_lists = [axis.values for axis in grid]
    return [dict(zip(names, combo)) for combo in itertools.product(*value_lists)]


def _campaign_to_dict(c: Campaign, run_stats: dict | None = None) -> dict:
    d = {
        "campaign_id": c.campaign_id,
        "name": c.name,
        "description": c.description,
        "project": c.project_slug,
        "grid_spec": c.grid_spec,
        "tags": c.tags or [],
        "status": c.status,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "total_combinations": len(_grid_combinations([GridAxis(**ax) for ax in (c.grid_spec.get("grid") or [])])),
    }
    if run_stats:
        d.update(run_stats)
    return d


def _compute_run_stats(runs: list[Run]) -> dict:
    total = len(runs)
    by_status: dict[str, int] = {}
    health_scores = []
    backends: dict[str, int] = {}

    for r in runs:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        if r.backend:
            backends[r.backend] = backends.get(r.backend, 0) + 1
        rd = {"results": r.results or {}, "calibration": r.calibration or {}, "fingerprint": r.fingerprint or {}}
        h = compute_health_score(rd)
        if h is not None:
            health_scores.append(h)

    completed = by_status.get("completed", 0)
    return {
        "run_count": total,
        "by_status": by_status,
        "completion_rate": round(completed / total, 3) if total else 0,
        "avg_health": round(sum(health_scores) / len(health_scores), 1) if health_scores else None,
        "max_health": round(max(health_scores), 1) if health_scores else None,
        "by_backend": backends,
    }


@router.post("")
def create_campaign(
    body: CampaignCreate,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Create a new campaign and return the campaign_id + all grid combinations."""
    grid_dicts = [{"name": ax.name, "values": ax.values} for ax in body.grid]
    combinations = _grid_combinations(body.grid)

    campaign = Campaign(
        campaign_id=_new_campaign_id(),
        name=body.name,
        description=body.description,
        project_slug=body.project,
        org_id=identity.org_id,
        created_by_user_id=identity.user_id,
        grid_spec={"grid": grid_dicts},
        tags=body.tags,
        status="running",
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)

    return {
        "campaign_id": campaign.campaign_id,
        "name": campaign.name,
        "total_combinations": len(combinations),
        "combinations": combinations,
        "created_at": campaign.created_at.isoformat(),
        "sdk_snippet": (
            f'import qlab\n'
            f'qlab.init()\n\n'
            f'# All runs submitted with campaign_id="{campaign.campaign_id}" are tracked together\n'
            f'for params in qlab.campaign_combinations("{campaign.campaign_id}"):\n'
            f'    # params is a dict with one combo, e.g. {combinations[0] if combinations else {}}\n'
            f'    run_circuit(params)  # your circuit code here\n'
        ),
    }


@router.get("")
def list_campaigns(
    project: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(50, ge=1, le=500),
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    query = select(Campaign).order_by(Campaign.created_at.desc())
    if identity and identity.org_id:
        query = query.where(Campaign.org_id == identity.org_id)
    if project:
        query = query.where(Campaign.project_slug == project)
    if status:
        query = query.where(Campaign.status == status)
    campaigns = db.scalars(query.limit(limit)).all()

    results = []
    for c in campaigns:
        runs = db.scalars(select(Run).where(Run.benchmark_id == c.campaign_id).limit(500)).all()
        results.append(_campaign_to_dict(c, _compute_run_stats(runs)))
    return results


@router.get("/{campaign_id}")
def get_campaign(
    campaign_id: str,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    campaign = db.scalar(select(Campaign).where(Campaign.campaign_id == campaign_id))
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    runs = db.scalars(select(Run).where(Run.benchmark_id == campaign_id).limit(1000)).all()
    stats = _compute_run_stats(runs)

    # Build sweep matrix: for each combination, find the matching run(s)
    grid = [GridAxis(**ax) for ax in (campaign.grid_spec.get("grid") or [])]
    combinations = _grid_combinations(grid)

    run_index: dict[str, list[dict]] = {}
    for run in runs:
        params = run.parameters or {}
        # Build a stable key from the grid parameter values in this run
        key_parts = []
        for ax in grid:
            val = params.get(ax.name)
            if val is None:
                # also check context
                val = (run.context or {}).get(ax.name)
            key_parts.append(f"{ax.name}={val}")
        key = ";".join(key_parts)
        rd = {"results": run.results or {}, "calibration": run.calibration or {}, "fingerprint": run.fingerprint or {}}
        h = compute_health_score(rd)
        run_index.setdefault(key, []).append({
            "run_id": run.run_id,
            "status": run.status,
            "health_score": round(h, 1) if h is not None else None,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "backend": run.backend,
        })

    sweep_rows = []
    for combo in combinations:
        key = ";".join(f"{k}={v}" for k, v in combo.items())
        matched_runs = run_index.get(key, [])
        best_health = max((r["health_score"] for r in matched_runs if r["health_score"] is not None), default=None)
        sweep_rows.append({
            "params": combo,
            "runs": matched_runs,
            "run_count": len(matched_runs),
            "best_health": best_health,
            "status": matched_runs[0]["status"] if matched_runs else "pending",
        })

    # Auto-close if all combinations have at least one completed run
    pending_count = sum(1 for row in sweep_rows if row["status"] != "completed")
    if pending_count == 0 and sweep_rows and campaign.status == "running":
        campaign.status = "completed"
        campaign.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(campaign)

    return {
        **_campaign_to_dict(campaign, stats),
        "grid": [{"name": ax.name, "values": ax.values} for ax in grid],
        "combinations_total": len(combinations),
        "combinations_pending": pending_count,
        "combinations_done": len(combinations) - pending_count,
        "sweep_rows": sweep_rows,
        "runs": [
            {
                "run_id": r.run_id,
                "circuit_name": r.circuit_name,
                "backend": r.backend,
                "status": r.status,
                "parameters": r.parameters or {},
                "health_score": (lambda rd: (h := compute_health_score(rd)) and round(h, 1))(
                    {"results": r.results or {}, "calibration": r.calibration or {}, "fingerprint": r.fingerprint or {}}
                ),
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in sorted(runs, key=lambda x: x.created_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
        ],
    }


@router.patch("/{campaign_id}/status")
def update_campaign_status(
    campaign_id: str,
    status: str = Query(..., pattern="^(running|completed|cancelled|paused)$"),
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    campaign = db.scalar(select(Campaign).where(Campaign.campaign_id == campaign_id))
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    campaign.status = status
    if status == "completed":
        campaign.completed_at = datetime.now(timezone.utc)
    db.commit()
    return {"campaign_id": campaign_id, "status": status}


@router.get("/{campaign_id}/combinations")
def get_combinations(campaign_id: str, db: Session = Depends(get_db)):
    """Return just the grid expansion — used by SDK to get the list of runs to submit."""
    campaign = db.scalar(select(Campaign).where(Campaign.campaign_id == campaign_id))
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    grid = [GridAxis(**ax) for ax in (campaign.grid_spec.get("grid") or [])]
    combinations = _grid_combinations(grid)
    return {
        "campaign_id": campaign_id,
        "name": campaign.name,
        "total_combinations": len(combinations),
        "combinations": combinations,
    }
