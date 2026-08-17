from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import List, Optional

import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/conference", tags=["conference"])
NS = "conference_assets"

# ---------------------------------------------------------------------------
# Anthropic client — real AI generation
# ---------------------------------------------------------------------------

_anthropic_client = None
try:
    import anthropic as _anthro_lib
    _key = os.getenv("ANTHROPIC_API_KEY")
    if _key:
        _anthropic_client = _anthro_lib.Anthropic(api_key=_key)
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ConferenceAsset(BaseModel):
    asset_id: str
    type: str
    title: str
    venue: str
    authors: List[str]
    experiment_ids: List[str]
    sections: List[dict]
    template: str
    format: str
    download_url: str
    created_at: str
    ai_generated: bool = False


class AbstractSummary(BaseModel):
    asset_id: str
    title: str
    word_count: int
    key_results: List[str]


class GeneratePosterRequest(BaseModel):
    title: str
    venue: str
    authors: List[str]
    experiment_ids: List[str]
    template: str = "ieee"
    highlight_metric: str = "fidelity"


class GenerateSlidesRequest(BaseModel):
    title: str
    venue: str
    authors: List[str]
    experiment_ids: List[str]
    n_slides: int = 12
    template: str = "clean"


class GenerateAbstractRequest(BaseModel):
    title: str
    authors: List[str]
    experiment_ids: List[str]
    max_words: int = 250
    venue: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_run_context(db: Session, experiment_ids: List[str]) -> str:
    lines = []
    for eid in experiment_ids[:6]:
        for ns in ("runs", "experiments", "circuit_runs"):
            data = store_get(db, ns, eid)
            if data:
                name = data.get("name") or data.get("circuit_name") or "unnamed circuit"
                backend = data.get("backend", "unknown")
                qubits = data.get("n_qubits") or data.get("num_qubits") or "?"
                depth = data.get("depth", "?")
                health = data.get("health_score", "?")
                lines.append(
                    f"- Run {eid[:8]}: circuit='{name}', backend={backend}, "
                    f"qubits={qubits}, depth={depth}, health={health}"
                )
                break
        else:
            lines.append(f"- Experiment ID: {eid[:8]}")
    return "\n".join(lines) if lines else "No experiment data available."


def _ai_call(prompt: str, max_tokens: int = 1500) -> Optional[str]:
    if _anthropic_client is None:
        return None
    try:
        msg = _anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text
    except Exception:
        return None


def _parse_json_array(text: str) -> Optional[list]:
    try:
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Poster
# ---------------------------------------------------------------------------

def _poster_sections(
    title: str, venue: str, authors: List[str],
    experiment_ids: List[str], highlight_metric: str, db: Session
) -> tuple[List[dict], bool]:
    run_ctx = _fetch_run_context(db, experiment_ids)
    prompt = f"""You are a quantum computing researcher writing a conference poster.

Title: {title}
Venue: {venue}
Authors: {', '.join(authors)}
Metric of interest: {highlight_metric}
Experiment data:
{run_ctx}

Generate exactly 4 poster sections as a JSON array:
[
  {{"title": "Introduction", "content": "3-4 sentences...", "figures": [{{"label": "Fig. 1", "caption": "...", "type": "circuit_diagram"}}]}},
  {{"title": "Methods", "content": "3-4 sentences...", "figures": [{{"label": "Fig. 2", "caption": "...", "type": "line_plot"}}]}},
  {{"title": "Results", "content": "3-4 sentences citing specific metrics...", "figures": [{{"label": "Fig. 3", "caption": "...", "type": "bar_chart"}}]}},
  {{"title": "Conclusion", "content": "2-3 sentences...", "figures": []}}
]

Write realistic, grounded academic content. Return ONLY the JSON array."""

    text = _ai_call(prompt, 1800)
    if text:
        sections = _parse_json_array(text)
        if sections and len(sections) >= 2:
            return sections, True

    exp_ref = f"runs {', '.join(e[:8] for e in experiment_ids[:3])}" if experiment_ids else "our experiments"
    return [
        {"title": "Introduction", "content": f"This poster presents {title}, targeting {highlight_metric} characterization from {exp_ref} on near-term quantum hardware.", "figures": []},
        {"title": "Methods", "content": f"Circuits from {exp_ref} were compiled with Qiskit, executed with readout mitigation and zero-noise extrapolation.", "figures": []},
        {"title": "Results", "content": f"Measured {highlight_metric} values from {exp_ref}. Full datasets available via Q-Lab.", "figures": []},
        {"title": "Conclusion", "content": f"Results establish a reproducible protocol. Future work targets larger qubit registers.", "figures": []},
    ], False


# ---------------------------------------------------------------------------
# Slides
# ---------------------------------------------------------------------------

def _slides_sections(
    title: str, venue: str, authors: List[str],
    experiment_ids: List[str], n_slides: int, db: Session
) -> tuple[List[dict], bool]:
    run_ctx = _fetch_run_context(db, experiment_ids)
    count = min(n_slides, 14)
    prompt = f"""You are preparing a {count}-slide quantum computing talk.

Title: {title}
Venue: {venue}
Authors: {', '.join(authors)}
Experiment data:
{run_ctx}

Generate {count} slides as a JSON array. Each slide:
{{"title": "slide title", "content": "2-3 bullet points as one string separated by newlines", "figures": []}}

Include slides for: motivation, background, setup, circuit design, key results, error analysis, conclusion.
Return ONLY the JSON array."""

    text = _ai_call(prompt, 2000)
    if text:
        slides = _parse_json_array(text)
        if slides and len(slides) >= 3:
            return slides[:n_slides], True

    default_titles = [
        "Introduction & Motivation", "Quantum Background", "Experimental Setup",
        "Circuit Design", "Calibration Protocol", "Key Results",
        "Error Mitigation", "Noise Analysis", "Scalability", "Conclusions",
        "Future Work", "Acknowledgements",
    ]
    exp_ref = ', '.join(e[:8] for e in experiment_ids[:2]) if experiment_ids else "experiments"
    return [
        {"title": t, "content": f"Content for '{t}' based on experiments: {exp_ref}", "figures": []}
        for t in default_titles[:n_slides]
    ], False


