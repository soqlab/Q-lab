"""Automated Experiment Design Engine — Novel Feature B.

Uses Bayesian active learning (Gaussian Process + Expected Improvement)
to suggest which experiments to run next, based on the stored run history.

No external ML libraries required — GP is implemented from scratch using
pure-Python Gaussian elimination.

How it works
────────────
1. Extract (feature_vector, outcome) pairs from run history for a project.
2. Normalise features; fit RBF-kernel GP to predict health_score.
3. Evaluate Expected Improvement over a grid of candidate configurations.
4. Return top-5 suggested configurations with predicted score and uncertainty.

Features used as input dimensions
──────────────────────────────────
  x[0] = shots           (log-scaled)
  x[1] = num_qubits      (circuit width)
  x[2] = depth           (circuit depth)
  x[3] = optimization_level (0–3)

Outcome
───────
  y = health_score (0–100, maximised)
"""
from __future__ import annotations

import math
import itertools
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["experiment_design"])

_NOISE = 1e-3   # GP noise (regularisation)
_N_CANDIDATES = 500


# ──────────────────────────────────────────────────────────────────────
# GP helpers
# ──────────────────────────────────────────────────────────────────────

def _rbf(x1: list, x2: list, ls: float) -> float:
    dist2 = sum((a - b) ** 2 for a, b in zip(x1, x2))
    return math.exp(-dist2 / (2 * ls * ls))


def _build_K(X: list, ls: float, noise: float) -> list[list[float]]:
    n = len(X)
    return [
        [_rbf(X[i], X[j], ls) + (noise if i == j else 0.0) for j in range(n)]
        for i in range(n)
    ]


def _cholesky(A: list[list[float]]) -> list[list[float]]:
    """Lower-triangular Cholesky decomposition L such that A = L Lᵀ."""
    n = len(A)
    L = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1):
            s = sum(L[i][k] * L[j][k] for k in range(j))
            if i == j:
                val = A[i][i] - s
                L[i][j] = math.sqrt(max(val, 1e-12))
            else:
                L[i][j] = (A[i][j] - s) / (L[j][j] + 1e-12)
    return L


