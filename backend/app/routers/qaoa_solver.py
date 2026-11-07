from __future__ import annotations
import math, random, uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/qaoa", tags=["qaoa_solver"])

MAX_NODES = 14

class QAOARequest(BaseModel):
    problem: str = "maxcut"
    n_nodes: int = Field(default=8, ge=3, le=20)  # exact simulation: up to MAX_NODES
    p_layers: int = Field(default=3, ge=1, le=10)
    graph_type: str = "random_3reg"
    edge_density: float = Field(default=0.4, ge=0.1, le=1.0)
    optimizer: str = "cobyla"
    max_iter: int = Field(default=200, ge=10, le=1000)
    n_shots: int = Field(default=1024, ge=100, le=65536)
    seed: Optional[int] = None

PROBLEM_TYPES = {
    "maxcut": "Maximum cut — partition graph to maximize edges between partitions",
}

GRAPH_TYPES = {
    "random_3reg": "Random 3-regular graph",
    "erdos_renyi": "Erdos-Renyi random graph",
    "complete": "Complete graph K_n",
    "ring": "Ring/cycle graph",
}

def _gen_graph(n: int, graph_type: str, density: float, rng: random.Random) -> List[Tuple[int, int, float]]:
    edges = []
    if graph_type == "ring":
        for i in range(n): edges.append((i, (i+1)%n, 1.0))
    elif graph_type == "complete":
        for i in range(n):
            for j in range(i+1, n): edges.append((i, j, 1.0))
    elif graph_type == "random_3reg":
        degree = [0] * n
        for i in range(n):
            for j in range(i+1, n):
                if degree[i] < 3 and degree[j] < 3 and rng.random() < 0.5:
                    edges.append((i, j, 1.0)); degree[i] += 1; degree[j] += 1
        if not edges:
            for i in range(n-1): edges.append((i, i+1, 1.0))
    else:
        for i in range(n):
            for j in range(i+1, n):
                if rng.random() < density: edges.append((i, j, 1.0))
    return edges

def _maxcut_brute(n: int, edges: list) -> Tuple[int, List[int]]:
    best = -1; best_bits = []
    limit = min(1 << n, 1 << 16)
    for mask in range(limit):
        cut = sum(w for i, j, w in edges if ((mask>>i)&1) != ((mask>>j)&1))
        if cut > best: best = cut; best_bits = [(mask>>k)&1 for k in range(n)]
    return int(best), best_bits

def _cut_values(n: int, edges: list):
    """C(z) for every bitstring z (bit k of the index is node k)."""
    import numpy as np

    idx = np.arange(1 << n)
    bits = (idx[:, None] >> np.arange(n)) & 1
    c = np.zeros(1 << n)
    for i, j, w in edges:
        c += w * (bits[:, i] != bits[:, j])
    return c


def _qaoa_state(gammas, betas, cut, n: int):
    """Exact QAOA statevector: |+>^n, then p layers of exp(-i gamma C) and exp(-i beta sum X)."""
    import numpy as np

    psi = np.full(1 << n, 1 / np.sqrt(1 << n), dtype=complex)
    for g, b in zip(gammas, betas):
        psi = psi * np.exp(-1j * g * cut)
        c, s_ = np.cos(b), -1j * np.sin(b)
        t = psi.reshape([2] * n)
        for q in range(n):
            axis = n - 1 - q  # reshape puts the most significant bit first
            a0 = np.take(t, 0, axis=axis)
            a1 = np.take(t, 1, axis=axis)
            t = np.stack([c * a0 + s_ * a1, s_ * a0 + c * a1], axis=axis)
        psi = t.reshape(-1)
    return psi


def _circuit_figures(n: int, edges: list, p: int) -> tuple[int, int, int]:
    from qiskit import QuantumCircuit, transpile

    qc = QuantumCircuit(n)
    qc.h(range(n))
    for _ in range(p):
        for i, j, _w in edges:
            qc.rzz(0.1, i, j)
        for q in range(n):
            qc.rx(0.1, q)
    t = transpile(qc, basis_gates=["cx", "rz", "rx", "h"], optimization_level=0)
    ops = t.count_ops()
    n2 = ops.get("cx", 0)
    return sum(ops.values()) - n2, n2, t.depth()


