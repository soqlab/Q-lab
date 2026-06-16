from __future__ import annotations
import uuid, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/arxiv-radar", tags=["arxiv-radar"])

NS_WATCHES = "arxiv_watches"
NS_ALERTS = "arxiv_alerts"
NS_FEED = "arxiv_feed"

SEED_PAPERS = [
    {"arxiv_id": "2401.12345", "title": "Heisenberg-Limited Phase Estimation with 50-Qubit GHZ States", "authors": ["Chen, L.", "Wang, X."], "abstract": "We demonstrate phase sensitivity at the Heisenberg limit using 50-qubit GHZ states on superconducting hardware.", "categories": ["quant-ph"], "submitted": "2024-01-15", "relevance_score": 0.96, "keywords": ["GHZ", "sensing", "phase estimation"], "cites_qlab_experiment": False, "contradicts_hypothesis": False, "confirms_hypothesis": True, "circuit_available": True, "doi": "10.1038/s41567-024-01234-5", "citations": 47},
    {"arxiv_id": "2402.67890", "title": "QAOA Performance Beyond p=10: A Comprehensive Benchmark", "authors": ["Singh, A.", "Brown, K."], "abstract": "We benchmark QAOA for MaxCut at p=1..15, finding saturation at p=7 with ratio 0.891, contradicting earlier p=3 reports.", "categories": ["quant-ph"], "submitted": "2024-02-03", "relevance_score": 0.89, "keywords": ["QAOA", "MaxCut", "benchmarking"], "cites_qlab_experiment": False, "contradicts_hypothesis": True, "confirms_hypothesis": False, "circuit_available": True, "doi": "arXiv:2402.67890", "citations": 23},
    {"arxiv_id": "2403.11111", "title": "ZNE vs PEC: Systematic Comparison on IBM Hardware", "authors": ["Kim, J.", "Patel, S."], "abstract": "ZNE outperforms PEC for shallow circuits (depth<30); PEC wins for deep circuits with overhead tolerance.", "categories": ["quant-ph"], "submitted": "2024-03-12", "relevance_score": 0.82, "keywords": ["ZNE", "PEC", "error mitigation"], "cites_qlab_experiment": False, "contradicts_hypothesis": False, "confirms_hypothesis": False, "circuit_available": False, "doi": "arXiv:2403.11111", "citations": 15},
    {"arxiv_id": "2404.22222", "title": "Surface Code Sub-Threshold Error Rates on 17-Qubit Device", "authors": ["Fowler, A.", "Google Team"], "abstract": "Logical error rates below fault-tolerance threshold using distance-3 surface code on 17-qubit superconducting device.", "categories": ["quant-ph"], "submitted": "2024-04-01", "relevance_score": 0.78, "keywords": ["surface code", "QEC", "logical qubit"], "cites_qlab_experiment": False, "contradicts_hypothesis": False, "confirms_hypothesis": False, "circuit_available": False, "doi": "10.1038/nature2024", "citations": 182},
    {"arxiv_id": "2405.33333", "title": "VQE for H2O Chemical Accuracy on 12 Qubits via Q-Lab", "authors": ["Aspuru-Guzik, A.", "Babbush, R."], "abstract": "VQE with UCCSD achieves chemical accuracy for H2O on 12-qubit ion trap hardware, using Q-Lab for tracking.", "categories": ["quant-ph"], "submitted": "2024-05-20", "relevance_score": 0.91, "keywords": ["VQE", "H2O", "chemistry", "Q-Lab"], "cites_qlab_experiment": True, "contradicts_hypothesis": False, "confirms_hypothesis": True, "circuit_available": True, "doi": "arXiv:2405.33333", "citations": 8},
]

class ArxivWatch(BaseModel):
    watch_id: str; created_at: str; name: str
    keywords: list[str]; authors: list[str]; categories: list[str]
    alert_on_contradiction: bool; alert_on_confirmation: bool
    alert_on_citation: bool; min_relevance: float; active: bool; alert_count: int

class ArxivAlert(BaseModel):
    alert_id: str; watch_id: str; paper_arxiv_id: str; paper_title: str
    alert_type: str; relevance_score: float; triggered_at: str; summary: str; action_recommended: str

class PaperResult(BaseModel):
    arxiv_id: str; title: str; authors: list[str]; abstract: str
    categories: list[str]; submitted: str; relevance_score: float; keywords: list[str]
    cites_qlab_experiment: bool; contradicts_hypothesis: bool; confirms_hypothesis: bool
    circuit_available: bool; doi: str; citations: int

class CreateWatchRequest(BaseModel):
    name: str = "My Research Watch"
    keywords: list[str] = ["VQE", "QAOA", "quantum sensing"]
    authors: list[str] = []
    categories: list[str] = ["quant-ph"]
    alert_on_contradiction: bool = True
    alert_on_confirmation: bool = True
    alert_on_citation: bool = True
    min_relevance: float = 0.7

class SearchRequest(BaseModel):
    query: str = ""; categories: list[str] = []; keywords: list[str] = []
    max_results: int = 20; min_relevance: float = 0.5

