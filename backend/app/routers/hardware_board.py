"""The hardware board's API: public readings of real IBM machines and the benchmark results.

Public (no sign-in) because the board is the same for everyone and shows only data the server
measured itself. The paths sit under /api/v1/public/, which run_scope leaves unscoped.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import hardware_board as hb
from ..database import get_db
from ..deps import Identity, log_audit, require_role

router = APIRouter(tags=["hardware-board"])

BACKEND_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,60}$")


@router.get("/api/v1/public/hardware-board")
def hardware_board(db: Session = Depends(get_db)):
    return hb.board(db)


@router.get("/api/v1/public/hardware-board/{backend}")
def hardware_board_backend(backend: str, db: Session = Depends(get_db)):
    if not BACKEND_RE.match(backend):
        raise HTTPException(status_code=404, detail="Not a backend name")
    return hb.board(db, backend=backend)


@router.post("/api/v1/hardware-board/run-now")
def run_now(identity: Identity = Depends(require_role("owner")), db: Session = Depends(get_db)):
    """Submit the benchmark now instead of waiting for it to be due (server owner only)."""
    if not hb.configured():
        raise HTTPException(status_code=409, detail="No IBM Quantum key on this server (QISKIT_IBM_TOKEN).")
    result = hb.tick(db, force=True)
    log_audit(db, "hardware_board.run_now", "hardware_board", ",".join(result["submitted"]) or "none", identity=identity)
    return result


@router.on_event("startup")
def _start_board_scheduler() -> None:
    from ..database import SessionLocal
    hb.start_scheduler(SessionLocal)


@router.on_event("shutdown")
def _stop_board_scheduler() -> None:
    hb.stop_scheduler()
