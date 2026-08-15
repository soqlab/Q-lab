from __future__ import annotations
import uuid
import random
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from ..database import get_db
from ..store import store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/hpc-bridge", tags=["hpc-bridge"])

CLUSTERS = [
    {
        "cluster_id": "frontier-ornl",
        "name": "Frontier (ORNL)",
        "scheduler": "slurm",
        "total_nodes": 9408,
        "available_nodes": 312,
        "partitions": ["batch", "gpu", "quantum_post", "debug"],
        "typical_wait_minutes": 18,
        "max_walltime_hours": 24,
        "location": "Oak Ridge, TN",
    },
    {
        "cluster_id": "perlmutter-nersc",
        "name": "Perlmutter (NERSC)",
        "scheduler": "slurm",
        "total_nodes": 3072,
        "available_nodes": 87,
        "partitions": ["regular", "premium", "preempt", "gpu"],
        "typical_wait_minutes": 42,
        "max_walltime_hours": 48,
        "location": "Berkeley, CA",
    },
    {
        "cluster_id": "summit-ornl",
        "name": "Summit (ORNL)",
        "scheduler": "lsf",
        "total_nodes": 4608,
        "available_nodes": 204,
        "partitions": ["batch", "killable", "debug"],
        "typical_wait_minutes": 27,
        "max_walltime_hours": 24,
        "location": "Oak Ridge, TN",
    },
]

_SIM_NOTE = "HPC job simulated locally — not submitted to Frontier/Perlmutter/Summit"


class JobRequest(BaseModel):
    name: str
    scheduler: str
    n_nodes: int
    n_cores_per_node: int
    memory_gb: int
    walltime_hours: float
    quantum_run_id: Optional[str] = None
    script: str
    partition: Optional[str] = "batch"


class HybridWorkflowRequest(BaseModel):
    quantum_circuit: str
    classical_script: str
    backend: str
    n_shots: int


def _slurm_job_id() -> str:
    return str(random.randint(10000000, 99999999))


def _make_job(req: JobRequest) -> dict:
    jid = str(uuid.uuid4())
    slurm_id = _slurm_job_id()
    now = datetime.now(timezone.utc)
    est_start = now + timedelta(minutes=random.randint(5, 90))
    return {
        "job_id": jid,
        "slurm_job_id": slurm_id,
        "name": req.name,
        "scheduler": req.scheduler,
        "partition": req.partition or "batch",
        "n_nodes": req.n_nodes,
        "n_cores_per_node": req.n_cores_per_node,
        "total_cores": req.n_nodes * req.n_cores_per_node,
        "memory_gb": req.memory_gb,
        "walltime_hours": req.walltime_hours,
        "quantum_run_id": req.quantum_run_id,
        "script": req.script,
        "status": "queued",
        "queue_position": random.randint(1, 25),
        "progress_pct": 0,
        "submitted_at": now.isoformat(),
        "estimated_start": est_start.isoformat(),
        "started_at": None,
        "completed_at": None,
        "node_list": None,
        "stdout_excerpt": "",
        "exit_code": None,
    }


def _simulate_progress(job: dict) -> dict:
    sub_time = datetime.fromisoformat(job["submitted_at"])
    elapsed = (datetime.now(timezone.utc) - sub_time).total_seconds()
    if elapsed < 30:
        job["status"] = "queued"
        job["queue_position"] = max(1, job["queue_position"] - int(elapsed / 10))
    elif elapsed < 90:
        job["status"] = "running"
        job["started_at"] = job["started_at"] or datetime.now(timezone.utc).isoformat()
        job["node_list"] = f"nid[{random.randint(1000,1999)}-{random.randint(2000,2099)}]"
        job["progress_pct"] = min(95, int((elapsed - 30) / 60 * 100))
        job["stdout_excerpt"] = f"[{elapsed:.0f}s] Initializing MPI ranks across {job['n_nodes']} nodes | Loading tensors | Post-processing {job['progress_pct']}% complete"
    else:
        job["status"] = "completed"
        job["progress_pct"] = 100
        job["exit_code"] = 0
        job["completed_at"] = job["completed_at"] or datetime.now(timezone.utc).isoformat()
        job["stdout_excerpt"] = "Post-processing complete. Statevector reconstructed: 2048 amplitudes. S=0.6931. Results written to /scratch/qlab/output.h5."
    return job


@router.post("/job")
def submit_job(req: JobRequest, db: Session = Depends(get_db)):
    if req.scheduler.lower() not in ("slurm", "pbs", "lsf"):
        raise HTTPException(400, f"Unsupported scheduler: {req.scheduler}")
    if req.n_nodes < 1 or req.n_nodes > 512:
        raise HTTPException(400, "n_nodes must be between 1 and 512")
    job = _make_job(req)
    store_put(db, "hpc_job", job["job_id"], job)
    return {**job, "is_simulated": True, "simulation_note": _SIM_NOTE}


@router.get("/job/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = store_get(db, "hpc_job", job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job = _simulate_progress(job)
    store_put(db, "hpc_job", job["job_id"], job)
    return {**job, "is_simulated": True, "simulation_note": _SIM_NOTE}


@router.post("/job/{job_id}/cancel")
def cancel_job(job_id: str, db: Session = Depends(get_db)):
    job = store_get(db, "hpc_job", job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] in ("completed", "failed", "cancelled"):
        raise HTTPException(400, f"Job already in terminal state: {job['status']}")
    job["status"] = "cancelled"
    job["exit_code"] = -1
    store_put(db, "hpc_job", job_id, job)
    return {"job_id": job_id, "status": "cancelled", "message": f"SLURM job {job['slurm_job_id']} cancelled."}


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db)):
    jobs = store_list(db, "hpc_job")
    result = []
    for j in jobs:
        updated = _simulate_progress(j)
        store_put(db, "hpc_job", updated["job_id"], updated)
        result.append(updated)
    return result


@router.get("/clusters")
def list_clusters():
    return CLUSTERS


@router.post("/hybrid-workflow")
def hybrid_workflow(req: HybridWorkflowRequest, db: Session = Depends(get_db)):
    workflow_id = str(uuid.uuid4())
    quantum_run_id = str(uuid.uuid4())
    job_req = JobRequest(
        name=f"hybrid-postproc-{workflow_id[:8]}",
        scheduler="slurm",
        n_nodes=4,
        n_cores_per_node=64,
        memory_gb=256,
        walltime_hours=2.0,
        quantum_run_id=quantum_run_id,
        script=req.classical_script,
        partition="quantum_post",
    )
    job = _make_job(job_req)
    store_put(db, "hpc_job", job["job_id"], job)
    return {
        "workflow_id": workflow_id,
        "quantum_run_id": quantum_run_id,
        "hpc_job_id": job["job_id"],
        "backend": req.backend,
        "n_shots": req.n_shots,
        "status": "submitted",
        "stages": [
            {"stage": "quantum_execution", "status": "pending", "backend": req.backend},
            {"stage": "result_transfer", "status": "pending"},
            {"stage": "hpc_post_processing", "status": "queued", "slurm_job_id": job["slurm_job_id"]},
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
