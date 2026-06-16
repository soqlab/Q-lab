"""Calibration Intelligence Network — Feature #1 of 10.

P2P mesh where Q-Lab instances voluntarily share anonymised calibration
statistics for quantum backends.  No central server required: each node
exposes public read-only endpoints and can query its configured peers.

Architecture
────────────
• Every instance generates a random anonymous node-ID on first boot.
• Sharing is opt-in; the public endpoints return 403 when disabled.
• Calibration data is aggregated to statistics only (mean/std/min/max)
  — raw run data and user info are never shared.
• Peer URLs are stored in data/network_peers.json.
• Config (opt-in flag, node-ID) in data/network_config.json.

Public endpoints (no auth, only when opt-in=True):
  GET /api/v1/network/status
  GET /api/v1/network/calibration/{backend}

Authenticated endpoints:
  GET/PATCH /api/v1/network/config
  GET/POST/DELETE /api/v1/network/peers
  GET /api/v1/network/aggregate/{backend}   ← queries all peers + self
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import secrets
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/network", tags=["cal_network"])

_DATA_DIR   = pathlib.Path(os.getenv("QLAB_DATA_DIR", "data"))
_PEERS_FILE = _DATA_DIR / "network_peers.json"
_CFG_FILE   = _DATA_DIR / "network_config.json"

_CAL_KEYS = ["avg_t1_us", "avg_t2_us", "avg_gate_error",
             "avg_gate_error_2q", "avg_readout_error"]

# ──────────────────────────────────────────────────────────────────────────────
# Config / persistence helpers
# ──────────────────────────────────────────────────────────────────────────────

def _load_cfg() -> dict:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _CFG_FILE.exists():
        try:
            return json.loads(_CFG_FILE.read_text())
        except Exception:
            pass
    cfg = {
        "opt_in": False,
        "instance_id": "node_" + secrets.token_hex(8),
        "joined_at": None,
        "node_label": "",
    }
    _CFG_FILE.write_text(json.dumps(cfg, indent=2))
    return cfg


def _save_cfg(cfg: dict) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _CFG_FILE.write_text(json.dumps(cfg, indent=2))


def _load_peers() -> list[dict]:
    if _PEERS_FILE.exists():
        try:
            return json.loads(_PEERS_FILE.read_text())
        except Exception:
            pass
    return []


def _save_peers(peers: list[dict]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _PEERS_FILE.write_text(json.dumps(peers, indent=2))


# ──────────────────────────────────────────────────────────────────────────────
# Calibration aggregation helpers
# ──────────────────────────────────────────────────────────────────────────────

def _metric_stats(values: list[float]) -> dict:
    n = len(values)
    if n == 0:
        return {"n": 0, "mean": None, "std": None, "min": None, "max": None}
    mean = sum(values) / n
    variance = sum((v - mean) ** 2 for v in values) / n if n > 1 else 0.0
    return {
        "n":    n,
        "mean": round(mean, 8),
        "std":  round(math.sqrt(variance), 8),
        "min":  round(min(values), 8),
        "max":  round(max(values), 8),
    }


def _build_local_snapshot(backend: str, db: Session) -> dict | None:
    """Aggregate calibration stats from local runs for a backend."""
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend, Run.calibration.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(200)
    ).all()
    if not runs:
        return None

    buckets: dict[str, list[float]] = {k: [] for k in _CAL_KEYS}
    dates = []

    for run in runs:
        cal = run.calibration or {}
        for k in _CAL_KEYS:
            v = cal.get(k)
            if v is not None:
                try:
                    buckets[k].append(float(v))
                except (TypeError, ValueError):
                    pass
        if run.created_at:
            dates.append(run.created_at)

    cfg = _load_cfg()
    return {
        "instance_id":  cfg["instance_id"],
        "node_label":   cfg.get("node_label", ""),
        "backend":      backend,
        "n_snapshots":  len(runs),
        "date_range": {
            "from": min(dates).isoformat() if dates else None,
            "to":   max(dates).isoformat() if dates else None,
        },
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "metrics": {k: _metric_stats(v) for k, v in buckets.items()},
    }


def _combine_snapshots(snapshots: list[dict]) -> dict:
    """Merge calibration snapshots from multiple nodes into global stats."""
    all_metrics: dict[str, list[float]] = {k: [] for k in _CAL_KEYS}
    for snap in snapshots:
        for key, stat in (snap.get("metrics") or {}).items():
            if key in all_metrics and stat.get("mean") is not None:
                # weight by n_snapshots
                n = stat.get("n", 1)
                all_metrics[key].extend([stat["mean"]] * n)

    return {k: _metric_stats(v) for k, v in all_metrics.items()}


# ──────────────────────────────────────────────────────────────────────────────
# Peer HTTP fetch
# ──────────────────────────────────────────────────────────────────────────────

def _fetch_peer_snapshot(peer_url: str, backend: str) -> dict | None:
    url = peer_url.rstrip("/") + f"/api/v1/network/calibration/{backend}"
    try:
        r = httpx.get(url, timeout=6.0)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


def _fetch_peer_status(peer_url: str) -> dict | None:
    url = peer_url.rstrip("/") + "/api/v1/network/status"
    try:
        r = httpx.get(url, timeout=4.0)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ──────────────────────────────────────────────────────────────────────────────

class ConfigPatch(BaseModel):
    opt_in:     Optional[bool] = None
    node_label: Optional[str] = None


class PeerBody(BaseModel):
    url:   str
    label: Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# Public endpoints (no auth — only active when opt_in=True)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/status")
def network_status(db: Session = Depends(get_db)):
    """Public: what backends does this node share calibration data for?"""
    cfg = _load_cfg()
    if not cfg.get("opt_in"):
        raise HTTPException(403, "This node has not opted in to the calibration network.")

    # Distinct backends with calibration data
    from sqlalchemy import func as sqlfunc
    rows = db.execute(
        select(Run.backend, sqlfunc.count(Run.id).label("n"))
        .where(Run.calibration.isnot(None), Run.backend.isnot(None))
        .group_by(Run.backend)
    ).all()

    return {
        "instance_id":   cfg["instance_id"],
        "node_label":    cfg.get("node_label", ""),
        "opt_in":        True,
        "backends":      [{"backend": r.backend, "n_snapshots": r.n} for r in rows],
        "queried_at":    datetime.now(timezone.utc).isoformat(),
    }


@router.get("/calibration/{backend}")
def public_calibration(backend: str, db: Session = Depends(get_db)):
    """Public: anonymised calibration stats for one backend from this node."""
    cfg = _load_cfg()
    if not cfg.get("opt_in"):
        raise HTTPException(403, "This node has not opted in to the calibration network.")

    snap = _build_local_snapshot(backend, db)
    if snap is None:
        raise HTTPException(404, f"No calibration data for '{backend}' on this node.")
    return snap


# ──────────────────────────────────────────────────────────────────────────────
# Authenticated endpoints
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/config")
def get_config():
    """Return this node's network participation config."""
    return _load_cfg()


