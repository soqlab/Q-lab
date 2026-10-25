"""Pre-registration and Hypothesis Testing Framework.

Researchers declare their hypothesis BEFORE running experiments, creating a
tamper-evident, timestamped record that prevents HARKing (Hypothesizing After
Results are Known).

Router prefix: /api/v1/prereg

Registration (add to main.py):
    from .routers import preregistration as preregistration_router
    app.include_router(preregistration_router.router)
"""

from __future__ import annotations

import hashlib
import json
import secrets
import string
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..store import store_get, store_list, store_put
from ..calibration_utils import per_qubit

router = APIRouter(prefix="/api/v1/prereg", tags=["preregistration"])

_NS = "preregistrations"
_ID_CHARS = string.ascii_lowercase + string.digits


def _new_prereg_id() -> str:
    return "prereg_" + "".join(secrets.choice(_ID_CHARS) for _ in range(16))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------


class Hypothesis(BaseModel):
    metric: str  # "success_probability" | "health_score" | "gate_fidelity" | custom
    operator: str  # ">" | "<" | ">=" | "<=" | "==" | "between"
    expected_value: float
    expected_value_upper: Optional[float] = None  # only for "between"
    confidence: float = Field(ge=0.0, le=1.0)  # 0.0–1.0
    rationale: str


class PreregistrationCreate(BaseModel):
    title: str = Field(..., max_length=500)
    description: str = Field(..., max_length=5000)
    researcher_name: str = Field(..., max_length=255)
    institution: Optional[str] = Field(None, max_length=255)
    # Experiment plan
    circuit_description: str = Field(..., max_length=5000)
    backend: str = Field(..., max_length=255)
    n_qubits: int = Field(..., ge=1, le=10000)
    n_shots: int = Field(..., ge=1, le=10_000_000)
    algorithm: str = Field(..., max_length=255)
    # Hypotheses
    hypotheses: List[Hypothesis] = Field(..., min_length=1, max_length=5)
    # Statistical power
    alpha: float = Field(default=0.05, ge=0.0, le=1.0)
    minimum_effect_size: Optional[float] = None
    # Timeline
    planned_run_date: Optional[str] = None


class PreregistrationUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = Field(None, max_length=5000)
    researcher_name: Optional[str] = Field(None, max_length=255)
    institution: Optional[str] = None
    circuit_description: Optional[str] = Field(None, max_length=5000)
    backend: Optional[str] = Field(None, max_length=255)
    n_qubits: Optional[int] = Field(None, ge=1, le=10000)
    n_shots: Optional[int] = Field(None, ge=1, le=10_000_000)
    algorithm: Optional[str] = Field(None, max_length=255)
    hypotheses: Optional[List[Hypothesis]] = Field(None, max_length=5)
    alpha: Optional[float] = Field(None, ge=0.0, le=1.0)
    minimum_effect_size: Optional[float] = None
    planned_run_date: Optional[str] = None


