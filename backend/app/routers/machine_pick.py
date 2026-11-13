"""Pick the machine before you run (app/machine_pick.py) and the drift alarm (app/drift.py).

POST /api/v1/machine-pick needs a signed-in caller (it transpiles for every machine, so it costs CPU),
is rate-limited per address, and runs at most two at a time on the server. A run's circuit can be
used instead of pasted text; that run is found with a Run query, which app/run_scope.py limits to
runs the caller can see.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import drift as drift_mod
from .. import hardware_board as hb
from .. import machine_pick as mp
from ..database import get_db
from ..deps import Identity, require_auth
from ..models import Run
from ..rate_limit import pick_limiter
from ..run_answer import LEVELS

router = APIRouter(tags=["machine-pick"])

def _level(level: str) -> str:
    if level not in LEVELS:
        raise HTTPException(status_code=422, detail=f"level must be one of {', '.join(LEVELS)}")
    return level


class PickRequest(BaseModel):
    qasm: Optional[str] = Field(default=None, max_length=mp.MAX_QASM_BYTES)
    run_id: Optional[str] = Field(default=None, max_length=64)
    level: str = "standard"


@router.get("/api/v1/machine-pick/calibration")
def calibration_status():
    """Whether there is calibration to estimate from, without reading any circuit."""
    if not hb.configured():
        return {"available": False, "simulated": False, "reason": "no_key",
                "sentence": mp.no_calibration_answer({"message": "no_key"})["sentence"]}
    live = hb.live_status(wait_s=5.0)
    up = [b for b in live.get("backends", []) if b.get("operational")]
    return {"available": bool(up), "simulated": hb.simulated(), "reason": None if up else (live.get("error") or "no_machines"),
            "machines": [{"name": b["name"], "num_qubits": b.get("num_qubits"), "pending_jobs": b.get("pending_jobs"),
                          "calibrated_at": (b.get("calibration") or {}).get("last_update")} for b in up],
            "read_at": live.get("fetched_at")}


def _circuit_text(db: Session, body: PickRequest) -> tuple[str, Optional[dict]]:
    if body.run_id:
        run = db.scalar(select(Run).where(Run.run_id == body.run_id))
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        text = drift_mod.logical_text(run) or run.qasm
        if not text:
            raise HTTPException(status_code=422, detail="That run has no circuit recorded, so it can't be estimated.")
        return text, {"run_id": run.run_id, "circuit_name": run.circuit_name, "backend": run.backend,
                      "source": "the circuit given to transpile()" if drift_mod.logical_text(run) else "the circuit that ran"}
    if not body.qasm:
        raise HTTPException(status_code=422, detail="Paste an OpenQASM 2 or 3 circuit, or pick one of your runs.")
    return body.qasm, None


@router.post("/api/v1/machine-pick", dependencies=[Depends(pick_limiter)])
def pick_machine(body: PickRequest, identity: Identity = Depends(require_auth), db: Session = Depends(get_db)):
    level = _level(body.level)
    text, from_run = _circuit_text(db, body)
    try:
        circuit = mp.parse_circuit(text)
        size = mp.check_size(circuit)
    except mp.CircuitError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    def work():
        source = mp.load_snapshots()
        return mp.estimate(circuit, source, level, circuit_key=mp.normalized_hash(text))

    out = mp.run_with_budget(work)
    if out is None:
        raise HTTPException(status_code=503, detail="Two estimates are already running on this server; try again in a few seconds.",
                            headers={"Retry-After": "5"})
    return {**out, "circuit": size, "from_run": from_run,
            "limits": {"qubits": mp.MAX_QUBITS, "operations": mp.MAX_OPERATIONS, "two_qubit_gates": mp.MAX_TWO_QUBIT,
                       "seconds": mp.BUDGET_S}}


@router.get("/api/v1/runs/{run_id}/drift")
def run_drift(run_id: str, level: str = Query(default="standard"), db: Session = Depends(get_db)):
    """Did the same circuit on the same backend give a different result last time, and why."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return drift_mod.drift_for(db, run, _level(level))  # type: ignore[arg-type]