# ---------------------------------------------------------------------------
# Abstract
# ---------------------------------------------------------------------------

def _abstract_sections(
    title: str, authors: List[str], experiment_ids: List[str],
    max_words: int, venue: str, db: Session
) -> tuple[List[dict], bool]:
    run_ctx = _fetch_run_context(db, experiment_ids)
    prompt = f"""Write an academic abstract ({max_words} words max) for a quantum computing paper.

Title: {title}
Authors: {', '.join(authors)}
Venue: {venue}
Experiment data:
{run_ctx}

Include: motivation, methods, key quantitative results, significance.
Write at a level appropriate for {venue}.
Return ONLY the abstract text, no labels."""

    text = _ai_call(prompt, 600)
    if text and len(text.split()) >= 50:
        return [{"title": "Abstract", "content": text.strip(), "figures": []}], True

    exp_ref = f"experiments {', '.join(e[:8] for e in experiment_ids[:3])}" if experiment_ids else "our experiments"
    body = (
        f"We present {title}, a systematic characterization of quantum circuits using the Q-Lab "
        f"experiment tracking platform. Using data from {exp_ref}, we quantify gate fidelity, "
        f"decoherence rates, and error mitigation efficacy under realistic noise conditions. "
        f"Our protocol combines randomized benchmarking, readout error mitigation, and zero-noise "
        f"extrapolation, yielding reproducible results across multiple backends. "
        f"These findings, to be presented at {venue}, provide a scalable benchmarking methodology "
        f"for near-term quantum advantage characterization. Authors: {', '.join(authors)}."
    )
    return [{"title": "Abstract", "content": body, "figures": []}], False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/generate-poster", response_model=ConferenceAsset)
def generate_poster(req: GeneratePosterRequest, db: Session = Depends(get_db)) -> ConferenceAsset:
    asset_id = str(uuid.uuid4())
    sections, ai_used = _poster_sections(req.title, req.venue, req.authors, req.experiment_ids, req.highlight_metric, db)
    asset = ConferenceAsset(
        asset_id=asset_id, type="poster", title=req.title, venue=req.venue,
        authors=req.authors, experiment_ids=req.experiment_ids, sections=sections,
        template=req.template, format="pdf",
        download_url=f"/api/v1/conference/asset/{asset_id}/download",
        created_at=datetime.now(timezone.utc).isoformat(), ai_generated=ai_used,
    )
    store_put(db, NS, asset_id, asset.model_dump())
    return asset


@router.post("/generate-slides", response_model=ConferenceAsset)
def generate_slides(req: GenerateSlidesRequest, db: Session = Depends(get_db)) -> ConferenceAsset:
    asset_id = str(uuid.uuid4())
    sections, ai_used = _slides_sections(req.title, req.venue, req.authors, req.experiment_ids, req.n_slides, db)
    asset = ConferenceAsset(
        asset_id=asset_id, type="slides", title=req.title, venue=req.venue,
        authors=req.authors, experiment_ids=req.experiment_ids, sections=sections,
        template=req.template, format="pptx",
        download_url=f"/api/v1/conference/asset/{asset_id}/download",
        created_at=datetime.now(timezone.utc).isoformat(), ai_generated=ai_used,
    )
    store_put(db, NS, asset_id, asset.model_dump())
    return asset


@router.post("/generate-abstract", response_model=ConferenceAsset)
def generate_abstract(req: GenerateAbstractRequest, db: Session = Depends(get_db)) -> ConferenceAsset:
    asset_id = str(uuid.uuid4())
    sections, ai_used = _abstract_sections(req.title, req.authors, req.experiment_ids, req.max_words, req.venue, db)
    asset = ConferenceAsset(
        asset_id=asset_id, type="abstract", title=req.title, venue=req.venue,
        authors=req.authors, experiment_ids=req.experiment_ids, sections=sections,
        template="plain", format="pdf",
        download_url=f"/api/v1/conference/asset/{asset_id}/download",
        created_at=datetime.now(timezone.utc).isoformat(), ai_generated=ai_used,
    )
    store_put(db, NS, asset_id, asset.model_dump())
    return asset


@router.get("/assets", response_model=List[AbstractSummary])
def list_assets(db: Session = Depends(get_db)) -> List[AbstractSummary]:
    summaries = []
    for a in store_list(db, NS):
        content = " ".join(s.get("content", "") for s in a.get("sections", []))
        word_count = len(content.split())
        key_results = [
            s.strip() for s in content.split(".")
            if any(kw in s.lower() for kw in ["fidelity", "result", "peak", "achieve", "demonstrate", "show"])
        ][:3]
        summaries.append(AbstractSummary(
            asset_id=a["asset_id"], title=a["title"], word_count=word_count,
            key_results=key_results or ["See full asset for details."],
        ))
    return summaries


@router.get("/asset/{asset_id}", response_model=ConferenceAsset)
def get_asset(asset_id: str, db: Session = Depends(get_db)) -> ConferenceAsset:
    a = store_get(db, NS, asset_id)
    if not a:
        raise HTTPException(status_code=404, detail=f"Asset {asset_id} not found.")
    return ConferenceAsset(**a)