def _score(paper: dict, keywords: list[str], query: str) -> float:
    score = paper.get("relevance_score", 0.5)
    text = (paper["title"] + " " + paper["abstract"] + " " + " ".join(paper.get("keywords", []))).lower()
    for kw in keywords:
        if kw.lower() in text:
            score = min(1.0, score + 0.05)
    for word in query.lower().split():
        if word in text:
            score = min(1.0, score + 0.03)
    return round(score, 3)

def _seed_db(db: Session):
    store_seed(db, NS_FEED, [(p["arxiv_id"], p) for p in SEED_PAPERS])

def _check_alerts(watch: ArxivWatch, db: Session) -> None:
    feed = store_list(db, NS_FEED)
    for paper_data in feed:
        paper = PaperResult(**paper_data)
        s = _score(paper.model_dump(), watch.keywords, "")
        if s < watch.min_relevance:
            continue
        alert_type = None
        if paper.contradicts_hypothesis and watch.alert_on_contradiction:
            alert_type = "contradiction"
        elif paper.confirms_hypothesis and watch.alert_on_confirmation:
            alert_type = "confirmation"
        elif paper.cites_qlab_experiment and watch.alert_on_citation:
            alert_type = "citation"
        if alert_type:
            aid = str(uuid.uuid4())
            alert = ArxivAlert(alert_id=aid, watch_id=watch.watch_id, paper_arxiv_id=paper.arxiv_id, paper_title=paper.title, alert_type=alert_type, relevance_score=s, triggered_at=datetime.now(timezone.utc).isoformat(), summary=f"{paper.arxiv_id} {alert_type}s your research: {paper.title[:80]}", action_recommended="Read immediately" if s > 0.9 else "Review within 48h")
            store_put(db, NS_ALERTS, aid, alert.model_dump())
            wd = store_get(db, NS_WATCHES, watch.watch_id)
            if wd:
                wd["alert_count"] = wd.get("alert_count", 0) + 1
                store_put(db, NS_WATCHES, watch.watch_id, wd)

@router.post("/watch", response_model=ArxivWatch)
def create_watch(req: CreateWatchRequest, db: Session = Depends(get_db)):
    _seed_db(db)
    wid = str(uuid.uuid4())
    watch = ArxivWatch(watch_id=wid, created_at=datetime.now(timezone.utc).isoformat(), name=req.name, keywords=req.keywords, authors=req.authors, categories=req.categories, alert_on_contradiction=req.alert_on_contradiction, alert_on_confirmation=req.alert_on_confirmation, alert_on_citation=req.alert_on_citation, min_relevance=req.min_relevance, active=True, alert_count=0)
    store_put(db, NS_WATCHES, wid, watch.model_dump())
    _check_alerts(watch, db)
    return watch

@router.post("/search", response_model=dict)
def search_papers(req: SearchRequest, db: Session = Depends(get_db)):
    _seed_db(db)
    feed = store_list(db, NS_FEED)
    results = []
    for paper_data in feed:
        paper = PaperResult(**paper_data)
        s = _score(paper.model_dump(), req.keywords, req.query)
        if s < req.min_relevance:
            continue
        if req.categories and not any(c in paper.categories for c in req.categories):
            continue
        pd = paper.model_dump()
        pd["relevance_score"] = s
        results.append(PaperResult(**pd))
    results.sort(key=lambda p: p.relevance_score, reverse=True)
    return {"results": results[:req.max_results], "total": len(results), "trending_keywords": ["GHZ", "VQE", "QAOA", "ZNE", "surface_code", "quantum_sensing"]}

@router.get("/alerts")
def get_alerts(watch_id: str | None = None, db: Session = Depends(get_db)):
    alerts = [ArxivAlert(**r) for r in store_list(db, NS_ALERTS)]
    if watch_id:
        alerts = [a for a in alerts if a.watch_id == watch_id]
    all_alerts = [ArxivAlert(**r) for r in store_list(db, NS_ALERTS)]
    return {"alerts": alerts, "total": len(alerts), "by_type": {t: sum(1 for a in all_alerts if a.alert_type == t) for t in ["contradiction", "confirmation", "citation"]}}

@router.get("/feed")
def get_feed(category: str | None = None, db: Session = Depends(get_db)):
    _seed_db(db)
    feed = store_list(db, NS_FEED)
    papers = [PaperResult(**p) for p in feed]
    if category:
        papers = [p for p in papers if category in p.categories]
    papers = sorted(papers, key=lambda p: p.submitted, reverse=True)
    return {"papers": papers, "total": len(papers), "trending": [p.title for p in sorted(papers, key=lambda p: p.citations, reverse=True)[:3]]}

@router.get("/watches")
def list_watches(db: Session = Depends(get_db)):
    watches = [ArxivWatch(**r) for r in store_list(db, NS_WATCHES)]
    return {"watches": watches, "total": len(watches)}

@router.delete("/watch/{watch_id}")
def delete_watch(watch_id: str, db: Session = Depends(get_db)):
    if store_get(db, NS_WATCHES, watch_id) is None:
        raise HTTPException(404, "watch not found")
    store_delete(db, NS_WATCHES, watch_id)
    return {"deleted": watch_id}
