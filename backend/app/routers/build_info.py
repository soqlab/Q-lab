"""Which code this server runs, and the public log of deploys.

GET /api/v1/build says which git commit the backend was built from, so anyone can compare it
with the source on GitHub. Render sets RENDER_GIT_COMMIT for every deploy; self-hosted installs
can set QLAB_COMMIT. If neither is set the commit is reported as unknown (null), never guessed.

GET /api/v1/public/deploys returns the deploy transparency log that
.github/workflows/transparency.yml appends to on every push to main (one JSON line per deploy, on
the repository's `transparency` branch). The server fetches it, so the dashboard never makes a
request to GitHub on the visitor's behalf.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter

router = APIRouter(tags=["build"])

SOURCE_REPO = "https://github.com/soqlab/Q-lab"
LOG_URL = "https://raw.githubusercontent.com/soqlab/Q-lab/transparency/transparency/log.jsonl"
LOG_PAGE = "https://github.com/soqlab/Q-lab/blob/transparency/transparency/log.jsonl"
_SHA = re.compile(r"^[0-9a-f]{40}$")
_CACHE_S = 600
_MAX_ENTRIES = 200

_cache: dict[str, Any] = {"at": 0.0, "value": None}
_lock = threading.Lock()


def backend_commit() -> Optional[str]:
    for name in ("RENDER_GIT_COMMIT", "QLAB_COMMIT"):
        value = (os.getenv(name) or "").strip().lower()
        if _SHA.match(value):
            return value
    return None


def build_info() -> dict[str, Any]:
    from ..main import app

    commit_time = (os.getenv("QLAB_COMMIT_TIME") or "").strip() or None
    return {"commit": backend_commit(), "commit_time": commit_time, "version": app.version, "source": SOURCE_REPO}


@router.get("/api/v1/build")
def get_build() -> dict[str, Any]:
    return build_info()


def _parse_log(text: str) -> list[dict[str, Any]]:
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except ValueError:
            continue
        if isinstance(item, dict) and isinstance(item.get("commit"), str) and _SHA.match(item["commit"]):
            entries.append({k: item.get(k) for k in (
                "commit", "commit_time", "time", "run_url", "tree_sha256", "rekor_log_index", "rekor_url")
                if item.get(k) is not None})
    entries.sort(key=lambda e: str(e.get("time") or ""), reverse=True)
    return entries[:_MAX_ENTRIES]


def _fetch_log() -> dict[str, Any]:
    try:
        res = httpx.get(LOG_URL, timeout=5.0, follow_redirects=False)
    except httpx.HTTPError:
        return {"available": False, "reason": "GitHub could not be reached just now."}
    if res.status_code == 404:
        return {"available": False, "reason": "No deploy has been logged yet."}
    if res.status_code != 200:
        return {"available": False, "reason": f"GitHub answered {res.status_code}."}
    entries = _parse_log(res.text)
    return {"available": True, "entries": entries}


@router.get("/api/v1/public/deploys")
def public_deploys() -> dict[str, Any]:
    now = time.monotonic()
    with _lock:
        cached = _cache["value"]
        if cached is not None and now - _cache["at"] < _CACHE_S:
            value = cached
        else:
            value = None
    if value is None:
        value = _fetch_log()
        with _lock:
            _cache.update(at=now, value=value)
    return {**value, "source": LOG_PAGE, "fetched_by": "server"}
