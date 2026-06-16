from __future__ import annotations
import math, uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/resource-estimator", tags=["resource_estimator"])

ALGORITHMS: Dict[str, Any] = {
    "shor_2048":    {"display": "Shor's (2048-bit RSA)", "n_logical": 4096, "t_gates": 2.3e12, "clifford_gates": 6e12,  "classical_years": 1e13},
    "shor_1024":    {"display": "Shor's (1024-bit RSA)", "n_logical": 2048, "t_gates": 5e11,  "clifford_gates": 1.5e12, "classical_years": 1e9},
    "grover_n30":   {"display": "Grover (n=30 search)",  "n_logical": 30,   "t_gates": 2e9,   "clifford_gates": 4e9,    "classical_years": 17},
    "chemistry_feo":{"display": "FeO Chemistry (FCI)",   "n_logical": 54,   "t_gates": 1.3e12,"clifford_gates": 3e12,   "classical_years": 1e6},
    "chemistry_h2o":{"display": "H₂O Chemistry",         "n_logical": 14,   "t_gates": 1.2e8, "clifford_gates": 3e8,    "classical_years": 0.01},
    "qpe_phase":    {"display": "Quantum Phase Estimation","n_logical":10,   "t_gates": 1e6,   "clifford_gates": 2e6,    "classical_years": 1e3},
    "hhl_1000":     {"display": "HHL (1000×1000 system)", "n_logical": 30,   "t_gates": 1e9,   "clifford_gates": 2e9,    "classical_years": 100},
    "custom":       {"display": "Custom Algorithm",        "n_logical": None, "t_gates": None,   "clifford_gates": None,   "classical_years": None},
}

CURRENT_SOTA_PHYSICAL = 1000  # IBM condor ~1000 physical qubits

class ResourceRequest(BaseModel):
    algorithm: str = "shor_2048"
    n_logical_qubits: Optional[int] = None
    t_gate_count: Optional[float] = None
    clifford_gate_count: Optional[float] = None
    physical_error_rate: float = Field(default=0.001, ge=1e-5, le=0.01)
    target_logical_error_rate: float = Field(default=1e-10, ge=1e-15, le=1e-3)
    code: str = "surface"
    factory_type: str = "15_to_1"

def _code_distance(p_phys: float, p_L: float) -> int:
    if p_phys >= 0.01:
        return 99
    ratio = p_L / (100 * p_phys)
    if ratio >= 1:
        return 3
    d = math.ceil(-math.log10(ratio) / math.log10(100 * p_phys / p_L + 1e-30) * 2 + 1)
    d = max(3, min(d, 101))
    if d % 2 == 0: d += 1
    return d

@router.post("")
def estimate_resources(req: ResourceRequest):
    if req.algorithm not in ALGORITHMS:
        raise HTTPException(400, f"Unknown algorithm. Options: {list(ALGORITHMS.keys())}")
    algo = ALGORITHMS[req.algorithm]
    n_log = req.n_logical_qubits if req.n_logical_qubits else algo["n_logical"]
    t_gates = req.t_gate_count if req.t_gate_count else algo["t_gates"]
    clif_gates = req.clifford_gate_count if req.clifford_gate_count else algo["clifford_gates"]

    if not n_log:
        raise HTTPException(400, "Provide n_logical_qubits for custom algorithm")

    d = _code_distance(req.physical_error_rate, req.target_logical_error_rate)
    phys_per_log = 2 * d * d
    log_with_routing = math.ceil(n_log * 1.5)

    factory_qubits = 900 if req.factory_type == "15_to_1" else 1200
    cycle_time_ns = 1000
    t_factory_time_us = 15 * d * cycle_time_ns / 1000.0

    # How many factories needed
    total_time_cycles = (clif_gates or 0) + (t_gates or 0) * t_factory_time_us * 1000 / cycle_time_ns
    if t_gates and t_factory_time_us > 0:
        cycles_per_t = t_factory_time_us * 1000 / cycle_time_ns
        n_t_factories = max(1, math.ceil(n_log / cycles_per_t))
    else:
        n_t_factories = 1

    total_factory_qubits = n_t_factories * factory_qubits
    total_phys = log_with_routing * phys_per_log + total_factory_qubits
    total_cycles = (clif_gates or 1) + (t_gates or 1) * math.ceil(t_factory_time_us * 1000 / cycle_time_ns)
    total_time_s = total_cycles * cycle_time_ns * 1e-9
    total_time_h = total_time_s / 3600
    total_time_years = total_time_h / 8760
    classical_years = algo.get("classical_years") or 1e6
    speedup = classical_years / max(total_time_years, 1e-10)
    gap = total_phys / CURRENT_SOTA_PHYSICAL
    mem_gb = (2**n_log) * 16 / 1e9 if n_log <= 40 else float('inf')

    bottleneck = "T-gate factories" if total_factory_qubits > log_with_routing * phys_per_log else "qubit count"
    recs = []
    if req.physical_error_rate > 0.003: recs.append("Reduce physical error rate below 0.1% for practical advantage")
    if d > 25: recs.append(f"Code distance d={d} requires very low error rates — consider less aggressive target")
    if total_phys > 1e6: recs.append("Total qubit count >1M — likely requires 2030s hardware")
    if gap < 100: recs.append("Within 100x of current hardware — may be achievable near-term")

    milestones = [
        {"year": 2025, "physical_qubits": 1000,  "can_run": total_phys <= 1000},
        {"year": 2027, "physical_qubits": 10000, "can_run": total_phys <= 10000},
        {"year": 2029, "physical_qubits": 100000,"can_run": total_phys <= 100000},
        {"year": 2032, "physical_qubits": 1000000,"can_run":total_phys <= 1000000},
        {"year": 2035, "physical_qubits": 10000000,"can_run":total_phys <= 10000000},
    ]

    return {
        "est_id": str(uuid.uuid4()),
        "algorithm": req.algorithm,
        "algorithm_display": algo["display"],
        "n_logical_qubits": n_log,
        "t_gate_count": t_gates,
        "clifford_gate_count": clif_gates,
        "physical_error_rate": req.physical_error_rate,
        "target_logical_error_rate": req.target_logical_error_rate,
        "code": req.code,
        "code_distance": d,
        "physical_per_logical": phys_per_log,
        "logical_qubits_with_routing": log_with_routing,
        "total_physical_qubits": int(total_phys),
        "n_t_factories": n_t_factories,
        "factory_qubits_each": factory_qubits,
        "total_factory_qubits": total_factory_qubits,
        "code_cycle_time_ns": cycle_time_ns,
        "t_factory_time_us": round(t_factory_time_us, 2),
        "total_time_hours": round(total_time_h, 4),
        "total_time_years": round(total_time_years, 6),
        "comparison_classical_years": classical_years,
        "speedup_vs_classical": round(speedup, 2),
        "memory_gb_classical_equivalent": round(mem_gb, 2) if mem_gb != float('inf') else -1,
        "key_bottleneck": bottleneck,
        "current_gap_factor": round(gap, 1),
        "milestones": milestones,
        "recommendations": recs,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/algorithms")
def list_algorithms():
    return {"algorithms": [{"id": k, "display": v["display"], "n_logical": v["n_logical"]} for k, v in ALGORITHMS.items()]}
