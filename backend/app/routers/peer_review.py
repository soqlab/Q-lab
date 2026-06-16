"""Peer Review Workflow.

Researchers share an experiment for external peer review.
Reviewers sign off cryptographically; signature is verifiable by hash.
"""

from __future__ import annotations

import hashlib
import secrets
import string
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..health_score import compute_health_score
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/peer-review", tags=["peer-review"])

_NAMESPACE = "peer_reviews"
_ID_CHARS = string.ascii_lowercase + string.digits


def _new_review_id() -> str:
    return "rev_" + "".join(secrets.choice(_ID_CHARS) for _ in range(16))


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ReviewRequestCreate(BaseModel):
    requester_name: str = Field(..., max_length=200)
    requester_email: str = Field(..., max_length=320)
    reviewer_name: str = Field(..., max_length=200)
    reviewer_institution: str = Field(..., max_length=300)
    review_type: str = Field(..., pattern="^(reproducibility|methodology|full)$")
    message: Optional[str] = Field(None, max_length=2000)


class ReviewDecision(BaseModel):
    decision: str = Field(..., pattern="^(approved|revision_requested|rejected)$")
    comments: str = Field(..., max_length=5000)
    reviewer_name: str = Field(..., max_length=200)
    reviewer_institution: str = Field(..., max_length=300)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_to_provenance(run: Run) -> dict[str, Any]:
    """Return full provenance dict for a run (public-safe)."""
    rd = {
        "results": run.results or {},
        "calibration": run.calibration or {},
        "fingerprint": run.fingerprint or {},
    }
    health = compute_health_score(rd)
    return {
        "run_id": run.run_id,
        "circuit_name": run.circuit_name,
        "backend": run.backend,
        "status": run.status,
        "project_slug": run.project_slug,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "qasm": run.qasm,
        "fingerprint": run.fingerprint or {},
        "parameters": run.parameters or {},
        "execution": run.execution or {},
        "calibration": run.calibration or {},
        "transpiler": run.transpiler or {},
        "timing": run.timing or {},
        "results": run.results or {},
        "tags": run.tags or [],
        "health_score": round(health, 1) if health is not None else None,
    }


def _make_signature(run_id: str, reviewer_name: str, access_token: str) -> str:
    payload = f"{run_id}:{reviewer_name}:approved:{access_token}"
    return hashlib.sha256(payload.encode()).hexdigest()


def _strip_email(review: dict) -> dict:
    """Return a copy of the review dict without the requester_email."""
    d = dict(review)
    d.pop("requester_email", None)
    return d


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/request/{run_id}")
def submit_review_request(
    run_id: str,
    body: ReviewRequestCreate,
    db: Session = Depends(get_db),
):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    review_id = _new_review_id()
    access_token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()

    data: dict[str, Any] = {
        "review_id": review_id,
        "run_id": run_id,
        "requester_name": body.requester_name,
        "requester_email": body.requester_email,
        "reviewer_name": body.reviewer_name,
        "reviewer_institution": body.reviewer_institution,
        "review_type": body.review_type,
        "message": body.message,
        "access_token": access_token,
        "status": "pending",
        "reviewer_comments": None,
        "signature": None,
        "signed_at": None,
        "created_at": now,
    }
    store_put(db, _NAMESPACE, review_id, data)

    return {
        **data,
        "reviewer_link": f"https://qlab.app/review/{access_token}",
    }


@router.get("/run/{run_id}")
def get_reviews_for_run(run_id: str, db: Session = Depends(get_db)):
    all_reviews = store_list(db, _NAMESPACE)
    reviews = [_strip_email(r) for r in all_reviews if r.get("run_id") == run_id]
    return {"run_id": run_id, "count": len(reviews), "reviews": reviews}


@router.get("/token/{access_token}")
def get_review_by_token(access_token: str, db: Session = Depends(get_db)):
    all_reviews = store_list(db, _NAMESPACE)
    review = next((r for r in all_reviews if r.get("access_token") == access_token), None)
    if review is None:
        raise HTTPException(404, "Review not found")

    run = db.scalar(select(Run).where(Run.run_id == review["run_id"]))
    run_data = _run_to_provenance(run) if run else None

    safe_review = _strip_email(review)
    return {
        **safe_review,
        "run": run_data,
    }


@router.post("/token/{access_token}/decide")
def submit_decision(
    access_token: str,
    body: ReviewDecision,
    db: Session = Depends(get_db),
):
    all_reviews = store_list(db, _NAMESPACE)
    review = next((r for r in all_reviews if r.get("access_token") == access_token), None)
    if review is None:
        raise HTTPException(404, "Review not found")
    if review["status"] in ("approved", "rejected"):
        raise HTTPException(400, f"Review already closed with status: {review['status']}")

    now = datetime.now(timezone.utc).isoformat()
    review["status"] = body.decision
    review["reviewer_comments"] = body.comments
    review["reviewer_name"] = body.reviewer_name
    review["reviewer_institution"] = body.reviewer_institution

    if body.decision == "approved":
        review["signature"] = _make_signature(
            review["run_id"], body.reviewer_name, access_token
        )
        review["signed_at"] = now

    store_put(db, _NAMESPACE, review["review_id"], review)
    return _strip_email(review)


@router.get("/verify/{signature}")
def verify_signature(signature: str, db: Session = Depends(get_db)):
    all_reviews = store_list(db, _NAMESPACE)
    review = next((r for r in all_reviews if r.get("signature") == signature), None)
    if review is None:
        raise HTTPException(404, "Signature not found or not valid")

    # Re-derive to confirm integrity
    expected = _make_signature(
        review["run_id"], review["reviewer_name"], review["access_token"]
    )
    valid = secrets.compare_digest(signature, expected)

    return {
        "valid": valid,
        "run_id": review["run_id"],
        "reviewer_name": review["reviewer_name"],
        "reviewer_institution": review["reviewer_institution"],
        "signed_at": review.get("signed_at"),
        "review_type": review.get("review_type"),
        "review_id": review["review_id"],
    }


@router.get("/my-requests")
def list_all_requests(db: Session = Depends(get_db)):
    all_reviews = store_list(db, _NAMESPACE)
    return {"count": len(all_reviews), "reviews": [_strip_email(r) for r in all_reviews]}
