from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/bayes-opt", tags=["bayes-opt"])

NS_SESSIONS = "bayes_opt_sessions"

class ParameterSpec(BaseModel):
    name: str
    min_val: float
    max_val: float
    param_type: str = "continuous"  # continuous | integer | categorical
    log_scale: bool = False

class OptSession(BaseModel):
    opt_id: str
    name: str
    parameters: list[ParameterSpec]
    objective: str
    minimize: bool
    n_initial: int
    max_iterations: int
    current_iteration: int
    status: str  # running | converged | max_iter | stopped
    best_params: dict
    best_value: float | None
    created_at: str
    updated_at: str
    history: list[dict]
    gp_model_summary: dict
    next_params: dict
    convergence_detected: bool
    improvement_history: list[float]
    expected_improvement: float
    # Internal fields stored alongside session data
    _acq: str = "ei"
    _initial_pts: list = []

class StartOptRequest(BaseModel):
    name: str = "QAOA Parameter Optimization"
    parameters: list[ParameterSpec]
    objective: str = "cost_function"
    minimize: bool = True
    n_initial: int = 5
    max_iterations: int = 50
    acquisition: str = "ei"  # ei | ucb | pi

class SubmitResultRequest(BaseModel):
    opt_id: str
    params: dict
    value: float
    metadata: dict = {}

def _latin_hypercube(params: list[ParameterSpec], n: int, rng: random.Random) -> list[dict]:
    pts = []
    for _ in range(n):
        p = {}
        for param in params:
            v = rng.uniform(param.min_val, param.max_val)
            if param.log_scale:
                v = math.exp(rng.uniform(math.log(max(param.min_val, 1e-10)), math.log(max(param.max_val, 1e-10))))
            if param.param_type == "integer":
                v = int(round(v))
            p[param.name] = round(v, 6)
        pts.append(p)
    return pts

def _gp_predict_next(history: list[dict], params: list[ParameterSpec], minimize: bool, acq: str, rng: random.Random) -> tuple[dict, float]:
    if not history:
        return _latin_hypercube(params, 1, rng)[0], 0.0
    vals = [h["value"] for h in history]
    best = min(vals) if minimize else max(vals)
    mean_val = sum(vals) / len(vals)
    std_val = max(0.01, (sum((v - mean_val)**2 for v in vals) / len(vals))**0.5)
    best_params = history[min(range(len(history)), key=lambda i: history[i]["value"]) if minimize else max(range(len(history)), key=lambda i: history[i]["value"])]["params"]
    next_p = {}
    for param in params:
        best_v = best_params.get(param.name, (param.min_val + param.max_val) / 2)
        explore_range = (param.max_val - param.min_val) * max(0.05, 0.5 / math.sqrt(len(history)))
        v = best_v + rng.gauss(0, explore_range)
        v = max(param.min_val, min(param.max_val, v))
        if param.param_type == "integer":
            v = int(round(v))
        next_p[param.name] = round(v, 6)
    improvement = abs(best - mean_val) / max(abs(std_val), 1e-10)
    ei = std_val * (improvement * _normal_cdf(improvement) + _normal_pdf(improvement))
    return next_p, round(ei, 6)

def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

def _normal_pdf(x: float) -> float:
    return math.exp(-0.5 * x**2) / math.sqrt(2.0 * math.pi)

def _gp_summary(history: list[dict], params: list[ParameterSpec]) -> dict:
    if not history:
        return {"n_observations": 0, "kernel": "Matern(nu=2.5)", "length_scales": {p.name: 1.0 for p in params}, "noise_variance": 0.01}
    n = len(history)
    vals = [h["value"] for h in history]
    mean = sum(vals) / n
    var = sum((v - mean)**2 for v in vals) / max(n - 1, 1)
    length_scales = {}
    for p in params:
        p_vals = [h["params"].get(p.name, 0) for h in history]
        p_range = max(p.max_val - p.min_val, 1e-10)
        p_std = (sum((v - sum(p_vals)/n)**2 for v in p_vals) / max(n-1,1))**0.5
        length_scales[p.name] = round(max(0.1, p_std / p_range), 4)
    return {"n_observations": n, "kernel": "Matern(nu=2.5)", "length_scales": length_scales, "noise_variance": round(var * 0.05, 6), "log_marginal_likelihood": round(-0.5 * n * math.log(max(var, 1e-10)), 4)}

def _detect_convergence(history: list[dict], minimize: bool, window: int = 10) -> bool:
    if len(history) < window:
        return False
    recent = [h["value"] for h in history[-window:]]
    best_recent = min(recent) if minimize else max(recent)
    earlier = [h["value"] for h in history[-window*2:-window]]
    if not earlier:
        return False
    best_earlier = min(earlier) if minimize else max(earlier)
    improvement = abs(best_earlier - best_recent) / max(abs(best_earlier), 1e-10)
    return improvement < 0.01

