"""Former browser activity endpoint. Q-Lab no longer records what pages people look at.

The dashboard used to post a page-view event here on every navigation, which was stored in the
audit log with the browser's address and user agent. That was tracking, so it is gone: the
dashboard sends nothing, and this endpoint stays only so older cached dashboards get a normal
reply. It records nothing.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/events", tags=["activity"])


class FrontendEvent(BaseModel):
    event: str = Field(..., max_length=120)
    page: Optional[str] = Field(None, max_length=300)
    meta: Optional[dict] = None


@router.post("")
def track_event(payload: FrontendEvent):
    """Accepted and discarded: nothing about the request is stored."""
    return {"ok": True, "recorded": False}
