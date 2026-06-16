"""Causal Discovery Engine — Novel Feature G.

Infers which experimental parameters *causally* influence circuit
outcomes across all stored runs, using the PC-skeleton algorithm on
partial correlations.

Why causal, not just correlational?
────────────────────────────────────
Standard correlation analysis can't distinguish:
  • shots → health_score (shots causes higher health via better statistics)
  • backend → gate_error  (backend determines hardware quality)
  • depth → success_prob  (depth → more noise → lower prob)
  …from spurious correlations induced by confounders.

The PC-skeleton algorithm:
  1. Start with a complete graph.
  2. For each pair (X, Y), test conditional independence:
         ρ_{XY|Z} ≈ 0  ⟹  X ⊥ Y | Z  ⟹  remove edge X–Y
  3. The remaining skeleton is a conservative causal graph under
     the Markov and faithfulness assumptions.

We approximate conditional independence with partial correlation
(valid for linear-Gaussian systems, reasonable approximation otherwise).

Nodes (variables)
─────────────────
  • shots, optimization_level, num_qubits, depth
  • avg_gate_error, avg_readout_error, avg_t1_us
  • health_score, success_probability

Output
──────
  • Edge list with partial correlation strength and p-value proxy
  • Ranked list of strongest causal influences on health_score
  • Adjacency matrix
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from itertools import combinations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["causal_discovery"])

_MIN_RUNS = 10

_VARIABLES = [
    "shots", "optimization_level", "num_qubits", "depth",
    "avg_gate_error", "avg_readout_error", "avg_t1_us",
    "health_score", "success_probability",
]

_VAR_LABELS = {
    "shots":               "Shots",
    "optimization_level":  "Optimisation Level",
    "num_qubits":          "Num Qubits",
    "depth":               "Circuit Depth",
    "avg_gate_error":      "Avg Gate Error",
    "avg_readout_error":   "Avg Readout Error",
    "avg_t1_us":           "T1 (µs)",
    "health_score":        "Health Score",
    "success_probability": "Success Probability",
}


def _safe(v, default=None):
    try:
        return float(v) if v is not None else default
    except Exception:
        return default


def _extract_row(run: Run) -> Optional[dict]:
    from ..health_score import compute_health_score
    fp      = run.fingerprint or {}
    cal     = run.calibration or {}
    res     = run.results or {}
    params  = run.parameters or {}
    trans   = run.transpiler or {}
    ts_s    = (trans.get("settings") or {})

    hs = compute_health_score({
        "fingerprint": fp, "calibration": cal, "results": res,
        "qasm": run.qasm or "", "context": run.context or {}, "transpiler": trans,
    })

    row = {
        "shots":               _safe(params.get("shots") or ts_s.get("shots"), None),
        "optimization_level":  _safe(ts_s.get("optimization_level") or params.get("optimization_level"), None),
        "num_qubits":          _safe(fp.get("num_qubits"), None),
        "depth":               _safe(fp.get("depth"), None),
        "avg_gate_error":      _safe(cal.get("avg_gate_error"), None),
        "avg_readout_error":   _safe(cal.get("avg_readout_error"), None),
        "avg_t1_us":           _safe(cal.get("avg_t1_us"), None),
        "health_score":        hs,
        "success_probability": _safe(res.get("success_probability"), None),
    }
    return row


def _pearson(xs: list, ys: list) -> float:
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = sum(xs)/n, sum(ys)/n
    num   = sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    den   = math.sqrt(sum((x-mx)**2 for x in xs) * sum((y-my)**2 for y in ys))
    return num / den if den > 1e-12 else 0.0


def _partial_corr(data: dict, var_x: str, var_y: str, conditioning: list[str]) -> float:
    """
    Partial correlation ρ_{XY|Z} using recursive formula for single conditioner,
    and Fischer's z-transform for multiple conditioners (approx).
    """
    if not conditioning:
        cols_x = data[var_x]
        cols_y = data[var_y]
        pairs  = [(x, y) for x, y in zip(cols_x, cols_y) if x is not None and y is not None]
        if len(pairs) < 3:
            return 0.0
        return _pearson([p[0] for p in pairs], [p[1] for p in pairs])

    # Use first conditioner Z for two-step recursion
    z_var = conditioning[0]
    # Get complete rows for (X, Y, Z)
    triples = [
        (data[var_x][i], data[var_y][i], data[z_var][i])
        for i in range(len(data[var_x]))
        if data[var_x][i] is not None and data[var_y][i] is not None and data[z_var][i] is not None
    ]
    if len(triples) < 5:
        return 0.0
    xs = [t[0] for t in triples]
    ys = [t[1] for t in triples]
    zs = [t[2] for t in triples]

    r_xy = _pearson(xs, ys)
    r_xz = _pearson(xs, zs)
    r_yz = _pearson(ys, zs)
    denom = math.sqrt(max(1e-9, (1 - r_xz**2) * (1 - r_yz**2)))
    r_xy_z = (r_xy - r_xz * r_yz) / denom
    return round(max(-1.0, min(1.0, r_xy_z)), 4)


def _fisher_z_pvalue(r: float, n: int) -> float:
    """Two-sided p-value for H₀: ρ=0 via Fisher's z-transform."""
    if n < 4 or abs(r) >= 1.0:
        return 1.0
    z   = 0.5 * math.log((1 + r) / (1 - r + 1e-12))
    se  = 1.0 / math.sqrt(max(1, n - 3))
    t   = abs(z / se)
    # Approximate two-sided p via complementary error function
    p   = math.erfc(t / math.sqrt(2))
    return round(min(1.0, p), 4)


