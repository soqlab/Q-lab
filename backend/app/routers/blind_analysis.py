"""Blind Analysis — pre-register hypotheses before unblinding experimental results."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/blind-analysis", tags=["blind_analysis"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_REGISTRATIONS = "blind_registrations"

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class AnalysisRegistration(BaseModel):
    reg_id: str
    title: str
    hypothesis: str
    methods: str
    primary_outcome: str
    secondary_outcomes: List[str]
    registered_at: str
    status: str
    blinded_data_hash: Optional[str] = None
    reveal_timestamp: Optional[str] = None
    results_summary: Optional[str] = None
    confirmed_hypothesis: Optional[bool] = None


class RevealResult(BaseModel):
    reg_id: str
    confirmed_hypothesis: bool
    effect_size: float
    p_value: float
    confidence_interval: List[float]
    result_summary: str
    revealed_at: str


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    title: str
    hypothesis: str
    methods: str
    primary_outcome: str
    secondary_outcomes: List[str] = []


class RevealRequest(BaseModel):
    effect_size: float
    p_value: float
    confidence_interval: List[float]
    result_summary: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hash_registration(title: str, hypothesis: str, methods: str, registered_at: str) -> str:
    payload = f"{title}|{hypothesis}|{methods}|{registered_at}"
    return hashlib.sha256(payload.encode()).hexdigest()


def _infer_confirmation(hypothesis: str, p_value: float, effect_size: float) -> bool:
    return p_value < 0.05 and abs(effect_size) > 0.1


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/register", response_model=AnalysisRegistration)
def register_analysis(body: RegisterRequest, db: Session = Depends(get_db)):
    """Pre-register a hypothesis and analysis plan before data collection or unblinding."""
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="title must not be empty")
    if not body.hypothesis.strip():
        raise HTTPException(status_code=422, detail="hypothesis must not be empty")

    reg_id = str(uuid.uuid4())
    registered_at = datetime.now(timezone.utc).isoformat()
    blinded_hash = _hash_registration(body.title, body.hypothesis, body.methods, registered_at)

    registration = AnalysisRegistration(
        reg_id=reg_id,
        title=body.title,
        hypothesis=body.hypothesis,
        methods=body.methods,
        primary_outcome=body.primary_outcome,
        secondary_outcomes=body.secondary_outcomes,
        registered_at=registered_at,
        status="registered",
        blinded_data_hash=blinded_hash,
        reveal_timestamp=None,
        results_summary=None,
        confirmed_hypothesis=None,
    )
    store_put(db, NS_REGISTRATIONS, reg_id, registration.model_dump())
    return registration


@router.get("/registrations")
def list_registrations(db: Session = Depends(get_db)):
    """List all analysis registrations."""
    records = store_list(db, NS_REGISTRATIONS)
    return {"count": len(records), "registrations": records}


@router.get("/registration/{reg_id}", response_model=AnalysisRegistration)
def get_registration(reg_id: str, db: Session = Depends(get_db)):
    """Retrieve a single registration by ID."""
    record = store_get(db, NS_REGISTRATIONS, reg_id)
    if not record:
        raise HTTPException(status_code=404, detail="registration not found")
    return record


@router.post("/{reg_id}/reveal", response_model=RevealResult)
def reveal_results(reg_id: str, body: RevealRequest, db: Session = Depends(get_db)):
    """Unblind: submit actual results and record whether the hypothesis was confirmed."""
    record = store_get(db, NS_REGISTRATIONS, reg_id)
    if not record:
        raise HTTPException(status_code=404, detail="registration not found")
    if record["status"] == "cancelled":
        raise HTTPException(status_code=409, detail="registration has been cancelled")
    if record["status"] == "revealed":
        raise HTTPException(status_code=409, detail="registration has already been revealed")
    if len(body.confidence_interval) != 2:
        raise HTTPException(status_code=422, detail="confidence_interval must be a list of exactly 2 floats")

    revealed_at = datetime.now(timezone.utc).isoformat()
    confirmed = _infer_confirmation(record["hypothesis"], body.p_value, body.effect_size)

    record["status"] = "revealed"
    record["reveal_timestamp"] = revealed_at
    record["results_summary"] = body.result_summary
    record["confirmed_hypothesis"] = confirmed
    store_put(db, NS_REGISTRATIONS, reg_id, record)

    return RevealResult(
        reg_id=reg_id,
        confirmed_hypothesis=confirmed,
        effect_size=body.effect_size,
        p_value=body.p_value,
        confidence_interval=body.confidence_interval,
        result_summary=body.result_summary,
        revealed_at=revealed_at,
    )


@router.delete("/{reg_id}")
def cancel_registration(reg_id: str, db: Session = Depends(get_db)):
    """Cancel a registered analysis (sets status to cancelled, does not delete)."""
    record = store_get(db, NS_REGISTRATIONS, reg_id)
    if not record:
        raise HTTPException(status_code=404, detail="registration not found")
    if record["status"] == "revealed":
        raise HTTPException(status_code=409, detail="cannot cancel an already revealed registration")
    record["status"] = "cancelled"
    store_put(db, NS_REGISTRATIONS, reg_id, record)
    return {"reg_id": reg_id, "status": "cancelled"}
