from __future__ import annotations
import uuid, hashlib
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/registry", tags=["experiment-registry"])

NS_REGISTRY = "registry_experiments"
NS_STARS = "registry_stars"

SEED_EXPERIMENTS = [
    {"title": "Quantum Advantage in Random Circuit Sampling", "description": "53-qubit random circuit sampling demonstrating quantum supremacy on Sycamore processor. Cross-entropy benchmarking validates computational hardness.", "experiment_type": "benchmarking", "n_qubits": 53, "backend": "google_sycamore_53", "tags": ["supremacy","xeb","random-circuits"], "stars": 1847, "forks": 203, "author": "quantum_ai_team", "institution": "Google Quantum AI", "doi": "10.1038/s41586-019-1666-5"},
    {"title": "VQE Ground State Energy H2 Molecule", "description": "Variational Quantum Eigensolver for hydrogen molecule ground state. Achieves chemical accuracy (1.6 mHa) on 4-qubit circuit using UCCSD ansatz.", "experiment_type": "chemistry", "n_qubits": 4, "backend": "ibm_nairobi", "tags": ["vqe","chemistry","uccsd","h2"], "stars": 934, "forks": 187, "author": "qchem_research", "institution": "MIT", "doi": "10.1103/PhysRevX.8.011021"},
    {"title": "QAOA MaxCut 20-Node Erdos-Renyi", "description": "QAOA p=5 on 20-node random graph. Achieves 0.91 approximation ratio. Includes parameter landscape and barren plateau analysis.", "experiment_type": "optimization", "n_qubits": 20, "backend": "ibm_brisbane", "tags": ["qaoa","maxcut","optimization"], "stars": 621, "forks": 98, "author": "variational_lab", "institution": "Caltech", "doi": None},
    {"title": "Quantum Error Correction Surface Code d=5", "description": "Distance-5 surface code logical qubit with real-time syndrome decoding. Physical error rate 0.18%, logical error rate 0.09%.", "experiment_type": "error_correction", "n_qubits": 49, "backend": "google_sycamore_70", "tags": ["qec","surface-code","fault-tolerant"], "stars": 2103, "forks": 312, "author": "error_correction_grp", "institution": "Google", "doi": "10.1038/s41586-023-05782-6"},
    {"title": "Quantum Sensing NV-Center Magnetometry", "description": "GHZ-enhanced magnetic field sensing using 8-qubit NV-center register. Heisenberg-limited sensitivity demonstrated for first time at room temperature.", "experiment_type": "sensing", "n_qubits": 8, "backend": "diamond_nv_lab", "tags": ["sensing","nv-center","ghz","heisenberg-limit"], "stars": 445, "forks": 67, "author": "quantum_sensing_lab", "institution": "Harvard", "doi": None},
]

class RegistryEntry(BaseModel):
    registry_id: str
    title: str
    description: str
    experiment_type: str
    n_qubits: int
    backend: str
    tags: list[str]
    stars: int
    forks: int
    author: str
    institution: str
    doi: str | None
    published_at: str
    updated_at: str
    run_ids: list[str]
    is_public: bool
    license: str
    views: int
    content_hash: str
    forked_from: str | None
    reproducibility_badge: bool

class PublishRequest(BaseModel):
    title: str
    description: str
    experiment_type: str = "general"
    n_qubits: int = 1
    backend: str = ""
    tags: list[str] = []
    run_ids: list[str] = []
    author: str = "anonymous"
    institution: str = ""
    doi: str | None = None
    license: str = "CC-BY-4.0"
    is_public: bool = True

class SearchRequest(BaseModel):
    query: str = ""
    experiment_type: str | None = None
    min_stars: int = 0
    tags: list[str] = []
    max_results: int = 20
    sort_by: str = "stars"

def _build_seed_records():
    records = []
    for s in SEED_EXPERIMENTS:
        rid = str(uuid.uuid4())
        content = f"{s['title']}|{s['description']}|{s['n_qubits']}"
        entry = RegistryEntry(
            registry_id=rid, published_at=datetime.now(timezone.utc).isoformat(),
            updated_at=datetime.now(timezone.utc).isoformat(),
            run_ids=[], is_public=True, license="CC-BY-4.0",
            views=s["stars"] * 10, content_hash=hashlib.md5(content.encode()).hexdigest()[:12],
            forked_from=None, reproducibility_badge=s["doi"] is not None, **s,
        )
        records.append((rid, entry.model_dump()))
    return records


