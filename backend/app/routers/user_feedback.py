"""General user feedback — feature requests, bug reports, general feedback."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_role
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/user-feedback", tags=["user-feedback"])

NS = "user_feedback"


class FeedbackPayload(BaseModel):
    type: str = Field(..., pattern="^(feature_request|bug_report|general)$")
    title: str = Field(..., min_length=3, max_length=200)
    description: str = Field(..., min_length=10, max_length=5000)
    category: Optional[str] = Field(None, max_length=80)   # feature_request
    severity: Optional[str] = Field(None, pattern="^(critical|high|medium|low)?$")  # bug_report
    page: Optional[str] = Field(None, max_length=200)
    browser: Optional[str] = Field(None, max_length=200)


@router.post("")
def submit(
    body: FeedbackPayload,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    fid = str(uuid.uuid4())
    record = {
        "id": fid,
        "type": body.type,
        "title": body.title,
        "description": body.description,
        "category": body.category,
        "severity": body.severity,
        "page": body.page,
        "browser": body.browser,
        "user_id": identity.user_id if identity else None,
        "user_email": identity.user.email if (identity and identity.user) else None,
        "user_name": identity.user.name if (identity and identity.user) else None,
        "status": "new",
        "admin_note": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, NS, fid, record)
    return {"id": fid, "message": "Feedback submitted — thank you!"}


@router.get("")
def list_feedback(
    type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    items = store_list(db, NS)
    if type:
        items = [i for i in items if i.get("type") == type]
    if status:
        items = [i for i in items if i.get("status") == status]
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"items": items[:limit], "total": len(items)}


@router.patch("/{fid}")
def update_feedback(
    fid: str,
    body: dict,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    record = store_get(db, NS, fid)
    if not record:
        from fastapi import HTTPException
        raise HTTPException(404, "Feedback not found")
    allowed = {"status", "admin_note"}
    for k, v in body.items():
        if k in allowed:
            record[k] = v
    store_put(db, NS, fid, record)
    return record


@router.delete("/{fid}")
def delete_feedback(
    fid: str,
    identity: Identity = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_db),
):
    store_delete(db, NS, fid)
    return {"deleted": fid}
