"""Dataset Publishing — mint DOIs and publish experimental datasets to open repositories."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/dataset-publish", tags=["dataset_publish"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_PUBLICATIONS = "dataset_publications"

# ---------------------------------------------------------------------------
# Repository definitions
# ---------------------------------------------------------------------------

_REPOSITORY_SPECS: dict[str, dict] = {
    "zenodo": {
        "base_url": "https://zenodo.org/record/",
        "doi_prefix": "10.5281/zenodo.",
        "api_endpoint": "https://zenodo.org/api/deposit/depositions",
    },
    "figshare": {
        "base_url": "https://figshare.com/articles/dataset/",
        "doi_prefix": "10.6084/m9.figshare.",
        "api_endpoint": "https://api.figshare.com/v2/account/articles",
    },
    "osf": {
        "base_url": "https://osf.io/",
        "doi_prefix": "10.17605/OSF.IO/",
        "api_endpoint": "https://api.osf.io/v2/nodes/",
    },
}

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


_PUB_NOTE = "This is a simulated publication record — no data was uploaded to Zenodo/figshare/OSF"


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
    is_simulated: bool = True
    note: str = _PUB_NOTE


class DOIMintResult(BaseModel):
    pub_id: str
    doi: str
    url: str
    record_id: str
    minted_at: str
    is_simulated: bool = True
    note: str = _PUB_NOTE


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class PublishRequest(BaseModel):
    title: str
    description: str
    repository: str
    license: str
    keywords: List[str]
    authors: List[str]
    run_ids: List[str]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _estimate_file_size(run_ids: List[str]) -> float:
    base_mb_per_run = random.uniform(1.2, 8.5)
    return round(len(run_ids) * base_mb_per_run, 2)


def _estimate_record_count(run_ids: List[str]) -> int:
    records_per_run = random.randint(512, 8192)
    return len(run_ids) * records_per_run


def _generate_record_id(repository: str) -> str:
    if repository == "zenodo":
        return str(random.randint(8_000_000, 12_000_000))
    elif repository == "figshare":
        return str(random.randint(20_000_000, 30_000_000))
    else:
        node_chars = "abcdefghjkmnpqrstvwxyz23456789"
        return "".join(random.choices(node_chars, k=5)).upper()


def _build_doi(repository: str, record_id: str) -> str:
    # Uses the 10.00000 prefix (unregistered) so the DOI is clearly non-resolvable.
    return f"10.00000/test-{repository}-{record_id}"


def _build_url(repository: str, record_id: str) -> str:
    spec = _REPOSITORY_SPECS.get(repository, _REPOSITORY_SPECS["zenodo"])
    return f"{spec['base_url']}{record_id}"


def _simulate_status_progression(pub: dict, db: Session) -> dict:
    """Simulate async status progression based on age of the record."""
    created_at = datetime.fromisoformat(pub["created_at"])
    now = datetime.now(timezone.utc)
    age_seconds = (now - created_at).total_seconds()

    if pub["status"] in ("published", "failed"):
        return pub

    if age_seconds < 5:
        pub["status"] = "pending"
    elif age_seconds < 15:
        pub["status"] = "minting"
    else:
        # Auto-complete if still in progress (simulated background task)
        pub["status"] = "published"
        if not pub.get("doi"):
            record_id = _generate_record_id(pub["repository"])
            pub["doi"] = _build_doi(pub["repository"], record_id)
            pub["url"] = _build_url(pub["repository"], record_id)
            pub["published_at"] = datetime.now(timezone.utc).isoformat()
        store_put(db, NS_PUBLICATIONS, pub["pub_id"], pub)

    return pub


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/publish", response_model=DatasetPublication)
def publish_dataset(body: PublishRequest, db: Session = Depends(get_db)):
    """Submit a dataset for publication to an open repository."""
    valid_repos = list(_REPOSITORY_SPECS.keys())
    if body.repository not in valid_repos:
        raise HTTPException(
            status_code=422,
            detail=f"repository must be one of {valid_repos}",
        )
    if not body.run_ids:
        raise HTTPException(status_code=422, detail="run_ids must not be empty")
    if not body.authors:
        raise HTTPException(status_code=422, detail="authors must not be empty")
    if not body.title.strip():
        raise HTTPException(status_code=422, detail="title must not be empty")

    pub_id = str(uuid.uuid4())
    file_size_mb = _estimate_file_size(body.run_ids)
    record_count = _estimate_record_count(body.run_ids)

    publication = DatasetPublication(
        pub_id=pub_id,
        title=body.title,
        description=body.description,
        repository=body.repository,
        license=body.license,
        keywords=body.keywords,
        authors=body.authors,
        run_ids=body.run_ids,
        status="pending",
        doi=None,
        url=None,
        file_size_mb=file_size_mb,
        record_count=record_count,
        created_at=datetime.now(timezone.utc).isoformat(),
        published_at=None,
    )
    store_put(db, NS_PUBLICATIONS, pub_id, publication.model_dump())
    return publication


@router.get("/publications")
def list_publications(db: Session = Depends(get_db)):
    """List all dataset publications."""
    records = store_list(db, NS_PUBLICATIONS)
    pubs = [_simulate_status_progression(dict(p), db) for p in records]
    return {"count": len(pubs), "publications": pubs}


@router.get("/publication/{pub_id}", response_model=DatasetPublication)
def get_publication(pub_id: str, db: Session = Depends(get_db)):
    """Retrieve a publication and simulate status progression."""
    pub = store_get(db, NS_PUBLICATIONS, pub_id)
    if not pub:
        raise HTTPException(status_code=404, detail="publication not found")
    pub = _simulate_status_progression(dict(pub), db)
    return pub


@router.post("/{pub_id}/mint-doi", response_model=DOIMintResult)
def mint_doi(pub_id: str, db: Session = Depends(get_db)):
    """Mint a DOI for a dataset publication and mark it as published."""
    pub = store_get(db, NS_PUBLICATIONS, pub_id)
    if not pub:
        raise HTTPException(status_code=404, detail="publication not found")
    if pub.get("doi"):
        return DOIMintResult(
            pub_id=pub_id,
            doi=pub["doi"],
            url=pub["url"],
            record_id=pub["doi"].split(".")[-1],
            minted_at=pub.get("published_at", datetime.now(timezone.utc).isoformat()),
        )

    record_id = _generate_record_id(pub["repository"])
    doi = _build_doi(pub["repository"], record_id)
    url = _build_url(pub["repository"], record_id)
    minted_at = datetime.now(timezone.utc).isoformat()

    pub["doi"] = doi
    pub["url"] = url
    pub["status"] = "published"
    pub["published_at"] = minted_at
    store_put(db, NS_PUBLICATIONS, pub_id, pub)

    return DOIMintResult(
        pub_id=pub_id,
        doi=doi,
        url=url,
        record_id=record_id,
        minted_at=minted_at,
    )
