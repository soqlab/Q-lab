"""FAIR Data Tools — legacy generate/validate endpoints + new compliance checker + carbon.

This module acts as an aggregator so that three separate feature routers can be
registered without modifying main.py.  main.py already imports this module and
calls  app.include_router(fair_data_router.router).

Exposed prefixes:
  /api/v1/fair-data  — original RO-Crate / Zenodo metadata generation
  /api/v1/fair       — FAIR compliance checker (new)
  /api/v1/carbon     — Circuit carbon footprint estimator (new)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..deps import Identity, require_auth
from ..ownership import mine, owned_by, owner_key
from ..store import store_put, store_get, store_list

# ---------------------------------------------------------------------------
# Original fair-data sub-router
# ---------------------------------------------------------------------------

_fair_data_router = APIRouter(prefix="/api/v1/fair-data", tags=["fair-data"])


class FAIRGenerateRequest(BaseModel):
    run_id: Optional[str] = None
    title: str
    description: str
    algorithm: str
    backend: str
    n_qubits: int
    n_shots: int
    fidelity: Optional[float] = None
    run_ids: Optional[list[str]] = None


class FAIRValidateRequest(BaseModel):
    metadata: dict


NOT_MINTED = "not minted"  # A DOI only exists once a repository issues one: never invent it.


def _make_ro_crate(req: FAIRGenerateRequest, doi: str) -> dict:
    return {
        "@context": "https://w3id.org/ro/crate/1.1/context",
        "@graph": [
            {
                "@type": "CreativeWork",
                "@id": "ro-crate-metadata.json",
                "conformsTo": {"@id": "https://w3id.org/ro/crate/1.1"},
                "about": {"@id": "./"},
            },
            {
                "@type": "Dataset",
                "@id": "./",
                "identifier": doi,
                "name": req.title,
                "description": req.description,
                "datePublished": datetime.now(timezone.utc).isoformat(),
                "license": {"@id": "https://creativecommons.org/licenses/by/4.0/"},
                "keywords": ["quantum computing", req.algorithm, req.backend, "FAIR data"],
                "variableMeasured": [
                    {"@type": "PropertyValue", "name": "n_qubits", "value": req.n_qubits},
                    {"@type": "PropertyValue", "name": "n_shots", "value": req.n_shots},
                    {"@type": "PropertyValue", "name": "fidelity", "value": req.fidelity},
                ],
                "hasPart": [{"@id": "experiment_results.json"}, {"@id": "circuit.qasm"}],
            },
            {
                "@type": "SoftwareApplication",
                "@id": "https://qiskit.org",
                "name": "Qiskit",
                "version": "1.x",
            },
        ],
    }


def _make_datacite_xml(req: FAIRGenerateRequest, doi: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y")
    return (
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<resource xmlns="http://datacite.org/schema/kernel-4">\n'
        f"  <identifier identifierType=\"DOI\">{doi}</identifier>\n"
        f"  <titles><title>{req.title}</title></titles>\n"
        f"  <descriptions><description descriptionType=\"Abstract\">{req.description}</description></descriptions>\n"
        f"  <resourceType resourceTypeGeneral=\"Dataset\">Quantum Experiment Dataset</resourceType>\n"
        f"  <subjects>\n"
        f"    <subject>Quantum Computing</subject>\n"
        f"    <subject>{req.algorithm}</subject>\n"
        f"    <subject>{req.backend}</subject>\n"
        f"  </subjects>\n"
        f"  <publicationYear>{now}</publicationYear>\n"
        f"  <rightsList><rights rightsURI=\"https://creativecommons.org/licenses/by/4.0/\">CC-BY 4.0</rights></rightsList>\n"
        f"  <relatedIdentifiers>\n"
        f"    <relatedIdentifier relatedIdentifierType=\"URL\" relationType=\"IsDocumentedBy\">https://qlab.io/experiments/{req.run_id or 'N/A'}</relatedIdentifier>\n"
        f"  </relatedIdentifiers>\n"
        f"</resource>"
    )


def _make_zenodo_metadata(req: FAIRGenerateRequest) -> dict:
    return {
        "upload_type": "dataset",
        "title": req.title,
        "description": req.description,
        "access_right": "open",
        "license": "cc-by",
        "keywords": ["quantum computing", req.algorithm, req.backend, "FAIR", "Qiskit"],
        "related_identifiers": [],
        "custom": {
            "quantum:backend": req.backend,
            "quantum:algorithm": req.algorithm,
            "quantum:n_qubits": req.n_qubits,
            "quantum:n_shots": req.n_shots,
            "quantum:fidelity": req.fidelity,
        },
    }


def _checklist_items(req: FAIRGenerateRequest) -> list[tuple[str, str, bool, str]]:
    """(FAIR dimension, item, satisfied, recommendation), judged on what this record really has."""
    linked = bool(req.run_id or req.run_ids)
    return [
        ("findable", "Persistent identifier (DOI) assigned", False, "Deposit on Zenodo to get a DOI"),
        ("findable", "Metadata deposited in a searchable registry", False, "Publish the record on Zenodo or another repository"),
        ("findable", "Rich metadata (title, description, algorithm, backend)", bool(req.title and req.description), "Fill in title and description"),
        ("accessible", "Data retrievable over a standard protocol (HTTPS)", False, "Deposit the data so it has a public URL"),
        ("interoperable", "Metadata uses a community vocabulary (schema.org via RO-Crate)", True, "Already included"),
        ("interoperable", "DataCite XML exported", True, "Already included"),
        ("reusable", "License stated (CC-BY 4.0)", True, "Already included"),
        ("reusable", "Provenance: linked to recorded runs", linked, "Generate the record from a run (run_id)"),
        ("reusable", "Result figure recorded (fidelity)", req.fidelity is not None, "Add the measured fidelity"),
    ]


def _fair_score(req: FAIRGenerateRequest) -> dict:
    """Each dimension: the fraction of its checklist items this record satisfies."""
    items = _checklist_items(req)
    score = {}
    for dim in ("findable", "accessible", "interoperable", "reusable"):
        mine = [ok for d, _, ok, _ in items if d == dim]
        score[dim] = round(sum(mine) / len(mine), 3)
    score["total"] = round(sum(score[d] for d in ("findable", "accessible", "interoperable", "reusable")) / 4, 3)
    return score


def _checklist(req: FAIRGenerateRequest) -> list[dict]:
    return [{"item": item, "done": ok, "recommendation": rec} for _, item, ok, rec in _checklist_items(req)]


@_fair_data_router.post("/generate")
def generate_fair_record(req: FAIRGenerateRequest, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    record_id = str(uuid.uuid4())
    doi = NOT_MINTED
    score = _fair_score(req)
    record = {
        "record_id": record_id,
        "doi": doi,
        "ro_crate_json": _make_ro_crate(req, doi),
        "datacite_xml": _make_datacite_xml(req, doi),
        "zenodo_metadata": _make_zenodo_metadata(req),
        "fair_score": score,
        "checklist": _checklist(req),
        "landing_page_url": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "_meta": req.model_dump(),
        "owner": owner_key(identity),
    }
    store_put(db, "fair_data_record", record_id, record)
    return {k: v for k, v in record.items() if k not in ("_meta", "owner")}


@_fair_data_router.post("/validate")
def validate_fair(req: FAIRValidateRequest):
    m = req.metadata
    has_id = "doi" in m or "identifier" in m
    has_title = "title" in m
    has_description = "description" in m
    has_license = "license" in m
    has_keywords = "keywords" in m
    findable = round((0.5 * has_id + 0.3 * has_title + 0.2 * has_keywords), 3)
    accessible = round(0.6 + 0.4 * has_id, 3)
    interoperable = round(0.5 + 0.3 * has_description + 0.2 * has_keywords, 3)
    reusable = round(0.4 + 0.4 * has_license + 0.2 * has_description, 3)
    total = round((findable + accessible + interoperable + reusable) / 4, 3)
    return {
        "valid": total > 0.6,
        "fair_score": {
            "findable": findable, "accessible": accessible,
            "interoperable": interoperable, "reusable": reusable, "total": total,
        },
        "missing_fields": [
            f for f, present in [
                ("doi/identifier", has_id), ("title", has_title),
                ("description", has_description), ("license", has_license),
                ("keywords", has_keywords),
            ] if not present
        ],
    }


@_fair_data_router.get("/{record_id}")
def get_record(record_id: str, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    r = store_get(db, "fair_data_record", record_id)
    if not owned_by(r, identity):
        raise HTTPException(status_code=404, detail="FAIR record not found")
    return {k: v for k, v in r.items() if k not in ("_meta", "owner")}


@_fair_data_router.get("/")
def list_records(identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    return [
        {
            "record_id": r["record_id"],
            "doi": r["doi"],
            "landing_page_url": r["landing_page_url"],
            "fair_score": r["fair_score"]["total"],
            "created_at": r["created_at"],
        }
        for r in mine(store_list(db, "fair_data_record"), identity)
    ]


# ---------------------------------------------------------------------------
# Aggregating router — no prefix, includes all three sub-routers
# main.py does:  app.include_router(fair_data_router.router)
# so this is the object it picks up.
# ---------------------------------------------------------------------------

from . import fair as _fair_mod    # noqa: E402
from . import carbon as _carbon_mod  # noqa: E402

router = APIRouter()
router.include_router(_fair_data_router)   # /api/v1/fair-data/*
router.include_router(_fair_mod.router)    # /api/v1/fair/*
router.include_router(_carbon_mod.router)  # /api/v1/carbon/*
