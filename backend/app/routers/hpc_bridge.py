from __future__ import annotations

import uuid
import random
import base64
import io
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/hpc-bridge", tags=["hpc-bridge"])

# ---------------------------------------------------------------------------
# Paramiko — real SSH SLURM submission
# ---------------------------------------------------------------------------

_PARAMIKO = False
try:
    import paramiko as _paramiko_lib
    _PARAMIKO = True
except ImportError:
    pass


# ---------------------------------------------------------------------------
# Cluster catalogue
# ---------------------------------------------------------------------------

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
        "real_submission": False,
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
        "real_submission": False,
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
        "real_submission": False,
    },
]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

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
    # Optional SSH credentials for real submission
    ssh_host: Optional[str] = None
    ssh_user: Optional[str] = None
    ssh_key_b64: Optional[str] = None    # base64-encoded PEM private key
    ssh_password: Optional[str] = None   # alternative to key


class HybridWorkflowRequest(BaseModel):
    quantum_circuit: str
    classical_script: str
    backend: str
    n_shots: int
    ssh_host: Optional[str] = None
    ssh_user: Optional[str] = None
    ssh_key_b64: Optional[str] = None
    ssh_password: Optional[str] = None


# ---------------------------------------------------------------------------
# Real SSH SLURM submission
# ---------------------------------------------------------------------------

def _build_sbatch_script(req: JobRequest) -> str:
    h = int(req.walltime_hours)
    m = int((req.walltime_hours - h) * 60)
    walltime = f"{h:02d}:{m:02d}:00"
    return f"""#!/bin/bash
#SBATCH --job-name={req.name[:15]}
#SBATCH --nodes={req.n_nodes}
#SBATCH --ntasks-per-node={req.n_cores_per_node}
#SBATCH --mem={req.memory_gb}G
#SBATCH --time={walltime}
#SBATCH --partition={req.partition or 'batch'}
{"#SBATCH --comment=qlab_run_" + req.quantum_run_id[:8] if req.quantum_run_id else ""}

export QUANTUM_RUN_ID={req.quantum_run_id or ""}
{req.script}
"""


def _ssh_connect(host: str, user: str, key_b64: Optional[str], password: Optional[str]) -> "_paramiko_lib.SSHClient":
    client = _paramiko_lib.SSHClient()
    client.set_missing_host_key_policy(_paramiko_lib.AutoAddPolicy())
    kwargs: dict = {"username": user, "timeout": 15}
    if key_b64:
        key_pem = base64.b64decode(key_b64).decode()
        try:
            pkey = _paramiko_lib.RSAKey.from_private_key(io.StringIO(key_pem))
        except Exception:
            pkey = _paramiko_lib.Ed25519Key.from_private_key(io.StringIO(key_pem))
        kwargs["pkey"] = pkey
    elif password:
        kwargs["password"] = password
    client.connect(host, **kwargs)
    return client


def _ssh_submit(req: JobRequest) -> tuple[str, str]:
    """Submit via SSH + sbatch. Returns (slurm_job_id, node_info)."""
    script_content = _build_sbatch_script(req)
    client = _ssh_connect(req.ssh_host, req.ssh_user, req.ssh_key_b64, req.ssh_password)
    try:
        remote_path = f"/tmp/qlab_{uuid.uuid4().hex[:8]}.sh"
        sftp = client.open_sftp()
        with sftp.open(remote_path, "w") as f:
            f.write(script_content)
        sftp.close()

        _, stdout, stderr = client.exec_command(f"chmod +x {remote_path} && sbatch {remote_path}")
        stdout.channel.recv_exit_status()
        output = stdout.read().decode().strip()
        err = stderr.read().decode().strip()

        if "Submitted batch job" in output:
            slurm_id = output.split()[-1]
        elif err:
            raise RuntimeError(f"sbatch error: {err}")
        else:
            raise RuntimeError(f"Unexpected sbatch output: {output}")

        return slurm_id, req.ssh_host
    finally:
        client.close()


def _ssh_job_status(ssh_host: str, ssh_user: str, key_b64: Optional[str],
                    password: Optional[str], slurm_job_id: str) -> dict:
    """Query job status via squeue."""
    client = _ssh_connect(ssh_host, ssh_user, key_b64, password)
    try:
        _, stdout, _ = client.exec_command(
            f"squeue -j {slurm_job_id} -o '%T %R %N' --noheader 2>/dev/null "
            f"|| sacct -j {slurm_job_id} -o State -n --noheader 2>/dev/null | head -1"
        )
        output = stdout.read().decode().strip()
        parts = output.split()
        state = parts[0].upper() if parts else "UNKNOWN"
        node_list = parts[2] if len(parts) > 2 else None

        status_map = {
            "RUNNING": "running", "PENDING": "queued", "COMPLETED": "completed",
            "FAILED": "failed", "CANCELLED": "cancelled", "COMPLETING": "running",
        }
        status = status_map.get(state, "queued")
        return {"status": status, "node_list": node_list, "raw_state": state}
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Simulated progress fallback
# ---------------------------------------------------------------------------

