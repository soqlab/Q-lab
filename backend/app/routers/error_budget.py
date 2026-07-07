from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/error-budget", tags=["error-budget"])

NS = "error_budget_reports"

class ErrorComponent(BaseModel):
    name: str; category: str; contribution_pct: float; absolute_error: float
    description: str; mitigatable: bool; mitigation_strategy: str

class ErrorBudgetReport(BaseModel):
    report_id: str; created_at: str; circuit_name: str
    n_qubits: int; circuit_depth: int; backend: str
    total_error: float; infidelity: float
    components: list[ErrorComponent]
    gate_error_total: float; decoherence_total: float
    spam_total: float; measurement_total: float; leakage_total: float
    dominant_error: str; fault_tolerant_threshold: float
    below_ft_threshold: bool
    recommendations: list[str]; action_items: list[dict]

class BudgetRequest(BaseModel):
    circuit_name: str = "circuit"; n_qubits: int = 5; circuit_depth: int = 20
    backend: str = "ibm_brisbane"; n_shots: int = 8192
    measured_fidelity: float | None = None
    single_q_error_rate: float | None = None; two_q_error_rate: float | None = None
    t1_us: float | None = None; t2_us: float | None = None
    gate_time_ns: float = 50.0; readout_error: float | None = None

BACKEND_DEFAULTS = {
    "ibm_brisbane": {"1q": 0.0003, "2q": 0.003, "t1": 280, "t2": 150, "readout": 0.01, "leakage": 0.0001},
    "ionq_aria_1": {"1q": 0.00005, "2q": 0.0005, "t1": 10000, "t2": 5000, "readout": 0.003, "leakage": 0.00001},
    "rigetti_ankaa_2": {"1q": 0.0005, "2q": 0.005, "t1": 180, "t2": 90, "readout": 0.02, "leakage": 0.0002},
}

