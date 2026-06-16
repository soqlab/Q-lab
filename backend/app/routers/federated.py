from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_seed
from ..models import Run

router = APIRouter(prefix="/api/v1/federated", tags=["federated"])

NS = "federated_results"

CATEGORIES = ["optimization", "chemistry", "ml", "crypto", "simulation"]

# ------------------------------------------------------------------
# Pydantic models
# ------------------------------------------------------------------

class FederatedResult(BaseModel):
    result_id: str
    contributed_by: str
    algorithm: str
    backend: str
    n_qubits: int
    circuit_depth: int
    n_shots: int
    success_probability: float
    health_score: float
    error_rate: float
    t1_at_runtime: Optional[float] = None
    t2_at_runtime: Optional[float] = None
    algorithm_category: str
    noise_model: Optional[str] = None
    error_mitigation: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    contributed_at: str
    verified: bool


class ContributeRequest(BaseModel):
    algorithm: str
    backend: str
    n_qubits: int
    circuit_depth: int
    n_shots: int
    success_probability: float
    health_score: float
    error_rate: float
    t1_at_runtime: Optional[float] = None
    t2_at_runtime: Optional[float] = None
    algorithm_category: str = "optimization"
    noise_model: Optional[str] = None
    error_mitigation: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    contributed_by: str = "anonymous"


# ------------------------------------------------------------------
# Seed data
# ------------------------------------------------------------------

