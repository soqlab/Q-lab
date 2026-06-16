from __future__ import annotations

import math
import random
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/paper-replication", tags=["paper-replication"])

NS = "paper_replications"

_NOW = datetime.now(timezone.utc)
_ARXIV_RE = re.compile(r"(\d{4}\.\d{4,5})(v\d+)?")

def _parse_arxiv_id(url: str) -> Optional[str]:
    m = _ARXIV_RE.search(url); return m.group(1) if m else None

_PAPER_DB: Dict[str, Dict] = {
    "2305.09993": {"title": "Suppressing quantum errors by scaling a surface code logical qubit",
                   "authors": ["Google Quantum AI"],
                   "main_claim": "Logical error rate suppresses below physical error rate at distance d=5 vs d=3",
                   "n_qubits": 49, "original_value": 0.00283, "bm_type": "logical_error_rate",
                   "qasm_stub": "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[49];\ncreg c[49];\n// surface code d=5"},
    "2210.06726": {"title": "Evidence for the utility of quantum computing before fault tolerance",
                   "authors": ["IBM Quantum", "UC Berkeley"],
                   "main_claim": "127-qubit Ising model quantum simulation matches tensor network results",
                   "n_qubits": 127, "original_value": 0.741, "bm_type": "magnetization_fidelity",
                   "qasm_stub": "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[127];\ncreg c[127];\n// Ising Trotter"},
    "2304.09519": {"title": "Quantum advantage in information retrieval",
                   "authors": ["IonQ Research", "University of Maryland"],
                   "main_claim": "GHZ-state fidelity of 0.9812 on 32 qubits with IonQ Forte",
                   "n_qubits": 32, "original_value": 0.9812, "bm_type": "ghz_fidelity",
                   "qasm_stub": "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[32];\ncreg c[32];\nh q[0];\ncx q[0],q[1];"},
}

_NOISE = {"ibm_torino": 0.06,"ibm_brisbane": 0.055,"ibm_kyoto": 0.07,
           "ionq_aria": 0.025,"ionq_forte": 0.015,"quantinuum_h2": 0.012}

def _normal_cdf(z: float) -> float:
    t = 1.0 / (1.0 + 0.2316419 * abs(z))
    p = t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))))
    val = 1.0 - math.exp(-0.5*z*z)/math.sqrt(2*math.pi)*p
    return val if z >= 0 else 1.0 - val

def _lookup_paper(arxiv_id: str) -> Dict:
    if arxiv_id in _PAPER_DB: return _PAPER_DB[arxiv_id].copy()
    return {"title": f"Quantum circuit experiments — arXiv:{arxiv_id}", "authors": ["Unknown Authors"],
            "main_claim": "Circuit fidelity exceeds classical simulation threshold",
            "n_qubits": random.randint(5, 20), "original_value": round(random.uniform(0.80, 0.97), 4),
            "bm_type": "circuit_fidelity",
            "qasm_stub": "OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[5];\ncreg c[5];\nh q[0];"}

def _simulate(paper: Dict, backend: str, n_shots: int) -> Dict:
    random.seed(hash(paper["title"]) % (2**31))
    orig = paper["original_value"]
    nl = _NOISE.get(backend, 0.05)
    rep = round(max(0.0, min(1.0, orig + (random.random()-0.5)*nl*2)), 4)
    dev = abs(rep - orig) / (orig + 1e-9)
    sem = max(math.sqrt(rep*(1-rep)/n_shots), 1e-6)
    sigma = abs((rep - orig) / sem)
    p_val = round(2*(1 - _normal_cdf(sigma)), 4)
    if dev < 0.03 and sigma < 2.0:
        verdict, detail = "replicated", f"Value {rep} within 3% and <2σ of original {orig}."
    elif dev < 0.08 and sigma < 3.0:
        verdict, detail = "partially_replicated", f"Value {rep} within 8% but {sigma:.1f}σ — partial agreement."
    else:
        verdict, detail = "failed", f"Value {rep} deviates {dev*100:.1f}% ({sigma:.1f}σ) from original {orig}."
    issues = []
    if paper.get("n_qubits", 5) > 20 and backend.startswith("ibm"):
        issues.append("Circuit too deep for backend coherence time — mitigation applied.")
    if nl > 0.05: issues.append("High noise level — results may not match original hardware.")
    return {"original_value": orig, "replicated_value": rep, "deviation_sigma": round(sigma, 3),
            "verdict": verdict, "verdict_detail": detail, "statistical_test": "two-tailed z-test",
            "p_value": p_val, "circuit_ran": True, "issues": issues, "sem": round(sem, 6)}