# ──────────────────────────────────────────────────────────────────────
# PC-skeleton algorithm
# ──────────────────────────────────────────────────────────────────────

def _pc_skeleton(data: dict, vars_: list, n: int, alpha=0.05) -> list[dict]:
    """
    Returns edges surviving the conditional independence tests.
    Uses depth-0 (unconditional) and depth-1 (single-conditioner) tests.
    """
    # Start: fully connected
    adj = {v: set(vars_) - {v} for v in vars_}
    edges_out = []
    sep_sets  = {}

    for depth in range(2):   # order-0 and order-1
        for x, y in list(combinations(vars_, 2)):
            if y not in adj[x]:
                continue
            # Candidate conditioning sets of size `depth` from neighbours of x (excl y)
            nbrs_x = adj[x] - {y}
            if len(nbrs_x) < depth:
                continue
            for z_set in (list(combinations(nbrs_x, depth)) if depth > 0 else [()]):
                z_list = list(z_set)
                # Gather full rows
                all_keys = [x, y] + z_list
                valid_idx = [
                    i for i in range(n)
                    if all(data[k][i] is not None for k in all_keys)
                ]
                n_valid = len(valid_idx)
                if n_valid < _MIN_RUNS:
                    continue
                sub = {k: [data[k][i] for i in valid_idx] for k in all_keys}
                r   = _partial_corr(sub, x, y, z_list)
                p   = _fisher_z_pvalue(r, n_valid)
                if p > alpha:
                    # Independence found — remove edge
                    adj[x].discard(y)
                    adj[y].discard(x)
                    sep_sets[(x, y)] = z_list
                    break

    seen = set()
    for x in vars_:
        for y in adj[x]:
            key = tuple(sorted([x, y]))
            if key in seen:
                continue
            seen.add(key)
            all_keys = [x, y]
            valid_idx = [i for i in range(n) if all(data[k][i] is not None for k in all_keys)]
            n_valid   = len(valid_idx)
            if n_valid < 3:
                continue
            sub = {k: [data[k][i] for i in valid_idx] for k in all_keys}
            r   = _partial_corr(sub, x, y, [])
            p   = _fisher_z_pvalue(r, n_valid)
            sep = sep_sets.get(key) or sep_sets.get((key[1], key[0]))
            edges_out.append({
                "source":      x,
                "target":      y,
                "partial_corr": round(r, 4),
                "p_value":     p,
                "n_obs":       n_valid,
                "strength":    "strong" if abs(r) > 0.5 else "moderate" if abs(r) > 0.2 else "weak",
                "direction":   "positive" if r > 0 else "negative",
                "separator":   sep or [],
            })

    edges_out.sort(key=lambda e: abs(e["partial_corr"]), reverse=True)
    return edges_out


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/projects/{slug}/causal-graph")
def causal_graph(
    slug: str,
    alpha: float = Query(default=0.05, ge=0.001, le=0.2),
    db: Session = Depends(get_db),
):
    """
    Run PC-skeleton causal discovery on a project's experiment history.
    Returns a causal graph between experimental parameters and outcomes.
    """
    runs = db.execute(
        select(Run).where(Run.project_slug == slug)
        .order_by(Run.created_at.desc())
        .limit(500)
    ).scalars().all()

    if len(runs) < _MIN_RUNS:
        raise HTTPException(422, f"Need ≥ {_MIN_RUNS} runs in '{slug}' — found {len(runs)}.")

    rows = [_extract_row(r) for r in runs]
    rows = [r for r in rows if r is not None]

    # Build columnar data dict
    n    = len(rows)
    data = {v: [r.get(v) for r in rows] for v in _VARIABLES}

    # Remove variables with too many missing values
    active_vars = [
        v for v in _VARIABLES
        if sum(1 for x in data[v] if x is not None) >= max(_MIN_RUNS, n * 0.3)
    ]

    if len(active_vars) < 2:
        raise HTTPException(422, "Not enough variable data — ensure runs have calibration, results, and parameters.")

    edges = _pc_skeleton(data, active_vars, n, alpha=alpha)

    # Ranked influences on health_score
    hs_edges = [
        e for e in edges
        if e["source"] == "health_score" or e["target"] == "health_score"
    ]
    for e in hs_edges:
        e["outcome_var"] = "health_score"
        e["influence_var"] = e["target"] if e["source"] == "health_score" else e["source"]

    hs_edges.sort(key=lambda e: abs(e["partial_corr"]), reverse=True)

    # Adjacency matrix
    adj = {v: {u: 0.0 for u in active_vars} for v in active_vars}
    for e in edges:
        adj[e["source"]][e["target"]] = e["partial_corr"]
        adj[e["target"]][e["source"]] = e["partial_corr"]

    narrative = (
        f"Causal discovery on {n} runs in project '{slug}'. "
        f"Active variables: {len(active_vars)}. "
        f"Found {len(edges)} significant edge{'s' if len(edges) != 1 else ''}. "
        + (f"Strongest driver of health_score: '{hs_edges[0]['influence_var']}' "
           f"(partial corr {hs_edges[0]['partial_corr']:+.3f})."
           if hs_edges else "No significant health_score edges detected.")
    )

    return {
        "project":       slug,
        "n_runs":        n,
        "alpha":         alpha,
        "variables":     active_vars,
        "variable_labels": {v: _VAR_LABELS.get(v, v) for v in active_vars},
        "edges":         edges,
        "health_score_drivers": hs_edges[:5],
        "adjacency":     [[adj[r][c] for c in active_vars] for r in active_vars],
        "narrative":     narrative,
        "computed_at":   datetime.now(timezone.utc).isoformat(),
    }