def _seed_data() -> List[tuple[str, dict]]:
    now = datetime.now(timezone.utc)

    def _ts(days_ago: int) -> str:
        return (now - timedelta(days=days_ago)).isoformat()

    records = [
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "mit-qc-lab",
            "algorithm": "vqe",
            "backend": "ibm_sherbrooke",
            "n_qubits": 8,
            "circuit_depth": 45,
            "n_shots": 8192,
            "success_probability": 0.87,
            "health_score": 82.4,
            "error_rate": 0.031,
            "t1_at_runtime": 112.3,
            "t2_at_runtime": 94.7,
            "algorithm_category": "chemistry",
            "noise_model": "ibm_noise_v2",
            "error_mitigation": "zne",
            "tags": ["h2", "vqe", "chemistry"],
            "contributed_at": _ts(5),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "anonymous",
            "algorithm": "qaoa",
            "backend": "ionq_harmony",
            "n_qubits": 12,
            "circuit_depth": 32,
            "n_shots": 4096,
            "success_probability": 0.79,
            "health_score": 74.1,
            "error_rate": 0.048,
            "t1_at_runtime": 10000.0,
            "t2_at_runtime": 2000.0,
            "algorithm_category": "optimization",
            "noise_model": None,
            "error_mitigation": "mem",
            "tags": ["maxcut", "qaoa"],
            "contributed_at": _ts(3),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "caltech-iqim",
            "algorithm": "grover",
            "backend": "ibm_brisbane",
            "n_qubits": 6,
            "circuit_depth": 18,
            "n_shots": 2048,
            "success_probability": 0.91,
            "health_score": 88.7,
            "error_rate": 0.019,
            "t1_at_runtime": 142.5,
            "t2_at_runtime": 118.2,
            "algorithm_category": "crypto",
            "noise_model": "depolarizing",
            "error_mitigation": "none",
            "tags": ["grover", "search"],
            "contributed_at": _ts(7),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "stanford-qis",
            "algorithm": "qft",
            "backend": "rigetti_aspen_m3",
            "n_qubits": 10,
            "circuit_depth": 28,
            "n_shots": 16384,
            "success_probability": 0.73,
            "health_score": 68.9,
            "error_rate": 0.062,
            "t1_at_runtime": 38.4,
            "t2_at_runtime": 29.1,
            "algorithm_category": "simulation",
            "noise_model": "rigetti_kraus",
            "error_mitigation": "pec",
            "tags": ["qft", "fourier"],
            "contributed_at": _ts(12),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "anonymous",
            "algorithm": "vqe",
            "backend": "ibm_sherbrooke",
            "n_qubits": 16,
            "circuit_depth": 72,
            "n_shots": 8192,
            "success_probability": 0.68,
            "health_score": 63.2,
            "error_rate": 0.089,
            "t1_at_runtime": 108.1,
            "t2_at_runtime": 87.4,
            "algorithm_category": "chemistry",
            "noise_model": "ibm_noise_v2",
            "error_mitigation": "zne",
            "tags": ["lih", "vqe", "molecules"],
            "contributed_at": _ts(9),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "eth-quantum",
            "algorithm": "qaoa",
            "backend": "ibm_nairobi",
            "n_qubits": 7,
            "circuit_depth": 22,
            "n_shots": 4096,
            "success_probability": 0.84,
            "health_score": 79.3,
            "error_rate": 0.042,
            "t1_at_runtime": 95.6,
            "t2_at_runtime": 71.2,
            "algorithm_category": "optimization",
            "noise_model": None,
            "error_mitigation": "mem",
            "tags": ["portfolio", "qaoa"],
            "contributed_at": _ts(2),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "anonymous",
            "algorithm": "custom",
            "backend": "ionq_aria",
            "n_qubits": 20,
            "circuit_depth": 55,
            "n_shots": 1024,
            "success_probability": 0.93,
            "health_score": 91.2,
            "error_rate": 0.012,
            "t1_at_runtime": 50000.0,
            "t2_at_runtime": 15000.0,
            "algorithm_category": "ml",
            "noise_model": None,
            "error_mitigation": "none",
            "tags": ["qml", "classification"],
            "contributed_at": _ts(1),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "chicago-pritzker",
            "algorithm": "vqe",
            "backend": "ibm_cairo",
            "n_qubits": 5,
            "circuit_depth": 30,
            "n_shots": 8192,
            "success_probability": 0.89,
            "health_score": 85.6,
            "error_rate": 0.026,
            "t1_at_runtime": 128.9,
            "t2_at_runtime": 101.3,
            "algorithm_category": "chemistry",
            "noise_model": "ibm_noise_v1",
            "error_mitigation": "zne",
            "tags": ["beh2", "vqe"],
            "contributed_at": _ts(15),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "anonymous",
            "algorithm": "grover",
            "backend": "ibm_brisbane",
            "n_qubits": 8,
            "circuit_depth": 25,
            "n_shots": 2048,
            "success_probability": 0.77,
            "health_score": 72.4,
            "error_rate": 0.054,
            "t1_at_runtime": 135.0,
            "t2_at_runtime": 112.5,
            "algorithm_category": "crypto",
            "noise_model": "depolarizing",
            "error_mitigation": "none",
            "tags": ["grover", "8qubit"],
            "contributed_at": _ts(4),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "tum-qc",
            "algorithm": "qaoa",
            "backend": "rigetti_aspen_m3",
            "n_qubits": 14,
            "circuit_depth": 40,
            "n_shots": 4096,
            "success_probability": 0.71,
            "health_score": 66.8,
            "error_rate": 0.073,
            "t1_at_runtime": 35.2,
            "t2_at_runtime": 27.8,
            "algorithm_category": "optimization",
            "noise_model": "rigetti_kraus",
            "error_mitigation": "pec",
            "tags": ["tsp", "routing"],
            "contributed_at": _ts(8),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "anonymous",
            "algorithm": "qft",
            "backend": "ionq_harmony",
            "n_qubits": 8,
            "circuit_depth": 20,
            "n_shots": 8192,
            "success_probability": 0.95,
            "health_score": 93.1,
            "error_rate": 0.009,
            "t1_at_runtime": 12000.0,
            "t2_at_runtime": 3500.0,
            "algorithm_category": "simulation",
            "noise_model": None,
            "error_mitigation": "none",
            "tags": ["qft", "ionq"],
            "contributed_at": _ts(6),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "oxford-mpl",
            "algorithm": "custom",
            "backend": "ibm_sherbrooke",
            "n_qubits": 10,
            "circuit_depth": 38,
            "n_shots": 16384,
            "success_probability": 0.82,
            "health_score": 77.9,
            "error_rate": 0.038,
            "t1_at_runtime": 115.2,
            "t2_at_runtime": 96.4,
            "algorithm_category": "ml",
            "noise_model": "ibm_noise_v2",
            "error_mitigation": "mem",
            "tags": ["qsvm", "kernel"],
            "contributed_at": _ts(11),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "anonymous",
            "algorithm": "vqe",
            "backend": "ionq_aria",
            "n_qubits": 14,
            "circuit_depth": 60,
            "n_shots": 4096,
            "success_probability": 0.88,
            "health_score": 84.3,
            "error_rate": 0.022,
            "t1_at_runtime": 45000.0,
            "t2_at_runtime": 12000.0,
            "algorithm_category": "chemistry",
            "noise_model": None,
            "error_mitigation": "zne",
            "tags": ["uccsd", "vqe", "trapped-ion"],
            "contributed_at": _ts(0),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "nist-boulder",
            "algorithm": "grover",
            "backend": "ibm_cairo",
            "n_qubits": 5,
            "circuit_depth": 14,
            "n_shots": 8192,
            "success_probability": 0.96,
            "health_score": 94.7,
            "error_rate": 0.007,
            "t1_at_runtime": 133.7,
            "t2_at_runtime": 109.8,
            "algorithm_category": "crypto",
            "noise_model": "ibm_noise_v1",
            "error_mitigation": "zne",
            "tags": ["grover", "optimal", "ibm"],
            "contributed_at": _ts(20),
            "verified": True,
        },
        {
            "result_id": str(uuid.uuid4()),
            "contributed_by": "anonymous",
            "algorithm": "qaoa",
            "backend": "ionq_aria",
            "n_qubits": 18,
            "circuit_depth": 48,
            "n_shots": 2048,
            "success_probability": 0.90,
            "health_score": 87.5,
            "error_rate": 0.016,
            "t1_at_runtime": 48000.0,
            "t2_at_runtime": 14000.0,
            "algorithm_category": "optimization",
            "noise_model": None,
            "error_mitigation": "none",
            "tags": ["large-scale", "qaoa", "trapped-ion"],
            "contributed_at": _ts(13),
            "verified": True,
        },
    ]
    return [(r["result_id"], r) for r in records]


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _sanity_check(req: ContributeRequest) -> bool:
    if not (0.0 <= req.success_probability <= 1.0):
        return False
    if not (1 <= req.n_qubits <= 1000):
        return False
    if not (0.0 <= req.health_score <= 100.0):
        return False
    return True


