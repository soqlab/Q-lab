"""Public reach endpoints: embeddable badge, RSS feed, public experiment gallery.

These endpoints are unauthenticated and designed to spread Q-Lab organically:
- Badge SVG: embed in GitHub READMEs, Jupyter notebooks, research papers
- RSS feed: picked up by quantum computing aggregators and blogs
- Gallery: SEO-optimized public listing of shared experiments
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(tags=["public"])

SITE_URL = os.getenv("QLAB_SITE_URL", "https://www.soqlab.com")


# ── Badge ─────────────────────────────────────────────────────────────────────

def _badge_svg(label: str, value: str, color: str = "#6366f1") -> str:
    label_w = max(len(label) * 7 + 14, 60)
    value_w = max(len(value) * 7 + 14, 40)
    total_w = label_w + value_w
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{total_w}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="{total_w}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="{label_w}" height="20" fill="#555"/>
    <rect x="{label_w}" width="{value_w}" height="20" fill="{color}"/>
    <rect width="{total_w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="{label_w // 2}" y="15" fill="#010101" fill-opacity=".3">{label}</text>
    <text x="{label_w // 2}" y="14">{label}</text>
    <text x="{label_w + value_w // 2}" y="15" fill="#010101" fill-opacity=".3">{value}</text>
    <text x="{label_w + value_w // 2}" y="14">{value}</text>
  </g>
</svg>"""


@router.get("/api/v1/badge/runs.svg", include_in_schema=False)
def badge_runs(db: Session = Depends(get_db)):
    """Embeddable shields-style badge showing total Q-Lab experiment count."""
    count = db.execute(select(Run.run_id).limit(10000)).rowcount
    if count is None or count < 0:
        from sqlalchemy import func
        count = db.scalar(select(func.count()).select_from(Run)) or 0
    label = "tracked on Q-Lab"
    value = f"{count:,} runs" if count != 1 else "1 run"
    svg = _badge_svg(label, value)
    return Response(content=svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "max-age=3600", "Access-Control-Allow-Origin": "*"})


@router.get("/api/v1/badge/status.svg", include_in_schema=False)
def badge_status():
    """Static 'Track on Q-Lab' badge for embedding in READMEs."""
    svg = _badge_svg("quantum tracking", "Q-Lab ⚛", "#6366f1")
    return Response(content=svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "max-age=86400", "Access-Control-Allow-Origin": "*"})


# ── RSS Feed ──────────────────────────────────────────────────────────────────

@router.get("/feed.xml", include_in_schema=False)
def rss_feed(limit: int = Query(default=20, ge=1, le=50), db: Session = Depends(get_db)):
    """RSS 2.0 feed of recent public shared experiments. Picked up by quantum computing aggregators."""
    runs = db.scalars(
        select(Run).where(Run.share_token.isnot(None))
        .order_by(Run.created_at.desc()).limit(limit)
    ).all()

    def escape(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

    now = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    items = []
    for r in runs:
        title = escape(r.circuit_name or r.run_id[:12])
        url = f"{SITE_URL}/share/{r.share_token}"
        fp = r.fingerprint or {}
        desc_parts = [f"Backend: {r.backend or 'unknown'}"]
        if fp.get("num_qubits"): desc_parts.append(f"Qubits: {fp['num_qubits']}")
        if fp.get("depth"): desc_parts.append(f"Depth: {fp['depth']}")
        if r.health_score is not None: desc_parts.append(f"Health: {r.health_score}/100")
        desc = escape(" · ".join(desc_parts))
        pub_date = r.created_at.strftime("%a, %d %b %Y %H:%M:%S +0000") if r.created_at else now
        items.append(f"""    <item>
      <title>{title}</title>
      <link>{url}</link>
      <description>{desc}</description>
      <pubDate>{pub_date}</pubDate>
      <guid isPermaLink="true">{url}</guid>
    </item>""")

    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Q-Lab — Shared Quantum Experiments</title>
    <link>{SITE_URL}</link>
    <description>Recently shared quantum circuit experiments tracked by Q-Lab. Includes IBM Quantum, IonQ, Rigetti, and simulator results.</description>
    <language>en-us</language>
    <lastBuildDate>{now}</lastBuildDate>
    <atom:link href="{SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
{chr(10).join(items)}
  </channel>
</rss>"""
    return Response(content=xml, media_type="application/rss+xml",
                    headers={"Cache-Control": "public, max-age=900"})


# ── Public Gallery ────────────────────────────────────────────────────────────

@router.get("/api/v1/public/gallery")
def public_gallery(
    limit: int = Query(default=24, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Public listing of shared experiments — powers the /gallery SEO page."""
    runs = db.scalars(
        select(Run).where(Run.share_token.isnot(None))
        .order_by(Run.created_at.desc()).offset(offset).limit(limit)
    ).all()
    from sqlalchemy import func
    total = db.scalar(select(func.count()).select_from(Run).where(Run.share_token.isnot(None))) or 0
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [
            {
                "share_token": r.share_token,
                "circuit_name": r.circuit_name or r.run_id[:12],
                "backend": r.backend,
                "status": r.status,
                "health_score": r.health_score,
                "qubits": (r.fingerprint or {}).get("num_qubits"),
                "depth": (r.fingerprint or {}).get("depth"),
                "project": r.project,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "url": f"{SITE_URL}/share/{r.share_token}",
            }
            for r in runs
        ],
    }
