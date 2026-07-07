from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/providers", tags=["providers"])

NS = "provider_batches"

PROVIDERS: dict = {
    "ibm_quantum": {
        "name": "IBM Quantum", "max_qubits": 156,
        "backends": ["ibm_brisbane", "ibm_kyoto", "ibm_osaka", "ibm_sherbrooke"],
        "cost_per_shot": 0.0, "free_tier": True, "avg_queue_min": 5,
        "native_gates": ["ecr", "id", "rz", "sx", "x"], "connectivity": "heavy_hex",
        "two_q_fidelity": 0.9985, "t1_us": 300.0, "t2_us": 200.0,
    },
    "aws_braket_ionq": {
        "name": "AWS Braket (IonQ Aria)", "max_qubits": 25,
        "backends": ["ionq_aria_1", "ionq_aria_2"],
        "cost_per_shot": 0.00097, "free_tier": False, "avg_queue_min": 2,
        "native_gates": ["ms", "gpi", "gpi2"], "connectivity": "all_to_all",
        "two_q_fidelity": 0.9972, "t1_us": 10000.0, "t2_us": 1000.0,
    },
    "aws_braket_rigetti": {
        "name": "AWS Braket (Rigetti Ankaa-2)", "max_qubits": 84,
        "backends": ["rigetti_ankaa_2"],
        "cost_per_shot": 0.00035, "free_tier": False, "avg_queue_min": 3,
        "native_gates": ["rx", "ry", "rz", "cz", "cphase"], "connectivity": "lattice_84",
        "two_q_fidelity": 0.9960, "t1_us": 28.0, "t2_us": 22.0,
    },
    "quantinuum": {
        "name": "Quantinuum H2-1", "max_qubits": 32,
        "backends": ["h2_1", "h2_1e"],
        "cost_per_shot": 0.0, "free_tier": False, "avg_queue_min": 60,
        "native_gates": ["rzz", "rz", "ry", "rx", "h"], "connectivity": "all_to_all",
        "two_q_fidelity": 0.9998, "t1_us": 3600.0, "t2_us": 1200.0,
    },
    "google_quantum_ai": {
        "name": "Google Sycamore", "max_qubits": 70,
        "backends": ["sycamore_70", "sycamore_53"],
        "cost_per_shot": 0.0, "free_tier": False, "avg_queue_min": 1440,
        "native_gates": ["cz", "phased_x", "t"], "connectivity": "sycamore_grid",
        "two_q_fidelity": 0.9940, "t1_us": 22.0, "t2_us": 18.0,
    },
    "iqm": {
        "name": "IQM Resonance", "max_qubits": 20,
        "backends": ["iqm_spark", "iqm_garnet"],
        "cost_per_shot": 0.00050, "free_tier": False, "avg_queue_min": 1,
        "native_gates": ["prx", "cz"], "connectivity": "star_20",
        "two_q_fidelity": 0.9970, "t1_us": 50.0, "t2_us": 40.0,
    },
}

class ProviderSubmitRequest(BaseModel):
    qasm: str
    provider_ids: list[str] = list(PROVIDERS.keys())[:3]
    n_shots: int = 1024
    circuit_name: str = "unnamed"

class ProviderJobResult(BaseModel):
    job_id: str
    provider_id: str
    provider_name: str
    backend: str
    status: str
    submitted_at: str
    estimated_completion: str
    n_shots: int
    cost_usd: float
    queue_position: int
    counts: dict
    fidelity_estimate: float
    transpiled_depth: int
    transpiled_gates: int
    success: bool
    error_message: str | None

class MultiProviderResult(BaseModel):
    batch_id: str
    circuit_name: str
    n_providers: int
    submitted_at: str
    jobs: list[ProviderJobResult]
    best_fidelity_provider: str
    lowest_cost_provider: str
    fastest_provider: str
    consensus_counts: dict
    agreement_score: float