def _filter_results(
    results: List[dict],
    algorithm_category: Optional[str],
    backend: Optional[str],
    min_qubits: Optional[int],
    max_qubits: Optional[int],
    min_health_score: Optional[float],
    algorithm: Optional[str],
) -> List[dict]:
    out = results
    if algorithm_category:
        out = [r for r in out if r.get("algorithm_category") == algorithm_category]
    if backend:
        out = [r for r in out if r.get("backend") == backend]
    if min_qubits is not None:
        out = [r for r in out if r.get("n_qubits", 0) >= min_qubits]
    if max_qubits is not None:
        out = [r for r in out if r.get("n_qubits", 0) <= max_qubits]
    if min_health_score is not None:
        out = [r for r in out if r.get("health_score", 0) >= min_health_score]
    if algorithm:
        out = [r for r in out if r.get("algorithm") == algorithm]
    return out


def _compute_stats(results: List[dict]) -> dict:
    total = len(results)
    if total == 0:
        return {
            "total_contributions": 0,
            "unique_backends": 0,
            "unique_algorithms": 0,
            "avg_health_score_by_backend": {},
            "avg_health_score_by_algorithm": {},
            "contributions_last_30_days": 0,
        }

    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=30)).isoformat()

    backends: Dict[str, List[float]] = {}
    algorithms: Dict[str, List[float]] = {}
    recent = 0

    for r in results:
        b = r.get("backend", "unknown")
        a = r.get("algorithm", "unknown")
        hs = r.get("health_score", 0.0)
        backends.setdefault(b, []).append(hs)
        algorithms.setdefault(a, []).append(hs)
        if r.get("contributed_at", "") >= cutoff:
            recent += 1

    avg_by_backend = {b: round(sum(v) / len(v), 2) for b, v in backends.items()}
    avg_by_algo = {a: round(sum(v) / len(v), 2) for a, v in algorithms.items()}
    all_hs = [r.get("health_score", 0.0) for r in results]

    return {
        "total_contributions": total,
        "unique_backends": len(backends),
        "unique_algorithms": len(algorithms),
        "avg_health_score": round(sum(all_hs) / len(all_hs), 2) if all_hs else 0.0,
        "avg_health_score_by_backend": avg_by_backend,
        "avg_health_score_by_algorithm": avg_by_algo,
        "contributions_last_30_days": recent,
    }


