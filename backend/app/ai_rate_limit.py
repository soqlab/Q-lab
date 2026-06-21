"""
Per-user daily AI request rate limiter.
Resets at midnight UTC. Stored in-memory (resets on server restart, which is acceptable).
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone

from fastapi import HTTPException

from .deps import Identity

_DAILY_LIMIT = int(20)  # requests per user per day

_lock = threading.Lock()
# { user_id: {"date": "YYYY-MM-DD", "count": int} }
_counters: dict[int, dict] = {}


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def check_ai_limit(identity: Identity) -> None:
    """
    Call this at the start of any endpoint that makes a Claude API call.
    Raises HTTP 429 if the user has exceeded their daily limit.
    API-key callers (no user_id) are exempt.
    """
    if identity.user_id is None:
        return  # SDK / API-key callers are exempt

    uid = identity.user_id
    today = _today()

    with _lock:
        rec = _counters.get(uid)
        if rec is None or rec["date"] != today:
            _counters[uid] = {"date": today, "count": 0}
            rec = _counters[uid]

        if rec["count"] >= _DAILY_LIMIT:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Daily AI limit reached ({_DAILY_LIMIT} requests). "
                    "Resets at midnight UTC."
                ),
            )

        rec["count"] += 1


def get_ai_usage(user_id: int) -> dict:
    """Return current usage for a user."""
    today = _today()
    with _lock:
        rec = _counters.get(user_id)
        if rec is None or rec["date"] != today:
            return {"used": 0, "limit": _DAILY_LIMIT, "remaining": _DAILY_LIMIT}
        return {
            "used": rec["count"],
            "limit": _DAILY_LIMIT,
            "remaining": max(0, _DAILY_LIMIT - rec["count"]),
        }