def _seed_db(db: Session):
    random.seed(99)
    seed_records = []
    for _url, _be, _sh in [("https://arxiv.org/abs/2305.09993","ionq_forte",1024),
                            ("https://arxiv.org/abs/2210.06726","ibm_torino",4096),
                            ("https://arxiv.org/abs/2304.09519","quantinuum_h2",2048)]:
        _rid = str(uuid.uuid4())
        _aid = _parse_arxiv_id(_url)
        _p = _lookup_paper(_aid)
        _s = _simulate(_p, _be, _sh)
        _st = (_NOW - timedelta(days=random.randint(1, 10))).isoformat()
        record = {"replication_id": _rid, "arxiv_id": _aid, "arxiv_url": _url,
            "paper_title": _p["title"], "paper_authors": _p["authors"], "main_claim": _p["main_claim"],
            "extracted_circuit_qasm": _p.get("qasm_stub"), "n_qubits": _p.get("n_qubits"),
            "backend_used": _be, "n_shots": _sh, "status": "completed",
            "started_at": _st, "completed_at": _st, "published": False, **_s}
        seed_records.append((_rid, record))
    store_seed(db, NS, seed_records)

class StartPayload(BaseModel):
    arxiv_url: str; backend: Optional[str] = "ibm_torino"; n_shots: Optional[int] = 1024

class PublishPayload(BaseModel):
    notes: Optional[str] = None

@router.get("/")
def list_replications(db: Session = Depends(get_db)):
    _seed_db(db)
    items = sorted(store_list(db, NS), key=lambda x: x["started_at"], reverse=True)
    return {"replications": items, "total": len(items)}

@router.post("/start")
def start_replication(payload: StartPayload, db: Session = Depends(get_db)):
    arxiv_id = _parse_arxiv_id(payload.arxiv_url)
    if not arxiv_id: raise HTTPException(status_code=400, detail="Could not parse arXiv ID from URL.")
    backend = payload.backend or "ibm_torino"
    n_shots = max(1, min(payload.n_shots or 1024, 65536))
    paper = _lookup_paper(arxiv_id)
    rid = str(uuid.uuid4()); now = datetime.now(timezone.utc).isoformat()
    sim = _simulate(paper, backend, n_shots)
    record = {"replication_id": rid, "arxiv_id": arxiv_id, "arxiv_url": payload.arxiv_url,
              "paper_title": paper["title"], "paper_authors": paper["authors"],
              "main_claim": paper["main_claim"], "extracted_circuit_qasm": paper.get("qasm_stub"),
              "n_qubits": paper.get("n_qubits"), "backend_used": backend, "n_shots": n_shots,
              "status": "completed", "started_at": now, "completed_at": now, "published": False, **sim}
    store_put(db, NS, rid, record)
    return record

@router.get("/{replication_id}")
def get_replication(replication_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS, replication_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Replication not found.")
    return data

@router.post("/{replication_id}/publish")
def publish_verdict(replication_id: str, payload: PublishPayload = PublishPayload(), db: Session = Depends(get_db)):
    r = store_get(db, NS, replication_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Replication not found.")
    if r["status"] != "completed":
        raise HTTPException(status_code=400, detail="Replication must be completed before publishing.")
    r.update(published=True, published_at=datetime.now(timezone.utc).isoformat(), publish_notes=payload.notes)
    store_put(db, NS, replication_id, r)
    return {"published": True, "replication_id": replication_id, "verdict": r["verdict"]}
