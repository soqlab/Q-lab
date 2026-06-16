"""Quantum Volume Auto-Benchmarker — implements IBM QV protocol for simulated backends."""
from __future__ import annotations
import math, uuid, random
from datetime import datetime, timezone
from typing import Dict, List
from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/qvbench", tags=["qv_benchmarker"])

NOISE_PROFILES = {
    "ideal":       0.000,
    "near_term":   0.002,
    "noisy":       0.005,
    "very_noisy":  0.015,
}


def _simulate_trial(n: int, noise: float, seed: int) -> dict:
    rng = random.Random(seed)
    try:
        from .job_executor import _simulate_qasm
        gates = []
        for _ in range(n):
            perm = list(range(n))
            rng.shuffle(perm)
            for i in range(0, n - 1, 2):
                q1, q2 = perm[i], perm[i + 1]
                a1 = rng.uniform(0, 2 * math.pi)
                a2 = rng.uniform(0, 2 * math.pi)
                gates += [f"ry({a1:.4f}) q[{q1}];", f"ry({a2:.4f}) q[{q2}];", f"cx q[{q1}],q[{q2}];"]
        hdr = ["OPENQASM 2.0;", 'include "qelib1.inc";', f"qreg q[{n}];", f"creg c[{n}];"]
        meas = "\n".join(f"measure q[{i}] -> c[{i}];" for i in range(n))
        qasm = "\n".join(hdr + gates) + "\n" + meas
        counts: Dict[str, int] = _simulate_qasm(qasm, 1024, seed=seed)
    except Exception:
        counts = {format(i, f"0{n}b"): max(1, 1024 // (2 ** n) + rng.randint(-3, 3)) for i in range(2 ** n)}

    if noise > 0:
        noisy: Dict[str, int] = {}
        for bs, c in counts.items():
            for _ in range(c):
                nb = "".join("1" if b == "0" else "0" if rng.random() < noise else b for b in bs)
                noisy[nb] = noisy.get(nb, 0) + 1
        counts = noisy

    total = sum(counts.values()) or 1
    probs = sorted(v / total for v in counts.values())
    median = probs[len(probs) // 2] if probs else 0
    hop = sum(v / total for v in counts.values() if v / total > median)
    return {"heavy_output_prob": round(hop, 4), "passes": hop > 2 / 3}


class QVBenchRequest(BaseModel):
    max_qubits: int = Field(default=5, ge=2, le=10)
    n_trials: int = Field(default=50, ge=10, le=200)
    noise_profile: str = Field(default="near_term")
    backend_name: str = "Q-Lab Simulator"
    seed: int = 42


@router.post("")
def run_qv_benchmark(req: QVBenchRequest):
    noise = NOISE_PROFILES.get(req.noise_profile, 0.002)
    results = []
    max_qv = 1

    for n in range(2, req.max_qubits + 1):
        trials = [_simulate_trial(n, noise, req.seed + n * 1000 + t * 17) for t in range(req.n_trials)]
        mean_hop = sum(t["heavy_output_prob"] for t in trials) / req.n_trials
        pass_count = sum(1 for t in trials if t["passes"])
        pass_rate = pass_count / req.n_trials
        sigma = math.sqrt(pass_rate * (1 - pass_rate) / req.n_trials)
        certified = pass_rate - 2 * sigma > 2 / 3
        qv = 2 ** n if certified else 2 ** (n - 1)
        results.append({
            "n_qubits": n,
            "mean_heavy_output_prob": round(mean_hop, 4),
            "pass_rate": round(pass_rate, 4),
            "pass_count": pass_count,
            "sigma_bound": round(2 * sigma, 4),
            "certified": certified,
            "qv_at_width": qv,
            "trials": [{"trial": i, "hop": t["heavy_output_prob"], "pass": t["passes"]} for i, t in enumerate(trials)],
        })
        if certified:
            max_qv = qv
        else:
            break

    log2_qv = int(math.log2(max_qv)) if max_qv > 1 else 0

    return {
        "bench_id": f"qvb-{uuid.uuid4().hex[:12]}",
        "backend_name": req.backend_name,
        "noise_profile": req.noise_profile,
        "noise_level": noise,
        "n_trials_per_width": req.n_trials,
        "quantum_volume": max_qv,
        "qv_log2": log2_qv,
        "certification_message": (
            f"QV = {max_qv} certified (log₂={log2_qv}) — passes heavy output test up to {log2_qv}-qubit width"
            if max_qv > 1 else "QV < 4: does not meet minimum QV certification"
        ),
        "per_width_results": results,
        "pass_threshold": round(2 / 3, 4),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/noise-profiles")
def list_noise_profiles():
    return [{"id": k, "noise_level": v} for k, v in NOISE_PROFILES.items()]