def _simulate_job(provider_id: str, provider: dict, qasm: str, n_shots: int) -> ProviderJobResult:
    rng = random.Random(hash(provider_id + qasm) & 0xFFFFFF)
    n_qubits = max(1, qasm.count("qubit"))
    depth = max(1, qasm.count(";") - 2)
    fidelity = provider["two_q_fidelity"] ** max(1, depth * (n_qubits - 1) // 2)
    fidelity *= rng.uniform(0.97, 1.0)
    backend = rng.choice(provider["backends"])
    cost = provider["cost_per_shot"] * n_shots
    transpile_overhead = rng.uniform(1.1, 2.5)
    n_states = 2 ** min(n_qubits, 4)
    raw = [rng.random() for _ in range(n_states)]
    total = sum(raw)
    probs = [r / total for r in raw]
    counts = {format(i, f"0{min(n_qubits,4)}b"): int(p * n_shots * fidelity) for i, p in enumerate(probs)}
    return ProviderJobResult(
        job_id=str(uuid.uuid4())[:12],
        provider_id=provider_id,
        provider_name=provider["name"],
        backend=backend,
        status="completed",
        submitted_at=datetime.now(timezone.utc).isoformat(),
        estimated_completion=datetime.now(timezone.utc).isoformat(),
        n_shots=n_shots,
        cost_usd=round(cost, 6),
        queue_position=rng.randint(0, 20),
        counts=counts,
        fidelity_estimate=round(fidelity, 6),
        transpiled_depth=int(depth * transpile_overhead),
        transpiled_gates=int(depth * n_qubits * transpile_overhead * 0.6),
        success=True,
        error_message=None,
    )

def _consensus(jobs: list[ProviderJobResult]) -> tuple[dict, float]:
    all_keys: set = set()
    for j in jobs:
        all_keys.update(j.counts.keys())
    merged: dict = {}
    for k in all_keys:
        vals = [j.counts.get(k, 0) for j in jobs]
        merged[k] = int(sum(vals) / len(jobs))
    total = sum(merged.values()) or 1
    agreement = 1.0 - sum(abs(j.counts.get(max(merged, key=merged.get), 0) / j.n_shots - merged[max(merged, key=merged.get)] / total) for j in jobs) / len(jobs)
    return merged, round(max(0.0, agreement), 4)

@router.post("/submit", response_model=MultiProviderResult)
def submit_to_providers(req: ProviderSubmitRequest, db: Session = Depends(get_db)):
    jobs = []
    for pid in req.provider_ids:
        if pid in PROVIDERS:
            jobs.append(_simulate_job(pid, PROVIDERS[pid], req.qasm, req.n_shots))
    if not jobs:
        jobs.append(_simulate_job("ibm_quantum", PROVIDERS["ibm_quantum"], req.qasm, req.n_shots))
    best_fid = max(jobs, key=lambda j: j.fidelity_estimate).provider_id
    lowest_cost = min(jobs, key=lambda j: j.cost_usd).provider_id
    fastest = min(jobs, key=lambda j: PROVIDERS.get(j.provider_id, {}).get("avg_queue_min", 999)).provider_id
    consensus, agreement = _consensus(jobs)
    batch_id = str(uuid.uuid4())
    result = MultiProviderResult(
        batch_id=batch_id,
        circuit_name=req.circuit_name,
        n_providers=len(jobs),
        submitted_at=datetime.now(timezone.utc).isoformat(),
        jobs=jobs,
        best_fidelity_provider=best_fid,
        lowest_cost_provider=lowest_cost,
        fastest_provider=fastest,
        consensus_counts=consensus,
        agreement_score=agreement,
    )
    store_put(db, NS, batch_id, result.model_dump())
    return result

@router.get("")
def list_providers():
    return {"providers": [{"id": k, **{x: v[x] for x in ["name","max_qubits","backends","cost_per_shot","free_tier","avg_queue_min","two_q_fidelity","native_gates"]}} for k, v in PROVIDERS.items()]}

@router.get("/batch/{batch_id}")
def get_batch(batch_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS, batch_id)
    if data is None:
        return {"error": "batch not found"}
    return data

