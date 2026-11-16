"""SOQLAB Witness receipts: read-only API. There are no update or delete endpoints, by design."""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Receipt, Run
from ..run_scope import current_scope, visible
from ..witness.receipt import receipt_digest
from ..witness_service import keys_document, receipt_status, run_data

router = APIRouter(tags=["witness"])


def _latest_for_run(db: Session, run_id: str) -> Optional[Receipt]:
    return db.scalar(select(Receipt).where(Receipt.run_id == run_id).order_by(Receipt.seq.desc()).limit(1))


def _run_is_shared(db: Session, run_id: str) -> bool:
    # Plain SQL: this question is about the run itself, not about what the caller may read.
    row = db.execute(text("SELECT share_token FROM runs WHERE run_id = :id"), {"id": run_id}).first()
    return bool(row and row[0])


@router.get("/.well-known/witness-keys.json", include_in_schema=False)
def witness_keys() -> Response:
    document = keys_document()
    if document is None:
        raise HTTPException(status_code=404, detail="Witness signing is not set up on this server")
    return Response(
        content=document.dumps(),
        media_type="application/json",
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300"},
    )


@router.get("/api/v1/receipts/chain/head")
def chain_head(db: Session = Depends(get_db)) -> dict[str, Any]:
    """The newest position in this server's chain. Save it to detect truncation later."""
    row = db.scalar(select(Receipt).order_by(Receipt.seq.desc()).limit(1))
    if row is None:
        return {"seq": 0, "digest": None, "issued_at": None}
    receipt = json.loads(row.body)
    return {"seq": row.seq, "digest": receipt_digest(receipt), "issued_at": receipt["issued_at"]}


@router.get("/api/v1/receipts/{receipt_id}")
def get_receipt(receipt_id: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.get(Receipt, receipt_id)
    # Same answer for hidden and missing, so that a private receipt's existence is not revealed.
    if row is None or not (
        visible(row.owner_user_id, row.org_id, current_scope()) or _run_is_shared(db, row.run_id)
    ):
        raise HTTPException(status_code=404, detail="receipt not found")
    return json.loads(row.body)


def _status_for(db: Session, run: Run) -> dict[str, Any]:
    row = _latest_for_run(db, run.run_id)
    if row is None:
        raise HTTPException(status_code=404, detail="this run has no receipt")
    history = db.scalars(select(Receipt.id).where(Receipt.run_id == run.run_id)).all()
    return {**receipt_status(db, row, run), "versions": len(history)}


@router.get("/api/v1/runs/{run_id}/receipt")
def run_receipt(run_id: str, download: bool = False, db: Session = Depends(get_db)) -> Any:
    """The newest receipt for a run, checked against what is stored right now.

    With ?download=1, the receipt alone, as the file to keep and check offline.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    if download:
        row = _latest_for_run(db, run.run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="this run has no receipt")
        return Response(
            content=json.dumps(json.loads(row.body), indent=2, ensure_ascii=False),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="receipt-{row.seq}.json"'},
        )
    return _status_for(db, run)


@router.get("/api/v1/runs/public/{share_token}/receipt")
def public_run_receipt(share_token: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    run = db.scalar(select(Run).where(Run.share_token == share_token))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return _status_for(db, run)


@router.get("/api/v1/runs/{run_id}/receipt/data/{field}")
def run_receipt_data(run_id: str, field: str, db: Session = Depends(get_db)) -> Response:
    """The exact file a digest covers, to check independently with the CLI or verify page."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    content = run_data(run).get(field)
    if content is None:
        raise HTTPException(status_code=404, detail=f"no stored data for {field}")
    is_text = field == "circuit"
    filename = f"{field}.qasm" if is_text else f"{field}.json"
    return Response(
        content=content,
        media_type="text/plain" if is_text else "application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
