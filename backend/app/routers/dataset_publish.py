"""Dataset Publishing — mint real DOIs via Zenodo API; fall back to simulation for other repos."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/dataset-publish", tags=["dataset_publish"])

NS_PUBLICATIONS = "dataset_publications"

# ---------------------------------------------------------------------------
# Zenodo config — set ZENODO_API_TOKEN in Render; optionally ZENODO_SANDBOX=true
# ---------------------------------------------------------------------------

_ZENODO_TOKEN = os.getenv("ZENODO_API_TOKEN", "")
_ZENODO_SANDBOX = os.getenv("ZENODO_SANDBOX", "false").lower() == "true"
_ZENODO_BASE = "https://sandbox.zenodo.org" if _ZENODO_SANDBOX else "https://zenodo.org"

_LICENSE_MAP = {
    "MIT": "mit",
    "CC-BY-4.0": "cc-by-4.0",
    "CC0": "cc-zero",
    "Apache-2.0": "apache2.0",
}

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class DatasetPublication(BaseModel):
    pub_id: str
    title: str
    description: str
    repository: str
    license: str
    keywords: List[str]
    authors: List[str]
    run_ids: List[str]
    status: str
    doi: Optional[str] = None
    url: Optional[str] = None
    file_size_mb: float
    record_count: int
    created_at: str
    published_at: Optional[str] = None
    real_submission: bool = False


class DOIMintResult(BaseModel):
    pub_id: str
    doi: str
    url: str
    record_id: str
    minted_at: str
    real_submission: bool = False


class PublishRequest(BaseModel):
    title: str
    description: str
    repository: str
    license: str
    keywords: List[str]
    authors: List[str]
    run_ids: List[str]


# ---------------------------------------------------------------------------
# Real Zenodo submission
# ---------------------------------------------------------------------------

def _zenodo_publish(
    title: str,
    description: str,
    authors: List[str],
    keywords: List[str],
    license: str,
    run_ids: List[str],
    db: Session,
) -> tuple[str, str, str]:
    """Submit to Zenodo. Returns (doi, url, record_id). Raises on failure."""
    params = {"access_token": _ZENODO_TOKEN}
    headers = {"Content-Type": "application/json"}

    # 1. Create empty deposition
    r = httpx.post(
        f"{_ZENODO_BASE}/api/deposit/depositions",
        params=params, headers=headers, json={}, timeout=30,
    )
    r.raise_for_status()
    dep = r.json()
    dep_id = dep["id"]
    bucket_url = dep["links"]["bucket"]

    # 2. Build data payload — try to include real run metadata
    payload: dict = {"title": title, "run_ids": run_ids, "exported_at": datetime.now(timezone.utc).isoformat()}
    for rid in run_ids[:20]:
        for ns in ("runs", "experiments", "circuit_runs"):
            data = store_get(db, ns, rid)
            if data:
                payload.setdefault("runs", {})[rid] = data
                break

    file_bytes = json.dumps(payload, indent=2, default=str).encode()

    # 3. Upload file
    r = httpx.put(
        f"{bucket_url}/experiment_data.json",
        params=params,
        content=file_bytes,
        headers={"Content-Type": "application/octet-stream"},
        timeout=60,
    )
    r.raise_for_status()

    # 4. Set metadata
    desc = description or f"Quantum experiment dataset from Q-Lab. Includes {len(run_ids)} run(s)."
    metadata = {
        "metadata": {
            "title": title,
            "upload_type": "dataset",
            "description": desc,
            "creators": [{"name": a} for a in authors],
            "keywords": keywords,
            "license": _LICENSE_MAP.get(license, "cc-by-4.0"),
            "access_right": "open",
        }
    }
    r = httpx.put(
        f"{_ZENODO_BASE}/api/deposit/depositions/{dep_id}",
        params=params, headers=headers, json=metadata, timeout=30,
    )
    r.raise_for_status()

    # 5. Publish
    r = httpx.post(
        f"{_ZENODO_BASE}/api/deposit/depositions/{dep_id}/actions/publish",
        params=params, timeout=30,
    )
    r.raise_for_status()
    pub = r.json()

    doi = pub.get("doi") or pub.get("conceptdoi") or f"10.5281/zenodo.{dep_id}"
    url = pub.get("links", {}).get("record_html", f"{_ZENODO_BASE}/record/{dep_id}")
    record_id = str(pub.get("id", dep_id))
    return doi, url, record_id


# ---------------------------------------------------------------------------
# Simulated fallback (for figshare / OSF / when no token)
# ---------------------------------------------------------------------------

_REPOSITORY_SPECS: dict = {
    "zenodo":   {"base_url": "https://zenodo.org/record/",                "doi_prefix": "10.5281/zenodo."},
    "figshare": {"base_url": "https://figshare.com/articles/dataset/",   "doi_prefix": "10.6084/m9.figshare."},
    "osf":      {"base_url": "https://osf.io/",                           "doi_prefix": "10.17605/OSF.IO/"},
}

def _without_invented_doi(pub: dict) -> dict:
    """Publications that never reached a repository are drafts, whatever older versions recorded."""
    return {**pub, "status": "draft", "doi": None, "url": None, "published_at": None}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

VALID_REPOS = list(_REPOSITORY_SPECS.keys())


@router.post("/publish", response_model=DatasetPublication)
def publish_dataset(body: PublishRequest, db: Session = Depends(get_db)):
    if body.repository not in VALID_REPOS:
        raise HTTPException(422, detail=f"repository must be one of {VALID_REPOS}")
    if not body.run_ids:
        raise HTTPException(422, detail="run_ids must not be empty")
    if not body.authors:
        raise HTTPException(422, detail="authors must not be empty")
    if not body.title.strip():
        raise HTTPException(422, detail="title must not be empty")

    pub_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    real = False
    doi: Optional[str] = None
    url: Optional[str] = None
    status = "draft"
    published_at: Optional[str] = None

    # Attempt real Zenodo submission
    if body.repository == "zenodo" and _ZENODO_TOKEN:
        try:
            doi, url, record_id = _zenodo_publish(
                body.title, body.description, body.authors,
                body.keywords, body.license, body.run_ids, db,
            )
            real = True
            status = "published"
            published_at = datetime.now(timezone.utc).isoformat()
        except Exception as exc:
            # Stays a draft: the repository didn't take it.
            pass

    file_size_mb = 0.0  # known once a repository has the files
    record_count = len(body.run_ids)

    pub = DatasetPublication(
        pub_id=pub_id, title=body.title, description=body.description,
        repository=body.repository, license=body.license, keywords=body.keywords,
        authors=body.authors, run_ids=body.run_ids, status=status,
        doi=doi, url=url, file_size_mb=file_size_mb, record_count=record_count,
        created_at=now, published_at=published_at, real_submission=real,
    )
    store_put(db, NS_PUBLICATIONS, pub_id, pub.model_dump())
    return pub


@router.get("/publications")
def list_publications(db: Session = Depends(get_db)):
    records = store_list(db, NS_PUBLICATIONS)
    pubs = []
    for p in records:
        p = dict(p)
        if not p.get("real_submission"):
            p = _without_invented_doi(p)
        pubs.append(p)
    return {"count": len(pubs), "publications": pubs}


@router.get("/publication/{pub_id}", response_model=DatasetPublication)
def get_publication(pub_id: str, db: Session = Depends(get_db)):
    pub = store_get(db, NS_PUBLICATIONS, pub_id)
    if not pub:
        raise HTTPException(404, "publication not found")
    pub = dict(pub)
    if not pub.get("real_submission"):
        pub = _without_invented_doi(pub)
    return pub


@router.post("/{pub_id}/mint-doi", response_model=DOIMintResult)
def mint_doi(pub_id: str, db: Session = Depends(get_db)):
    pub = store_get(db, NS_PUBLICATIONS, pub_id)
    if not pub:
        raise HTTPException(404, "publication not found")
    pub = dict(pub)

    if pub.get("doi") and pub.get("real_submission"):
        return DOIMintResult(
            pub_id=pub_id, doi=pub["doi"], url=pub["url"] or "",
            record_id=pub["doi"].split(".")[-1],
            minted_at=pub.get("published_at", datetime.now(timezone.utc).isoformat()),
            real_submission=pub.get("real_submission", False),
        )

    # Try real Zenodo mint if not yet submitted
    real = False
    if pub.get("repository") == "zenodo" and _ZENODO_TOKEN and not pub.get("real_submission"):
        try:
            doi, url, record_id = _zenodo_publish(
                pub["title"], pub.get("description", ""), pub["authors"],
                pub.get("keywords", []), pub.get("license", "CC-BY-4.0"),
                pub["run_ids"], db,
            )
            real = True
        except Exception:
            doi, url, record_id = None, None, None

        if doi:
            pub.update({"doi": doi, "url": url, "status": "published",
                        "published_at": datetime.now(timezone.utc).isoformat(),
                        "real_submission": True})
            store_put(db, NS_PUBLICATIONS, pub_id, pub)
            return DOIMintResult(pub_id=pub_id, doi=doi, url=url, record_id=record_id,
                                 minted_at=pub["published_at"], real_submission=True)

    raise HTTPException(
        503,
        "No DOI was created. Publishing needs a Zenodo token (ZENODO_TOKEN on the server), "
        "or Zenodo refused the deposit.",
    )