class AbandonBody(BaseModel):
    reason: str = Field(..., max_length=2000)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_fingerprint(prereg: dict[str, Any]) -> str:
    """SHA-256 of all fields except 'fingerprint' itself (sorted keys, deterministic)."""
    data = {k: v for k, v in prereg.items() if k != "fingerprint"}
    canonical = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def _get_prereg_or_404(db: Session, prereg_id: str) -> dict[str, Any]:
    rec = store_get(db, _NS, prereg_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Pre-registration not found")
    return rec


def _evaluate_hypothesis(hyp: dict[str, Any], actual_value: float) -> dict[str, Any]:
    """Check a single hypothesis against an actual metric value."""
    op = hyp["operator"]
    ev = hyp["expected_value"]
    ev_upper = hyp.get("expected_value_upper")

    if op == ">":
        passed = actual_value > ev
    elif op == "<":
        passed = actual_value < ev
    elif op == ">=":
        passed = actual_value >= ev
    elif op == "<=":
        passed = actual_value <= ev
    elif op == "==":
        passed = abs(actual_value - ev) < 1e-9
    elif op == "between":
        if ev_upper is None:
            passed = False
        else:
            passed = ev <= actual_value <= ev_upper
    else:
        passed = False

    return {
        "metric": hyp["metric"],
        "operator": op,
        "expected_value": ev,
        "expected_value_upper": ev_upper,
        "confidence": hyp["confidence"],
        "actual_value": actual_value,
        "passed": passed,
        "rationale": hyp["rationale"],
    }


def _extract_metric(run: Run, metric: str) -> float | None:
    """Pull a named metric from a run's stored data."""
    results = run.results or {}
    calibration = run.calibration or {}
    fingerprint = run.fingerprint or {}

    # Direct results fields
    if metric == "success_probability":
        if "success_probability" in results:
            return float(results["success_probability"])
        counts = results.get("counts")
        if isinstance(counts, dict) and counts:
            total = sum(counts.values())
            if total > 0:
                return max(counts.values()) / total
        return None

    if metric == "health_score":
        from ..health_score import compute_health_score
        h = compute_health_score({
            "results": results,
            "calibration": calibration,
            "fingerprint": fingerprint,
        })
        return h

    if metric == "gate_fidelity":
        gate_errors = per_qubit(calibration.get("gate_errors"))
        if gate_errors:
            avg_err = sum(gate_errors.values()) / len(gate_errors)
            return max(0.0, 1.0 - avg_err)
        return None

    if metric == "readout_fidelity":
        ro_errors = per_qubit(calibration.get("readout_errors"))
        if ro_errors:
            avg = sum(ro_errors.values()) / len(ro_errors)
            return max(0.0, 1.0 - avg)
        return None

    # Custom metric — try results dict directly
    if metric in results:
        try:
            return float(results[metric])
        except (TypeError, ValueError):
            return None

    return None


def _run_outcome_analysis(prereg: dict[str, Any], run: Run) -> tuple[dict, str]:
    """Evaluate all hypotheses; return (outcome_dict, verdict)."""
    hyp_results = []
    any_refuted = False
    any_inconclusive = False

    for hyp in prereg["hypotheses"]:
        actual = _extract_metric(run, hyp["metric"])
        if actual is None:
            hyp_results.append({
                **hyp,
                "actual_value": None,
                "passed": None,
                "result": "inconclusive",
            })
            any_inconclusive = True
        else:
            result = _evaluate_hypothesis(hyp, actual)
            result["result"] = "confirmed" if result["passed"] else "refuted"
            hyp_results.append(result)
            if not result["passed"]:
                any_refuted = True

    if any_refuted:
        verdict = "refuted"
    elif any_inconclusive:
        verdict = "inconclusive"
    else:
        verdict = "confirmed"

    outcome = {
        "hypothesis_results": hyp_results,
        "run_id": run.run_id,
        "backend_used": run.backend,
        "analyzed_at": _now_iso(),
        "results_snapshot": {
            "success_probability": (run.results or {}).get("success_probability"),
            "health_score": _extract_metric(run, "health_score"),
        },
    }

    return outcome, verdict


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("")
def create_preregistration(
    body: PreregistrationCreate,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a draft pre-registration."""
    prereg_id = _new_prereg_id()
    now = _now_iso()

    prereg: dict[str, Any] = {
        "prereg_id": prereg_id,
        "title": body.title,
        "description": body.description,
        "researcher_name": body.researcher_name,
        "institution": body.institution,
        "circuit_description": body.circuit_description,
        "backend": body.backend,
        "n_qubits": body.n_qubits,
        "n_shots": body.n_shots,
        "algorithm": body.algorithm,
        "hypotheses": [h.model_dump() for h in body.hypotheses],
        "alpha": body.alpha,
        "minimum_effect_size": body.minimum_effect_size,
        "planned_run_date": body.planned_run_date,
        "status": "draft",
        "locked_at": None,
        "run_id": None,
        "outcome": None,
        "verdict": None,
        "fingerprint": None,
        "created_at": now,
    }

    store_put(db, _NS, prereg_id, prereg)
    return prereg


@router.put("/{prereg_id}")
def update_preregistration(
    prereg_id: str,
    body: PreregistrationUpdate,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Update a DRAFT pre-registration. Locked pre-registrations cannot be edited."""
    prereg = _get_prereg_or_404(db, prereg_id)

    if prereg["status"] != "draft":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit a pre-registration with status '{prereg['status']}'. Only drafts can be edited.",
        )

    # Build update dict manually to handle nested Hypothesis objects correctly
    update_data: dict[str, Any] = {}
    if body.title is not None:
        update_data["title"] = body.title
    if body.description is not None:
        update_data["description"] = body.description
    if body.researcher_name is not None:
        update_data["researcher_name"] = body.researcher_name
    if body.institution is not None:
        update_data["institution"] = body.institution
    if body.circuit_description is not None:
        update_data["circuit_description"] = body.circuit_description
    if body.backend is not None:
        update_data["backend"] = body.backend
    if body.n_qubits is not None:
        update_data["n_qubits"] = body.n_qubits
    if body.n_shots is not None:
        update_data["n_shots"] = body.n_shots
    if body.algorithm is not None:
        update_data["algorithm"] = body.algorithm
    if body.hypotheses is not None:
        update_data["hypotheses"] = [h.model_dump() for h in body.hypotheses]
    if body.alpha is not None:
        update_data["alpha"] = body.alpha
    if body.minimum_effect_size is not None:
        update_data["minimum_effect_size"] = body.minimum_effect_size
    if body.planned_run_date is not None:
        update_data["planned_run_date"] = body.planned_run_date

    prereg.update(update_data)
    store_put(db, _NS, prereg_id, prereg)
    return prereg


@router.post("/{prereg_id}/lock")
def lock_preregistration(
    prereg_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Lock the pre-registration. Irreversible — creates tamper-evident fingerprint."""
    prereg = _get_prereg_or_404(db, prereg_id)

    if prereg["status"] != "draft":
        raise HTTPException(
            status_code=400,
            detail=f"Only draft pre-registrations can be locked. Current status: '{prereg['status']}'.",
        )

    prereg["status"] = "locked"
    prereg["locked_at"] = _now_iso()
    prereg["fingerprint"] = None  # Clear before computing

    # Compute fingerprint over all content (fingerprint field is None during this)
    fingerprint = _compute_fingerprint(prereg)
    prereg["fingerprint"] = fingerprint

    store_put(db, _NS, prereg_id, prereg)
    return prereg


@router.get("")
def list_preregistrations(
    status: Optional[str] = Query(default=None),
    researcher_name: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all pre-registrations with optional filters."""
    all_prereg = store_list(db, _NS)

    if status:
        all_prereg = [p for p in all_prereg if p.get("status") == status]
    if researcher_name:
        rl = researcher_name.lower()
        all_prereg = [p for p in all_prereg if rl in (p.get("researcher_name") or "").lower()]

    return all_prereg


@router.get("/{prereg_id}")
def get_preregistration(
    prereg_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Get a single pre-registration by ID."""
    return _get_prereg_or_404(db, prereg_id)


@router.post("/{prereg_id}/link-run/{run_id}")
def link_run(
    prereg_id: str,
    run_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Link a completed run to this pre-registration and run automated outcome analysis."""
    prereg = _get_prereg_or_404(db, prereg_id)

    if prereg["status"] not in ("locked", "run_completed"):
        raise HTTPException(
            status_code=400,
            detail=f"Can only link a run to a locked pre-registration. Current status: '{prereg['status']}'.",
        )

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    outcome, verdict = _run_outcome_analysis(prereg, run)

    prereg["status"] = "run_completed"
    prereg["run_id"] = run_id
    prereg["outcome"] = outcome
    prereg["verdict"] = verdict

    store_put(db, _NS, prereg_id, prereg)
    return prereg


@router.get("/{prereg_id}/verify")
def verify_fingerprint(
    prereg_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Verify the SHA-256 fingerprint of a locked pre-registration for tamper detection."""
    prereg = _get_prereg_or_404(db, prereg_id)

    if prereg["status"] == "draft":
        raise HTTPException(
            status_code=400,
            detail="Pre-registration has not been locked yet — no fingerprint to verify.",
        )

    stored_fp = prereg.get("fingerprint")
    if not stored_fp:
        return {
            "valid": False,
            "stored_fingerprint": None,
            "computed_fingerprint": None,
            "locked_at": prereg.get("locked_at"),
            "error": "No fingerprint stored",
        }

    # Recompute: temporarily null out fingerprint field as we did during locking
    check = {k: v for k, v in prereg.items() if k != "fingerprint"}
    check["fingerprint"] = None
    computed_fp = _compute_fingerprint(check)

    return {
        "valid": stored_fp == computed_fp,
        "stored_fingerprint": stored_fp,
        "computed_fingerprint": computed_fp,
        "locked_at": prereg.get("locked_at"),
    }


@router.post("/{prereg_id}/abandon")
def abandon_preregistration(
    prereg_id: str,
    body: AbandonBody,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Mark a pre-registration as abandoned with a reason."""
    prereg = _get_prereg_or_404(db, prereg_id)

    if prereg["status"] == "run_completed":
        raise HTTPException(
            status_code=400,
            detail="Cannot abandon a pre-registration that already has a completed run linked.",
        )

    prereg["status"] = "abandoned"
    prereg["outcome"] = prereg.get("outcome") or {}
    prereg["outcome"]["abandon_reason"] = body.reason
    prereg["outcome"]["abandoned_at"] = _now_iso()

    store_put(db, _NS, prereg_id, prereg)
    return prereg
