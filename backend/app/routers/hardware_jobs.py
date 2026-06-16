from __future__ import annotations
import math, random, uuid, time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/hardware-jobs", tags=["hardware_jobs"])

NS = "hardware_jobs"

BACKENDS: Dict[str, Any] = {
    "ibm_nairobi":    {"provider": "IBM", "n_qubits": 7,   "topology": "heavy-hex",   "gate_error": 0.0015, "readout_error": 0.012, "t1_us": 180, "t2_us": 120, "clops": 2100, "queue_depth": 3},
    "ibm_kyoto":      {"provider": "IBM", "n_qubits": 127,  "topology": "heavy-hex",   "gate_error": 0.002,  "readout_error": 0.018, "t1_us": 150, "t2_us": 90,  "clops": 1800, "queue_depth": 12},
    "ionq_aria":      {"provider": "IonQ","n_qubits": 25,   "topology": "all-to-all",  "gate_error": 0.0005, "readout_error": 0.004, "t1_us": 10000,"t2_us": 8000,"clops": 500,  "queue_depth": 2},
    "rigetti_aspen":  {"provider": "Rigetti","n_qubits": 80,"topology": "octagonal",   "gate_error": 0.008,  "readout_error": 0.03,  "t1_us": 20,  "t2_us": 15,  "clops": 800,  "queue_depth": 1},
    "quantinuum_h1":  {"provider": "Quantinuum","n_qubits":20,"topology":"all-to-all", "gate_error": 0.0003, "readout_error": 0.002, "t1_us": 30000,"t2_us":25000,"clops": 300,  "queue_depth": 5},
}

def _now(): return datetime.now(timezone.utc).isoformat()

def _parse_n_qubits(qasm: str) -> int:
    import re
    m = re.search(r'qreg\s+\w+\[(\d+)\]', qasm)
    return int(m.group(1)) if m else 2

def _simulate_counts(qasm: str, backend_key: str, n_shots: int, rng: random.Random) -> Dict[str, int]:
    spec = BACKENDS.get(backend_key, BACKENDS["ibm_nairobi"])
    n_q = _parse_n_qubits(qasm)
    n_q = min(n_q, 10)
    size = 1 << n_q
    probs = [rng.random() for _ in range(size)]
    total = sum(probs)
    probs = [p/total for p in probs]
    noise = spec["readout_error"]
    probs = [(1-noise)*p + noise/size for p in probs]
    total = sum(probs); probs = [p/total for p in probs]
    counts: Dict[str, int] = {}
    for _ in range(n_shots):
        r = rng.random(); cum = 0.0
        for i, p in enumerate(probs):
            cum += p
            if r < cum:
                key = format(i, f'0{n_q}b')
                counts[key] = counts.get(key, 0) + 1
                break
    return counts

class JobSubmitRequest(BaseModel):
    qasm: str
    backend: str = "ibm_nairobi"
    n_shots: int = Field(default=1024, ge=1, le=100000)
    job_name: str = ""
    priority: str = "normal"

@router.post("")
def submit_job(req: JobSubmitRequest, db: Session = Depends(get_db)):
    if req.backend not in BACKENDS:
        raise HTTPException(400, f"Unknown backend. Available: {list(BACKENDS.keys())}")
    spec = BACKENDS[req.backend]
    job_id = str(uuid.uuid4())
    now = time.time()
    q_depth = spec["queue_depth"]
    est_queue = q_depth * 30 + random.randint(5, 20)
    job = {
        "job_id": job_id,
        "job_name": req.job_name or f"job-{job_id[:8]}",
        "backend": req.backend,
        "provider": spec["provider"],
        "n_shots": req.n_shots,
        "status": "queued",
        "priority": req.priority,
        "submitted_at": _now(),
        "started_at": None,
        "completed_at": None,
        "estimated_queue_time_s": est_queue,
        "queue_position": q_depth,
        "counts": None,
        "success_probability": None,
        "total_shots": None,
        "backend_specs": spec,
        "error_message": None,
        "_qasm": req.qasm,
        "_submitted_ts": now,
        "_rng_seed": random.randint(0, 2**31),
    }
    store_put(db, NS, job_id, job)
    return {k: v for k, v in job.items() if not k.startswith('_')}

def _advance_job(job: Dict) -> Dict:
    elapsed = time.time() - job["_submitted_ts"]
    if job["status"] == "queued" and elapsed > 5:
        job["status"] = "running"
        job["started_at"] = _now()
        job["queue_position"] = 0
    if job["status"] == "running" and elapsed > 12:
        rng = random.Random(job["_rng_seed"])
        counts = _simulate_counts(job["_qasm"], job["backend"], job["n_shots"], rng)
        total = sum(counts.values())
        job["status"] = "completed"
        job["completed_at"] = _now()
        job["counts"] = counts
        job["total_shots"] = total
        job["success_probability"] = max(counts.values()) / total if total else 0
    return job

@router.get("")
def list_jobs(db: Session = Depends(get_db)):
    jobs = [_advance_job(j) for j in store_list(db, NS)]
    for j in jobs:
        store_put(db, NS, j["job_id"], j)
    return {"jobs": [{k:v for k,v in j.items() if not k.startswith('_')} for j in jobs], "total": len(jobs)}

@router.get("/backends")
def list_backends():
    return {"backends": [{"id": k, **v} for k, v in BACKENDS.items()]}

@router.get("/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = store_get(db, NS, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    job = _advance_job(job)
    store_put(db, NS, job_id, job)
    return {k: v for k, v in job.items() if not k.startswith('_')}

@router.delete("/{job_id}")
def cancel_job(job_id: str, db: Session = Depends(get_db)):
    job = store_get(db, NS, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job["status"] == "completed":
        raise HTTPException(400, "Cannot cancel completed job")
    job["status"] = "cancelled"
    store_put(db, NS, job_id, job)
    return {"cancelled": True, "job_id": job_id}
