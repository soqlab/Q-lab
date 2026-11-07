from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/social", tags=["social"])

_NS_PROFILE = "social_profile"
_NS_FOLLOW  = "social_follow"
_NS_NOTIF   = "social_notif"
_NS_FEED    = "social_feed"
_SEEDED_KEY = "social_seeded_v1"

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _ts(days: int = 0, hours: int = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).isoformat()

# ── Sample records from earlier versions ───────────────────────────────────────
# Earlier versions wrote invented researchers, follows and feed events into every database.
# They are deleted the first time this router is used; no sample data is created any more.

_OLD_SAMPLE_USERS = ["qyang_mit", "chen_stanford", "ivanova_caltech", "park_ibm", "nguyen_cambridge"]
_OLD_SAMPLE_FOLLOWS = [
    ("chen_stanford", "qyang_mit"), ("ivanova_caltech", "qyang_mit"), ("park_ibm", "chen_stanford"),
    ("nguyen_cambridge", "chen_stanford"), ("qyang_mit", "park_ibm"), ("ivanova_caltech", "park_ibm"),
]
_CLEANED_KEY = "social_samples_removed_v1"


def _ensure_seeded(db: Session) -> None:
    """Removes the sample records earlier versions created (once). Creates nothing."""
    if store_get(db, _NS_PROFILE, _CLEANED_KEY):
        return
    if store_get(db, _NS_PROFILE, _SEEDED_KEY):
        for uname in _OLD_SAMPLE_USERS:
            store_delete(db, _NS_PROFILE, uname)
        for flr, flg in _OLD_SAMPLE_FOLLOWS:
            store_delete(db, _NS_FOLLOW, f"{flr}__{flg}")
        for i in range(7):
            store_delete(db, _NS_FEED, f"seed_event_{i}")
        store_delete(db, _NS_PROFILE, _SEEDED_KEY)
    store_put(db, _NS_PROFILE, _CLEANED_KEY, {"done": True})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_profile(db: Session, username: str) -> dict:
    p = store_get(db, _NS_PROFILE, username)
    if not p:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found.")
    return p


def _add_to_list(db: Session, ns: str, key: str, field: str, value: str) -> None:
    obj = store_get(db, ns, key) or {}
    lst = obj.get(field, [])
    if value not in lst:
        lst.append(value)
        obj[field] = lst
        store_put(db, ns, key, obj)


def _remove_from_list(db: Session, ns: str, key: str, field: str, value: str) -> None:
    obj = store_get(db, ns, key) or {}
    lst = obj.get(field, [])
    if value in lst:
        lst.remove(value)
        obj[field] = lst
        store_put(db, ns, key, obj)


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProfilePayload(BaseModel):
    username: str
    institution: str
    research_areas: List[str]
    bio: Optional[str] = ""


class FollowPayload(BaseModel):
    follower: str
    following: str


class NotifyPayload(BaseModel):
    user: str
    type: str
    message: str
    link: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/profile")
