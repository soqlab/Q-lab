"""Hardware Intelligence — poll public status APIs for quantum hardware providers.

Caches results for 5 minutes to avoid hammering external services.
All endpoints are public (no auth required).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/intel", tags=["intel"])

# In-memory cache {provider_id: (timestamp, payload)}
_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 300  # 5 minutes

# Public Atlassian statuspage endpoints for each provider
_SOURCES: dict[str, dict[str, Any]] = {
    "ibm": {
        "name": "IBM Quantum",
        "color": "#6929c4",
        "status_url": "https://status.quantum.ibm.com/api/v2/status.json",
        "incidents_url": "https://status.quantum.ibm.com/api/v2/incidents/unresolved.json",
        "dashboard_url": "https://quantum.ibm.com",
    },
    "ionq": {
        "name": "IonQ",
        "color": "#0f62fe",
        "status_url": "https://status.ionq.co/api/v2/status.json",
        "incidents_url": "https://status.ionq.co/api/v2/incidents/unresolved.json",
        "dashboard_url": "https://cloud.ionq.com",
    },
    "rigetti": {
        "name": "Rigetti",
        "color": "#2b5ce6",
        "status_url": "https://status.rigetti.com/api/v2/status.json",
        "incidents_url": "https://status.rigetti.com/api/v2/incidents/unresolved.json",
        "dashboard_url": "https://qcs.rigetti.com",
    },
    "braket": {
        "name": "Amazon Braket",
        "color": "#ff9900",
        "status_url": "https://status.aws.amazon.com/data.json",
        "incidents_url": None,
        "dashboard_url": "https://aws.amazon.com/braket",
    },
    "quantinuum": {
        "name": "Quantinuum",
        "color": "#00b4d8",
        "status_url": "https://status.quantinuum.com/api/v2/status.json",
        "incidents_url": "https://status.quantinuum.com/api/v2/incidents/unresolved.json",
        "dashboard_url": "https://um.qapi.quantinuum.com",
    },
}


def _normalize(indicator: str) -> str:
    return {
        "none": "operational",
        "minor": "degraded",
        "major": "outage",
        "critical": "outage",
        "maintenance": "maintenance",
    }.get(indicator.lower(), "unknown")


async def _fetch_one(pid: str, cfg: dict[str, Any]) -> dict:
    now = time.time()
    if pid in _cache:
        ts, cached = _cache[pid]
        if now - ts < _CACHE_TTL:
            return cached

    result: dict[str, Any] = {
        "id": pid,
        "name": cfg["name"],
        "color": cfg["color"],
        "status": "unknown",
        "description": "Status unavailable",
        "incidents": [],
        "last_checked": now,
        "dashboard_url": cfg["dashboard_url"],
        "cache_age_s": 0,
    }

    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            resp = await client.get(cfg["status_url"])
            resp.raise_for_status()
            data = resp.json()

            # Atlassian statuspage format
            if "status" in data and isinstance(data["status"], dict):
                result["status"] = _normalize(data["status"].get("indicator", "none"))
                result["description"] = data["status"].get("description", "All Systems Operational")

            # AWS data.json is a different shape — just mark as fetched
            elif pid == "braket" and "archive" in data:
                result["status"] = "operational"
                result["description"] = "See AWS Health Dashboard for details"

            # Fetch unresolved incidents
            if cfg.get("incidents_url"):
                try:
                    ir = await client.get(cfg["incidents_url"])
                    ir.raise_for_status()
                    for inc in ir.json().get("incidents", [])[:4]:
                        result["incidents"].append({
                            "name": inc.get("name", ""),
                            "status": inc.get("status", ""),
                            "impact": inc.get("impact", "none"),
                            "created_at": inc.get("created_at", ""),
                            "shortlink": inc.get("shortlink", ""),
                        })
                except Exception:
                    pass

    except Exception as exc:
        result["status"] = "unknown"
        result["description"] = "Could not reach status endpoint"
        result["error"] = str(exc)[:120]

    _cache[pid] = (now, result)
    return result


@router.get("/hardware-status")
async def all_hardware_status():
    """Return live status for all tracked quantum hardware providers."""
    tasks = [_fetch_one(pid, cfg) for pid, cfg in _SOURCES.items()]
    results = await asyncio.gather(*tasks)
    # Annotate cache age
    now = time.time()
    for r in results:
        pid = r["id"]
        r["cache_age_s"] = int(now - _cache[pid][0]) if pid in _cache else 0
    return list(results)


@router.get("/hardware-status/{provider_id}")
async def single_hardware_status(provider_id: str):
    """Return live status for one quantum hardware provider."""
    if provider_id not in _SOURCES:
        raise HTTPException(404, f"Unknown provider '{provider_id}'")
    result = await _fetch_one(provider_id, _SOURCES[provider_id])
    now = time.time()
    result["cache_age_s"] = int(now - _cache[provider_id][0]) if provider_id in _cache else 0
    return result


@router.delete("/hardware-status/cache")
async def clear_cache():
    """Force-clear the status cache (useful for testing)."""
    _cache.clear()
    return {"cleared": True}
