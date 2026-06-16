from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/dd-optimizer", tags=["dd-optimizer"])

NS = "dd_reports"

DD_SEQUENCES = {
    "hahn_echo": {"pulses": ["X"], "period_factor": 2, "description": "Single pi-pulse refocusing. Best for static Z noise.", "suppresses": ["low_freq_z"]},
    "cpmg": {"pulses": ["X","X"], "period_factor": 4, "description": "Carr-Purcell-Meiboom-Gill. Optimal for Lorentzian noise.", "suppresses": ["lorentzian_z"]},
    "xy4": {"pulses": ["X","Y","X","Y"], "period_factor": 8, "description": "XY-4 sequence. Suppresses both X and Z noise.", "suppresses": ["xyz_noise", "pulse_errors"]},
    "xy8": {"pulses": ["X","Y","X","Y","Y","X","Y","X"], "period_factor": 16, "description": "XY-8: time-symmetric version of XY-4 for better refocusing.", "suppresses": ["xyz_noise", "pulse_errors", "systematic_errors"]},
    "knill": {"pulses": ["X","Y","X","Y","X"], "period_factor": 10, "description": "Knill DD (KDD): composite pulses for robust refocusing.", "suppresses": ["xyz_noise", "pulse_imperfections"]},
    "udd": {"pulses": ["X"]*8, "period_factor": 16, "description": "Uhrig DD: non-equidistant pulses for power-law noise.", "suppresses": ["power_law_noise", "1_over_f"]},
    "cdd": {"pulses": ["X","Y","X","Y"]*2, "period_factor": 16, "description": "Concatenated DD: nested XY-4 for stronger suppression.", "suppresses": ["high_order_terms", "xyz_noise"]},
}

class DDPulseSchedule(BaseModel):
    sequence_type: str; pulses: list[str]; n_repetitions: int
    total_pulses: int; gate_overhead: int; time_overhead_pct: float
    t1_improvement_factor: float; t2_improvement_factor: float
    fidelity_improvement_pct: float; idle_qubits: list[int]
    qasm_insertion: str; qiskit_snippet: str; suppresses: list[str]

class DDReport(BaseModel):
    report_id: str; created_at: str; circuit_name: str; n_qubits: int
    circuit_depth: int; backend: str; idle_time_us: float
    recommended_sequence: str; reason: str; sequences: list[DDPulseSchedule]
    estimated_t2_with_dd: float; estimated_t2_without_dd: float
    overhead_acceptable: bool; noise_spectrum: dict

class OptimizeRequest(BaseModel):
    circuit_name: str = "circuit"; n_qubits: int = 5; circuit_depth: int = 20
    backend: str = "ibm_brisbane"; idle_time_us: float | None = None
    noise_type: str = "auto"; target_qubit: int = 0
    t1_us: float | None = None; t2_us: float | None = None
    gate_time_ns: float = 50.0; max_overhead_pct: float = 20.0

BACKEND_NOISE = {
    "ibm_brisbane": {"noise_type": "lorentzian_z", "t1": 280, "t2": 150},
    "ionq_aria_1": {"noise_type": "low_freq_z", "t1": 10000, "t2": 5000},
    "rigetti_ankaa_2": {"noise_type": "xyz_noise", "t1": 180, "t2": 90},
}

@router.post("/optimize", response_model=DDReport)
def optimize(req: OptimizeRequest, db: Session = Depends(get_db)):
    rng = random.Random(hash(req.circuit_name + req.backend) & 0xFFFFFF)
    bn = BACKEND_NOISE.get(req.backend, {"noise_type": "xyz_noise", "t1": 200, "t2": 100})
    t1 = req.t1_us or bn["t1"]
    t2 = req.t2_us or bn["t2"]
    noise_type = req.noise_type if req.noise_type != "auto" else bn["noise_type"]
    circuit_time = req.circuit_depth * req.gate_time_ns * 1e-3
    idle_time = req.idle_time_us or circuit_time * 0.3
    seq_scores = {}
    for seq_id, seq_info in DD_SEQUENCES.items():
        suppresses = seq_info["suppresses"]
        score = 2.0 if noise_type in suppresses else 1.0
        overhead = len(seq_info["pulses"]) * req.gate_time_ns / max(idle_time * 1000, 1) * 100
        if overhead > req.max_overhead_pct: score *= 0.3
        seq_scores[seq_id] = score + rng.uniform(-0.1, 0.1)
    best_seq = max(seq_scores, key=seq_scores.get)
    schedules = []
    for seq_id, seq_info in DD_SEQUENCES.items():
        n_reps = max(1, int(idle_time * 1000 / max(len(seq_info["pulses"]) * req.gate_time_ns, 1)))
        n_reps = min(n_reps, 10)
        total_p = len(seq_info["pulses"]) * n_reps
        overhead = total_p * req.gate_time_ns / max(req.circuit_depth * req.gate_time_ns, 1) * 100
        t1_imp = 1.0 + 0.1 * n_reps if "t1" in " ".join(seq_info["suppresses"]) else 1.05
        t2_imp = 1.5 + 0.2 * n_reps * seq_scores.get(seq_id, 1)
        fid_imp = (t2_imp - 1.0) * 10
        pulses_str = " ".join(f"x q[{req.target_qubit}];" if p=="X" else f"y q[{req.target_qubit}];" for p in seq_info["pulses"] * n_reps)
        qiskit_s = f"# {seq_id.upper()} DD sequence\nfrom qiskit.circuit.library import XGate, YGate\n# Insert after each idle period\nfor rep in range({n_reps}):\n    qc.x({req.target_qubit})  # DD pulse"
        schedules.append(DDPulseSchedule(sequence_type=seq_id, pulses=seq_info["pulses"]*n_reps, n_repetitions=n_reps, total_pulses=total_p, gate_overhead=total_p, time_overhead_pct=round(overhead,2), t1_improvement_factor=round(t1_imp,3), t2_improvement_factor=round(t2_imp,3), fidelity_improvement_pct=round(fid_imp,2), idle_qubits=list(range(req.n_qubits)), qasm_insertion=pulses_str[:200], qiskit_snippet=qiskit_s, suppresses=seq_info["suppresses"]))
    best_sched = next(s for s in schedules if s.sequence_type == best_seq)
    rid = str(uuid.uuid4())
    report = DDReport(report_id=rid, created_at=datetime.now(timezone.utc).isoformat(), circuit_name=req.circuit_name, n_qubits=req.n_qubits, circuit_depth=req.circuit_depth, backend=req.backend, idle_time_us=round(idle_time,3), recommended_sequence=best_seq, reason=f"Best match for {noise_type} noise detected on {req.backend}", sequences=schedules, estimated_t2_with_dd=round(t2*best_sched.t2_improvement_factor,1), estimated_t2_without_dd=round(t2,1), overhead_acceptable=best_sched.time_overhead_pct<=req.max_overhead_pct, noise_spectrum={"dominant_type": noise_type, "estimated_coherence_time_us": round(t2,1), "low_freq_fraction": round(rng.uniform(0.3,0.7),2), "lorentzian_fraction": round(rng.uniform(0.1,0.4),2)})
    store_put(db, NS, rid, report.model_dump())
    return report

@router.get("/{report_id}", response_model=DDReport)
def get_report(report_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS, report_id)
    if data is None:
        raise HTTPException(404, "not found")
    return DDReport(**data)

@router.get("/sequences")
def list_sequences():
    return {"sequences": [{**{"id": k}, **v} for k, v in DD_SEQUENCES.items()]}
