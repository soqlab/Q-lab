"""Circuit unit testing — store and retrieve assertion results per run.

SDK usage::

    run_id = qlab.track(qc, backend="ibm_brisbane")
    job = sampler.run([qc])
    result = job.result()
    qlab.log_result(run_id, result)

    # Assert expected outcomes
    qlab.expect(run_id, state="00", min_prob=0.45, label="Bell |00⟩")
    qlab.expect(run_id, state="11", min_prob=0.45, label="Bell |11⟩")
    qlab.expect(run_id, state="01", max_prob=0.05, label="No leakage")
"""
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run, RunAssertion

router = APIRouter(tags=["assertions"])


class AssertionPayload(BaseModel):
    label: Optional[str] = None
    assertion_type: str = "min_prob"   # "min_prob" | "max_prob" | "range_prob" | "custom"
    state: Optional[str] = None
    expected_min: Optional[float] = None
    expected_max: Optional[float] = None
    actual_value: Optional[float] = None
    passed: Optional[bool] = None
    message: Optional[str] = None


class AssertionBatch(BaseModel):
    assertions: List[AssertionPayload]


def _find_run(db: Session, run_id: str) -> Run:
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _assertion_to_dict(a: RunAssertion) -> dict[str, Any]:
    return {
        "id": a.id,
        "run_id": a.run_id,
        "label": a.label,
        "assertion_type": a.assertion_type,
        "state": a.state,
        "expected_min": a.expected_min,
        "expected_max": a.expected_max,
        "actual_value": a.actual_value,
        "passed": a.passed,
        "message": a.message,
        "created_at": a.created_at.isoformat(),
    }


@router.post("/api/v1/runs/{run_id}/assertions")
def submit_assertions(
    run_id: str,
    payload: AssertionBatch,
    db: Session = Depends(get_db),
):
    _find_run(db, run_id)
    created = []
    for item in payload.assertions:
        a = RunAssertion(
            run_id=run_id,
            label=item.label,
            assertion_type=item.assertion_type,
            state=item.state,
            expected_min=item.expected_min,
            expected_max=item.expected_max,
            actual_value=item.actual_value,
            passed=item.passed,
            message=item.message,
        )
        db.add(a)
        created.append(a)
    db.commit()
    for a in created:
        db.refresh(a)

    all_passed = all(a.passed for a in created if a.passed is not None)
    any_failed = any(a.passed is False for a in created)

    return {
        "run_id": run_id,
        "submitted": len(created),
        "passed": sum(1 for a in created if a.passed is True),
        "failed": sum(1 for a in created if a.passed is False),
        "pending": sum(1 for a in created if a.passed is None),
        "overall": "passed" if all_passed and not any_failed and created else (
            "failed" if any_failed else "pending"
        ),
        "assertions": [_assertion_to_dict(a) for a in created],
    }


@router.get("/api/v1/runs/{run_id}/assertions")
def get_assertions(run_id: str, db: Session = Depends(get_db)):
    _find_run(db, run_id)
    rows = db.scalars(
        select(RunAssertion)
        .where(RunAssertion.run_id == run_id)
        .order_by(RunAssertion.created_at.asc())
    ).all()

    all_passed = all(a.passed for a in rows if a.passed is not None)
    any_failed = any(a.passed is False for a in rows)

    return {
        "run_id": run_id,
        "total": len(rows),
        "passed": sum(1 for a in rows if a.passed is True),
        "failed": sum(1 for a in rows if a.passed is False),
        "pending": sum(1 for a in rows if a.passed is None),
        "overall": "passed" if all_passed and not any_failed and rows else (
            "failed" if any_failed else ("pending" if rows else "none")
        ),
        "assertions": [_assertion_to_dict(a) for a in rows],
    }


@router.delete("/api/v1/runs/{run_id}/assertions")
def clear_assertions(run_id: str, db: Session = Depends(get_db)):
    _find_run(db, run_id)
    rows = db.scalars(select(RunAssertion).where(RunAssertion.run_id == run_id)).all()
    for a in rows:
        db.delete(a)
    db.commit()
    return {"deleted": len(rows), "run_id": run_id}
