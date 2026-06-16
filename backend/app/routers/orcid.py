"""ORCID Researcher Identity Integration.

Lets researchers connect their ORCID iD and claim quantum experiment runs
as their own work.  OAuth is simulated here; set ORCID_CLIENT_ID env var
to mark profiles as verified.

Router prefix: /api/v1/orcid
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..store import store_list, store_put  # noqa: F401

router = APIRouter(prefix="/api/v1/orcid", tags=["orcid"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

_ORCID_RE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")

_NS = "orcid_profiles"


class ORCIDProfile(BaseModel):
    profile_id: str
    user_id: Optional[int] = None
    orcid_id: str
    display_name: str
    institution: Optional[str] = None
    verified: bool
    run_ids: List[str]
    created_at: str


class ConnectRequest(BaseModel):
    orcid_id: str
    display_name: str
    institution: Optional[str] = None


class ClaimRequest(BaseModel):
    orcid_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_orcid(orcid_id: str) -> None:
    if not _ORCID_RE.match(orcid_id):
        raise HTTPException(
            status_code=422,
            detail=(
                "Invalid ORCID format. Expected: 0000-0000-0000-000X "
                "(four groups of four digits, last character may be X)."
            ),
        )


def _find_profile(db: Session, orcid_id: str) -> Optional[dict]:
    for p in store_list(db, _NS):
        if p.get("orcid_id") == orcid_id:
            return p
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/connect", response_model=ORCIDProfile)
def connect_orcid(body: ConnectRequest, db: Session = Depends(get_db)):
    """Register an ORCID iD with Q-Lab (or update an existing profile)."""
    _validate_orcid(body.orcid_id)

    # Upsert: reuse existing profile_id if already registered
    existing = _find_profile(db, body.orcid_id)
    profile_id = existing["profile_id"] if existing else str(uuid.uuid4())
    created_at = existing["created_at"] if existing else _utcnow()
    run_ids: List[str] = existing["run_ids"] if existing else []

    # In a real implementation ORCID_CLIENT_ID would trigger OAuth flow
    verified = bool(os.environ.get("ORCID_CLIENT_ID"))

    profile_data: dict = {
        "profile_id": profile_id,
        "user_id": None,
        "orcid_id": body.orcid_id,
        "display_name": body.display_name,
        "institution": body.institution,
        "verified": verified,
        "run_ids": run_ids,
        "created_at": created_at,
    }

    store_put(db, _NS, profile_id, profile_data)
    return ORCIDProfile(**profile_data)


@router.post("/claim/{run_id}", response_model=ORCIDProfile)
def claim_run(run_id: str, body: ClaimRequest, db: Session = Depends(get_db)):
    """Add a run to the list of runs claimed by this researcher."""
    _validate_orcid(body.orcid_id)

    profile = _find_profile(db, body.orcid_id)
    if profile is None:
        raise HTTPException(
            status_code=404,
            detail="ORCID profile not found. Connect your ORCID first via POST /api/v1/orcid/connect.",
        )

    run_ids: List[str] = profile.get("run_ids", [])
    if run_id not in run_ids:
        run_ids = run_ids + [run_id]

    updated = {**profile, "run_ids": run_ids}
    store_put(db, _NS, profile["profile_id"], updated)
    return ORCIDProfile(**updated)


@router.get("/profile/{orcid_id}", response_model=ORCIDProfile)
def get_profile(orcid_id: str, db: Session = Depends(get_db)):
    """Retrieve a researcher's ORCID profile."""
    _validate_orcid(orcid_id)
    profile = _find_profile(db, orcid_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="ORCID profile not found")
    return ORCIDProfile(**profile)


@router.get("/researcher/{orcid_id}/runs")
def researcher_runs(orcid_id: str, db: Session = Depends(get_db)):
    """Return all runs claimed by this researcher, with basic run metadata."""
    _validate_orcid(orcid_id)
    profile = _find_profile(db, orcid_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="ORCID profile not found")

    run_ids: List[str] = profile.get("run_ids", [])

    runs_meta: List[dict] = []
    for rid in run_ids:
        run = db.scalar(select(Run).where(Run.run_id == rid))
        if run is not None:
            runs_meta.append(
                {
                    "run_id": run.run_id,
                    "circuit_name": run.circuit_name,
                    "backend": run.backend,
                    "status": run.status,
                    "created_at": run.created_at.isoformat() if run.created_at else None,
                }
            )
        else:
            # Run may have been deleted; keep the id so the researcher's
            # claim history is preserved.
            runs_meta.append({"run_id": rid, "circuit_name": None, "backend": None, "status": "deleted", "created_at": None})

    return {
        "orcid_id": orcid_id,
        "display_name": profile.get("display_name"),
        "run_count": len(run_ids),
        "runs": runs_meta,
    }