@router.post("/analyze", response_model=ErrorBudgetReport)
def analyze(req: BudgetRequest, db: Session = Depends(get_db)):
    rng = random.Random(hash(req.circuit_name + req.backend) & 0xFFFFFF)
    bd = BACKEND_DEFAULTS.get(req.backend, BACKEND_DEFAULTS["ibm_brisbane"])
    p1q = req.single_q_error_rate or bd["1q"]
    p2q = req.two_q_error_rate or bd["2q"]
    t1 = (req.t1_us or bd["t1"]) * 1e-6
    t2 = (req.t2_us or bd["t2"]) * 1e-6
    gt = req.gate_time_ns * 1e-9
    readout = req.readout_error or bd["readout"]
    leakage = bd["leakage"]
    n1q = req.n_qubits * req.circuit_depth // 2
    n2q = (req.n_qubits - 1) * req.circuit_depth // 4
    gate_1q_err = n1q * p1q
    gate_2q_err = n2q * p2q
    circuit_time = req.circuit_depth * gt
    t1_err = req.n_qubits * (1 - math.exp(-circuit_time / t1))
    t2_err = req.n_qubits * (1 - math.exp(-circuit_time / t2)) * 0.5
    spam_err = req.n_qubits * 0.005
    meas_err = req.n_qubits * readout
    leak_err = (n1q + n2q) * leakage
    total = gate_1q_err + gate_2q_err + t1_err + t2_err + spam_err + meas_err + leak_err
    total = max(total, 1e-6)
    infidelity = min(0.999, 1 - math.exp(-total))
    def pct(e): return round(e / total * 100, 2)
    components = [
        ErrorComponent(name="Single-qubit gates", category="gate", contribution_pct=pct(gate_1q_err), absolute_error=round(gate_1q_err,6), description=f"{n1q} single-qubit gates × {p1q:.2e} error/gate", mitigatable=True, mitigation_strategy="ZNE, PEC, gate compilation optimization"),
        ErrorComponent(name="Two-qubit gates", category="gate", contribution_pct=pct(gate_2q_err), absolute_error=round(gate_2q_err,6), description=f"{n2q} CX/ECR gates × {p2q:.2e} error/gate", mitigatable=True, mitigation_strategy="ZNE, reduce CX count, use native gates"),
        ErrorComponent(name="T1 relaxation", category="decoherence", contribution_pct=pct(t1_err), absolute_error=round(t1_err,6), description=f"Circuit time {circuit_time*1e9:.0f}ns vs T1={t1*1e6:.0f}μs", mitigatable=True, mitigation_strategy="Dynamical decoupling, shorter circuits, faster gates"),
        ErrorComponent(name="T2 dephasing", category="decoherence", contribution_pct=pct(t2_err), absolute_error=round(t2_err,6), description=f"Circuit time {circuit_time*1e9:.0f}ns vs T2={t2*1e6:.0f}μs", mitigatable=True, mitigation_strategy="Echo sequences, refocusing pulses"),
        ErrorComponent(name="SPAM errors", category="spam", contribution_pct=pct(spam_err), absolute_error=round(spam_err,6), description="State preparation and measurement combined", mitigatable=True, mitigation_strategy="M3 readout mitigation, repeated readout"),
        ErrorComponent(name="Readout errors", category="measurement", contribution_pct=pct(meas_err), absolute_error=round(meas_err,6), description=f"Per-qubit readout error {readout:.3%}", mitigatable=True, mitigation_strategy="Readout calibration matrix, post-selection"),
        ErrorComponent(name="Leakage to |2⟩", category="leakage", contribution_pct=pct(leak_err), absolute_error=round(leak_err,6), description="Population escape to non-computational states", mitigatable=False, mitigation_strategy="Leakage reduction units (LRU), leakage-aware transpilation"),
    ]
    dominant = max(components, key=lambda c: c.contribution_pct)
    ft_threshold = 0.01
    recs = [f"Dominant error: {dominant.name} ({dominant.contribution_pct:.1f}%) — {dominant.mitigation_strategy}"]
    if gate_2q_err > gate_1q_err * 2: recs.append("2Q gate errors dominant — optimize circuit to reduce CX count")
    if t1_err + t2_err > gate_1q_err + gate_2q_err: recs.append("Decoherence dominates — use DD sequences or switch to faster backend")
    if infidelity > ft_threshold: recs.append(f"Infidelity {infidelity:.4f} above FT threshold {ft_threshold} — QEC encoding recommended")
    actions = [{"priority": i+1, "action": c.mitigation_strategy, "target_error": c.name, "expected_improvement_pct": round(c.contribution_pct*0.6, 1)} for i, c in enumerate(sorted(components, key=lambda x: x.contribution_pct, reverse=True)[:3]) if c.mitigatable]
    rid = str(uuid.uuid4())
    report = ErrorBudgetReport(report_id=rid, created_at=datetime.now(timezone.utc).isoformat(), circuit_name=req.circuit_name, n_qubits=req.n_qubits, circuit_depth=req.circuit_depth, backend=req.backend, total_error=round(total,6), infidelity=round(infidelity,6), components=components, gate_error_total=round(gate_1q_err+gate_2q_err,6), decoherence_total=round(t1_err+t2_err,6), spam_total=round(spam_err,6), measurement_total=round(meas_err,6), leakage_total=round(leak_err,6), dominant_error=dominant.name, fault_tolerant_threshold=ft_threshold, below_ft_threshold=infidelity<ft_threshold, recommendations=recs, action_items=actions)
    store_put(db, NS, rid, report.model_dump())
    return report

@router.get("/{report_id}", response_model=ErrorBudgetReport)
def get_report(report_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS, report_id)
    if data is None:
        raise HTTPException(404, "report not found")
    return ErrorBudgetReport(**data)

@router.get("")
def list_reports(db: Session = Depends(get_db)):
    reports = store_list(db, NS)
    return {"reports": [{"report_id": r["report_id"], "circuit_name": r["circuit_name"], "infidelity": r["infidelity"], "dominant_error": r["dominant_error"]} for r in reports]}

