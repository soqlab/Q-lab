"""Provenance certificates and the "Reproduced" badge (app/provenance/).

Signed in (the run's owner), or anyone for a shared run:
    GET /api/v1/runs/{id}/certificate                 the signed certificate (?download=1: as a file)

Public, no sign-in (a shared run's share token; unsharing makes all of these 404):
    GET /api/v1/public/verified/{token}               the verification page: state, sentence, certificate
    GET /api/v1/public/verified/{token}/certificate   the certificate alone (for the offline verifier)
    GET /api/v1/public/verified/{token}/badge.svg     the badge, showing the current state

    GET /api/v1/certificates/public-key               the key certificates are signed with
    GET /api/v1/certificates/verify.py                the offline verifier (stdlib + cryptography)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..provenance import certificate as cert
from .build_info import backend_commit

router = APIRouter(tags=["certificate"])

_GONE = "This run isn't shared (or sharing was turned off), so it has no public verification page."
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
VERIFIER = Path(__file__).resolve().parent.parent / "provenance" / "verify.py"


def _json_file(doc: dict, name: str) -> Response:
    return Response(content=json.dumps(doc, indent=2, ensure_ascii=False) + "\n", media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


def _file_name(run_id: str) -> str:
    return f"qlab-certificate-{re.sub(r'[^A-Za-z0-9_-]', '', run_id)[:16] or 'run'}.json"


@router.get("/api/v1/runs/{run_id}/certificate")
def run_certificate(run_id: str, download: bool = Query(default=False), db: Session = Depends(get_db)):
    run = cert.find_for_caller(db, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    doc = cert.issue(db, run, app_url=cert.app_url(), commit=backend_commit())
    if download:
        return _json_file(doc, _file_name(run.run_id))
    return Response(content=json.dumps(doc, ensure_ascii=False), media_type="application/json",
                    headers={"Cache-Control": "private, no-store"})


def _shared(db: Session, token: str):
    run = cert.find_shared(db, token) if _TOKEN.match(token or "") else None
    if run is None:
        raise HTTPException(status_code=404, detail=_GONE)
    return run


@router.get("/api/v1/public/verified/{token}")
def verified_page(token: str, db: Session = Depends(get_db)):
    run = _shared(db, token)
    doc = cert.issue(db, run, app_url=cert.app_url(), commit=backend_commit())
    body = doc["certificate"]
    rep = body["reproduction"]
    return {
        "token": token,
        "run": {"run_id": run.run_id, "circuit_name": body["run"]["circuit_name"], "backend": body["machine"]["backend"],
                "created_at": body["run"]["created_at"], "shots": body["settings"]["shots"],
                "share_page": f"/share/{token}"},
        "state": rep["state"],
        "sentence": rep["sentence"],
        "sentences": rep["sentences"],
        "badge": {"text": cert.badge_text(rep), "svg_path": f"/verified/{token}/badge.svg",
                  "api_svg_path": f"/api/v1/public/verified/{token}/badge.svg"},
        "certificate": doc,
        "signing": {"key_id": (doc.get("signature") or {}).get("key"), "public_key_path": "/api/v1/certificates/public-key"},
    }


@router.get("/api/v1/public/verified/{token}/certificate")
def verified_certificate(token: str, download: bool = Query(default=False), db: Session = Depends(get_db)):
    run = _shared(db, token)
    doc = cert.issue(db, run, app_url=cert.app_url(), commit=backend_commit())
    if download:
        return _json_file(doc, _file_name(run.run_id))
    return Response(content=json.dumps(doc, ensure_ascii=False), media_type="application/json",
                    headers={"Cache-Control": "no-store"})


@router.get("/api/v1/public/verified/{token}/badge.svg")
def verified_badge(token: str, db: Session = Depends(get_db)):
    run = cert.find_shared(db, token) if _TOKEN.match(token or "") else None
    if run is None:
        # An image, so a dead badge in a paper or README says so instead of showing a broken image.
        gone = {"state": "not_yet", "agreed": 0, "disagreed": 0, "sentence": _GONE}
        svg = cert.badge_svg(gone, "not shared")
        return Response(content=svg, status_code=404, media_type="image/svg+xml",
                        headers={"Cache-Control": "no-cache, max-age=0"})
    rep = cert.reproduction(db, run, cert.app_url())
    # Reflects the current state: caches (GitHub's image proxy too) are asked to check back.
    return Response(content=cert.badge_svg(rep), media_type="image/svg+xml",
                    headers={"Cache-Control": "no-cache, max-age=0"})


@router.get("/api/v1/certificates/public-key")
def certificate_public_key():
    return cert.public_key()


@router.get("/api/v1/certificates/verify.py")
def certificate_verifier():
    return Response(content=VERIFIER.read_text(encoding="utf-8"), media_type="text/x-python; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="verify_certificate.py"'})
