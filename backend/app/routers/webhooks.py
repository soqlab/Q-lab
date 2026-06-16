import secrets
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_auth
from ..models import Webhook

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])

VALID_EVENTS = {"run.created", "run.completed", "run.failed", "benchmark.completed"}


class WebhookPayload(BaseModel):
    name: str
    url: str
    events: List[str] = Field(default_factory=lambda: ["run.completed", "run.failed"])
    project_slug: Optional[str] = None
    sign: bool = True


class WebhookUpdatePayload(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    events: Optional[List[str]] = None
    is_active: Optional[bool] = None
    project_slug: Optional[str] = None


def _wh_dict(wh: Webhook) -> Dict[str, Any]:
    return {
        "id": wh.id,
        "name": wh.name,
        "url": wh.url,
        "events": wh.events or [],
        "project_slug": wh.project_slug,
        "is_active": wh.is_active,
        "last_triggered_at": wh.last_triggered_at.isoformat() if wh.last_triggered_at else None,
        "last_status_code": wh.last_status_code,
        "created_at": wh.created_at.isoformat(),
    }


@router.post("")
def create_webhook(
    payload: WebhookPayload,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    unknown = set(payload.events) - VALID_EVENTS
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown events: {unknown}. Valid: {VALID_EVENTS}")

    wh = Webhook(
        org_id=identity.org_id,
        name=payload.name,
        url=payload.url,
        events=payload.events,
        secret=secrets.token_hex(32) if payload.sign else None,
        project_slug=payload.project_slug,
    )
    db.add(wh)
    db.commit()
    db.refresh(wh)
    resp = _wh_dict(wh)
    if payload.sign:
        resp["secret"] = wh.secret  # returned only on creation
    return resp


@router.get("")
def list_webhooks(
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    query = select(Webhook).order_by(Webhook.created_at.desc())
    if identity.org_id:
        query = query.where(Webhook.org_id == identity.org_id)
    return [_wh_dict(wh) for wh in db.scalars(query).all()]


@router.patch("/{webhook_id}")
def update_webhook(
    webhook_id: int,
    payload: WebhookUpdatePayload,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    wh = db.scalar(select(Webhook).where(Webhook.id == webhook_id))
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    if identity.org_id and wh.org_id != identity.org_id:
        raise HTTPException(status_code=403)

    if payload.name is not None:
        wh.name = payload.name
    if payload.url is not None:
        wh.url = payload.url
    if payload.events is not None:
        wh.events = payload.events
    if payload.is_active is not None:
        wh.is_active = payload.is_active
    if payload.project_slug is not None:
        wh.project_slug = payload.project_slug

    db.commit()
    return _wh_dict(wh)


@router.delete("/{webhook_id}")
def delete_webhook(
    webhook_id: int,
    identity: Identity = Depends(require_auth),
    db: Session = Depends(get_db),
):
    wh = db.scalar(select(Webhook).where(Webhook.id == webhook_id))
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    if identity.org_id and wh.org_id != identity.org_id:
        raise HTTPException(status_code=403)
    db.delete(wh)
    db.commit()
    return {"deleted": True}
