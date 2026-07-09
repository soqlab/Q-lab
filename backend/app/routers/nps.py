"""Net Promoter Score collection and admin reporting."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_role
from ..store import store_list, store_put

router = APIRouter(prefix="/api/v1/nps", tags=["nps"])

NS = "nps_responses"


class NPSPayload(BaseModel):
    score: int = Field(..., ge=1, le=10)
    comment: Optional[str] = Field(None, max_length=2000)


@router.post("")
def submit_nps(
    body: NPSPayload,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    rid = str(uuid.uuid4())
    record = {
        "id": rid,
        "score": body.score,
        "comment": body.comment,
        "user_id": identity.user_id if identity else None,
        "user_email": identity.user.email if (identity and identity.user) else None,
        "user_name": identity.user.name if (identity and identity.user) else None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, NS, rid, record)
    return {"id": rid, "message": "Thank you for your feedback!"}


@router.get("")
def list_nps(
    limit: int = Query(default=200, ge=1, le=1000),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    items = store_list(db, NS)
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    scores = [i["score"] for i in items if "score" in i]
    avg = round(sum(scores) / len(scores), 1) if scores else None
    promoters = sum(1 for s in scores if s >= 9)
    detractors = sum(1 for s in scores if s <= 6)
    nps_score = round(((promoters - detractors) / len(scores)) * 100) if scores else None
    distribution = {str(i): scores.count(i) for i in range(1, 11)}
    return {
        "items": items[:limit],
        "total": len(items),
        "avg_score": avg,
        "nps_score": nps_score,
        "distribution": distribution,
        "promoters": promoters,
        "passives": len(scores) - promoters - detractors,
        "detractors": detractors,
    }
