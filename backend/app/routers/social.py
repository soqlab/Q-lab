from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/social", tags=["social"])

_profiles: Dict[str, Dict] = {}
_follows: List[Dict] = []
_notifications: Dict[str, List[Dict]] = {}
_feed_events: List[Dict] = []
_NOW = datetime.now(timezone.utc)

def _ts(days: int = 0, hours: int = 0) -> str:
    return (_NOW - timedelta(days=days, hours=hours)).isoformat()

_SEED = [
    ("qyang_mit",       "MIT Lincoln Laboratory",     ["quantum error correction","surface codes","fault tolerance"],
     "Working on scalable fault-tolerant quantum computation using surface codes."),
    ("chen_stanford",   "Stanford Quantum Computing", ["variational quantum algorithms","QAOA","quantum chemistry"],
     "Developing hybrid classical-quantum algorithms for near-term devices."),
    ("ivanova_caltech", "Caltech IQIM",               ["quantum sensing","metrology","entanglement"],
     "Pushing the limits of quantum sensing with entangled states."),
    ("park_ibm",        "IBM Quantum",                ["quantum hardware","superconducting qubits","noise mitigation"],
     "Hardware engineer focused on improving coherence times in superconducting systems."),
    ("nguyen_cambridge","University of Cambridge",    ["quantum machine learning","quantum neural networks","barren plateaus"],
     "Investigating trainability and expressibility of quantum machine learning models."),
]
for uname, inst, areas, bio in _SEED:
    _profiles[uname] = {"user_id": str(uuid.uuid4()), "username": uname, "institution": inst,
                        "research_areas": areas, "bio": bio, "created_at": _ts(30),
                        "followers": [], "following": []}
    _notifications[uname] = []

random.seed(7)
_EVENTS = [
    ("qyang_mit","experiment","Published new experiment: Surface Code Distance-5 Logical Qubit"),
    ("chen_stanford","paper","New paper: QAOA Performance on MAX-CUT with 50 qubits"),
    ("ivanova_caltech","replication","Replicated arXiv:2312.09085 — GHZ fidelity confirmed"),
    ("park_ibm","experiment","Noise mitigation benchmarks on ibm_torino updated"),
    ("nguyen_cambridge","paper","Submitted: Barren Plateau Mitigation via Layerwise Learning"),
    ("qyang_mit","milestone","Reached 1000 successful experiment runs"),
    ("chen_stanford","experiment","VQE convergence study on H2 molecule"),
]
for i, (actor, etype, msg) in enumerate(_EVENTS):
    _feed_events.append({"event_id": str(uuid.uuid4()), "actor": actor, "type": etype,
                         "message": msg, "created_at": _ts(i, random.randint(0, 12))})

for flr, flg in [("chen_stanford","qyang_mit"),("ivanova_caltech","qyang_mit"),
                  ("park_ibm","chen_stanford"),("nguyen_cambridge","chen_stanford"),
                  ("qyang_mit","park_ibm"),("ivanova_caltech","park_ibm")]:
    _follows.append({"follower": flr, "following": flg, "created_at": _ts(15)})
    if flr not in _profiles[flg]["followers"]: _profiles[flg]["followers"].append(flr)
    if flg not in _profiles[flr]["following"]: _profiles[flr]["following"].append(flg)

class ProfilePayload(BaseModel):
    username: str; institution: str; research_areas: List[str]; bio: Optional[str] = ""

class FollowPayload(BaseModel):
    follower: str; following: str

class NotifyPayload(BaseModel):
    user: str; type: str; message: str; link: Optional[str] = None

@router.post("/profile")
def create_or_update_profile(payload: ProfilePayload):
    now = datetime.now(timezone.utc).isoformat()
    if payload.username in _profiles:
        p = _profiles[payload.username]
        p.update(institution=payload.institution, research_areas=payload.research_areas,
                 bio=payload.bio or "", updated_at=now)
    else:
        _profiles[payload.username] = {"user_id": str(uuid.uuid4()), "username": payload.username,
            "institution": payload.institution, "research_areas": payload.research_areas,
            "bio": payload.bio or "", "created_at": now, "followers": [], "following": []}
        _notifications[payload.username] = []
    return _profiles[payload.username]

