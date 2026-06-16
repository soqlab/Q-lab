"""Device Identity Fingerprinting — Novel Feature C.

Creates a unique statistical "fingerprint" for each quantum backend
from its run-history characteristics — a quantum Physical Unclonable
Function (PUF) implemented in software.

Applications
────────────
• Verify you're actually running on the claimed backend (not a simulator)
• Detect hardware replacement / significant recalibration events
• Track device "ageing" as gate fidelity slowly degrades
• Build a fingerprint library across backends for automatic identification

Fingerprint construction
────────────────────────
We extract 12 statistical features from a backend's run history:

  Calibration-derived (from metadata):
  f[0]  = mean T1 (µs)
  f[1]  = std  T1
  f[2]  = mean T2 (µs)
  f[3]  = std  T2
  f[4]  = mean gate_error
  f[5]  = std  gate_error
  f[6]  = mean readout_error

  Run-distribution-derived:
  f[7]  = mean success_probability
  f[8]  = std  success_probability
  f[9]  = mean depth (circuit variety)
  f[10] = run-count-normalised heavy output fraction (proxy)
  f[11] = mean non_clifford_ratio

These are hashed into a 64-bit fingerprint ID and compared across time
windows to produce a drift score.
"""
from __future__ import annotations

import hashlib
import math
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["device_fingerprint"])

_N_FEATURES = 12


def _safe(v, default=0.0) -> float:
    try:
        return float(v or default)
    except Exception:
        return default


def _stats(vals: list[float]) -> tuple[float, float]:
    if not vals:
        return 0.0, 0.0
    n   = len(vals)
    mu  = sum(vals) / n
    std = math.sqrt(sum((v - mu) ** 2 for v in vals) / max(1, n - 1))
    return mu, std


def _extract_features(runs: list[Run]) -> list[float]:
    t1s, t2s, gerrs, rerrs, sps, depths, ncs = [], [], [], [], [], [], []
    for r in runs:
        cal = r.calibration or {}
        fp  = r.fingerprint or {}
        res = r.results     or {}
        t1 = _safe(cal.get("avg_t1_us"))
        t2 = _safe(cal.get("avg_t2_us"))
        ge = _safe(cal.get("avg_gate_error"))
        re = _safe(cal.get("avg_readout_error"))
        sp = _safe(res.get("success_probability"), -1)
        d  = _safe(fp.get("depth"))
        nc = _safe(fp.get("non_clifford_ratio"))
        if t1 > 0: t1s.append(t1)
        if t2 > 0: t2s.append(t2)
        if ge > 0: gerrs.append(ge)
        if re > 0: rerrs.append(re)
        if sp >= 0: sps.append(sp)
        if d  > 0: depths.append(d)
        if nc >= 0: ncs.append(nc)

    mt1, st1 = _stats(t1s)
    mt2, st2 = _stats(t2s)
    mge, sge = _stats(gerrs)
    mre, _   = _stats(rerrs)
    msp, ssp = _stats(sps)
    mdp, _   = _stats(depths)
    mnc, _   = _stats(ncs)

    # Heavy output fraction proxy: fraction of sps > 2/3
    hof = (sum(1 for sp in sps if sp > 2/3) / len(sps)) if sps else 0.0

    return [mt1, st1, mt2, st2, mge, sge, mre, msp, ssp, mdp, hof, mnc]


def _fingerprint_hash(features: list[float]) -> str:
    """SHA-256 of rounded feature vector → 16-char hex."""
    rounded = [round(f, 4) for f in features]
    blob = ",".join(str(r) for r in rounded)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _cosine_drift(a: list[float], b: list[float]) -> float:
    dot  = sum(x * y for x, y in zip(a, b))
    ma   = math.sqrt(sum(x * x for x in a)) or 1.0
    mb   = math.sqrt(sum(y * y for y in b)) or 1.0
    return round(1.0 - dot / (ma * mb), 4)  # 0 = identical, 1 = orthogonal


def _feature_names() -> list[str]:
    return [
        "mean_T1_us", "std_T1_us",
        "mean_T2_us", "std_T2_us",
        "mean_gate_error", "std_gate_error",
        "mean_readout_error",
        "mean_success_probability", "std_success_probability",
        "mean_depth",
        "heavy_output_fraction",
        "mean_non_clifford_ratio",
    ]


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/backends/{backend}/device-fingerprint")
def device_fingerprint(
    backend: str,
    window_days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """
    Compute a statistical device fingerprint and detect drift over time.
    """
    all_runs = db.execute(
        select(Run)
        .where(Run.backend == backend)
        .order_by(Run.created_at.asc())
        .limit(1000)
    ).scalars().all()

    if len(all_runs) < 3:
        raise HTTPException(422, f"Need ≥ 3 runs on '{backend}' — found {len(all_runs)}.")

    # Full fingerprint (all time)
    full_features = _extract_features(all_runs)
    full_hash     = _fingerprint_hash(full_features)

    # Early window (oldest half) vs Recent window (newest half)
    mid = len(all_runs) // 2
    early_runs  = all_runs[:mid]
    recent_runs = all_runs[mid:]

    early_feat  = _extract_features(early_runs)
    recent_feat = _extract_features(recent_runs)

    drift_score = _cosine_drift(early_feat, recent_feat) if early_runs and recent_runs else 0.0

    drift_label = (
        "high"   if drift_score > 0.15 else
        "medium" if drift_score > 0.05 else
        "low"
    )

    # Per-feature change
    names    = _feature_names()
    features_detail = []
    for i, name in enumerate(names):
        early_v  = early_feat[i]
        recent_v = recent_feat[i]
        pct = ((recent_v - early_v) / max(abs(early_v), 1e-9)) * 100 if early_v != 0 else 0.0
        features_detail.append({
            "name":     name,
            "early":    round(early_v, 6),
            "recent":   round(recent_v, 6),
            "pct_change": round(pct, 1),
            "flag":     abs(pct) > 20,
        })

    # Time-windowed fingerprint hashes for drift timeline
    timeline = []
    now = datetime.now(timezone.utc)
    for weeks_ago in range(8, -1, -1):
        start = now - timedelta(weeks=weeks_ago + 1)
        end   = now - timedelta(weeks=weeks_ago)
        window_runs = [
            r for r in all_runs
            if r.created_at and
               start <= (r.created_at.replace(tzinfo=timezone.utc) if r.created_at.tzinfo is None else r.created_at) < end
        ]
        if window_runs:
            wf   = _extract_features(window_runs)
            wh   = _fingerprint_hash(wf)
            wd   = _cosine_drift(full_features, wf)
            timeline.append({
                "week_start": start.strftime("%Y-%m-%d"),
                "n_runs":     len(window_runs),
                "fingerprint": wh,
                "drift_from_baseline": round(wd, 4),
            })

    narrative = (
        f"Backend '{backend}' fingerprinted from {len(all_runs)} runs. "
        f"Fingerprint ID: {full_hash}. "
        f"Device drift: {drift_label} (cosine distance {drift_score:.4f} between early and recent window). "
        + ("Significant hardware change or recalibration likely occurred." if drift_label == "high"
           else "Device characteristics appear stable." if drift_label == "low"
           else "Moderate drift detected — worth monitoring.")
    )

    return {
        "backend":          backend,
        "fingerprint_id":   full_hash,
        "n_runs":           len(all_runs),
        "drift_score":      drift_score,
        "drift_label":      drift_label,
        "features":         features_detail,
        "feature_vector":   [round(f, 6) for f in full_features],
        "timeline":         timeline,
        "narrative":        narrative,
        "computed_at":      datetime.now(timezone.utc).isoformat(),
    }
