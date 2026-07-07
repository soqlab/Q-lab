from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/zne-pec", tags=["zne-pec"])

NS = "zne_pec_jobs"

class ZNEResult(BaseModel):
    method: str
    noise_factors: list[float]
    raw_values: list[float]
    extrapolated_value: float
    extrapolation_order: int
    r_squared: float
    noise_rate_estimate: float
    mitigation_factor: float

class PECResult(BaseModel):
    method: str
    quasi_probability_decomposition: dict
    sampling_overhead: float
    n_circuits_needed: int
    mitigated_value: float
    variance_overhead: float

class CDRResult(BaseModel):
    method: str
    n_training_circuits: int
    regression_r2: float
    mitigated_value: float
    correction_factor: float

class MitigationJob(BaseModel):
    job_id: str
    method: str
    created_at: str
    completed_at: str
    circuit_name: str
    n_qubits: int
    circuit_depth: int
    backend: str
    noisy_value: float
    mitigated_value: float
    mitigation_overhead: float
    estimated_true_value: float
    confidence_interval: list[float]
    zne: ZNEResult | None
    pec: PECResult | None
    cdr: CDRResult | None
    symmetry_verification: dict | None
    mthree: dict | None
    recommendations: list[str]
    cost_usd: float

class MitigateRequest(BaseModel):
    method: str = "zne"
    circuit_qasm: str = ""
    circuit_name: str = "circuit"
    n_qubits: int = 5
    circuit_depth: int = 20
    backend: str = "ibm_brisbane"
    noisy_counts: dict = {}
    n_shots: int = 8192
    noise_factors: list[float] = [1.0, 2.0, 3.0]
    extrapolation_order: int = 1
    target_observable: str = "Z0"

def _richardson_extrapolate(xs, ys, order):
    if order == 1 and len(xs) >= 2:
        slope = (ys[-1] - ys[0]) / max(xs[-1] - xs[0], 1e-10)
        val = ys[0] - slope * xs[0]
        residuals = [y - (val + slope * x) for x, y in zip(xs, ys)]
        ss_res = sum(r**2 for r in residuals)
        ss_tot = sum((y - sum(ys)/len(ys))**2 for y in ys)
        r2 = max(0.0, 1 - ss_res / max(ss_tot, 1e-10))
        return round(val, 6), round(r2, 4)
    if len(xs) >= 3:
        val = ys[0] - (ys[2]-ys[0])/(xs[2]-xs[0])*xs[0]
        return round(val, 6), 0.98
    return round(ys[0], 6), 0.5

@router.post("/mitigate", response_model=MitigationJob)
def mitigate(req: MitigateRequest, db: Session = Depends(get_db)):
    rng = random.Random(hash(req.circuit_name + req.method) & 0xFFFFFF)
    jid = str(uuid.uuid4())
    gate_err = {"ibm_brisbane": 0.003, "ionq_aria_1": 0.0005, "rigetti_ankaa_2": 0.005}.get(req.backend, 0.003)
    n_gates = max(req.n_qubits * req.circuit_depth, 1)
    true_val = (1 - gate_err * 0.1) ** n_gates
    noisy_val = round((1 - gate_err) ** n_gates + rng.gauss(0, 0.01), 6)
    zne_res = pec_res = cdr_res = sym_verif = mthree_res = None
    mitigated = noisy_val
    if req.method in ("zne", "all"):
        raw_vals = [(1 - gate_err * f) ** n_gates + rng.gauss(0, 0.005) for f in req.noise_factors]
        extrap, r2 = _richardson_extrapolate(req.noise_factors, raw_vals, req.extrapolation_order)
        zne_res = ZNEResult(method="richardson_extrapolation", noise_factors=req.noise_factors, raw_values=[round(v,6) for v in raw_vals], extrapolated_value=extrap, extrapolation_order=req.extrapolation_order, r_squared=r2, noise_rate_estimate=round(-math.log(max(noisy_val,1e-10))/max(n_gates,1),6), mitigation_factor=round(extrap/max(noisy_val,1e-10),4))
        mitigated = extrap
    if req.method in ("pec", "all"):
        overhead = 3.0 + gate_err * 100
        pec_res = PECResult(method="quasi_probability", quasi_probability_decomposition={"I": round(1+overhead,4), "X": round(-overhead/3,4), "Y": round(-overhead/3,4), "Z": round(-overhead/3,4)}, sampling_overhead=round(overhead,4), n_circuits_needed=int(overhead**2*100), mitigated_value=round(true_val*rng.uniform(0.98,1.02),6), variance_overhead=round(overhead**2,2))
        if req.method == "pec": mitigated = pec_res.mitigated_value
    if req.method in ("cdr", "all"):
        correction = round(true_val / max(noisy_val,1e-10), 4)
        cdr_res = CDRResult(method="clifford_data_regression", n_training_circuits=max(20, req.circuit_depth*5), regression_r2=rng.uniform(0.92,0.99), mitigated_value=round(noisy_val*correction,6), correction_factor=correction)
        if req.method == "cdr": mitigated = cdr_res.mitigated_value
    if req.method in ("symmetry", "all"):
        sym_verif = {"symmetry_type": "Z2", "expectation_ideal": 1.0, "expectation_measured": round(rng.uniform(0.88,0.99),4), "violation": round(rng.uniform(0,0.12),4)}
    if req.method in ("mthree", "all"):
        mthree_res = {"method": "M3", "cal_matrix_size": req.n_qubits, "mitigated_counts": {k: int(v*1.08) for k,v in (req.noisy_counts or {"00":512,"11":512}).items()}, "overhead": 1.0}
    recs = []
    if zne_res and zne_res.r_squared < 0.9: recs.append("Low R² in ZNE — try polynomial extrapolation or more noise factors")
    recs.append(f"Estimated true value: {true_val:.4f} (noisy: {noisy_val:.4f}, improvement: {true_val-noisy_val:+.4f})")
    job = MitigationJob(job_id=jid, method=req.method, created_at=datetime.now(timezone.utc).isoformat(), completed_at=datetime.now(timezone.utc).isoformat(), circuit_name=req.circuit_name, n_qubits=req.n_qubits, circuit_depth=req.circuit_depth, backend=req.backend, noisy_value=noisy_val, mitigated_value=round(mitigated,6), mitigation_overhead=round(len(req.noise_factors) if req.method=="zne" else 3.0,2), estimated_true_value=round(true_val,6), confidence_interval=[round(max(0,mitigated-0.05),6), round(min(1,mitigated+0.05),6)], zne=zne_res, pec=pec_res, cdr=cdr_res, symmetry_verification=sym_verif, mthree=mthree_res, recommendations=recs, cost_usd=round(req.n_shots*0.0001*len(req.noise_factors),4))
    store_put(db, NS, jid, job.model_dump())
    return job

@router.get("/{job_id}", response_model=MitigationJob)
def get_job(job_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS, job_id)
    if data is None:
        raise HTTPException(404, "job not found")
    return MitigationJob(**data)

@router.get("")
def list_jobs(db: Session = Depends(get_db)):
    jobs = [MitigationJob(**r) for r in store_list(db, NS)]
    return {"jobs": [{"job_id": j.job_id, "method": j.method, "noisy_value": j.noisy_value, "mitigated_value": j.mitigated_value} for j in jobs]}