def create_or_update_profile(payload: ProfilePayload, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    existing = store_get(db, _NS_PROFILE, payload.username)
    now = _now()
    if existing:
        existing.update(institution=payload.institution, research_areas=payload.research_areas,
                        bio=payload.bio or "", updated_at=now)
        store_put(db, _NS_PROFILE, payload.username, existing)
        return existing
    profile = {
        "username": payload.username, "institution": payload.institution,
        "research_areas": payload.research_areas, "bio": payload.bio or "",
        "created_at": now, "followers": [], "following": [],
    }
    store_put(db, _NS_PROFILE, payload.username, profile)
    return profile


@router.get("/profile/{username}")
def get_profile(username: str, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    p = _get_profile(db, username)
    feed = [e["value"] for e in store_list(db, _NS_FEED)
            if isinstance(e.get("value"), dict) and e["value"].get("actor") == username]
    feed.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {**p, "follower_count": len(p.get("followers", [])),
            "following_count": len(p.get("following", [])), "recent_activity": feed[:5]}


@router.post("/follow")
def follow_user(payload: FollowPayload, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    if payload.follower == payload.following:
        raise HTTPException(status_code=400, detail="Cannot follow yourself.")
    _get_profile(db, payload.follower)
    _get_profile(db, payload.following)
    fkey = f"{payload.follower}__{payload.following}"
    if not store_get(db, _NS_FOLLOW, fkey):
        now = _now()
        store_put(db, _NS_FOLLOW, fkey, {"follower": payload.follower, "following": payload.following, "created_at": now})
        _add_to_list(db, _NS_PROFILE, payload.following, "followers", payload.follower)
        _add_to_list(db, _NS_PROFILE, payload.follower, "following", payload.following)
        notif_key = f"{payload.following}_{uuid.uuid4().hex[:8]}"
        store_put(db, _NS_NOTIF, notif_key, {
            "user": payload.following, "type": "new_follower",
            "message": f"{payload.follower} started following you.",
            "read": False, "created_at": now,
        })
    flg = _get_profile(db, payload.following)
    flr = _get_profile(db, payload.follower)
    return {"follower": payload.follower, "following": payload.following,
            "follower_count": len(flg.get("followers", [])),
            "following_count": len(flr.get("following", []))}


@router.delete("/follow")
def unfollow_user(payload: FollowPayload, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    fkey = f"{payload.follower}__{payload.following}"
    if store_get(db, _NS_FOLLOW, fkey):
        from ..models import GenericRecord
        from sqlalchemy import select, delete
        db.execute(delete(GenericRecord).where(
            GenericRecord.namespace == _NS_FOLLOW,
            GenericRecord.key == fkey,
        ))
        db.commit()
        _remove_from_list(db, _NS_PROFILE, payload.following, "followers", payload.follower)
        _remove_from_list(db, _NS_PROFILE, payload.follower, "following", payload.following)
    return {"unfollowed": True, "follower": payload.follower, "following": payload.following}


@router.get("/feed/{username}")
def get_feed(username: str, limit: int = 20, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    p = _get_profile(db, username)
    following_set = set(p.get("following", []))
    all_events = [e["value"] for e in store_list(db, _NS_FEED)
                  if isinstance(e.get("value"), dict) and e["value"].get("actor") in following_set]
    all_events.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"username": username, "feed": all_events[:limit], "count": len(all_events[:limit])}


@router.post("/notify")
def create_notification(payload: NotifyPayload, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    _get_profile(db, payload.user)
    now = _now()
    notif_key = f"{payload.user}_{uuid.uuid4().hex[:8]}"
    notif = {"user": payload.user, "type": payload.type, "message": payload.message,
             "link": payload.link, "read": False, "created_at": now}
    store_put(db, _NS_NOTIF, notif_key, notif)
    return notif


@router.get("/notifications/{username}")
def get_notifications(username: str, unread_only: bool = False, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    _get_profile(db, username)
    notifs = [e["value"] for e in store_list(db, _NS_NOTIF)
              if isinstance(e.get("value"), dict) and e["value"].get("user") == username]
    if unread_only:
        notifs = [n for n in notifs if not n.get("read")]
    notifs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"username": username, "notifications": notifs, "count": len(notifs)}


@router.get("/discover")
def discover_researchers(username: Optional[str] = None, limit: int = 5, db: Session = Depends(get_db)):
    _ensure_seeded(db)
    if username:
        _get_profile(db, username)
    all_profiles = [e["value"] for e in store_list(db, _NS_PROFILE)
                    if isinstance(e.get("value"), dict) and "username" in e.get("value", {})]
    user_profile = next((p for p in all_profiles if p.get("username") == username), None) if username else None
    skip = (set(user_profile.get("following", [])) | {username}) if user_profile else set()
    user_areas = user_profile.get("research_areas", []) if user_profile else []
    candidates = []
    for p in all_profiles:
        uname = p.get("username")
        if not uname or uname in skip or uname == _SEEDED_KEY:
            continue
        overlap = len(set(p.get("research_areas", [])) & set(user_areas))
        candidates.append({"username": uname, "institution": p.get("institution", ""),
                           "research_areas": p.get("research_areas", []), "bio": p.get("bio", ""),
                           "follower_count": len(p.get("followers", [])), "area_overlap": overlap})
    candidates.sort(key=lambda x: (x["area_overlap"], x["follower_count"]), reverse=True)
    return {"suggestions": candidates[:limit]}
