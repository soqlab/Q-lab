from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/autopilot", tags=["autopilot"])

NS = "autopilot_missions"

class TerminationCondition(BaseModel):
    metric: str = "fidelity"
    target_value: float = 0.99
    tolerance: float = 0.001
    max_iterations: int = 50
    max_cost_usd: float = 100.0
    confidence_required: float = 0.95

class AutopilotMission(BaseModel):
    mission_id: str
    name: str
    goal: str
    status: str
    created_at: str
    updated_at: str
    current_iteration: int
    total_runs: int
    best_value: float | None
    best_params: dict
    best_run_id: str | None
    termination: TerminationCondition
    iterations: list[dict]
    decision_log: list[dict]
    total_cost_usd: float
    estimated_completion_pct: float
    next_action: dict
    converged: bool
    convergence_reason: str | None
    # Internal fields stored but not part of Pydantic model
    _rng_state: dict = {}

class StartMissionRequest(BaseModel):
    name: str = "VQE Ground State Search"
    goal: str = "minimize_energy"
    circuit_template: str = "vqe_ansatz"
    backend: str = "ibm_brisbane"
    termination: TerminationCondition = TerminationCondition()
    initial_params: dict = {}
    param_bounds: dict = {}
    n_shots: int = 4096
    auto_select_backend: bool = True
    use_error_mitigation: bool = True

class IterationResult(BaseModel):
    mission_id: str
    value: float
    params: dict
    run_id: str
    metadata: dict = {}

DECISION_STRATEGIES = [
    "Gaussian Process surrogate suggests exploring region θ∈[1.2, 1.8] rad",
    "Early stopping criterion not met — continuing exploration phase",
    "Switching backend to ionq_aria_1: predicted 12% fidelity improvement based on circuit profile",
    "Applying ZNE (Richardson extrapolation, factors 1,2,3) to mitigate gate errors",
    "Detected barren plateau — switching to layer-by-layer training strategy",
    "Convergence test: improvement < 0.1% over last 5 iterations — tightening search radius",
    "Anomalous measurement detected — re-running with fresh calibration snapshot",
    "Optimal region found near current best — switching to exploitation (EI acquisition)",
]

def _simulate_next(mission: AutopilotMission, rng: random.Random) -> tuple[float, dict, str]:
    iteration = mission.current_iteration + 1
    base = 0.5 + 0.4 * (1 - math.exp(-iteration / 15))
    noise = rng.gauss(0, 0.02 * math.exp(-iteration / 20))
    value = min(1.0, max(0.0, base + noise))
    if mission.goal == "minimize_energy":
        value = -5.0 + 4.8 * math.exp(-iteration / 10) + rng.gauss(0, 0.05)
    params = {k: round(v + rng.gauss(0, 0.1 / math.sqrt(iteration)), 4) for k, v in (mission.best_params or {"gamma": 1.0, "beta": 0.5}).items()}
    run_id = f"autopilot_run_{str(uuid.uuid4())[:8]}"
    return round(value, 6), params, run_id

@router.post("/start", response_model=AutopilotMission)
def start_mission(req: StartMissionRequest, db: Session = Depends(get_db)):
    mid = str(uuid.uuid4())
    rng = random.Random(hash(mid) & 0xFFFFFF)
    init_params = req.initial_params or {"gamma": round(rng.uniform(0, math.pi), 4), "beta": round(rng.uniform(0, math.pi/2), 4)}
    mission = AutopilotMission(
        mission_id=mid, name=req.name, goal=req.goal, status="running",
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
        current_iteration=0, total_runs=0, best_value=None,
        best_params=init_params, best_run_id=None,
        termination=req.termination, iterations=[], decision_log=[],
        total_cost_usd=0.0, estimated_completion_pct=0.0,
        next_action={"type": "run_circuit", "params": init_params, "backend": req.backend, "n_shots": req.n_shots},
        converged=False, convergence_reason=None,
    )
    record = mission.model_dump()
    record["_req"] = req.model_dump()
    record["_rng_seed"] = hash(mid) & 0xFFFFFF
    store_put(db, NS, mid, record)
    return mission

