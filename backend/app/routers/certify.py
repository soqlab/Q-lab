"""Fidelity certificate: does the hardware's output carry the circuit's signal, or is it noise?

For each evidence run, Q-Lab takes the counts recorded with the run and the exact ideal
probabilities of the run's stored circuit (statevector simulation), and computes the linear
cross-entropy benchmark (Arute et al., Nature 574, 2019):

    F = 2^n * mean over shots of P_ideal(x) - 1

F is about 1 for a perfect device and 0 for output that is uniformly random. The null hypothesis
is "the samples are uniform noise"; under it the mean of 2^n P_ideal(x) has expectation 1 and
variance (2^n * sum_x P_ideal(x)^2 - 1) / shots, which gives a z-score per run. Runs are combined
with Stouffer's method. Nothing here is estimated or randomised: the same runs give the same
certificate. A certificate says the signal is present; it does not establish a quantum advantage.

Certificates recorded before this (with invented statistics) have no "runs" field and are hidden.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity
from ..local_sim import ideal_probabilities
from ..xeb_stats import linear_xeb, norm_sf
from ..models import Run
from ..run_scope import current_scope, visible
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/certify", tags=["certify"])

NS = "certifications"
SOURCE = ("Counts recorded with your runs, compared with exact ideal probabilities from a "
          "statevector simulation of each run's stored circuit.")


class RunEvidence(BaseModel):
    run_id: str
    backend: Optional[str] = None
    n_bits: int
    shots: int
    linear_xeb: float
    null_std_error: float
    z_score: float


class SkippedRun(BaseModel):
    run_id: str
    reason: str


class CertificationResult(BaseModel):
    cert_id: str
    name: str
    statistic: str = "linear_xeb"
    runs: list[RunEvidence]
    skipped: list[SkippedRun]
    linear_xeb: Optional[float]
    combined_z: Optional[float]
    p_value: Optional[float]
    confidence_level: float
    certified: bool
    source: str = SOURCE
    methodology_notes: list[str]
    created_at: str


class CertSummary(BaseModel):
    cert_id: str
    name: str
    certified: bool
    linear_xeb: Optional[float]
    p_value: Optional[float]
    n_runs: int
    created_at: str


class CertifyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    evidence_run_ids: list[str] = Field(min_length=1, max_length=50)
    confidence_level: float = Field(default=0.95, gt=0.5, lt=1.0)


def _evaluate(run: Run) -> RunEvidence:
    counts = (run.results or {}).get("counts") or {}
    if not run.qasm:
        raise ValueError("The run has no stored circuit (QASM), so its ideal distribution is unknown.")
    if not counts:
        raise ValueError("The run has no recorded counts.")
    ideal = ideal_probabilities(run.qasm)
    n_bits = len(next(iter(ideal)))
    xeb, se, shots = linear_xeb(counts, ideal, n_bits)
    if se < 1e-9:
        raise ValueError("The circuit's ideal output is uniform, so XEB cannot tell signal from noise.")
    return RunEvidence(run_id=run.run_id, backend=run.backend, n_bits=n_bits, shots=shots,
                       linear_xeb=round(xeb, 6), null_std_error=round(se, 6), z_score=round(xeb / se, 4))


def _owned(record: dict) -> bool:
    return "runs" in record and visible(record.get("owner_user_id"), record.get("owner_org_id"), current_scope())


@router.post("/certify", response_model=CertificationResult)
def certify(req: CertifyRequest, db: Session = Depends(get_db),
            identity: Optional[Identity] = Depends(get_identity)) -> CertificationResult:
    run_ids = list(dict.fromkeys(req.evidence_run_ids))
    found = {r.run_id: r for r in db.scalars(select(Run).where(Run.run_id.in_(run_ids)))}
    missing = [rid for rid in run_ids if rid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Run(s) not found: {', '.join(missing)}")

    evidence: list[RunEvidence] = []
    skipped: list[SkippedRun] = []
    for rid in run_ids:
        try:
            evidence.append(_evaluate(found[rid]))
        except ValueError as exc:
            skipped.append(SkippedRun(run_id=rid, reason=str(exc)))

    alpha = 1.0 - req.confidence_level
    combined_z = p_value = mean_xeb = None
    certified = False
    if evidence:
        combined_z = sum(e.z_score for e in evidence) / math.sqrt(len(evidence))
        p_value = norm_sf(combined_z)
        mean_xeb = sum(e.linear_xeb * e.shots for e in evidence) / sum(e.shots for e in evidence)
        certified = p_value < alpha

    if certified:
        verdict = "Null hypothesis rejected: the output carries the ideal circuit's signal."
    elif evidence:
        verdict = "Null hypothesis not rejected."
    else:
        verdict = "No run had both a stored circuit and recorded counts, so no test was made."
    notes = [
        f"{len(evidence)} of {len(run_ids)} run(s) could be evaluated.",
        "Null hypothesis: the measured outcomes are uniformly random (a fully depolarised device).",
        f"Significance level alpha = {alpha:.3g}, one-sided. {verdict}",
        "This certifies agreement with the ideal circuit, not a computational speedup or quantum advantage.",
    ]
    record = CertificationResult(
        cert_id=str(uuid.uuid4()), name=req.name, runs=evidence, skipped=skipped,
        linear_xeb=None if mean_xeb is None else round(mean_xeb, 6),
        combined_z=None if combined_z is None else round(combined_z, 4),
        p_value=None if p_value is None else float(f"{p_value:.6g}"),
        confidence_level=req.confidence_level, certified=certified, methodology_notes=notes,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS, record.cert_id, {
        **record.model_dump(),
        "owner_user_id": identity.user_id if identity else None,
        "owner_org_id": identity.org_id if identity else None,
    })
    return record


@router.get("/certifications", response_model=list[CertSummary])
def list_certifications(db: Session = Depends(get_db)) -> list[CertSummary]:
    return [
        CertSummary(cert_id=c["cert_id"], name=c["name"], certified=c["certified"],
                    linear_xeb=c.get("linear_xeb"), p_value=c.get("p_value"),
                    n_runs=len(c["runs"]), created_at=c["created_at"])
        for c in store_list(db, NS) if _owned(c)
    ]


def _get_owned(db: Session, cert_id: str) -> dict:
    c = store_get(db, NS, cert_id)
    if not c or not _owned(c):
        raise HTTPException(status_code=404, detail=f"Certification {cert_id} not found.")
    return c


@router.get("/certification/{cert_id}", response_model=CertificationResult)
def get_certification(cert_id: str, db: Session = Depends(get_db)) -> CertificationResult:
    return CertificationResult(**_get_owned(db, cert_id))


@router.delete("/certification/{cert_id}", status_code=204)
def delete_certification(cert_id: str, db: Session = Depends(get_db)) -> None:
    _get_owned(db, cert_id)
    store_delete(db, NS, cert_id)
