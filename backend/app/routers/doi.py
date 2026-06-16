"""DOI Minting — assign persistent identifiers to quantum experiment runs.

Supports:
- Real minting via Zenodo sandbox (requires ZENODO_ACCESS_TOKEN env var)
- Simulated / preview DOIs when the token is absent (demo mode)
- APA, BibTeX, and RIS citation export

Router prefix: /api/v1/doi
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..store import store_delete, store_get, store_list, store_put  # noqa: F401

router = APIRouter(prefix="/api/v1/doi", tags=["doi"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class DOIRecord(BaseModel):
    doi_record_id: str
    run_id: str
    doi: Optional[str] = None
    zenodo_record_id: Optional[str] = None
    figshare_article_id: Optional[str] = None
    title: str
    description: str
    authors: List[str]
    keywords: List[str]
    license: str
    status: str  # draft | submitted | minted | failed
    minted_at: Optional[str] = None
    citation_text: Optional[str] = None
    created_at: str


class MintRequest(BaseModel):
    title: str
    description: str
    authors: List[str]
    keywords: List[str]
    license: str = "cc-by-4.0"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NS = "doi_records"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _apa_citation(authors: List[str], year: int, title: str, doi: str) -> str:
    first = authors[0] if authors else "Unknown"
    suffix = " et al." if len(authors) > 1 else ""
    return f"{first}{suffix} ({year}). {title}. Zenodo. https://doi.org/{doi}"


def _bibtex(record: dict) -> str:
    doi = record.get("doi", "")
    year = record.get("minted_at", "")[:4] if record.get("minted_at") else str(datetime.now().year)
    key = doi.replace("/", "_").replace(".", "_") if doi else f"qlab_{record['run_id'][:8]}"
    authors_raw = record.get("authors", [])
    author_str = " and ".join(authors_raw) if authors_raw else "Unknown"
    lines = [
        f"@dataset{{{key},",
        f"  title = {{{record.get('title', '')}}},",
        f"  author = {{{author_str}}},",
        f"  year = {{{year}}},",
        f"  publisher = {{Zenodo}},",
    ]
    if doi:
        lines.append(f"  doi = {{{doi}}},")
        lines.append(f"  url = {{https://doi.org/{doi}}},")
    lines.append("}")
    return "\n".join(lines)


def _ris(record: dict) -> str:
    doi = record.get("doi", "")
    year = record.get("minted_at", "")[:4] if record.get("minted_at") else str(datetime.now().year)
    authors_raw = record.get("authors", [])
    lines = ["TY  - DATA"]
    for a in authors_raw:
        lines.append(f"AU  - {a}")
    lines += [
        f"TI  - {record.get('title', '')}",
        f"PY  - {year}",
        "PB  - Zenodo",
    ]
    if doi:
        lines += [f"DO  - {doi}", f"UR  - https://doi.org/{doi}"]
    lines.append("ER  -")
    return "\n".join(lines)


def _find_by_run(db: Session, run_id: str) -> Optional[dict]:
    """Return the first DOI record whose run_id matches."""
    records = store_list(db, _NS)
    for r in records:
        if r.get("run_id") == run_id:
            return r
    return None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/mint/{run_id}", response_model=DOIRecord)
def mint_doi(run_id: str, body: MintRequest, db: Session = Depends(get_db)):
    """Attempt to mint a DOI for a run via Zenodo (or simulate one in demo mode)."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    token = os.environ.get("ZENODO_ACCESS_TOKEN")
    now = _utcnow()
    year = datetime.now(timezone.utc).year
    record_id = str(uuid.uuid4())

    zenodo_record_id: Optional[str] = None
    doi: Optional[str] = None
    status = "draft"
    minted_at: Optional[str] = None

    zenodo_payload = {
        "metadata": {
            "title": body.title,
            "description": body.description,
            "creators": [{"name": a} for a in body.authors],
            "keywords": body.keywords,
            "license": body.license,
            "upload_type": "dataset",
            "access_right": "open",
            "notes": (
                f"Quantum experiment run {run_id} tracked by Q-Lab. "
                f"Backend: {run.backend or 'unknown'}. "
                f"Circuit: {run.circuit_name or 'unnamed'}."
            ),
        }
    }

    if token:
        # Real Zenodo sandbox mint
        try:
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
            resp = httpx.post(
                "https://sandbox.zenodo.org/api/deposit/depositions",
                json=zenodo_payload,
                headers=headers,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            zenodo_record_id = str(data.get("record_id", ""))
            doi = data.get("metadata", {}).get("prereserve_doi", {}).get("doi") or data.get("doi")
            if not doi and zenodo_record_id:
                doi = f"10.5281/zenodo.{zenodo_record_id}"
            status = "minted"
            minted_at = now
        except Exception as exc:
            status = "failed"
            doi = None
            # Store the failure but don't crash — return the record with status=failed
    else:
        # Simulation / demo mode
        doi = f"10.5281/qlab.{run_id[:8]}"
        status = "draft"
        minted_at = now

    citation_text = _apa_citation(body.authors, year, body.title, doi) if doi else None

    record_data: dict = {
        "doi_record_id": record_id,
        "run_id": run_id,
        "doi": doi,
        "zenodo_record_id": zenodo_record_id,
        "figshare_article_id": None,
        "title": body.title,
        "description": body.description,
        "authors": body.authors,
        "keywords": body.keywords,
        "license": body.license,
        "status": status,
        "minted_at": minted_at,
        "citation_text": citation_text,
        "created_at": now,
    }

    store_put(db, _NS, record_id, record_data)
    return DOIRecord(**record_data)


@router.get("/run/{run_id}")
def get_doi_for_run(run_id: str, db: Session = Depends(get_db)):
    """Return the DOI record for a specific run, or null if none exists."""
    record = _find_by_run(db, run_id)
    if record is None:
        return {"doi_record": None}
    return {"doi_record": record}


@router.get("/records")
def list_doi_records(db: Session = Depends(get_db)):
    """List all DOI records across all runs."""
    records = store_list(db, _NS)
    return {"count": len(records), "records": records}


@router.get("/cite/{run_id}")
def get_citation(run_id: str, db: Session = Depends(get_db)):
    """Return APA, BibTeX, and RIS citation formats for a run's DOI."""
    record = _find_by_run(db, run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="No DOI record found for this run")

    authors = record.get("authors", [])
    year = record.get("minted_at", "")[:4] if record.get("minted_at") else str(datetime.now().year)
    doi = record.get("doi", "")
    title = record.get("title", "")

    apa = (
        record.get("citation_text")
        or _apa_citation(authors, int(year), title, doi)
    )

    return {
        "run_id": run_id,
        "doi": doi,
        "apa": apa,
        "bibtex": _bibtex(record),
        "ris": _ris(record),
    }