# ------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------

@router.post("/contribute", response_model=FederatedResult)
def contribute(req: ContributeRequest, db: Session = Depends(get_db)) -> FederatedResult:
    """Submit an anonymized quantum experiment result to the federated registry."""
    if not _sanity_check(req):
        raise HTTPException(
            status_code=422,
            detail="Validation failed: success_probability must be in [0,1], n_qubits in [1,1000], health_score in [0,100].",
        )

    result = FederatedResult(
        result_id=str(uuid.uuid4()),
        contributed_by=req.contributed_by or "anonymous",
        algorithm=req.algorithm,
        backend=req.backend,
        n_qubits=req.n_qubits,
        circuit_depth=req.circuit_depth,
        n_shots=req.n_shots,
        success_probability=req.success_probability,
        health_score=req.health_score,
        error_rate=req.error_rate,
        t1_at_runtime=req.t1_at_runtime,
        t2_at_runtime=req.t2_at_runtime,
        algorithm_category=req.algorithm_category,
        noise_model=req.noise_model,
        error_mitigation=req.error_mitigation,
        tags=req.tags,
        contributed_at=datetime.now(timezone.utc).isoformat(),
        verified=True,
    )
    store_put(db, NS, result.result_id, result.model_dump())
    return result


@router.get("/results")
def list_results(
    algorithm_category: Optional[str] = None,
    backend: Optional[str] = None,
    min_qubits: Optional[int] = Query(default=None, ge=1),
    max_qubits: Optional[int] = Query(default=None, ge=1),
    min_health_score: Optional[float] = Query(default=None, ge=0.0, le=100.0),
    algorithm: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict:
    """Browse the federated registry with optional filters."""
    store_seed(db, NS, _seed_data())

    all_results = store_list(db, NS)
    filtered = _filter_results(
        all_results, algorithm_category, backend, min_qubits, max_qubits, min_health_score, algorithm
    )
    # Sort by health_score desc
    filtered.sort(key=lambda r: r.get("health_score", 0), reverse=True)
    paginated = filtered[:limit]

    total = len(filtered)
    all_hs = [r.get("health_score", 0.0) for r in all_results]
    avg_hs = round(sum(all_hs) / len(all_hs), 2) if all_hs else 0.0

    backends = [r.get("backend") for r in all_results if r.get("backend")]
    algos = [r.get("algorithm") for r in all_results if r.get("algorithm")]
    top_backend = max(set(backends), key=backends.count) if backends else None
    top_algo = max(set(algos), key=algos.count) if algos else None

    return {
        "results": paginated,
        "total": total,
        "stats": {
            "avg_health_score": avg_hs,
            "top_backend": top_backend,
            "top_algorithm": top_algo,
            "total_contributed": len(all_results),
        },
    }


@router.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db)) -> dict:
    """Top 10 results per algorithm category sorted by health score."""
    store_seed(db, NS, _seed_data())

    all_results = store_list(db, NS)
    by_category: Dict[str, List[dict]] = {cat: [] for cat in CATEGORIES}

    for r in all_results:
        cat = r.get("algorithm_category")
        if cat in by_category:
            by_category[cat].append(r)

    leaderboard_data: Dict[str, List[dict]] = {}
    for cat, items in by_category.items():
        top = sorted(items, key=lambda x: x.get("health_score", 0), reverse=True)[:10]
        leaderboard_data[cat] = top

    return {"by_category": leaderboard_data}