@router.post("")
def run_qaoa(req: QAOARequest):
    """QAOA for MaxCut, simulated exactly.

    The graph is generated from the request (seeded). The QAOA state is computed exactly as a
    statevector, the angles are optimised with scipy (COBYLA, Nelder-Mead or Powell) on the exact
    expected cut, and shots are sampled from the final state. The optimum is found by brute force,
    so the approximation ratio is exact. Gate counts and depth come from building the circuit.
    """
    import numpy as np
    from fastapi import HTTPException
    from scipy.optimize import minimize

    if req.problem != "maxcut":
        raise HTTPException(422, "Only MaxCut is implemented.")
    if req.n_nodes > MAX_NODES:
        raise HTTPException(422, f"Exact simulation is limited to {MAX_NODES} nodes.")
    method = {"cobyla": "COBYLA", "nelder-mead": "Nelder-Mead", "powell": "Powell"}.get(req.optimizer.lower())
    if method is None:
        raise HTTPException(422, "optimizer must be cobyla, nelder-mead or powell.")
    seed = 42 if req.seed is None else req.seed
    rng = random.Random(seed)
    n, p = req.n_nodes, req.p_layers
    edges = _gen_graph(n, req.graph_type, req.edge_density, rng)
    brute_cut, brute_bits = _maxcut_brute(n, edges)
    cut = _cut_values(n, edges)

    history: list[float] = []

    def objective(x):
        psi = _qaoa_state(x[:p], x[p:], cut, n)
        value = float(np.abs(psi) ** 2 @ cut)
        history.append(round(value, 6))
        return -value

    x0 = np.array([0.4] * p + [0.3] * p)  # a fixed, documented starting point
    res = minimize(objective, x0, method=method, options={"maxiter": req.max_iter})
    gammas, betas = res.x[:p], res.x[p:]
    probs = np.abs(_qaoa_state(gammas, betas, cut, n)) ** 2
    expected = float(probs @ cut)
    shots = np.random.default_rng(seed).choice(1 << n, size=req.n_shots, p=probs / probs.sum())
    best_idx = int(shots[np.argmax(cut[shots])])
    n1, n2, depth = _circuit_figures(n, edges, p)
    ratio = expected / brute_cut if brute_cut else 0.0
    return {
        "qaoa_id": str(uuid.uuid4()),
        "problem": req.problem,
        "n_nodes": n,
        "n_edges": len(edges),
        "graph_type": req.graph_type,
        "p_layers": p,
        "n_params": 2 * p,
        "optimizer": req.optimizer,
        "optimal_gammas": [round(float(g), 6) for g in gammas],
        "optimal_betas": [round(float(b), 6) for b in betas],
        "optimal_cost": round(expected, 6),
        "convergence_history": history,
        "n_iterations": len(history),
        "classical_optimal": brute_cut,
        "classical_assignment": brute_bits,
        "qaoa_assignment": [(best_idx >> k) & 1 for k in range(n)],
        "qaoa_cut_value": int(cut[best_idx]),
        "approximation_ratio": round(ratio, 4),
        "expected_cut_value": round(expected, 4),
        "best_shot_cut": int(cut[best_idx]),
        "n_qubits": n,
        "n_1q_gates": n1,
        "n_2q_gates": n2,
        "circuit_depth": depth,
        "goemans_williamson_bound": round(0.878 * brute_cut, 2),
        "exceeds_gw": ratio > 0.878,
        "edges": [{"from": i, "to": j, "weight": w} for i, j, w in edges],
        "method": "Exact statevector QAOA; scipy " + method + " on the exact expected cut; brute-force optimum.",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/problems")
def list_problems():
    return {"problems": [{"id": k, "description": v} for k, v in PROBLEM_TYPES.items()]}

@router.get("/graphs")
def list_graphs():
    return {"graph_types": [{"id": k, "description": v} for k, v in GRAPH_TYPES.items()]}