@router.post("/", response_model=RegistryEntry)
def publish_experiment(req: PublishRequest, db: Session = Depends(get_db)):
    rid = str(uuid.uuid4())
    content = f"{req.title}|{req.description}|{req.n_qubits}"
    entry = RegistryEntry(
        registry_id=rid, stars=0, forks=0,
        published_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
        views=0, content_hash=hashlib.md5(content.encode()).hexdigest()[:12],
        forked_from=None, reproducibility_badge=req.doi is not None,
        **req.model_dump(),
    )
    store_put(db, NS_REGISTRY, rid, entry.model_dump())
    return entry

@router.post("/search")
def search_registry(req: SearchRequest, db: Session = Depends(get_db)):
    store_seed(db, NS_REGISTRY, _build_seed_records())
    results = [RegistryEntry(**r) for r in store_list(db, NS_REGISTRY)]
    if req.query:
        q = req.query.lower()
        results = [r for r in results if q in r.title.lower() or q in r.description.lower() or any(q in t for t in r.tags)]
    if req.experiment_type:
        results = [r for r in results if r.experiment_type == req.experiment_type]
    if req.min_stars > 0:
        results = [r for r in results if r.stars >= req.min_stars]
    if req.tags:
        results = [r for r in results if any(t in r.tags for t in req.tags)]
    results = [r for r in results if r.is_public]
    if req.sort_by == "stars":
        results.sort(key=lambda r: r.stars, reverse=True)
    elif req.sort_by == "date":
        results.sort(key=lambda r: r.published_at, reverse=True)
    elif req.sort_by == "forks":
        results.sort(key=lambda r: r.forks, reverse=True)
    all_entries = store_list(db, NS_REGISTRY)
    total = len(results)
    results = results[:req.max_results]
    return {"results": results, "total": total, "returned": len(results),
            "stats": {"total_experiments": len(all_entries), "total_stars": sum(r.get("stars", 0) for r in all_entries), "total_forks": sum(r.get("forks", 0) for r in all_entries)}}

@router.get("/{registry_id}", response_model=RegistryEntry)
def get_entry(registry_id: str, db: Session = Depends(get_db)):
    store_seed(db, NS_REGISTRY, _build_seed_records())
    data = store_get(db, NS_REGISTRY, registry_id)
    if not data:
        raise HTTPException(404, "experiment not found")
    data["views"] += 1
    store_put(db, NS_REGISTRY, registry_id, data)
    return RegistryEntry(**data)

@router.post("/{registry_id}/star")
def star_entry(registry_id: str, user: str = "anonymous", db: Session = Depends(get_db)):
    store_seed(db, NS_REGISTRY, _build_seed_records())
    data = store_get(db, NS_REGISTRY, registry_id)
    if not data:
        raise HTTPException(404, "experiment not found")
    star_key = f"{user}:{registry_id}"
    if store_get(db, NS_STARS, star_key):
        return {"starred": False, "stars": data["stars"]}
    store_put(db, NS_STARS, star_key, {"user": user, "registry_id": registry_id})
    data["stars"] += 1
    store_put(db, NS_REGISTRY, registry_id, data)
    return {"starred": True, "stars": data["stars"]}

@router.post("/{registry_id}/fork", response_model=RegistryEntry)
def fork_entry(registry_id: str, new_title: str = "", author: str = "anonymous", db: Session = Depends(get_db)):
    store_seed(db, NS_REGISTRY, _build_seed_records())
    src = store_get(db, NS_REGISTRY, registry_id)
    if not src:
        raise HTTPException(404, "experiment not found")
    new_id = str(uuid.uuid4())
    data = dict(src)
    data.update({"registry_id": new_id, "stars": 0, "forks": 0, "views": 0, "title": new_title or f"Fork of {src['title']}", "author": author, "forked_from": registry_id, "published_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()})
    store_put(db, NS_REGISTRY, new_id, data)
    src["forks"] += 1
    store_put(db, NS_REGISTRY, registry_id, src)
    return RegistryEntry(**data)

@router.get("/")
def list_experiments(limit: int = 20, sort_by: str = "stars", db: Session = Depends(get_db)):
    store_seed(db, NS_REGISTRY, _build_seed_records())
    all_entries = [RegistryEntry(**r) for r in store_list(db, NS_REGISTRY)]
    results = sorted(all_entries, key=lambda r: r.stars if sort_by == "stars" else r.published_at, reverse=True)[:limit]
    return {"experiments": results, "total": len(all_entries)}