@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    """Aggregate statistics across the entire federated registry."""
    store_seed(db, NS, _seed_data())
    all_results = store_list(db, NS)
    return _compute_stats(all_results)


@router.post("/contribute-from-run/{run_id}", response_model=FederatedResult)
def contribute_from_run(
    run_id: str,
    contributed_by: str = "anonymous",
    db: Session = Depends(get_db),
) -> FederatedResult:
    """Auto-extract an anonymized result from an existing Q-Lab run and contribute it."""
    from sqlalchemy import select

    run: Optional[Run] = db.execute(select(Run).where(Run.run_id == run_id)).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    # Extract anonymized metrics from run
    fp = run.fingerprint or {}
    res = run.results or {}
    ex = run.execution or {}
    cal = run.calibration or {}

    n_qubits = fp.get("num_qubits") or 1
    circuit_depth = fp.get("depth") or 1
    n_shots = res.get("shots") or ex.get("shots") or 1024
    success_probability = float(res.get("success_probability") or 0.0)
    error_rate = float(res.get("error_rate") or (1.0 - success_probability) * 0.5)

    # Health score from calibration or default
    from ..health_score import compute_health_score
    run_dict = {
        "fingerprint": fp,
        "results": res,
        "execution": ex,
        "calibration": cal,
        "backend": run.backend,
        "transpiler": run.transpiler or {},
    }
    health_score = float(compute_health_score(run_dict) or 50.0)

    # T1/T2 from calibration
    t1 = cal.get("t1") or cal.get("T1")
    t2 = cal.get("t2") or cal.get("T2")
    if isinstance(t1, dict):
        vals = list(t1.values())
        t1 = sum(vals) / len(vals) if vals else None
    if isinstance(t2, dict):
        vals = list(t2.values())
        t2 = sum(vals) / len(vals) if vals else None

    # Infer category from circuit name / tags / algorithm
    tags = list(run.tags or [])
    circuit_name_lower = (run.circuit_name or "").lower()
    category = "simulation"
    for cat, keywords in {
        "chemistry": ["vqe", "h2", "lih", "molecule", "chem", "uccsd"],
        "optimization": ["qaoa", "maxcut", "portfolio", "tsp", "optim"],
        "ml": ["qml", "qsvm", "classify", "kernel", "neural"],
        "crypto": ["grover", "shor", "qkd", "crypto"],
    }.items():
        if any(kw in circuit_name_lower or kw in " ".join(tags).lower() for kw in keywords):
            category = cat
            break

    result = FederatedResult(
        result_id=str(uuid.uuid4()),
        contributed_by=contributed_by or "anonymous",
        algorithm=run.circuit_name or "custom",
        backend=run.backend or "unknown",
        n_qubits=int(n_qubits),
        circuit_depth=int(circuit_depth),
        n_shots=int(n_shots),
        success_probability=min(1.0, max(0.0, success_probability)),
        health_score=min(100.0, max(0.0, health_score)),
        error_rate=min(1.0, max(0.0, error_rate)),
        t1_at_runtime=float(t1) if t1 is not None else None,
        t2_at_runtime=float(t2) if t2 is not None else None,
        algorithm_category=category,
        noise_model=None,
        error_mitigation=None,
        tags=tags,
        contributed_at=datetime.now(timezone.utc).isoformat(),
        verified=True,
    )
    store_put(db, NS, result.result_id, result.model_dump())
    return result
