from __future__ import annotations
import math, random, uuid, time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity
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


# ─────────────────────────────────────────────────────────────────────────────
# Real IBM Quantum job submission via qiskit-ibm-runtime
# ─────────────────────────────────────────────────────────────────────────────

def _submit_ibm_real(qasm: str, backend_name: str, n_shots: int, token: str) -> str:
    """Submit a real IBM Quantum job. Returns the IBM job ID."""
    from qiskit import QuantumCircuit
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    service = QiskitRuntimeService(token=token, channel="ibm_quantum")
    qc = QuantumCircuit.from_qasm_str(qasm)
    backend = service.backend(backend_name)
    sampler = SamplerV2(mode=backend)
    job = sampler.run([qc], shots=n_shots)
    return job.job_id()


def _poll_ibm_job(ibm_job_id: str, token: str) -> dict:
    """
    Poll an IBM Quantum job for status and results.
    Returns: {status, counts?, error?}
    Possible status values: 'queued', 'running', 'completed', 'failed', 'cancelled'.
    """
    from qiskit_ibm_runtime import QiskitRuntimeService

    service = QiskitRuntimeService(token=token, channel="ibm_quantum")
    job = service.job(ibm_job_id)
    status_raw = str(job.status()).lower()

    if "done" in status_raw or "completed" in status_raw:
        out: dict = {"status": "completed"}
        try:
            r = job.result()
            pub_result = r[0]
            counts: Dict[str, int] = {}
            # DataBin field names match the circuit's classical register names
            for fname, val in vars(pub_result.data).items():
                if hasattr(val, "get_counts"):
                    counts = val.get_counts()
                    break
            out["counts"] = counts
        except Exception:
            out["counts"] = {}
        return out
    elif "running" in status_raw:
        return {"status": "running"}
    elif "error" in status_raw or "failed" in status_raw:
        msg = ""
        try:
            msg = job.error_message()
        except Exception:
            pass
        return {"status": "failed", "error": msg or status_raw}
    elif "cancelled" in status_raw:
        return {"status": "cancelled"}
    else:
        return {"status": "queued"}


def _cancel_ibm_job(ibm_job_id: str, token: str) -> None:
    """Cancel a real IBM Quantum job."""
    from qiskit_ibm_runtime import QiskitRuntimeService
    service = QiskitRuntimeService(token=token, channel="ibm_quantum")
    service.job(ibm_job_id).cancel()


# ─────────────────────────────────────────────────────────────────────────────
# Job lifecycle helpers
# ─────────────────────────────────────────────────────────────────────────────

def _advance_job(job: Dict, db: Session) -> Dict:
    """Advance a job — real IBM poll or local simulation."""
    if job.get("ibm_job_id") and job.get("_user_id"):
        # Real IBM job: poll for status
        try:
            from .credentials import get_active_key_for_user
            token = get_active_key_for_user(db, "ibm", job["_user_id"])
            if token:
                result = _poll_ibm_job(job["ibm_job_id"], token)
                job["status"] = result["status"]
                if result["status"] == "running" and not job.get("started_at"):
                    job["started_at"] = _now()
                if result["status"] == "completed" and not job.get("completed_at"):
                    job["completed_at"] = _now()
                    counts = result.get("counts") or {}
                    total = sum(counts.values())
                    job["counts"] = counts
                    job["total_shots"] = total
                    job["success_probability"] = max(counts.values()) / total if total else 0
                if result["status"] == "failed":
                    job["error_message"] = result.get("error", "IBM job failed")
        except Exception:
            pass
        return job

    # Simulation: time-based state machine
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


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class JobSubmitRequest(BaseModel):
    qasm: str
    backend: str = "ibm_nairobi"
    n_shots: int = Field(default=1024, ge=1, le=100000)
    job_name: str = ""
    priority: str = "normal"


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def submit_job(
    req: JobSubmitRequest,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    if req.backend not in BACKENDS:
        raise HTTPException(400, f"Unknown backend. Available: {list(BACKENDS.keys())}")
    spec = BACKENDS[req.backend]
    job_id = str(uuid.uuid4())
    now = time.time()

    # Attempt real IBM submission when user has a token
    ibm_job_id: Optional[str] = None
    is_real = False
    submission_error: Optional[str] = None
    if identity and identity.user_id and req.backend.startswith("ibm"):
        try:
            from .credentials import get_active_key_for_user
            token = get_active_key_for_user(db, "ibm", identity.user_id)
            if token:
                ibm_job_id = _submit_ibm_real(req.qasm, req.backend, req.n_shots, token)
                is_real = True
        except ImportError:
            submission_error = "qiskit-ibm-runtime not installed"
        except Exception as e:
            submission_error = str(e)

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
        "ibm_job_id": ibm_job_id,
        "is_real": is_real,
        "simulation_note": None if is_real else (submission_error or "Simulated — connect IBM account in Settings for real execution"),
        "_qasm": req.qasm,
        "_submitted_ts": now,
        "_rng_seed": random.randint(0, 2**31),
        "_user_id": identity.user_id if identity else None,
    }
    store_put(db, NS, job_id, job)
    return {k: v for k, v in job.items() if not k.startswith('_')}


@router.get("")
def list_jobs(db: Session = Depends(get_db)):
    jobs = [_advance_job(j, db) for j in store_list(db, NS)]
    for j in jobs:
        store_put(db, NS, j["job_id"], j)
    return {"jobs": [{k: v for k, v in j.items() if not k.startswith('_')} for j in jobs], "total": len(jobs)}


@router.get("/backends")
def list_backends():
    return {"backends": [{"id": k, **v} for k, v in BACKENDS.items()]}


@router.get("/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = store_get(db, NS, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    job = _advance_job(job, db)
    store_put(db, NS, job_id, job)
    return {k: v for k, v in job.items() if not k.startswith('_')}


@router.delete("/{job_id}")
def cancel_job(
    job_id: str,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    job = store_get(db, NS, job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job["status"] == "completed":
        raise HTTPException(400, "Cannot cancel completed job")

    # Cancel on IBM if real job
    if job.get("ibm_job_id") and identity and identity.user_id:
        try:
            from .credentials import get_active_key_for_user
            token = get_active_key_for_user(db, "ibm", identity.user_id)
            if token:
                _cancel_ibm_job(job["ibm_job_id"], token)
        except Exception:
            pass

    job["status"] = "cancelled"
    store_put(db, NS, job_id, job)
    return {"cancelled": True, "job_id": job_id}
