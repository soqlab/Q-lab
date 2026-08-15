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
import random
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
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


def _make_doi() -> str:
    return f"10.5281/zenodo.{random.randint(7000000, 9999999)}"


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
        "related_identifiers": [
            {"relation": "isCitedBy", "identifier": "https://arxiv.org/abs/placeholder", "scheme": "url"}
        ],
        "custom": {
            "quantum:backend": req.backend,
            "quantum:algorithm": req.algorithm,
            "quantum:n_qubits": req.n_qubits,
            "quantum:n_shots": req.n_shots,
            "quantum:fidelity": req.fidelity,
        },
    }


def _fair_score(req: FAIRGenerateRequest) -> dict:
    findable = round(random.uniform(0.80, 0.97), 3)
    accessible = round(random.uniform(0.75, 0.95), 3)
    interoperable = round(random.uniform(0.70, 0.92), 3)
    reusable = round(0.6 + (0.1 if req.fidelity else 0) + random.uniform(0.05, 0.2), 3)
    reusable = min(reusable, 1.0)
    total = round((findable + accessible + interoperable + reusable) / 4, 3)
    return {
        "findable": findable,
        "accessible": accessible,
        "interoperable": interoperable,
        "reusable": reusable,
        "total": total,
    }


def _checklist(score: dict) -> list[dict]:
    items = [
        ("Persistent identifier (DOI) assigned", score["findable"] > 0.7, "Assign a DOI via Zenodo"),
        ("Metadata deposited in searchable registry", score["findable"] > 0.8, "Register on re3data.org"),
        ("Data accessible via standard protocol (HTTPS)", score["accessible"] > 0.7, "Ensure HTTPS endpoint"),
        ("Authentication documented", score["accessible"] > 0.85, "Document API token requirements"),
        ("Metadata uses community vocabulary (schema.org)", score["interoperable"] > 0.75, "Add schema.org types"),
        ("RO-Crate manifest included", True, "Already included"),
        ("DataCite XML exported", True, "Already included"),
        ("License explicitly stated (CC-BY 4.0)", score["reusable"] > 0.7, "Add LICENSE file"),
        ("Provenance recorded (circuit QASM)", score["reusable"] > 0.8, "Include circuit QASM artifact"),
        ("README with usage instructions", score["reusable"] > 0.9, "Add README.md to dataset"),
    ]
    return [{"item": i[0], "done": i[1], "recommendation": i[2]} for i in items]


@_fair_data_router.post("/generate")
def generate_fair_record(req: FAIRGenerateRequest, db: Session = Depends(get_db)):
    record_id = str(uuid.uuid4())
    doi = _make_doi()
    score = _fair_score(req)
    record = {
        "record_id": record_id,
        "doi": doi,
        "ro_crate_json": _make_ro_crate(req, doi),
        "datacite_xml": _make_datacite_xml(req, doi),
        "zenodo_metadata": _make_zenodo_metadata(req),
        "fair_score": score,
        "checklist": _checklist(score),
        "landing_page_url": f"https://zenodo.org/record/{doi.split('.')[-1]}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "_meta": req.model_dump(),
    }
    store_put(db, "fair_data_record", record_id, record)
    return {k: v for k, v in record.items() if k != "_meta"}


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
def get_record(record_id: str, db: Session = Depends(get_db)):
    r = store_get(db, "fair_data_record", record_id)
    if r is None:
        raise HTTPException(status_code=404, detail="FAIR record not found")
    return {k: v for k, v in r.items() if k != "_meta"}


@_fair_data_router.get("/")
def list_records(db: Session = Depends(get_db)):
    return [
        {
            "record_id": r["record_id"],
            "doi": r["doi"],
            "landing_page_url": r["landing_page_url"],
            "fair_score": r["fair_score"]["total"],
            "created_at": r["created_at"],
        }
        for r in store_list(db, "fair_data_record")
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
