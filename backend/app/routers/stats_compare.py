"""Statistical Comparison between groups of runs.

Welch's t-test, Cohen's d effect size, and bootstrap 95% CI.
Suitable for publication-quality significance reporting.
"""

from __future__ import annotations

import math
import random
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..health_score import compute_health_score

router = APIRouter(prefix="/api/v1/stats", tags=["stats_compare"])

_METRICS = {"health_score", "depth", "size", "num_qubits", "non_clifford_ratio", "success_probability"}
_BOOTSTRAP_REPS = 2000
_BOOTSTRAP_SEED = 42


class CompareRequest(BaseModel):
    group_a: list[str] = Field(..., min_length=2, max_length=500)
    group_b: list[str] = Field(..., min_length=2, max_length=500)
    metric: str = Field("health_score")


def _welch_t(a: list[float], b: list[float]) -> dict:
    """Welch's t-test (unequal variances). Returns t, df, p-value approximation."""
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return {"t": None, "df": None, "p_value": None}

    mean_a = sum(a) / na
    mean_b = sum(b) / nb
    var_a = sum((x - mean_a) ** 2 for x in a) / (na - 1)
    var_b = sum((x - mean_b) ** 2 for x in b) / (nb - 1)

    if var_a == 0 and var_b == 0:
        return {"t": None, "df": None, "p_value": 1.0 if mean_a == mean_b else None}

    se2_a = var_a / na
    se2_b = var_b / nb
    se = math.sqrt(se2_a + se2_b)
    if se == 0:
        return {"t": 0.0, "df": na + nb - 2, "p_value": 1.0}

    t = (mean_a - mean_b) / se

    # Welch–Satterthwaite df
    denom = (se2_a ** 2) / (na - 1) + (se2_b ** 2) / (nb - 1)
    df = ((se2_a + se2_b) ** 2) / denom if denom > 0 else na + nb - 2

    # Two-tailed p approximation via Student-t CDF (abramowitz & stegun)
    p = _t_pvalue(abs(t), df)
    return {"t": round(t, 4), "df": round(df, 1), "p_value": round(p, 4)}


def _t_pvalue(t_abs: float, df: float) -> float:
    """Two-tailed p-value approximation for large df (normal approximation when df>30)."""
    if df <= 0:
        return 1.0
    if df > 30:
        # Normal approximation
        p1 = _normal_sf(t_abs)
        return min(1.0, 2 * p1)
    # Use regularized incomplete beta function approximation
    x = df / (df + t_abs ** 2)
    p1 = 0.5 * _ibeta(df / 2, 0.5, x)
    return min(1.0, max(0.0, p1))


def _ibeta(a: float, b: float, x: float, iters: int = 200) -> float:
    """Regularized incomplete beta function via continued fraction (Lentz)."""
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    front = math.exp(math.log(x) * a + math.log(1 - x) * b - lbeta) / a

    # Lentz continued fraction
    def cf():
        f = 1e-30
        C, D = f, 0.0
        for m in range(0, iters + 1):
            for flag in (0, 1):
                if m == 0 and flag == 0:
                    d = 1.0
                elif flag == 0:
                    d = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m))
                else:
                    d = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))
                D = 1 + d * D
                if abs(D) < 1e-30:
                    D = 1e-30
                C = 1 + d / C
                if abs(C) < 1e-30:
                    C = 1e-30
                D = 1 / D
                delta = C * D
                f *= delta
                if abs(delta - 1) < 1e-7:
                    return f
        return f

    return front * cf()


def _normal_sf(z: float) -> float:
    """Survival function of standard normal (right tail)."""
    return 0.5 * math.erfc(z / math.sqrt(2))


def _cohens_d(a: list[float], b: list[float]) -> float | None:
    """Cohen's d (pooled SD version)."""
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return None
    mean_a = sum(a) / na
    mean_b = sum(b) / nb
    var_a = sum((x - mean_a) ** 2 for x in a) / (na - 1)
    var_b = sum((x - mean_b) ** 2 for x in b) / (nb - 1)
    pooled_sd = math.sqrt(((na - 1) * var_a + (nb - 1) * var_b) / (na + nb - 2))
    if pooled_sd == 0:
        return None
    return round((mean_a - mean_b) / pooled_sd, 4)


def _bootstrap_ci(a: list[float], b: list[float], reps: int = _BOOTSTRAP_REPS, seed: int = _BOOTSTRAP_SEED) -> dict:
    """Bootstrap 95% CI for the difference in means (A - B)."""
    rng = random.Random(seed)
    diffs = []
    for _ in range(reps):
        samp_a = [rng.choice(a) for _ in range(len(a))]
        samp_b = [rng.choice(b) for _ in range(len(b))]
        diffs.append(sum(samp_a) / len(samp_a) - sum(samp_b) / len(samp_b))
    diffs.sort()
    lo = diffs[int(0.025 * reps)]
    hi = diffs[int(0.975 * reps)]
    return {"lower": round(lo, 4), "upper": round(hi, 4), "contains_zero": lo <= 0 <= hi}