@router.patch("/config")
def patch_config(body: ConfigPatch):
    """Toggle opt-in and set a human-readable node label."""
    cfg = _load_cfg()
    if body.opt_in is not None:
        cfg["opt_in"] = body.opt_in
        if body.opt_in and not cfg.get("joined_at"):
            cfg["joined_at"] = datetime.now(timezone.utc).isoformat()
    if body.node_label is not None:
        cfg["node_label"] = body.node_label[:80]
    _save_cfg(cfg)
    return cfg


@router.get("/peers")
def list_peers():
    """List configured peer Q-Lab instances."""
    return {"peers": _load_peers()}


@router.post("/peers", status_code=201)
def add_peer(body: PeerBody):
    """Add a peer Q-Lab instance URL."""
    url = body.url.rstrip("/")
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "URL must start with http:// or https://")

    peers = _load_peers()
    if any(p["url"] == url for p in peers):
        raise HTTPException(409, "Peer URL already registered.")

    peer = {
        "id":       secrets.token_hex(6),
        "url":      url,
        "label":    (body.label or url)[:80],
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    peers.append(peer)
    _save_peers(peers)

    # Probe the peer immediately to get its status
    status = _fetch_peer_status(url)
    return {"peer": peer, "reachable": status is not None, "peer_status": status}


@router.delete("/peers/{peer_id}", status_code=200)
def remove_peer(peer_id: str):
    peers = _load_peers()
    before = len(peers)
    peers = [p for p in peers if p["id"] != peer_id]
    if len(peers) == before:
        raise HTTPException(404, "Peer not found.")
    _save_peers(peers)
    return {"removed": peer_id}


@router.get("/peers/probe")
def probe_peers():
    """Check reachability of all configured peers."""
    peers = _load_peers()
    results = []
    for peer in peers:
        status = _fetch_peer_status(peer["url"])
        results.append({
            "id":        peer["id"],
            "url":       peer["url"],
            "label":     peer["label"],
            "reachable": status is not None,
            "status":    status,
        })
    return {"peers": results, "total": len(peers), "reachable": sum(1 for r in results if r["reachable"])}


@router.get("/aggregate/{backend}")
def aggregate_calibration(backend: str, db: Session = Depends(get_db)):
    """
    Query all configured peers + local data and return a combined
    calibration picture for the given backend.

    Each peer is queried in parallel (sequential for simplicity here).
    Results include per-source breakdowns and global statistics.
    """
    snapshots: list[dict] = []
    source_details: list[dict] = []

    # Local snapshot
    local_snap = _build_local_snapshot(backend, db)
    if local_snap:
        snapshots.append(local_snap)
        source_details.append({
            "instance_id": local_snap["instance_id"],
            "label":       local_snap.get("node_label") or "this instance",
            "source":      "local",
            "n_snapshots": local_snap["n_snapshots"],
            "last_updated": local_snap["last_updated"],
            "reachable":   True,
        })

    # Peer snapshots
    for peer in _load_peers():
        snap = _fetch_peer_snapshot(peer["url"], backend)
        if snap:
            snapshots.append(snap)
            source_details.append({
                "instance_id": snap.get("instance_id", peer["id"]),
                "label":       peer.get("label", peer["url"]),
                "source":      "peer",
                "peer_url":    peer["url"],
                "n_snapshots": snap.get("n_snapshots", 0),
                "last_updated": snap.get("last_updated"),
                "reachable":   True,
            })
        else:
            source_details.append({
                "instance_id": peer["id"],
                "label":       peer.get("label", peer["url"]),
                "source":      "peer",
                "peer_url":    peer["url"],
                "reachable":   False,
            })

    combined = _combine_snapshots(snapshots)
    total_snaps = sum(s.get("n_snapshots", 0) for s in snapshots)

    return {
        "backend":          backend,
        "sources":          len(snapshots),
        "total_snapshots":  total_snaps,
        "network_summary":  f"Aggregated from {len(snapshots)} node(s), {total_snaps} calibration snapshots.",
        "global_metrics":   combined,
        "per_source":       [s for s in snapshots],
        "source_status":    source_details,
        "aggregated_at":    datetime.now(timezone.utc).isoformat(),
    }


@router.get("/backends")
def list_network_backends(db: Session = Depends(get_db)):
    """
    Return the union of all backends available across this node + all peers.
    Useful for the network dashboard to know what to query.
    """
    # Local backends
    from sqlalchemy import func as sqlfunc
    local_rows = db.execute(
        select(Run.backend)
        .where(Run.calibration.isnot(None), Run.backend.isnot(None))
        .distinct()
    ).scalars().all()
    backends = set(local_rows)

    # Peer backends
    peer_info = []
    for peer in _load_peers():
        status = _fetch_peer_status(peer["url"])
        if status:
            for b in (status.get("backends") or []):
                backends.add(b["backend"])
            peer_info.append({"url": peer["url"], "label": peer["label"], "reachable": True, "backends": [b["backend"] for b in (status.get("backends") or [])]})
        else:
            peer_info.append({"url": peer["url"], "label": peer["label"], "reachable": False, "backends": []})

    return {
        "backends":    sorted(backends),
        "peers":       peer_info,
        "queried_at":  datetime.now(timezone.utc).isoformat(),
    }