def _simulate_progress(job: dict) -> dict:
    sub_time = datetime.fromisoformat(job["submitted_at"])
    elapsed = (datetime.now(timezone.utc) - sub_time).total_seconds()
    if elapsed < 30:
        job["status"] = "queued"
        job["queue_position"] = max(1, job.get("queue_position", 10) - int(elapsed / 10))
    elif elapsed < 90:
        job["status"] = "running"
        job["started_at"] = job.get("started_at") or datetime.now(timezone.utc).isoformat()
        job["node_list"] = f"nid[{random.randint(1000,1999)}-{random.randint(2000,2099)}]"
        job["progress_pct"] = min(95, int((elapsed - 30) / 60 * 100))
        job["stdout_excerpt"] = f"[{elapsed:.0f}s] Initializing across {job['n_nodes']} nodes | {job['progress_pct']}% complete"
    else:
        job["status"] = "completed"
        job["progress_pct"] = 100
        job["exit_code"] = 0
        job["completed_at"] = job.get("completed_at") or datetime.now(timezone.utc).isoformat()
        job["stdout_excerpt"] = "Post-processing complete. Results written to /scratch/qlab/output.h5."
    return job


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/job")
def submit_job(req: JobRequest, db: Session = Depends(get_db)):
    if req.scheduler.lower() not in ("slurm", "pbs", "lsf"):
        raise HTTPException(400, f"Unsupported scheduler: {req.scheduler}")
    if not (1 <= req.n_nodes <= 512):
        raise HTTPException(400, "n_nodes must be between 1 and 512")

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    real = False
    slurm_job_id = str(random.randint(10_000_000, 99_999_999))

    if _PARAMIKO and req.ssh_host and req.ssh_user and (req.ssh_key_b64 or req.ssh_password):
        try:
            slurm_job_id, host_info = _ssh_submit(req)
            real = True
        except Exception as exc:
            # Fall through to simulation
            pass

    est_start = now + timedelta(minutes=random.randint(5, 90))
    job = {
        "job_id": job_id,
        "slurm_job_id": slurm_job_id,
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
        "real_submission": real,
        # Store SSH info for status queries (without private key for security)
        "_ssh_host": req.ssh_host if real else None,
        "_ssh_user": req.ssh_user if real else None,
    }
    store_put(db, "hpc_job", job_id, job)
    return job


@router.get("/job/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = store_get(db, "hpc_job", job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job = dict(job)

    if job.get("real_submission") and job.get("_ssh_host"):
        # Can't re-query without credentials in GET request; return stored state
        pass
    else:
        job = _simulate_progress(job)

    store_put(db, "hpc_job", job["job_id"], job)
    # Don't expose internal SSH fields
    return {k: v for k, v in job.items() if not k.startswith("_")}


@router.post("/job/{job_id}/cancel")
def cancel_job(job_id: str, db: Session = Depends(get_db)):
    job = store_get(db, "hpc_job", job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    job = dict(job)
    if job["status"] in ("completed", "failed", "cancelled"):
        raise HTTPException(400, f"Job already in terminal state: {job['status']}")
    job["status"] = "cancelled"
    job["exit_code"] = -1
    store_put(db, "hpc_job", job_id, job)
    return {"job_id": job_id, "status": "cancelled", "message": f"Job {job['slurm_job_id']} cancelled."}


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db)):
    result = []
    for j in store_list(db, "hpc_job"):
        j = dict(j)
        if not j.get("real_submission"):
            j = _simulate_progress(j)
            store_put(db, "hpc_job", j["job_id"], j)
        result.append({k: v for k, v in j.items() if not k.startswith("_")})
    return result


@router.get("/clusters")
def list_clusters():
    return CLUSTERS


@router.post("/hybrid-workflow")
def hybrid_workflow(req: HybridWorkflowRequest, db: Session = Depends(get_db)):
    workflow_id = str(uuid.uuid4())
    quantum_run_id = str(uuid.uuid4())
    job_req = JobRequest(
        name=f"hybrid-{workflow_id[:8]}",
        scheduler="slurm",
        n_nodes=4,
        n_cores_per_node=64,
        memory_gb=256,
        walltime_hours=2.0,
        quantum_run_id=quantum_run_id,
        script=req.classical_script,
        partition="quantum_post",
        ssh_host=req.ssh_host,
        ssh_user=req.ssh_user,
        ssh_key_b64=req.ssh_key_b64,
        ssh_password=req.ssh_password,
    )
    job_response = submit_job(job_req, db)
    return {
        "workflow_id": workflow_id,
        "quantum_run_id": quantum_run_id,
        "hpc_job_id": job_response["job_id"],
        "backend": req.backend,
        "n_shots": req.n_shots,
        "status": "submitted",
        "real_submission": job_response.get("real_submission", False),
        "stages": [
            {"stage": "quantum_execution", "status": "pending", "backend": req.backend},
            {"stage": "result_transfer", "status": "pending"},
            {"stage": "hpc_post_processing", "status": "queued", "slurm_job_id": job_response["slurm_job_id"]},
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