def _forward_sub(L: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    x = [0.0] * n
    for i in range(n):
        x[i] = (b[i] - sum(L[i][k] * x[k] for k in range(i))) / (L[i][i] + 1e-12)
    return x


def _back_sub(L: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (b[i] - sum(L[j][i] * x[j] for j in range(i + 1, n))) / (L[i][i] + 1e-12)
    return x


def _gp_predict(
    X_train: list, y_train: list, x_star: list, ls: float
) -> tuple[float, float]:
    """GP posterior mean and variance at x_star."""
    n = len(X_train)
    K   = _build_K(X_train, ls, _NOISE)
    L   = _cholesky(K)
    k_s = [_rbf(x_star, X_train[i], ls) for i in range(n)]

    alpha = _back_sub(L, _forward_sub(L, y_train))
    mu    = sum(k_s[i] * alpha[i] for i in range(n))

    v     = _forward_sub(L, k_s)
    var   = max(0.0, 1.0 - sum(vi * vi for vi in v))
    return mu, var


def _ei(mu: float, sigma: float, best: float) -> float:
    """Expected Improvement (standard normal CDF approximation)."""
    if sigma < 1e-9:
        return max(0.0, mu - best)
    z   = (mu - best) / sigma
    phi = math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)
    cdf = 0.5 * (1.0 + math.erf(z / math.sqrt(2)))
    return (mu - best) * cdf + sigma * phi


# ──────────────────────────────────────────────────────────────────────
# Feature extraction
# ──────────────────────────────────────────────────────────────────────

def _safe(v, default=0.0) -> float:
    try:
        return float(v or default)
    except Exception:
        return default


def _extract(run: Run) -> Optional[tuple[list[float], float]]:
    fp      = run.fingerprint  or {}
    params  = run.parameters   or {}
    transpiler = run.transpiler or {}
    ts      = transpiler.get("settings") or {}

    shots      = _safe(params.get("shots") or ts.get("shots"), 1024)
    num_qubits = _safe(fp.get("num_qubits"), 0)
    depth      = _safe(fp.get("depth"), 0)
    opt_level  = _safe(ts.get("optimization_level") or params.get("optimization_level"), 1)

    if num_qubits < 1 or depth < 1:
        return None

    from ..health_score import compute_health_score
    rd = {
        "fingerprint": fp,
        "calibration": run.calibration or {},
        "results":     run.results or {},
        "qasm":        run.qasm or "",
        "context":     run.context or {},
        "transpiler":  transpiler,
    }
    hs = compute_health_score(rd)
    if hs is None:
        return None

    x = [
        math.log1p(shots) / math.log1p(8192),   # normalised log-shots
        num_qubits / 50.0,                        # normalised qubits
        depth      / 300.0,                       # normalised depth
        opt_level  / 3.0,                         # normalised opt level
    ]
    return x, float(hs)


def _normalise_y(ys: list[float]) -> tuple[list[float], float, float]:
    mn, mx = min(ys), max(ys)
    if mx == mn:
        return [0.5] * len(ys), mn, 1.0
    return [(y - mn) / (mx - mn) for y in ys], mn, mx - mn


# ──────────────────────────────────────────────────────────────────────
# Candidate grid
# ──────────────────────────────────────────────────────────────────────

def _candidate_grid() -> list[list[float]]:
    shots_vals    = [512, 1024, 4096, 8192]
    qubits_vals   = [2, 4, 8, 16, 32]
    depth_vals    = [10, 30, 80, 150]
    opt_vals      = [0, 1, 2, 3]
    candidates = []
    for shots, nq, d, opt in itertools.product(shots_vals, qubits_vals, depth_vals, opt_vals):
        x = [
            math.log1p(shots) / math.log1p(8192),
            nq / 50.0,
            d  / 300.0,
            opt / 3.0,
        ]
        candidates.append((x, shots, nq, d, opt))
    return candidates


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/projects/{slug}/suggest-experiment")
def suggest_experiment(
    slug: str,
    n: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
):
    """
    Use Gaussian Process + Expected Improvement to suggest the next
    experiments most likely to improve health score for this project.
    """
    runs = db.execute(
        select(Run)
        .where(Run.project_slug == slug)
        .order_by(Run.created_at.desc())
        .limit(300)
    ).scalars().all()

    pairs = [_extract(r) for r in runs]
    pairs = [p for p in pairs if p is not None]

    if len(pairs) < 4:
        raise HTTPException(
            422, f"Need ≥ 4 runs with complete data in project '{slug}' — found {len(pairs)}."
        )

    X_train = [p[0] for p in pairs]
    y_raw   = [p[1] for p in pairs]
    y_norm, y_min, y_scale = _normalise_y(y_raw)

    best_norm = max(y_norm)
    best_raw  = max(y_raw)

    # Median pairwise distance → length-scale
    dists = []
    for i in range(min(len(X_train), 30)):
        for j in range(i + 1, min(len(X_train), 30)):
            d = math.sqrt(sum((X_train[i][k] - X_train[j][k]) ** 2 for k in range(4)))
            dists.append(d)
    ls = sorted(dists)[len(dists) // 2] if dists else 1.0
    ls = max(0.1, ls)

    candidates = _candidate_grid()

    scored = []
    for (x, shots, nq, d, opt) in candidates:
        # Skip configurations already well-covered by training data
        min_dist = min(
            math.sqrt(sum((x[k] - xt[k]) ** 2 for k in range(4))) for xt in X_train
        )
        mu_norm, var = _gp_predict(X_train, y_norm, x, ls)
        sigma = math.sqrt(var)
        ei    = _ei(mu_norm, sigma, best_norm)
        mu_raw = mu_norm * y_scale + y_min

        scored.append({
            "shots":               shots,
            "num_qubits":          nq,
            "depth":               d,
            "optimization_level":  opt,
            "predicted_health":    round(min(100.0, max(0.0, mu_raw)), 1),
            "uncertainty":         round(sigma * y_scale, 2),
            "expected_improvement": round(ei * y_scale, 3),
            "novelty":             round(min_dist, 4),
            "x_norm":              x,
        })

    scored.sort(key=lambda r: r["expected_improvement"], reverse=True)
    top = scored[:n]

    # Strip internal fields
    for s in top:
        s.pop("x_norm", None)

    return {
        "project":         slug,
        "n_training_runs": len(pairs),
        "best_health_seen": round(best_raw, 1),
        "length_scale":    round(ls, 4),
        "suggestions":     top,
        "feature_axes":    ["shots", "num_qubits", "depth", "optimization_level"],
        "computed_at":     datetime.now(timezone.utc).isoformat(),
    }
