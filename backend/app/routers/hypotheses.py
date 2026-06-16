from __future__ import annotations
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/hypotheses", tags=["hypotheses"])

NS_HYPOTHESES = "hypotheses"

class Hypothesis(BaseModel):
    hyp_id: str
    title: str
    statement: str
    background: str
    prediction: str
    null_hypothesis: str
    status: str  # draft | testing | confirmed | refuted | inconclusive
    confidence: float
    created_at: str
    updated_at: str
    linked_run_ids: list[str]
    linked_paper_ids: list[str]
    evidence_for: list[str]
    evidence_against: list[str]
    tags: list[str]
    created_by: str
    conclusion: str | None
    p_value: float | None
    effect_size: float | None

class CreateHypothesisRequest(BaseModel):
    title: str
    statement: str
    background: str = ""
    prediction: str = ""
    null_hypothesis: str = ""
    tags: list[str] = []
    created_by: str = "researcher"

class UpdateHypothesisRequest(BaseModel):
    status: str | None = None
    conclusion: str | None = None
    confidence: float | None = None
    evidence_for: list[str] | None = None
    evidence_against: list[str] | None = None
    p_value: float | None = None
    effect_size: float | None = None

class LinkRunRequest(BaseModel):
    run_id: str
    role: str = "evidence"  # evidence | refutation | baseline

class LinkPaperRequest(BaseModel):
    paper_id: str
    citation: str = ""

_SEED_HYPOTHESES = [
    {
        "title": "Heisenberg Limit Scaling in GHZ States",
        "statement": "GHZ entangled probe states achieve 1/N phase sensitivity scaling (Heisenberg limit) vs 1/√N for separable states",
        "background": "Quantum metrology theory predicts entanglement enables sub-shot-noise sensing",
        "prediction": "Phase estimation error ~ 1/N for N-qubit GHZ state",
        "null_hypothesis": "Phase error scales as 1/√N regardless of entanglement",
        "status": "testing", "confidence": 0.72,
        "tags": ["metrology", "ghz", "heisenberg-limit"],
    },
    {
        "title": "QAOA Depth Plateaus Beyond p=5",
        "statement": "Increasing QAOA depth beyond p=5 yields no improvement in approximation ratio for 3-regular graphs",
        "background": "QAOA convergence theory suggests diminishing returns at high depth",
        "prediction": "Approximation ratio saturates within 2% of optimal past p=5",
        "null_hypothesis": "Approximation ratio improves monotonically with QAOA depth",
        "status": "confirmed", "confidence": 0.91,
        "tags": ["qaoa", "depth", "approximation"],
    },
    {
        "title": "Crosstalk Dominates at >20 Simultaneous 2Q Gates",
        "statement": "Circuit fidelity drops non-linearly when >20 two-qubit gates execute simultaneously on ibm_brisbane",
        "background": "ZZ crosstalk characterization shows coupling beyond nearest neighbors",
        "prediction": "Fidelity degradation >15% when simultaneous 2Q gate count exceeds 20",
        "null_hypothesis": "Fidelity scales linearly with simultaneous gate count",
        "status": "draft", "confidence": 0.55,
        "tags": ["crosstalk", "ibm", "fidelity"],
    },
]

def _build_seed_records():
    records = []
    for h in _SEED_HYPOTHESES:
        hid = str(uuid.uuid4())
        hyp = Hypothesis(
            hyp_id=hid, **h,
            created_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
            linked_run_ids=[], linked_paper_ids=[],
            evidence_for=[], evidence_against=[],
            created_by="researcher", conclusion=None, p_value=None, effect_size=None,
        )
        records.append((hid, hyp.model_dump()))
    return records


@router.post("/", response_model=Hypothesis)
def create_hypothesis(req: CreateHypothesisRequest, db: Session = Depends(get_db)):
    hid = str(uuid.uuid4())
    h = Hypothesis(
        hyp_id=hid, title=req.title, statement=req.statement,
        background=req.background, prediction=req.prediction,
        null_hypothesis=req.null_hypothesis, status="draft",
        confidence=0.5, created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
        linked_run_ids=[], linked_paper_ids=[],
        evidence_for=[], evidence_against=[],
        tags=req.tags, created_by=req.created_by,
        conclusion=None, p_value=None, effect_size=None,
    )
    store_put(db, NS_HYPOTHESES, hid, h.model_dump())
    return h

@router.get("/", response_model=dict)
def list_hypotheses(status: str | None = None, db: Session = Depends(get_db)):
    store_seed(db, NS_HYPOTHESES, _build_seed_records())
    hyps = [Hypothesis(**r) for r in store_list(db, NS_HYPOTHESES)]
    if status:
        hyps = [h for h in hyps if h.status == status]
    all_hyps = [Hypothesis(**r) for r in store_list(db, NS_HYPOTHESES)]
    return {"hypotheses": hyps, "total": len(hyps),
            "by_status": {s: sum(1 for h in all_hyps if h.status == s) for s in ["draft","testing","confirmed","refuted","inconclusive"]}}

@router.get("/{hyp_id}", response_model=Hypothesis)
def get_hypothesis(hyp_id: str, db: Session = Depends(get_db)):
    store_seed(db, NS_HYPOTHESES, _build_seed_records())
    data = store_get(db, NS_HYPOTHESES, hyp_id)
    if not data:
        raise HTTPException(404, "hypothesis not found")
    return Hypothesis(**data)

@router.patch("/{hyp_id}", response_model=Hypothesis)
def update_hypothesis(hyp_id: str, req: UpdateHypothesisRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_HYPOTHESES, _build_seed_records())
    data = store_get(db, NS_HYPOTHESES, hyp_id)
    if not data:
        raise HTTPException(404, "hypothesis not found")
    if req.status is not None: data["status"] = req.status
    if req.conclusion is not None: data["conclusion"] = req.conclusion
    if req.confidence is not None: data["confidence"] = req.confidence
    if req.evidence_for is not None: data["evidence_for"] = req.evidence_for
    if req.evidence_against is not None: data["evidence_against"] = req.evidence_against
    if req.p_value is not None: data["p_value"] = req.p_value
    if req.effect_size is not None: data["effect_size"] = req.effect_size
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS_HYPOTHESES, hyp_id, data)
    return Hypothesis(**data)

@router.post("/{hyp_id}/link-run", response_model=Hypothesis)
def link_run(hyp_id: str, req: LinkRunRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_HYPOTHESES, _build_seed_records())
    data = store_get(db, NS_HYPOTHESES, hyp_id)
    if not data:
        raise HTTPException(404, "hypothesis not found")
    if req.run_id not in data["linked_run_ids"]:
        data["linked_run_ids"].append(req.run_id)
    if req.role == "evidence" and req.run_id not in data["evidence_for"]:
        data["evidence_for"].append(f"Run {req.run_id[:8]}")
    elif req.role == "refutation" and req.run_id not in data["evidence_against"]:
        data["evidence_against"].append(f"Run {req.run_id[:8]}")
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS_HYPOTHESES, hyp_id, data)
    return Hypothesis(**data)

@router.delete("/{hyp_id}")
def delete_hypothesis(hyp_id: str, db: Session = Depends(get_db)):
    store_seed(db, NS_HYPOTHESES, _build_seed_records())
    deleted = store_delete(db, NS_HYPOTHESES, hyp_id)
    if not deleted:
        raise HTTPException(404, "hypothesis not found")
    return {"deleted": hyp_id}