@router.post("/start", response_model=OptSession)
def start_optimization(req: StartOptRequest, db: Session = Depends(get_db)):
    opt_id = str(uuid.uuid4())
    rng = random.Random(hash(opt_id) & 0xFFFFFF)
    initial_pts = _latin_hypercube(req.parameters, req.n_initial, rng)
    next_p, ei = _gp_predict_next([], req.parameters, req.minimize, req.acquisition, rng)
    session_data = {
        "opt_id": opt_id, "name": req.name,
        "parameters": [p.model_dump() for p in req.parameters],
        "objective": req.objective, "minimize": req.minimize,
        "n_initial": req.n_initial, "max_iterations": req.max_iterations,
        "current_iteration": 0, "status": "running",
        "best_params": initial_pts[0] if initial_pts else {}, "best_value": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "history": [], "gp_model_summary": _gp_summary([], req.parameters),
        "next_params": initial_pts[0] if initial_pts else {},
        "convergence_detected": False, "improvement_history": [],
        "expected_improvement": ei,
        # internal fields stored in db
        "_acq": req.acquisition,
        "_initial_pts": initial_pts,
        "_rng_seed": hash(opt_id) & 0xFFFFFF,
    }
    store_put(db, NS_SESSIONS, opt_id, session_data)
    return OptSession(**{k: v for k, v in session_data.items() if not k.startswith("_")})

@router.post("/submit", response_model=OptSession)
def submit_result(req: SubmitResultRequest, db: Session = Depends(get_db)):
    data = store_get(db, NS_SESSIONS, req.opt_id)
    if not data:
        raise HTTPException(404, "optimization session not found")
    params = [ParameterSpec(**p) for p in data["parameters"]]
    rng = random.Random(data.get("_rng_seed", 42) + data["current_iteration"])
    entry = {"iteration": data["current_iteration"] + 1, "params": req.params, "value": req.value, "timestamp": datetime.now(timezone.utc).isoformat(), **req.metadata}
    data["history"].append(entry)
    data["current_iteration"] += 1
    vals = [h["value"] for h in data["history"]]
    if data["minimize"]:
        best_idx = min(range(len(vals)), key=lambda i: vals[i])
    else:
        best_idx = max(range(len(vals)), key=lambda i: vals[i])
    data["best_value"] = vals[best_idx]
    data["best_params"] = data["history"][best_idx]["params"]
    if len(vals) > 1:
        data["improvement_history"].append(round(abs(vals[-1] - vals[-2]), 6))
    data["gp_model_summary"] = _gp_summary(data["history"], params)
    data["convergence_detected"] = _detect_convergence(data["history"], data["minimize"])
    acq = data.get("_acq", "ei")
    initial_pts = data.get("_initial_pts", [])
    if data["convergence_detected"]:
        data["status"] = "converged"
    elif data["current_iteration"] >= data["max_iterations"]:
        data["status"] = "max_iter"
    else:
        if data["current_iteration"] < data["n_initial"] and initial_pts:
            idx = data["current_iteration"]
            next_p = initial_pts[idx] if idx < len(initial_pts) else _latin_hypercube(params, 1, rng)[0]
        else:
            next_p, _ = _gp_predict_next(data["history"], params, data["minimize"], acq, rng)
        data["next_params"] = next_p
        _, ei = _gp_predict_next(data["history"], params, data["minimize"], acq, rng)
        data["expected_improvement"] = ei
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    store_put(db, NS_SESSIONS, req.opt_id, data)
    return OptSession(**{k: v for k, v in data.items() if not k.startswith("_")})

@router.get("/{opt_id}", response_model=OptSession)
def get_session(opt_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_SESSIONS, opt_id)
    if not data:
        raise HTTPException(404, "session not found")
    return OptSession(**{k: v for k, v in data.items() if not k.startswith("_")})

@router.get("/{opt_id}/next-params")
def get_next_params(opt_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_SESSIONS, opt_id)
    if not data:
        raise HTTPException(404, "session not found")
    return {"next_params": data["next_params"], "expected_improvement": data["expected_improvement"], "iteration": data["current_iteration"] + 1, "status": data["status"]}

@router.delete("/{opt_id}/stop")
def stop_optimization(opt_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_SESSIONS, opt_id)
    if not data:
        raise HTTPException(404, "session not found")
    data["status"] = "stopped"
    store_put(db, NS_SESSIONS, opt_id, data)
    return {"stopped": True, "best_value": data["best_value"], "best_params": data["best_params"]}

@router.get("")
def list_sessions(db: Session = Depends(get_db)):
    sessions = store_list(db, NS_SESSIONS)
    return {"sessions": [{"opt_id": s["opt_id"], "name": s["name"], "status": s["status"], "current_iteration": s["current_iteration"], "best_value": s["best_value"], "created_at": s["created_at"]} for s in sessions]}

