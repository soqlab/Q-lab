from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/backend-emulator", tags=["backend-emulator"])

NS_JOBS = "emulator_jobs"

BACKENDS = {
    "ibm_brisbane": {"t1":280,"t2":150,"1q_err":0.0003,"2q_err":0.003,"readout":0.01,"connectivity":"heavy_hex","qv":256},
    "ibm_kyoto": {"t1":260,"t2":140,"1q_err":0.0004,"2q_err":0.0035,"readout":0.012,"connectivity":"heavy_hex","qv":128},
    "ionq_aria_1": {"t1":10000,"t2":5000,"1q_err":0.00005,"2q_err":0.0005,"readout":0.003,"connectivity":"all_to_all","qv":65536},
    "rigetti_ankaa_2": {"t1":180,"t2":90,"1q_err":0.0005,"2q_err":0.005,"readout":0.02,"connectivity":"square","qv":32},
    "quantinuum_h2": {"t1":3000,"t2":2000,"1q_err":0.00002,"2q_err":0.0002,"readout":0.001,"connectivity":"all_to_all","qv":65536},
    "google_willow": {"t1":400,"t2":200,"1q_err":0.0001,"2q_err":0.001,"readout":0.005,"connectivity":"sycamore","qv":4096},
}

class EmulationJob(BaseModel):
    job_id: str; created_at: str; source_backend: str; target_backend: str
    n_qubits: int; circuit_depth: int; n_shots: int
    source_fidelity: float; emulated_fidelity: float; fidelity_delta: float
    source_counts: dict; emulated_counts: dict
    noise_model_mapping: dict; connectivity_penalty: float
    gate_error_scaling: float; t1_scaling: float; t2_scaling: float
    depth_penalty: int; swap_overhead: int
    cross_backend_agreement: float; confidence: float
    warnings: list[str]; recommendations: list[str]

class EmulateRequest(BaseModel):
    source_backend: str = "ibm_brisbane"; target_backend: str = "ionq_aria_1"
    n_qubits: int = 5; circuit_depth: int = 20; n_shots: int = 8192
    source_counts: dict = {}; circuit_qasm: str = ""

@router.post("/emulate", response_model=EmulationJob)
def emulate(req: EmulateRequest, db: Session = Depends(get_db)):
    rng = random.Random(hash(req.source_backend + req.target_backend) & 0xFFFFFF)
    if req.source_backend not in BACKENDS: raise HTTPException(400, f"Unknown source backend: {req.source_backend}")
    if req.target_backend not in BACKENDS: raise HTTPException(400, f"Unknown target backend: {req.target_backend}")
    sb = BACKENDS[req.source_backend]; tb = BACKENDS[req.target_backend]
    n_gates = req.n_qubits * req.circuit_depth
    src_fid = (1 - sb["2q_err"]) ** (n_gates // 4) * (1 - sb["readout"]) ** req.n_qubits
    conn_penalty = 0.0 if tb["connectivity"]=="all_to_all" else (0.05 if tb["connectivity"]==sb["connectivity"] else 0.1)
    swap_overhead = 0 if tb["connectivity"]=="all_to_all" else req.n_qubits // 2
    depth_penalty = swap_overhead * 3
    gate_scaling = tb["2q_err"] / max(sb["2q_err"], 1e-10)
    t1_scaling = tb["t1"] / max(sb["t1"], 1)
    t2_scaling = tb["t2"] / max(sb["t2"], 1)
    emulated_fid = (1-tb["2q_err"])**((n_gates+depth_penalty)//4) * (1-tb["readout"])**req.n_qubits * (1-conn_penalty)
    emulated_fid = max(0.0, min(1.0, emulated_fid + rng.gauss(0, 0.01)))
    src_counts = req.source_counts or {format(i, f"0{min(req.n_qubits,4)}b"): max(1,int(req.n_shots*(src_fid if i==0 else (1-src_fid)/15))) for i in range(min(16,2**req.n_qubits))}
    emulated_counts = {k: max(0, int(v * emulated_fid / max(src_fid,0.001) + rng.gauss(0, max(v**0.5,1)))) for k,v in src_counts.items()}
    total = sum(emulated_counts.values())
    if total > 0:
        scale = req.n_shots / total
        emulated_counts = {k: max(1,int(v*scale)) for k,v in emulated_counts.items()}
    agree = 1 - abs(emulated_fid - src_fid)
    warnings = []
    if conn_penalty > 0.05: warnings.append(f"Connectivity mismatch: {sb['connectivity']} -> {tb['connectivity']} requires {swap_overhead} SWAP insertions")
    if gate_scaling > 5: warnings.append("Target backend has significantly higher gate error — results may diverge")
    if req.n_qubits > 20 and tb["connectivity"] != "all_to_all": warnings.append("Large circuit on limited connectivity — SWAP overhead may dominate")
    recs = []
    if emulated_fid > src_fid: recs.append(f"{req.target_backend} predicted to outperform {req.source_backend} by {(emulated_fid-src_fid)*100:.1f}%")
    else: recs.append(f"Stick with {req.source_backend} — {req.target_backend} predicted worse by {(src_fid-emulated_fid)*100:.1f}%")
    jid = str(uuid.uuid4())
    job = EmulationJob(job_id=jid, created_at=datetime.now(timezone.utc).isoformat(), source_backend=req.source_backend, target_backend=req.target_backend, n_qubits=req.n_qubits, circuit_depth=req.circuit_depth, n_shots=req.n_shots, source_fidelity=round(src_fid,6), emulated_fidelity=round(emulated_fid,6), fidelity_delta=round(emulated_fid-src_fid,6), source_counts=src_counts, emulated_counts=emulated_counts, noise_model_mapping={"1q_ratio": round(tb["1q_err"]/max(sb["1q_err"],1e-10),3), "2q_ratio": round(gate_scaling,3), "readout_ratio": round(tb["readout"]/max(sb["readout"],1e-10),3)}, connectivity_penalty=round(conn_penalty,4), gate_error_scaling=round(gate_scaling,4), t1_scaling=round(t1_scaling,4), t2_scaling=round(t2_scaling,4), depth_penalty=depth_penalty, swap_overhead=swap_overhead, cross_backend_agreement=round(agree,4), confidence=round(rng.uniform(0.75,0.95),4), warnings=warnings, recommendations=recs)
    store_put(db, NS_JOBS, jid, job.model_dump())
    return job

@router.get("/{job_id}", response_model=EmulationJob)
def get_job(job_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_JOBS, job_id)
    if not data: raise HTTPException(404, "not found")
    return EmulationJob(**data)

@router.get("/backends")
def list_backends():
    return {"backends": [{**{"id": k}, **v} for k,v in BACKENDS.items()]}