@router.get("/profile/{username}")
def get_profile(username: str):
    if username not in _profiles:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found.")
    p = _profiles[username].copy()
    p["follower_count"] = len(p["followers"]); p["following_count"] = len(p["following"])
    p["recent_activity"] = [e for e in _feed_events if e["actor"] == username][-5:]
    return p

@router.post("/follow")
def follow_user(payload: FollowPayload):
    if payload.follower == payload.following:
        raise HTTPException(status_code=400, detail="Cannot follow yourself.")
    for u in [payload.follower, payload.following]:
        if u not in _profiles: raise HTTPException(status_code=404, detail=f"User '{u}' not found.")
    if not any(f["follower"] == payload.follower and f["following"] == payload.following for f in _follows):
        now = datetime.now(timezone.utc).isoformat()
        _follows.append({"follower": payload.follower, "following": payload.following, "created_at": now})
        _profiles[payload.following]["followers"].append(payload.follower)
        _profiles[payload.follower]["following"].append(payload.following)
        _notifications.setdefault(payload.following, []).append({
            "notification_id": str(uuid.uuid4()), "type": "new_follower",
            "message": f"{payload.follower} started following you.", "read": False, "created_at": now})
    return {"follower": payload.follower, "following": payload.following,
            "follower_count": len(_profiles[payload.following]["followers"]),
            "following_count": len(_profiles[payload.follower]["following"])}

@router.delete("/follow")
def unfollow_user(payload: FollowPayload):
    global _follows
    before = len(_follows)
    _follows = [f for f in _follows if not (f["follower"] == payload.follower and f["following"] == payload.following)]
    if len(_follows) < before:
        if payload.follower in _profiles.get(payload.following, {}).get("followers", []):
            _profiles[payload.following]["followers"].remove(payload.follower)
        if payload.following in _profiles.get(payload.follower, {}).get("following", []):
            _profiles[payload.follower]["following"].remove(payload.following)
    return {"unfollowed": True, "follower": payload.follower, "following": payload.following}

@router.get("/feed/{username}")
def get_feed(username: str, limit: int = 20):
    if username not in _profiles:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found.")
    following_set = set(_profiles[username]["following"])
    events = sorted([e for e in _feed_events if e["actor"] in following_set],
                    key=lambda x: x["created_at"], reverse=True)[:limit]
    return {"username": username, "feed": events, "count": len(events)}

@router.post("/notify")
def create_notification(payload: NotifyPayload):
    if payload.user not in _profiles:
        raise HTTPException(status_code=404, detail=f"User '{payload.user}' not found.")
    notif = {"notification_id": str(uuid.uuid4()), "type": payload.type, "message": payload.message,
             "link": payload.link, "read": False, "created_at": datetime.now(timezone.utc).isoformat()}
    _notifications.setdefault(payload.user, []).append(notif)
    return notif

@router.get("/notifications/{username}")
def get_notifications(username: str, unread_only: bool = False):
    if username not in _profiles:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found.")
    notifs = _notifications.get(username, [])
    if unread_only: notifs = [n for n in notifs if not n["read"]]
    return {"username": username, "notifications": list(reversed(notifs)), "count": len(notifs)}

@router.get("/discover")
def discover_researchers(username: Optional[str] = None, limit: int = 5):
    if username and username not in _profiles:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found.")
    skip = (set(_profiles[username]["following"]) | {username}) if username else set()
    user_areas = _profiles[username]["research_areas"] if username else []
    candidates = []
    for uname, p in _profiles.items():
        if uname in skip: continue
        overlap = len(set(p["research_areas"]) & set(user_areas))
        candidates.append({"username": uname, "institution": p["institution"],
                           "research_areas": p["research_areas"], "bio": p["bio"],
                           "follower_count": len(p["followers"]), "area_overlap": overlap})
    candidates.sort(key=lambda x: (x["area_overlap"], x["follower_count"]), reverse=True)
    return {"suggestions": candidates[:limit]}