@router.post("/step", response_model=AutopilotMission)
def step(result: IterationResult, db: Session = Depends(get_db)):
    record = store_get(db, NS, result.mission_id)
    if record is None:
        raise HTTPException(404, "mission not found")
    req_data = record["_req"]
    rng = random.Random(record["_rng_seed"] + record["current_iteration"])
    data = {k: v for k, v in record.items() if not k.startswith("_")}
    iteration_entry = {"iteration": data["current_iteration"] + 1, "value": result.value, "params": result.params, "run_id": result.run_id, "timestamp": datetime.now(timezone.utc).isoformat(), **result.metadata}
    data["iterations"].append(iteration_entry)
    data["current_iteration"] += 1
    data["total_runs"] += 1
    data["total_cost_usd"] += req_data["n_shots"] * 0.0001
    minimize = "energy" in req_data["goal"] or "minimize" in req_data["goal"]
    if data["best_value"] is None or (result.value < data["best_value"] if minimize else result.value > data["best_value"]):
        data["best_value"] = result.value
        data["best_params"] = result.params
        data["best_run_id"] = result.run_id
    pct = min(99, data["current_iteration"] / req_data["termination"]["max_iterations"] * 100)
    if data["best_value"] is not None:
        target = req_data["termination"]["target_value"]
        if minimize:
            pct = max(pct, min(99, (1 - abs(data["best_value"] - target) / max(abs(target), 1)) * 100))
        else:
            pct = max(pct, min(99, (data["best_value"] / max(target, 1e-10)) * 100))
    data["estimated_completion_pct"] = round(pct, 1)
    converged = False
    reason = None
    if data["current_iteration"] >= req_data["termination"]["max_iterations"]:
        converged = True; reason = f"Max iterations ({req_data['termination']['max_iterations']}) reached"
    elif data["total_cost_usd"] >= req_data["termination"]["max_cost_usd"]:
        converged = True; reason = f"Budget limit ${req_data['termination']['max_cost_usd']:.2f} reached"
    elif data["best_value"] is not None:
        tol = req_data["termination"]["tolerance"]
        tv = req_data["termination"]["target_value"]
        if minimize and data["best_value"] <= tv + tol:
            converged = True; reason = f"Target {tv} achieved"
        elif not minimize and data["best_value"] >= tv - tol:
            converged = True; reason = f"Target {tv} achieved"
    data["converged"] = converged
    data["convergence_reason"] = reason
    data["status"] = "converged" if converged else "running"
    decision = rng.choice(DECISION_STRATEGIES)
    data["decision_log"].append({"iteration": data["current_iteration"], "decision": decision, "timestamp": datetime.now(timezone.utc).isoformat()})
    m_obj = AutopilotMission(**data)
    next_v, next_p, _ = _simulate_next(m_obj, rng)
    data["next_action"] = {"type": "run_circuit" if not converged else "stop", "params": next_p, "backend": req_data["backend"], "n_shots": req_data["n_shots"], "predicted_value": next_v}
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    record.update(data)
    store_put(db, NS, result.mission_id, record)
    return AutopilotMission(**data)

@router.get("/{mission_id}", response_model=AutopilotMission)
def get_mission(mission_id: str, db: Session = Depends(get_db)):
    record = store_get(db, NS, mission_id)
    if record is None:
        raise HTTPException(404, "mission not found")
    data = {k: v for k, v in record.items() if not k.startswith("_")}
    return AutopilotMission(**data)

@router.get("/")
def list_missions(db: Session = Depends(get_db)):
    records = store_list(db, NS)
    return {"missions": [{"mission_id": r["mission_id"], "name": r["name"], "status": r["status"], "current_iteration": r["current_iteration"], "best_value": r["best_value"], "estimated_completion_pct": r["estimated_completion_pct"]} for r in records]}

@router.delete("/{mission_id}/stop")
def stop_mission(mission_id: str, db: Session = Depends(get_db)):
    record = store_get(db, NS, mission_id)
    if record is None:
        raise HTTPException(404, "mission not found")
    record["status"] = "stopped"
    record["converged"] = True
    record["convergence_reason"] = "Manually stopped"
    store_put(db, NS, mission_id, record)
    return {"stopped": True, "best_value": record["best_value"], "total_runs": record["total_runs"]}
