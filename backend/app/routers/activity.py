"""Frontend activity tracking — receives page-view and feature-click events from the browser."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, log_audit

router = APIRouter(prefix="/api/v1/events", tags=["activity"])


class FrontendEvent(BaseModel):
    event: str = Field(..., max_length=120)
    page: Optional[str] = Field(None, max_length=300)
    meta: Optional[dict] = None


@router.post("")
def track_event(
    payload: FrontendEvent,
    request: Request,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
):
    """Receive a browser-side event and record it in the audit log."""
    if identity and identity.user_id:
        log_audit(
            db,
            payload.event,
            resource_type="page",
            resource_id=payload.page,
            identity=identity,
            request=request,
            meta=payload.meta or {},
        )
    return {"ok": True}
