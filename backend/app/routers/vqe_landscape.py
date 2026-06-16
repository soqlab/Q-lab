"""VQE/QAOA Loss Landscape Explorer — sweeps two parameter dimensions and maps energy."""
from __future__ import annotations
import math, uuid, random
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/landscape-explorer", tags=["vqe_landscape"])


def _energy_fn(theta1: float, theta2: float, n_qubits: int, hamiltonian: str, rng: random.Random) -> float:
    noise = rng.gauss(0, 0.015)
    if hamiltonian == "ising":
        base = -math.cos(theta1) * math.cos(theta2) - 0.5 * math.sin(theta1 + theta2)
        return round(base * (1 + 0.1 * max(n_qubits - 2, 0)) + noise, 4)
    elif hamiltonian == "heisenberg":
        base = -math.cos(theta1) * math.cos(theta2) * math.cos(theta1 - theta2)
        return round(base * n_qubits * 0.25 + noise, 4)
    elif hamiltonian == "maxcut":
        g = math.cos(2 * theta1) * math.sin(2 * theta2)
        return round(-g * n_qubits * (n_qubits - 1) / 4 + noise, 4)
    else:
        r = math.sqrt(theta1 ** 2 + theta2 ** 2)
        base = rng.gauss(0, 0.001) if r < 0.5 else -math.cos(2 * theta1) * math.sin(theta2) * math.exp(-r * 0.1)
        return round(base * n_qubits * 0.3, 4)


class LandscapeRequest(BaseModel):
    qasm: str = ""
    hamiltonian: str = Field(default="ising")
    n_qubits: int = Field(default=4, ge=2, le=12)
    param1_range: List[float] = Field(default=[-3.14159, 3.14159])
    param2_range: List[float] = Field(default=[-3.14159, 3.14159])
    grid_size: int = Field(default=20, ge=5, le=50)
    seed: int = 42


@router.post("")
def explore_landscape(req: LandscapeRequest):
    rng = random.Random(req.seed)
    p1_min, p1_max = req.param1_range
    p2_min, p2_max = req.param2_range
    n = req.grid_size

    grid = []
    min_energy, max_energy = float("inf"), float("-inf")
    optimal_params = [0.0, 0.0]

    for i in range(n):
        row = []
        for j in range(n):
            t1 = p1_min + (p1_max - p1_min) * i / max(n - 1, 1)
            t2 = p2_min + (p2_max - p2_min) * j / max(n - 1, 1)
            e = _energy_fn(t1, t2, req.n_qubits, req.hamiltonian, rng)
            row.append({"theta1": round(t1, 4), "theta2": round(t2, 4), "energy": e})
            if e < min_energy:
                min_energy = e
                optimal_params = [round(t1, 4), round(t2, 4)]
            max_energy = max(max_energy, e)
        grid.append(row)

    all_energies = [row[j]["energy"] for row in grid for j in range(n)]
    mean_e = sum(all_energies) / len(all_energies)
    roughness = math.sqrt(sum((e - mean_e) ** 2 for e in all_energies) / len(all_energies))

    center = [grid[n // 4 + di][n // 4 + dj]["energy"] for di in range(n // 2) for dj in range(n // 2)]
    variance = sum((e - sum(center) / len(center)) ** 2 for e in center) / len(center)
    has_barren_plateau = variance < 0.01

    recs = []
    if has_barren_plateau:
        recs.append("Barren plateau detected in center region — use gradient-free optimizer (COBYLA/SPSA)")
    else:
        recs.append(f"Well-conditioned landscape — start at θ1={optimal_params[0]:.3f}, θ2={optimal_params[1]:.3f}")
        recs.append("Gradient descent (ADAM) should converge from the identified minimum")

    return {
        "landscape_id": f"lscape-{uuid.uuid4().hex[:12]}",
        "hamiltonian": req.hamiltonian,
        "n_qubits": req.n_qubits,
        "grid_size": n,
        "grid": grid,
        "min_energy": round(min_energy, 4),
        "max_energy": round(max_energy, 4),
        "energy_range": round(max_energy - min_energy, 4),
        "optimal_theta1": optimal_params[0],
        "optimal_theta2": optimal_params[1],
        "has_barren_plateau": has_barren_plateau,
        "landscape_roughness": round(roughness, 4),
        "gradient_variance": round(variance, 6),
        "recommendations": recs,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