def _describe(vals: list[float]) -> dict:
    n = len(vals)
    if n == 0:
        return {}
    mu = sum(vals) / n
    sorted_v = sorted(vals)
    med = sorted_v[n // 2] if n % 2 else (sorted_v[n // 2 - 1] + sorted_v[n // 2]) / 2
    var = sum((x - mu) ** 2 for x in vals) / max(n - 1, 1)
    return {
        "n": n,
        "mean": round(mu, 4),
        "median": round(med, 4),
        "std": round(math.sqrt(var), 4),
        "min": round(min(vals), 4),
        "max": round(max(vals), 4),
        "p25": round(sorted_v[int(0.25 * n)], 4),
        "p75": round(sorted_v[int(0.75 * n)], 4),
    }


def _extract_metric(run: Run, metric: str) -> float | None:
    """Extract a numeric metric value from a Run ORM object."""
    if metric == "health_score":
        try:
            run_dict = {
                "results": run.results or {},
                "calibration": run.calibration or {},
                "fingerprint": run.fingerprint or {},
            }
            v = compute_health_score(run_dict)
            return float(v) if v is not None else None
        except Exception:
            return None
    fp = run.fingerprint or {}
    res = run.results or {}
    transpiler = run.transpiler or {}
    sources = [fp, res, transpiler]
    for src in sources:
        raw = src.get(metric)
        if raw is not None:
            try:
                return float(raw)
            except (TypeError, ValueError):
                pass
    return None


def _effect_label(d: float | None) -> str:
    if d is None:
        return "unknown"
    abs_d = abs(d)
    return "negligible" if abs_d < 0.2 else "small" if abs_d < 0.5 else "medium" if abs_d < 0.8 else "large"


def _significance_verdict(p: float | None, d: float | None, ci: dict) -> str:
    if p is None:
        return "insufficient_data"
    if p < 0.001:
        sig = "highly_significant"
    elif p < 0.05:
        sig = "significant"
    elif p < 0.1:
        sig = "marginally_significant"
    else:
        sig = "not_significant"
    if sig in ("not_significant", "marginally_significant") or ci.get("contains_zero"):
        return "no_meaningful_difference"
    eff = _effect_label(d)
    if eff in ("negligible", "small"):
        return "statistically_significant_small_effect"
    return "statistically_significant_meaningful_effect"


@router.post("/compare")
def compare_groups(body: CompareRequest, db: Session = Depends(get_db)):
    """Run Welch's t-test + Cohen's d + bootstrap CI between two run groups on a given metric."""
    if body.metric not in _METRICS:
        raise HTTPException(422, f"metric must be one of: {sorted(_METRICS)}")

    # Fetch both groups
    runs_a = db.scalars(select(Run).where(Run.run_id.in_(body.group_a))).all()
    runs_b = db.scalars(select(Run).where(Run.run_id.in_(body.group_b))).all()

    found_a = {r.run_id for r in runs_a}
    found_b = {r.run_id for r in runs_b}
    missing_a = [rid for rid in body.group_a if rid not in found_a]
    missing_b = [rid for rid in body.group_b if rid not in found_b]

    vals_a = [v for r in runs_a if (v := _extract_metric(r, body.metric)) is not None]
    vals_b = [v for r in runs_b if (v := _extract_metric(r, body.metric)) is not None]

    if len(vals_a) < 2 or len(vals_b) < 2:
        raise HTTPException(
            422,
            f"Need ≥2 runs with '{body.metric}' in each group. "
            f"Got {len(vals_a)} in A, {len(vals_b)} in B.",
        )

    welch = _welch_t(vals_a, vals_b)
    d = _cohens_d(vals_a, vals_b)
    ci = _bootstrap_ci(vals_a, vals_b)
    mean_a = sum(vals_a) / len(vals_a)
    mean_b = sum(vals_b) / len(vals_b)

    verdict = _significance_verdict(welch["p_value"], d, ci)
    direction = "A > B" if mean_a > mean_b else "A < B" if mean_a < mean_b else "A = B"

    return {
        "metric": body.metric,
        "group_a": {"run_ids": body.group_a, "missing": missing_a, "usable_n": len(vals_a)},
        "group_b": {"run_ids": body.group_b, "missing": missing_b, "usable_n": len(vals_b)},
        "descriptive": {
            "group_a": _describe(vals_a),
            "group_b": _describe(vals_b),
            "mean_difference": round(mean_a - mean_b, 4),
            "direction": direction,
        },
        "welch_t_test": welch,
        "effect_size": {"cohens_d": d, "magnitude": _effect_label(d)},
        "bootstrap_ci_95": ci,
        "verdict": verdict,
        "interpretation": _interpret(welch["p_value"], d, ci, body.metric, mean_a, mean_b),
    }


def _interpret(p: float | None, d: float | None, ci: dict, metric: str, mean_a: float, mean_b: float) -> str:
    if p is None:
        return "Could not compute statistics — insufficient data."
    higher = "A" if mean_a > mean_b else "B"
    delta_pct = abs(mean_a - mean_b) / max(abs(mean_b), 1e-9) * 100
    eff = _effect_label(d)
    sig_word = "highly significant" if p < 0.001 else "significant" if p < 0.05 else "marginally significant" if p < 0.1 else "not significant"
    ci_note = "" if ci["contains_zero"] else f" The 95% bootstrap CI [{ci['lower']:.4f}, {ci['upper']:.4f}] excludes zero."
    return (
        f"Group {higher} has a {delta_pct:.1f}% {'higher' if higher == 'A' else 'lower'} {metric} on average "
        f"(p={p:.4f}, {sig_word}; Cohen's d={d:.3f}, {eff} effect).{ci_note}"
    )


@router.get("/metrics")
def list_metrics():
    return {"available_metrics": sorted(_METRICS)}
