from __future__ import annotations
import uuid, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/replication", tags=["replication"])

NS_CLAIMS = "replication_claims"
NS_ATTEMPTS = "replication_attempts"

class ReplicationClaim(BaseModel):
    claim_id: str; title: str; original_author: str; original_doi: str | None
    original_value: float; metric: str; higher_is_better: bool
    n_qubits: int; backend: str; description: str
    submitted_at: str; tags: list[str]; status: str
    replication_count: int; success_count: int; failure_count: int; partial_count: int
    consensus_value: float | None; consensus_uncertainty: float | None
    replication_rate: float; badge: str; attempts: list[dict]

class AttemptRequest(BaseModel):
    claim_id: str; your_value: float; your_uncertainty: float = 0.0
    backend: str = "ibm_brisbane"; n_shots: int = 8192
    run_ids: list[str] = []; notes: str = ""
    circuit_modified: bool = False; methodology_notes: str = ""

# Titles and authors of the sample claims earlier versions created, to find and delete them.
_OLD_SAMPLE_CLAIMS = {('GHZ Heisenberg Limit at N=8', 'Martinez et al.'), ('QAOA MaxCut Approximation Ratio p=3', 'Farhi et al.'), ('VQE H2 Chemical Accuracy', 'Peruzzo et al.')}

def _verdict(original: float, your_val: float, uncertainty: float, higher_is_better: bool) -> str:
    delta = abs(your_val - original)
    if delta <= 2 * uncertainty: return "success"
    if delta <= 5 * uncertainty or delta/abs(original) < 0.05: return "partial"
    return "failure"

def _badge(rate: float, count: int) -> str:
    if count < 2: return "awaiting_replication"
    if rate >= 0.8: return "independently_replicated"
    if rate >= 0.5: return "partially_replicated"
    return "contested"

# Earlier versions created three claims with invented authors, DOIs and replication attempts. They
# are removed once; claims and attempts now come only from users.
_CLEANED = "_samples_removed_v1"


def _seed_db(db: Session):
    if store_get(db, NS_CLAIMS + "_meta", _CLEANED):
        return
    for c in store_list(db, NS_CLAIMS):
        if (c.get("title"), c.get("original_author")) in _OLD_SAMPLE_CLAIMS:
            for a in c.get("attempts") or []:
                store_delete(db, NS_ATTEMPTS, a.get("attempt_id", ""))
            store_delete(db, NS_CLAIMS, c["claim_id"])
    store_put(db, NS_CLAIMS + "_meta", _CLEANED, {"done": True})

@router.get("")
def list_claims(status: str | None = None, badge: str | None = None, db: Session = Depends(get_db)):
    _seed_db(db)
    claims = [ReplicationClaim(**r) for r in store_list(db, NS_CLAIMS)]
    if status: claims = [c for c in claims if c.status == status]
    if badge: claims = [c for c in claims if c.badge == badge]
    all_claims = [ReplicationClaim(**r) for r in store_list(db, NS_CLAIMS)]
    return {"claims": claims, "total": len(claims), "replicated": sum(1 for c in all_claims if c.badge=="independently_replicated"), "contested": sum(1 for c in all_claims if c.badge=="contested")}

@router.get("/{claim_id}", response_model=ReplicationClaim)
def get_claim(claim_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_CLAIMS, claim_id)
    if data is None:
        raise HTTPException(404, "not found")
    return ReplicationClaim(**data)

@router.post("/attempt", response_model=dict)
def attempt_replication(req: AttemptRequest, db: Session = Depends(get_db)):
    claim_data = store_get(db, NS_CLAIMS, req.claim_id)
    if claim_data is None:
        raise HTTPException(404, "claim not found")
    claim = ReplicationClaim(**claim_data)
    verdict = _verdict(claim.original_value, req.your_value, req.your_uncertainty, claim.higher_is_better)
    attempt = {"attempt_id": str(uuid.uuid4()), "claim_id": req.claim_id, "your_value": req.your_value, "your_uncertainty": req.your_uncertainty, "verdict": verdict, "backend": req.backend, "submitted_at": datetime.now(timezone.utc).isoformat(), "run_ids": req.run_ids, "notes": req.notes, "circuit_modified": req.circuit_modified, "methodology_notes": req.methodology_notes}
    store_put(db, NS_ATTEMPTS, attempt["attempt_id"], attempt)
    all_atts = [r for r in store_list(db, NS_ATTEMPTS) if r.get("claim_id") == req.claim_id]
    success = sum(1 for a in all_atts if a["verdict"]=="success")
    partial = sum(1 for a in all_atts if a["verdict"]=="partial")
    failure = sum(1 for a in all_atts if a["verdict"]=="failure")
    rep_rate = (success + 0.5*partial) / max(len(all_atts), 1)
    vals = [a["your_value"] for a in all_atts]
    cd = claim.model_dump()
    cd.update(replication_count=len(all_atts), success_count=success, failure_count=failure, partial_count=partial, consensus_value=round(sum(vals)/len(vals),6), replication_rate=round(rep_rate,3), badge=_badge(rep_rate,len(all_atts)), attempts=all_atts)
    store_put(db, NS_CLAIMS, req.claim_id, cd)
    return {**attempt, "delta_from_original": round(abs(req.your_value - claim.original_value), 6), "within_2sigma": abs(req.your_value - claim.original_value) <= 2*max(req.your_uncertainty, 1e-10)}

@router.post("/publish", response_model=ReplicationClaim)
def publish_claim(req: dict, db: Session = Depends(get_db)):
    cid = str(uuid.uuid4())
    claim = ReplicationClaim(claim_id=cid, submitted_at=datetime.now(timezone.utc).isoformat(), replication_count=0, success_count=0, failure_count=0, partial_count=0, consensus_value=None, consensus_uncertainty=None, replication_rate=0.0, badge="awaiting_replication", attempts=[], status="published", **{k:v for k,v in req.items() if k not in ("claim_id","submitted_at","replication_count","success_count","failure_count","partial_count","consensus_value","consensus_uncertainty","replication_rate","badge","attempts","status")})
    store_put(db, NS_CLAIMS, cid, claim.model_dump())
    return claim

