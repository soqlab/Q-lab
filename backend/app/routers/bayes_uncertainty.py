from __future__ import annotations

import math
import random
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/bayes-uncertainty", tags=["bayes-uncertainty"])

# ---------------------------------------------------------------------------
# Math helpers (no scipy)
# ---------------------------------------------------------------------------

def _beta_sample(a: float, b: float, rng: random.Random) -> float:
    """Sample from Beta(a,b) via Johnk's method."""
    while True:
        u = rng.random() ** (1.0 / a); v = rng.random() ** (1.0 / b)
        if u + v <= 1.0: s = u + v; return u / s if s > 0 else 0.5

def _box_muller(rng: random.Random) -> float:
    while True:
        u = rng.random()
        if u > 0: return math.sqrt(-2.0 * math.log(u)) * math.cos(2*math.pi*rng.random())

def _normal_sample(mu: float, sigma: float, rng: random.Random) -> float:
    return mu + sigma * _box_muller(rng)

def _mean(xs: List[float]) -> float: return sum(xs) / len(xs) if xs else 0.0

def _variance(xs: List[float]) -> float:
    if len(xs) < 2: return 0.0
    m = _mean(xs); return sum((x - m)**2 for x in xs) / (len(xs) - 1)

def _skewness(xs: List[float]) -> float:
    m, s = _mean(xs), math.sqrt(_variance(xs))
    return 0.0 if s == 0 else _mean([(x-m)**3 for x in xs]) / s**3

def _kurtosis(xs: List[float]) -> float:
    m, s = _mean(xs), math.sqrt(_variance(xs))
    return 0.0 if s == 0 else _mean([(x-m)**4 for x in xs]) / s**4 - 3.0

def _credible_interval(samples: List[float], pct: float) -> Tuple[float, float]:
    s = sorted(samples); n = len(s); tail = (1.0 - pct) / 2
    return (round(s[max(0, int(tail*n))], 6), round(s[min(n-1, int((1-tail)*n))], 6))

def _ess(samples: List[float]) -> float:
    n = len(samples)
    if n < 3: return float(n)
    m, var = _mean(samples), _variance(samples)
    if var == 0: return float(n)
    lag1 = sum((samples[i]-m)*(samples[i+1]-m) for i in range(n-1)) / ((n-1)*var)
    rho = max(-0.999, min(0.999, lag1))
    return round(n*(1-rho)/(1+rho), 2)

def _counts_to_fidelity(counts: Dict[str, int], n_qubits: Optional[int]) -> Tuple[float, int]:
    total = sum(counts.values())
    if total == 0: return 0.5, 0
    target = ("0"*n_qubits) if n_qubits else "0"*len(max(counts, key=lambda k: len(k)))
    return counts.get(target, 0) / total, total

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class PropagatePayload(BaseModel):
    counts: Dict[str, int]; n_shots: int
    prior: Optional[str] = "uniform"; likelihood: Optional[str] = "binomial"; n_qubits: Optional[int] = None

class ComparePayload(BaseModel):
    experiment_a: Dict[str, int]; experiment_b: Dict[str, int]
    n_shots_a: Optional[int] = None; n_shots_b: Optional[int] = None

class UpdatePayload(BaseModel):
    prior_posterior: Dict; new_counts: Dict[str, int]; n_shots: int; n_qubits: Optional[int] = None

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/propagate")
def propagate_uncertainty(payload: PropagatePayload):
    rng = random.Random(42); n_samp = 100
    fidelity, total = _counts_to_fidelity(payload.counts, payload.n_qubits)
    n = payload.n_shots or total or 1; successes = int(round(fidelity * n))
    prior = payload.prior or "uniform"
    if prior == "jeffreys": a_pr, b_pr = 0.5, 0.5
    elif prior == "informative": a_pr, b_pr = 9.0, 1.0
    else: a_pr, b_pr = 1.0, 1.0
    likelihood = payload.likelihood or "binomial"
    if likelihood == "binomial":
        samples = [_beta_sample(a_pr+successes, b_pr+(n-successes), rng) for _ in range(n_samp)]
    else:
        sp = math.sqrt(fidelity*(1-fidelity)/max(n,1))
        samples = [max(0.0, min(1.0, _normal_sample(fidelity, sp, rng))) for _ in range(n_samp)]
    mean_s = _mean(samples); std_s = math.sqrt(_variance(samples))
    return {"posterior_mean": round(mean_s,6), "posterior_std": round(std_s,6),
            "credible_interval_95": list(_credible_interval(samples, 0.95)),
            "credible_interval_68": list(_credible_interval(samples, 0.68)),
            "posterior_samples": [round(s,6) for s in samples], "prior_used": prior,
            "likelihood": likelihood, "effective_sample_size": _ess(samples),
            "convergence": _ess(samples) > 50, "skewness": round(_skewness(samples),4),
            "kurtosis": round(_kurtosis(samples),4), "n_shots_used": n, "successes": successes}

@router.post("/compare")
def compare_experiments(payload: ComparePayload):
    rng = random.Random(77); n_samp = 200
    def _post(counts: Dict[str, int], n_shots: Optional[int]) -> List[float]:
        fid, total = _counts_to_fidelity(counts, None); n = n_shots or total or 1
        s = int(round(fid * n))
        return [_beta_sample(1.0+s, 1.0+(n-s), rng) for _ in range(n_samp)]
    sA, sB = _post(payload.experiment_a, payload.n_shots_a), _post(payload.experiment_b, payload.n_shots_b)
    mA, mB = _mean(sA), _mean(sB)
    prob_a = sum(1 for a,b in zip(sA,sB) if a > b) / n_samp
    diff = [a-b for a,b in zip(sA,sB)]
    near_zero = sum(1 for d in diff if abs(d) < 0.01) / n_samp
    bf = round(1.0/max(near_zero, 0.01), 3)
    overlap = sum(1 for a,b in zip(sorted(sA),sorted(sB)) if abs(a-b)<0.02) / n_samp
    pooled = math.sqrt((_variance(sA)+_variance(sB))/2)
    effect = round((mA-mB)/max(pooled,1e-9), 4)
    interp = ("strong evidence for A" if bf>10 else "moderate evidence for A" if bf>3
              else "anecdotal evidence for A" if bf>1 else "evidence for B")
    return {"bayes_factor": bf, "evidence_for_a": round(prob_a,4), "evidence_for_b": round(1-prob_a,4),
            "interpretation": interp, "posterior_overlap": round(overlap,4),
            "effect_size": effect, "mean_a": round(mA,6), "mean_b": round(mB,6)}

@router.post("/update")
def sequential_update(payload: UpdatePayload):
    rng = random.Random(13); n_samp = 100
    prior = payload.prior_posterior
    fidelity, total = _counts_to_fidelity(payload.new_counts, payload.n_qubits)
    n = payload.n_shots or total or 1; successes = int(round(fidelity * n))
    a_pr = float(prior.get("alpha", 1.0)); b_pr = float(prior.get("beta", 1.0))
    a_post, b_post = a_pr + successes, b_pr + (n - successes)
    samples = [_beta_sample(a_post, b_post, rng) for _ in range(n_samp)]
    mean_s = _mean(samples); std_s = math.sqrt(_variance(samples))
    return {"updated_alpha": round(a_post,4), "updated_beta": round(b_post,4),
            "posterior_mean": round(mean_s,6), "posterior_std": round(std_s,6),
            "credible_interval_95": list(_credible_interval(samples, 0.95)),
            "posterior_samples": [round(s,6) for s in samples],
            "n_data_points": n, "new_successes": successes, "convergence": _ess(samples) > 50}
