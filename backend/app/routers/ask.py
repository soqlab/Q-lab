"""Multi-Run AI Chat.

Researchers ask natural-language questions across their full experiment history.
Claude scans relevant runs and answers with specific numbers and run citations.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_identity, Identity
from ..models import Run
from ..health_score import compute_health_score

router = APIRouter(prefix="/api/v1/ask", tags=["ask"])

_MODEL = os.getenv("QLAB_INSIGHT_MODEL", "claude-haiku-4-5-20251001")
_MAX_CONTEXT_RUNS = 60


class AskRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=2000)
    project: Optional[str] = None
    backend: Optional[str] = None
    days: int = Field(30, ge=1, le=365)
    max_runs: int = Field(50, ge=5, le=200)


def _run_summary(run: Run) -> dict:
    fp = run.fingerprint or {}
    res = run.results or {}
    sr = run.shadow_results or {}
    ts = run.transpiler or {}
    rd = {"results": res, "calibration": run.calibration or {}, "fingerprint": fp}
    health = compute_health_score(rd)
    return {
        "run_id": run.run_id,
        "circuit_name": run.circuit_name,
        "backend": run.backend,
        "project": run.project_slug,
        "status": run.status,
        "created_at": run.created_at.isoformat()[:19] if run.created_at else None,
        "tags": run.tags or [],
        "health_score": round(health, 1) if health is not None else None,
        "depth": fp.get("depth"),
        "num_qubits": fp.get("num_qubits"),
        "size": fp.get("size"),
        "non_clifford_ratio": round(fp.get("non_clifford_ratio", 0), 3) if fp.get("non_clifford_ratio") is not None else None,
        "success_probability": round(float(res["success_probability"]), 4) if res.get("success_probability") is not None else None,
        "tvd": round(float(sr["tvd"]), 4) if sr.get("tvd") is not None else None,
        "optimization_level": ts.get("settings", ts).get("optimization_level"),
        "benchmark_id": run.benchmark_id,
    }


def _build_prompt(question: str, runs: list[dict], filters: dict) -> str:
    filter_desc = ", ".join(f"{k}={v}" for k, v in filters.items() if v)
    runs_json = json.dumps(runs, indent=1)
    return f"""You are a quantum computing research assistant with direct access to a researcher's experiment database.

The researcher has asked: **{question}**

Active filters: {filter_desc or "none (all experiments)"}

Here are {len(runs)} recent experiments (JSON format):

{runs_json}

INSTRUCTIONS:
- Answer the question using ONLY the data above. Do not fabricate metrics.
- Cite specific run_ids when making claims (use the format: run_id `abc123`)
- Compare numbers explicitly: "ibm_kyoto averaged health 72.3 vs ibm_osaka at 58.1"
- If the data is insufficient to answer, say so directly and explain what additional data would help
- Be concise and scientific. Use the researcher's vocabulary (TVD, non-Clifford ratio, health score, etc.)
- Highlight the most actionable finding first
- If you see anomalies or patterns, name them with specific numbers
- End with 1-2 concrete next steps the researcher could take

Respond in plain text (no markdown headers, no bullet points unless the question asks for a list).
Maximum 400 words."""


def _call_claude(prompt: str) -> str:
    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "anthropic package not installed. Run: pip install anthropic>=0.30")
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY not configured")
    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=_MODEL,
        max_tokens=800,
        temperature=0.1,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


async def _stream_claude(prompt: str) -> AsyncGenerator[str, None]:
    try:
        import anthropic
    except ImportError:
        yield "data: " + json.dumps({"error": "anthropic package not installed"}) + "\n\n"
        return
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        yield "data: " + json.dumps({"error": "ANTHROPIC_API_KEY not configured"}) + "\n\n"
        return

    client = anthropic.Anthropic(api_key=api_key)
    try:
        with client.messages.stream(
            model=_MODEL,
            max_tokens=800,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield "data: " + json.dumps({"token": text}) + "\n\n"
    except Exception as exc:
        yield "data: " + json.dumps({"error": str(exc)}) + "\n\n"
    yield "data: [DONE]\n\n"


def _fetch_runs(db: Session, body: AskRequest, identity: Optional[Identity]) -> list[Run]:
    since = datetime.now(timezone.utc) - timedelta(days=body.days)
    q = select(Run).where(Run.created_at >= since)
    if identity and identity.org_id:
        q = q.where(Run.org_id == identity.org_id)
    if body.project:
        q = q.where(Run.project_slug == body.project)
    if body.backend:
        q = q.where(Run.backend == body.backend)
    return db.scalars(q.order_by(Run.created_at.desc()).limit(body.max_runs)).all()


@router.post("")
def ask(
    body: AskRequest,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    runs = _fetch_runs(db, body, identity)
    if not runs:
        return {
            "answer": "No experiments found matching your filters. Try expanding the date range or removing project/backend filters.",
            "cited_run_ids": [],
            "run_count": 0,
        }

    summaries = [_run_summary(r) for r in runs]
    prompt = _build_prompt(body.question, summaries, {"project": body.project, "backend": body.backend, "days": body.days})
    answer = _call_claude(prompt)

    # Extract cited run IDs from answer
    cited = [r["run_id"] for r in summaries if r["run_id"] in answer]

    return {
        "answer": answer,
        "cited_run_ids": cited,
        "run_count": len(runs),
        "model": _MODEL,
    }


@router.post("/stream")
async def ask_stream(
    body: AskRequest,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    runs = _fetch_runs(db, body, identity)
    summaries = [_run_summary(r) for r in runs]
    prompt = _build_prompt(body.question, summaries, {"project": body.project, "backend": body.backend, "days": body.days})

    # Send run metadata first so the frontend can show sources immediately
    async def event_stream():
        meta = json.dumps({"run_count": len(runs), "run_ids": [r["run_id"] for r in summaries[:20]]})
        yield f"data: {{\"meta\": {meta}}}\n\n"
        async for chunk in _stream_claude(prompt):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/status")
def ask_status():
    available = bool(os.getenv("ANTHROPIC_API_KEY"))
    return {"available": available, "model": _MODEL if available else None}
