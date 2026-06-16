from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math

from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/rl-optimizer", tags=["rl-optimizer"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_SESSIONS = "rl_sessions"


class RLSession(BaseModel):
    session_id: str
    name: str
    backend: str
    n_qubits: int
    algorithm: str
    objective: str
    episodes: int
    status: str
    best_reward: float
    initial_circuit_depth: int
    optimized_circuit_depth: int
    depth_reduction_pct: float
    gate_fidelity_improvement: float
    training_curve: List[float]
    created_at: str
    completed_at: Optional[str] = None


class OptimizedCircuit(BaseModel):
    opt_id: str
    session_id: str
    original_qasm: str
    optimized_qasm: str
    original_depth: int
    optimized_depth: int
    original_gate_count: int
    optimized_gate_count: int
    estimated_fidelity_gain: float
    applied_at: str


class TrainRequest(BaseModel):
    name: str
    backend: str
    n_qubits: int
    algorithm: str
    objective: str
    episodes: int = 500


class ApplyRequest(BaseModel):
    session_id: str
    circuit_qasm: str


def _generate_training_curve(episodes: int, algorithm: str, objective: str) -> List[float]:
    base_reward = random.uniform(-1.0, -0.5)
    final_reward = random.uniform(0.7, 0.98)
    curve = []
    warmup = int(episodes * 0.1)
    for i in range(episodes):
        progress = i / max(episodes - 1, 1)
        if algorithm == "ppo":
            noise_scale = 0.15 * math.exp(-3 * progress)
            trend = base_reward + (final_reward - base_reward) * (1 - math.exp(-4 * progress))
        elif algorithm == "dqn":
            noise_scale = 0.2 * math.exp(-2 * progress)
            trend = base_reward + (final_reward - base_reward) * (progress ** 0.6)
        else:
            noise_scale = 0.1 * math.exp(-3.5 * progress)
            trend = base_reward + (final_reward - base_reward) * math.tanh(5 * progress)
        noise = random.gauss(0, noise_scale)
        val = trend + noise
        if i < warmup:
            val *= random.uniform(0.3, 0.7)
        curve.append(round(min(1.0, max(-1.5, val)), 4))
    return curve


def _make_qasm(n_qubits: int, depth: int) -> str:
    gates = ["h", "cx", "rz", "ry", "rx", "s", "t"]
    lines = ["OPENQASM 2.0;", 'include "qelib1.inc";', f"qreg q[{n_qubits}];", f"creg c[{n_qubits}];"]
    for _ in range(depth):
        g = random.choice(gates)
        q = random.randint(0, n_qubits - 1)
        if g in ("rx", "ry", "rz"):
            angle = round(random.uniform(0, 2 * math.pi), 4)
            lines.append(f"{g}({angle}) q[{q}];")
        elif g == "cx" and n_qubits > 1:
            ctrl = random.randint(0, n_qubits - 1)
            tgt = (ctrl + 1) % n_qubits
            lines.append(f"cx q[{ctrl}],q[{tgt}];")
        else:
            lines.append(f"{g} q[{q}];")
    for i in range(n_qubits):
        lines.append(f"measure q[{i}] -> c[{i}];")
    return "\n".join(lines)


@router.post("/train", response_model=RLSession)
def train(req: TrainRequest, db: Session = Depends(get_db)) -> RLSession:
    if req.algorithm not in ("ppo", "dqn", "sac"):
        raise HTTPException(status_code=422, detail="algorithm must be ppo, dqn, or sac")
    if req.objective not in ("depth", "fidelity", "cnot_count"):
        raise HTTPException(status_code=422, detail="objective must be depth, fidelity, or cnot_count")

    session_id = str(uuid.uuid4())
    initial_depth = random.randint(20 + req.n_qubits * 3, 60 + req.n_qubits * 5)
    reduction_factor = random.uniform(0.28, 0.52)
    optimized_depth = max(5, int(initial_depth * (1 - reduction_factor)))
    depth_reduction_pct = round((initial_depth - optimized_depth) / initial_depth * 100, 2)
    gate_fidelity_improvement = round(random.uniform(0.005, 0.045), 4)

    training_curve = _generate_training_curve(req.episodes, req.algorithm, req.objective)
    best_reward = round(max(training_curve), 4)
    status = "converged" if best_reward > 0.6 else "failed"

    now = datetime.now(timezone.utc).isoformat()
    session = RLSession(
        session_id=session_id,
        name=req.name,
        backend=req.backend,
        n_qubits=req.n_qubits,
        algorithm=req.algorithm,
        objective=req.objective,
        episodes=req.episodes,
        status=status,
        best_reward=best_reward,
        initial_circuit_depth=initial_depth,
        optimized_circuit_depth=optimized_depth,
        depth_reduction_pct=depth_reduction_pct,
        gate_fidelity_improvement=gate_fidelity_improvement,
        training_curve=training_curve,
        created_at=now,
        completed_at=now,
    )
    store_put(db, NS_SESSIONS, session_id, session.model_dump())
    return session


@router.get("/sessions", response_model=List[RLSession])
def list_sessions(db: Session = Depends(get_db)) -> List[RLSession]:
    return store_list(db, NS_SESSIONS)


@router.get("/session/{session_id}", response_model=RLSession)
def get_session(session_id: str, db: Session = Depends(get_db)) -> RLSession:
    session = store_get(db, NS_SESSIONS, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/apply", response_model=OptimizedCircuit)
def apply(req: ApplyRequest, db: Session = Depends(get_db)) -> OptimizedCircuit:
    session = store_get(db, NS_SESSIONS, req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    opt_id = str(uuid.uuid4())
    original_depth = session["initial_circuit_depth"]
    optimized_depth = session["optimized_circuit_depth"]
    original_gate_count = original_depth + random.randint(5, 15)
    optimized_gate_count = optimized_depth + random.randint(2, 8)

    optimized_qasm = _make_qasm(session["n_qubits"], optimized_depth)

    record = OptimizedCircuit(
        opt_id=opt_id,
        session_id=req.session_id,
        original_qasm=req.circuit_qasm,
        optimized_qasm=optimized_qasm,
        original_depth=original_depth,
        optimized_depth=optimized_depth,
        original_gate_count=original_gate_count,
        optimized_gate_count=optimized_gate_count,
        estimated_fidelity_gain=session["gate_fidelity_improvement"],
        applied_at=datetime.now(timezone.utc).isoformat(),
    )
    return record
