"""Verify this run: checks anyone can repeat on a run's stored record.

Each check says what was compared with what, and passes, fails, or can't be made (with why).
Nothing here trusts the dashboard: the record digest lets a downloaded copy be compared byte for
byte, the circuit hash is recomputed from the stored QASM, the result is recomputed from the
stored counts and circuit, and hardware-board runs are matched against the job table only this
server writes.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import HardwareBoardJob, Run
from ..run_answer import measure
from ..run_diff import counts_of
from .build_info import backend_commit

router = APIRouter(tags=["verify"])

# The fields that make up a run's record, in a fixed order.
RECORD_FIELDS = ("run_id", "circuit_name", "backend", "status", "project_slug", "qasm", "fingerprint", "context",
                 "parameters", "execution", "calibration", "transpiler", "timing", "results", "tags")


def canonical_record(run: Run) -> dict[str, Any]:
    rec = {f: getattr(run, f) for f in RECORD_FIELDS}
    rec["created_at"] = run.created_at.isoformat() if run.created_at else None
    return rec


def record_digest(run: Run) -> str:
    text = json.dumps(canonical_record(run), sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _check(cid: str, title: str, status: str, detail: str) -> dict[str, str]:
    return {"id": cid, "title": title, "status": status, "detail": detail}


@router.get("/api/v1/runs/{run_id}/verify")
def verify_run(run_id: str, db: Session = Depends(get_db)):
    # Run queries are scoped to the caller (app/run_scope.py): only runs you can open are verifiable here.
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    checks: list[dict[str, str]] = []

    # 1. The circuit hash the SDK recorded at capture, against the stored circuit.
    stated = (run.fingerprint or {}).get("qasm_sha256")
    if not run.qasm:
        checks.append(_check("circuit_hash", "The stored circuit matches its recorded hash", "cant",
                             "No circuit (QASM) was stored with this run."))
    elif not stated:
        checks.append(_check("circuit_hash", "The stored circuit matches its recorded hash", "cant",
                             "The run was recorded without a circuit hash, so there is nothing to compare with."))
    else:
        actual = hashlib.sha256(run.qasm.encode("utf-8")).hexdigest()
        ok = actual == stated
        checks.append(_check("circuit_hash", "The stored circuit matches its recorded hash", "pass" if ok else "fail",
                             f"SHA-256 of the stored QASM is {actual}; the hash recorded at capture is {stated}."
                             + ("" if ok else " They differ: the circuit text changed after capture.")))

    # 2. Shots: the counts add up to the shots the run says it took.
    counts = counts_of(run)
    shots = run.shots
    if not counts:
        checks.append(_check("shots", "The results add up to the shots taken", "cant", "No measured counts were stored."))
    elif shots is None:
        checks.append(_check("shots", "The results add up to the shots taken", "cant",
                             f"The counts total {sum(counts.values())}, but the run didn't record how many shots it asked for."))
    else:
        total = sum(counts.values())
        checks.append(_check("shots", "The results add up to the shots taken", "pass" if total == shots else "fail",
                             f"The counts total {total}; the run asked for {shots} shots."))

    # 3. The headline number, recomputed from the stored counts and circuit.
    m = measure(run)
    if m is None:
        checks.append(_check("result", "The headline result can be recomputed", "cant", "There are no counts to compute it from."))
    elif m["kind"] == "ideal_share":
        checks.append(_check("result", "The headline result can be recomputed", "pass",
                             f"{m['value'] * 100:.2f}% of {m['shots']} shots are on outcomes the noise-free circuit can produce "
                             f"({', '.join(m['ideal_outcomes'][:8])}{'…' if len(m['ideal_outcomes']) > 8 else ''}), "
                             f"from the {m['ideal_source']}. Hellinger fidelity {m['hellinger_fidelity']:.4f}."))
    else:
        checks.append(_check("result", "The headline result can be recomputed", "cant",
                             f"There is no ideal distribution to compare with ({m['ideal_source']}); "
                             f"the most common outcome, {m['top_outcome']}, has {m['value'] * 100:.2f}% of shots."))

    # 4. Hardware-board runs: recorded by this server's own benchmark job, not uploaded.
    if (run.context or {}).get("source") == "hardware-board" or run.run_id.startswith("hwb-"):
        job_id = (run.execution or {}).get("job_id")
        job = db.scalar(select(HardwareBoardJob).where(HardwareBoardJob.job_id == job_id)) if job_id else None
        mine = job is not None and any(r.get("run_id") == run.run_id for r in (job.results or []))
        if mine and job is not None:
            sim = " It ran on a simulator (preview), not real hardware." if job.simulated else ""
            checks.append(_check("board", "Recorded by this server's hardware benchmark", "pass",
                                 f"IBM job {job.job_id} on {job.backend} was submitted by this Q-Lab server itself and lists this run.{sim} "
                                 "The job id can be looked up in IBM Quantum by anyone with access to that account."))
        else:
            checks.append(_check("board", "Recorded by this server's hardware benchmark", "fail",
                                 "This run looks like a hardware-board run, but no benchmark job this server submitted lists it. "
                                 "It was uploaded through the run API, not measured by the board."))

    commit = backend_commit()
    return {
        "run_id": run.run_id,
        "record_sha256": record_digest(run),
        "record_fields": list(RECORD_FIELDS) + ["created_at"],
        "record": canonical_record(run),
        "how_to_recompute": ("python -c \"import json,hashlib,sys; r=json.load(sys.stdin)['record']; "
                             "print(hashlib.sha256(json.dumps(r,sort_keys=True,separators=(',',':'),ensure_ascii=False)"
                             ".encode()).hexdigest())\" < verify.json"),
        "checks": checks,
        "checked_by": {"commit": commit, "source": "https://github.com/soqlab/Q-lab"},
        "passed": all(c["status"] != "fail" for c in checks),
    }
