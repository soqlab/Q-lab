"""Wall mode and the display links that read it (app/wall.py).

Settings (a signed-in person; in an organisation, an owner or admin):
  GET    /api/v1/display-links            the links of your organisation (or your own, without one)
  POST   /api/v1/display-links            make one; the token is returned once and never again
  PATCH  /api/v1/display-links/{id}       change what it shows
  DELETE /api/v1/display-links/{id}       revoke it (it stops at the display's next poll)

The display:
  GET    /api/v1/wall                     with `X-Qlab-Display: <token>`; nothing else is accepted

A display token is not a sign-in and not an API key: get_identity never reads its header, so it opens
no other endpoint, and this endpoint reads nothing but the wall payload. Tokens are stored as SHA-256
hashes. The page keeps the token in the URL fragment (#), which browsers never send to a server.
Creation, changes and revocation are written to the audit log.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, log_audit, require_passkey_session
from ..models import DisplayLink, User
from ..rate_limit import RateLimiter, write_limiter
from ..run_scope import scoped_as
from ..wall import METRICS, wall_data, etag_of

router = APIRouter(prefix="/api/v1", tags=["wall"])

TOKEN_PREFIX = "qdl_"
MAX_ACTIVE_LINKS = 20
ADMIN_ROLES = ("owner", "admin")
BAD_LINK = "This display link isn't valid: it was revoked, it expired, or it was mistyped."
_LAST_USED_EVERY = timedelta(seconds=60)
# A display polls about once a minute; this is generous for a few screens behind one office address.
wall_limiter = RateLimiter(max_calls=120, period=60)

_NO_STORE = {
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
}

Metric = Literal["last_run", "runs_week", "drift"]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _iso(dt: Optional[datetime]) -> Optional[str]:
    d = _utc(dt)
    return d.isoformat().replace("+00:00", "Z") if d else None


def may_manage(user: Optional[User]) -> bool:
    """In an organisation, owners and admins make display links; without one, anyone, for their own runs."""
    if user is None or not user.is_active:
        return False
    return user.org_id is None or user.role in ADMIN_ROLES


def _manager(identity: Identity = Depends(require_passkey_session)) -> Identity:
    if not may_manage(identity.user):
        raise HTTPException(status_code=403, detail="Only an owner or admin of your organisation can manage display links.")
    return identity


def _mine(db: Session, identity: Identity):
    u = identity.user
    q = select(DisplayLink)
    return q.where(DisplayLink.org_id == u.org_id) if u.org_id is not None else \
        q.where(DisplayLink.org_id.is_(None), DisplayLink.created_by_user_id == u.id)


def _status(link: DisplayLink, now: datetime) -> str:
    if link.revoked_at is not None:
        return "revoked"
    exp = _utc(link.expires_at)
    if exp is not None and exp <= now:
        return "expired"
    return "active"


def _out(db: Session, link: DisplayLink, now: datetime) -> dict:
    creator = db.get(User, link.created_by_user_id)
    return {
        "id": link.id, "name": link.name, "metric": link.metric, "metric_label": METRICS.get(link.metric, ""),
        "status": _status(link, now), "created_at": _iso(link.created_at), "expires_at": _iso(link.expires_at),
        "revoked_at": _iso(link.revoked_at), "last_used_at": _iso(link.last_used_at),
        "created_by": {"id": link.created_by_user_id, "name": creator.name if creator else None},
    }


class CreateLink(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    metric: Metric = "last_run"
    expires_days: Optional[int] = Field(default=None, ge=1, le=365)


class UpdateLink(BaseModel):
    metric: Metric


@router.get("/display-links/metrics")
def list_metrics() -> list[dict]:
    return [{"id": k, "label": v} for k, v in METRICS.items()]


@router.get("/display-links")
def list_links(identity: Identity = Depends(_manager), db: Session = Depends(get_db)) -> list[dict]:
    now = datetime.now(timezone.utc)
    rows = db.scalars(_mine(db, identity).order_by(DisplayLink.created_at.desc(), DisplayLink.id.desc())).all()
    return [_out(db, r, now) for r in rows]


@router.post("/display-links", dependencies=[Depends(write_limiter)])
def create_link(payload: CreateLink, request: Request, identity: Identity = Depends(_manager),
                db: Session = Depends(get_db)) -> dict:
    now = datetime.now(timezone.utc)
    active = [r for r in db.scalars(_mine(db, identity)).all() if _status(r, now) == "active"]
    if len(active) >= MAX_ACTIVE_LINKS:
        raise HTTPException(status_code=409, detail=f"You already have {MAX_ACTIVE_LINKS} working display links. Revoke one first.")
    token = new_token()
    link = DisplayLink(
        token_hash=hash_token(token), org_id=identity.user.org_id, created_by_user_id=identity.user.id,
        name=payload.name.strip(), metric=payload.metric, created_at=now,
        expires_at=now + timedelta(days=payload.expires_days) if payload.expires_days else None,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    log_audit(db, "display_link.create", "display_link", str(link.id), identity=identity, request=request,
              meta={"name": link.name, "metric": link.metric, "expires_at": _iso(link.expires_at)})
    return {**_out(db, link, now), "token": token, "path": f"/wall#{token}"}


def _own_link(db: Session, identity: Identity, link_id: int) -> DisplayLink:
    link = db.scalar(_mine(db, identity).where(DisplayLink.id == link_id))
    if link is None:
        raise HTTPException(status_code=404, detail="Display link not found")
    return link


@router.patch("/display-links/{link_id}", dependencies=[Depends(write_limiter)])
def update_link(link_id: int, payload: UpdateLink, request: Request, identity: Identity = Depends(_manager),
                db: Session = Depends(get_db)) -> dict:
    link = _own_link(db, identity, link_id)
    before = link.metric
    link.metric = payload.metric
    db.commit()
    log_audit(db, "display_link.update", "display_link", str(link.id), identity=identity, request=request,
              meta={"metric": link.metric, "was": before})
    return _out(db, link, datetime.now(timezone.utc))


@router.delete("/display-links/{link_id}", dependencies=[Depends(write_limiter)])
def revoke_link(link_id: int, request: Request, identity: Identity = Depends(_manager),
                db: Session = Depends(get_db)) -> dict:
    link = _own_link(db, identity, link_id)
    if link.revoked_at is None:
        link.revoked_at = datetime.now(timezone.utc)
        db.commit()
        log_audit(db, "display_link.revoke", "display_link", str(link.id), identity=identity, request=request,
                  meta={"name": link.name})
    return _out(db, link, datetime.now(timezone.utc))


def _refuse(status: int, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail=detail, headers=_NO_STORE)


@router.get("/wall")
def wall(request: Request, response: Response,
         x_qlab_display: Optional[str] = Header(default=None),
         if_none_match: Optional[str] = Header(default=None),
         db: Session = Depends(get_db)):
    try:
        wall_limiter(request)
    except HTTPException as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail, headers={**_NO_STORE, **(exc.headers or {})})
    token = (x_qlab_display or "").strip()
    if not token.startswith(TOKEN_PREFIX) or len(token) > 200:
        raise _refuse(401, BAD_LINK)
    link = db.scalar(select(DisplayLink).where(DisplayLink.token_hash == hash_token(token)))
    now = datetime.now(timezone.utc)
    if link is None or _status(link, now) != "active":
        raise _refuse(401, BAD_LINK)
    creator = db.get(User, link.created_by_user_id)
    # The link stands for its creator: when they leave the organisation, lose the admin role or
    # delete their account, it stops.
    if not may_manage(creator) or creator.org_id != link.org_id:
        raise _refuse(401, BAD_LINK)

    last = _utc(link.last_used_at)
    if last is None or now - last >= _LAST_USED_EVERY:
        link.last_used_at = now
        db.commit()

    with scoped_as(creator.id, creator.org_id):
        data = wall_data(db, link.id, link.metric, now)
    payload = {"name": link.name, **data, "expires_at": _iso(link.expires_at)}
    tag = etag_of(payload)
    headers = {**_NO_STORE, "ETag": tag}
    if if_none_match and tag in [t.strip() for t in if_none_match.split(",")]:
        return Response(status_code=304, headers=headers)
    for k, v in headers.items():
        response.headers[k] = v
    return {**payload, "served_at": _iso(now)}
