"""Feedback telemetry for automated advice quality."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity
from ..models import AdviceFeedback

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])


class FeedbackPayload(BaseModel):
    run_id: str = Field(..., max_length=64)
    feature: str = Field(..., pattern="^(mitigation|rca|bug_database)$")
    item_id: Optional[str] = Field(None, max_length=120)
    rating: str = Field(..., pattern="^(up|down|accepted)$")
    note: Optional[str] = Field(None, max_length=1000)


@router.post("")
def submit_feedback(body: FeedbackPayload, identity: Optional[Identity] = Depends(get_identity), db: Session = Depends(get_db)):
    row = AdviceFeedback(
        run_id=body.run_id,
        feature=body.feature,
        item_id=body.item_id,
        rating=body.rating,
        note=body.note,
        user_id=identity.user_id if identity else None,
        org_id=identity.org_id if identity else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "run_id": row.run_id,
        "feature": row.feature,
        "item_id": row.item_id,
        "rating": row.rating,
        "created_at": row.created_at.isoformat(),
    }


@router.get("/summary")
def feedback_summary(db: Session = Depends(get_db)):
    rows = db.execute(
        select(AdviceFeedback.feature, AdviceFeedback.rating, func.count())
        .group_by(AdviceFeedback.feature, AdviceFeedback.rating)
    ).all()
    summary: dict[str, dict[str, int]] = {}
    for feature, rating, count in rows:
        summary.setdefault(feature, {"up": 0, "down": 0, "accepted": 0})
        summary[feature][rating] = int(count)
    return summary
