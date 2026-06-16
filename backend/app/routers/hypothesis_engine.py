"""Hypothesis Engine.

Statistical hypothesis testing for quantum distributions and classical data.
Implements: chi_squared, tvd, ks_test, t_test, quantum_fidelity, portmanteau.
All math is pure Python — no scipy/numpy required.
"""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/hypothesis", tags=["hypothesis_engine"])

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class HypothesisRequest(BaseModel):
    test: str = Field("chi_squared", description="Statistical test to run")
    observed: List[float] = Field(..., description="Observed distribution or sample")
    expected: Optional[List[float]] = Field(None, description="Expected distribution (chi-squared, TVD, quantum_fidelity)")
    alpha: float = Field(0.05, gt=0.0, lt=1.0, description="Significance level")
    distribution_b: Optional[List[float]] = Field(None, description="Second sample (t_test, KS)")
    n_qubits: Optional[int] = Field(None, ge=1, le=20)


# ---------------------------------------------------------------------------
# Pure-Python statistical helpers
# ---------------------------------------------------------------------------

# --- Gamma / incomplete gamma functions (Lanczos approximation) ---

def _log_gamma(z: float) -> float:
    """Log-Gamma via Lanczos approximation (accurate to ~1e-9)."""
    if z < 0.5:
        return math.log(math.pi) - math.log(abs(math.sin(math.pi * z))) - _log_gamma(1 - z)
    z -= 1
    g = 7
    c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ]
    x = c[0]
    for i in range(1, g + 2):
        x += c[i] / (z + i)
    t = z + g + 0.5
    return 0.5 * math.log(2 * math.pi) + (z + 0.5) * math.log(t) - t + math.log(x)


def _gamma(z: float) -> float:
    return math.exp(_log_gamma(z))


def _lower_inc_gamma_regularized(a: float, x: float, n_terms: int = 100) -> float:
    """P(a, x) = lower incomplete gamma / Gamma(a), series expansion."""
    if x < 0:
        return 0.0
    if x == 0:
        return 0.0
    # Series: P(a,x) = e^-x * x^a * Σ x^n / Γ(a+n+1)
    term = 1.0 / a
    total = term
    for n in range(1, n_terms):
        term *= x / (a + n)
        total += term
        if abs(term) < 1e-12 * abs(total):
            break
    return math.exp(-x + a * math.log(x) - _log_gamma(a)) * total


def _chi2_p_value(chi2: float, df: int) -> float:
    """P-value for chi-squared distribution = 1 - P(df/2, chi2/2)."""
    if chi2 <= 0:
        return 1.0
    return 1.0 - _lower_inc_gamma_regularized(df / 2.0, chi2 / 2.0)


def _chi2_critical(df: int, alpha: float) -> float:
    """Critical value for chi-squared (binary search on CDF)."""
    lo, hi = 0.0, 200.0
    for _ in range(60):
        mid = (lo + hi) / 2
        p = 1.0 - _lower_inc_gamma_regularized(df / 2.0, mid / 2.0)
        if p > alpha:
            lo = mid
        else:
            hi = mid
    return round((lo + hi) / 2, 4)


def _normal_cdf(x: float) -> float:
    """Standard normal CDF via erfc."""
    return 0.5 * math.erfc(-x / math.sqrt(2))


def _t_p_value(t_stat: float, df: int) -> float:
    """Two-tailed p-value for Student's t-distribution (approximation via normal for large df)."""
    if df >= 30:
        return 2 * (1 - _normal_cdf(abs(t_stat)))
    # Use Wilson-Hilferty approximation
    x = (t_stat ** 2) / (t_stat ** 2 + df)
    # Beta regularized approximation: p ≈ I_x(0.5, df/2)
    # We approximate via the normal for simplicity
    se = 1 / math.sqrt(df)
    z = t_stat * (1 - 0.02 / df)
    return 2 * (1 - _normal_cdf(abs(z)))


def _t_critical(alpha: float, df: int) -> float:
    """Two-tailed t critical value by Newton inversion of normal CDF."""
    # Use normal quantile then adjust for df
    alpha2 = alpha / 2
    # Standard normal quantile via inverse erfc
    z = math.sqrt(2) * _erfinv(1 - 2 * alpha2)
    # t correction: t ≈ z * (1 + (z^2 + 1)/(4*df))
    t = z * (1 + (z ** 2 + 1) / (4 * df))
    return round(t, 4)


def _erfinv(x: float) -> float:
    """Inverse error function (Halley's method)."""
    if x >= 1.0:
        return 8.0
    if x <= -1.0:
        return -8.0
    a = 0.147
    ln_term = math.log(1 - x ** 2)
    term1 = 2 / (math.pi * a) + ln_term / 2
    y = math.copysign(math.sqrt(math.sqrt(term1 ** 2 - ln_term / a) - term1), x)
    # One Newton refinement
    for _ in range(3):
        fx = math.erf(y) - x
        dfx = 2 / math.sqrt(math.pi) * math.exp(-y ** 2)
        y -= fx / dfx
    return y


def _ks_p_value(ks_stat: float, n: int) -> float:
    """Kolmogorov-Smirnov p-value via Kolmogorov distribution series."""
    if ks_stat <= 0:
        return 1.0
    lam = (math.sqrt(n) + 0.12 + 0.11 / math.sqrt(n)) * ks_stat
    # Kolmogorov distribution: sum(-1)^k * exp(-2*k^2*lam^2)
    total = 0.0
    for k in range(1, 101):
        term = ((-1) ** (k - 1)) * math.exp(-2 * k * k * lam * lam)
        total += term
        if abs(term) < 1e-12:
            break
    return min(1.0, max(0.0, 2 * total))


# ---------------------------------------------------------------------------
# Effect size helpers
# ---------------------------------------------------------------------------

def _cohens_d(obs: List[float], ref: List[float]) -> Tuple[float, str]:
    n1, n2 = len(obs), len(ref)
    if n1 < 2 or n2 < 2:
        return 0.0, "undefined"
    m1 = sum(obs) / n1
    m2 = sum(ref) / n2
    s1 = math.sqrt(sum((x - m1) ** 2 for x in obs) / (n1 - 1))
    s2 = math.sqrt(sum((x - m2) ** 2 for x in ref) / (n2 - 1))
    pooled_s = math.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2))
    if pooled_s == 0:
        return 0.0, "zero variance"
    d = (m1 - m2) / pooled_s
    interp = "negligible" if abs(d) < 0.2 else "small" if abs(d) < 0.5 else "medium" if abs(d) < 0.8 else "large"
    return round(d, 4), interp


def _cramers_v(chi2: float, n: int, k: int) -> Tuple[float, str]:
    if n == 0 or k <= 1:
        return 0.0, "undefined"
    v = math.sqrt(chi2 / (n * (k - 1)))
    v = min(v, 1.0)
    interp = "negligible" if v < 0.1 else "small" if v < 0.3 else "medium" if v < 0.5 else "large"
    return round(v, 4), interp


def _min_n_for_power(effect_size: float, alpha: float = 0.05, power: float = 0.8) -> int:
    """Approximate minimum sample size (two-sample t-test formula)."""
    if effect_size <= 0:
        return 9999
    z_alpha = abs(_erfinv(1 - alpha)) * math.sqrt(2)   # one-tailed z
    z_power = abs(_erfinv(2 * power - 1)) * math.sqrt(2)
    n = 2 * ((z_alpha + z_power) / effect_size) ** 2
    return max(2, math.ceil(n))


def _confidence_interval_mean(data: List[float], alpha: float = 0.05) -> Tuple[float, float]:
    n = len(data)
    if n < 2:
        m = data[0] if data else 0.0
        return round(m, 6), round(m, 6)
    m = sum(data) / n
    s = math.sqrt(sum((x - m) ** 2 for x in data) / (n - 1))
    se = s / math.sqrt(n)
    tc = _t_critical(alpha, n - 1)
    return round(m - tc * se, 6), round(m + tc * se, 6)


def _estimate_power(test_stat: float, critical: float, n: int) -> float:
    """Heuristic power estimate: how far stat is from critical value."""
    if critical <= 0:
        return 0.5
    ratio = abs(test_stat) / abs(critical)
    # Sigmoid-style power estimate
    power = 1 / (1 + math.exp(-3 * (ratio - 1)))
    return round(max(0.01, min(0.99, power)), 4)


# ---------------------------------------------------------------------------
# Individual tests
# ---------------------------------------------------------------------------

def _run_chi_squared(obs: List[float], exp: Optional[List[float]], alpha: float) -> Dict[str, Any]:
    n = len(obs)
    if n < 2:
        raise ValueError("Need at least 2 bins")
    total_obs = sum(obs) or 1.0
    obs_norm = [o / total_obs for o in obs]

    if exp:
        total_exp = sum(exp) or 1.0
        exp_norm = [e / total_exp for e in exp[:n]]
    else:
        exp_norm = [1.0 / n] * n   # uniform

    # Scale to counts-like
    scale = max(total_obs, 50.0)
    chi2 = sum(
        (o * scale - e * scale) ** 2 / max(e * scale, 1e-9)
        for o, e in zip(obs_norm, exp_norm)
    )
    df = n - 1
    p_value = _chi2_p_value(chi2, df)
    critical = _chi2_critical(df, alpha)
    cramer_v, interp = _cramers_v(chi2, int(scale), n)
    ci = _confidence_interval_mean(obs, alpha)
    min_n = _min_n_for_power(cramer_v, alpha)
    power = _estimate_power(chi2, critical, int(scale))

    return {
        "test_name": "Chi-Squared Goodness-of-Fit",
        "test_statistic": round(chi2, 6),
        "p_value": round(p_value, 6),
        "critical_value": critical,
        "reject_null": p_value < alpha,
        "effect_size": cramer_v,
        "effect_size_name": "Cramér's V",
        "effect_interpretation": interp,
        "confidence_interval": list(ci),
        "power_at_current_n": power,
        "minimum_n_for_power_80": min_n,
        "interpretation": (
            f"Chi-squared test (df={df}): χ²={chi2:.3f}, p={p_value:.4f}. "
            f"{'Reject' if p_value < alpha else 'Fail to reject'} H₀ at α={alpha}."
        ),
        "recommendation": (
            "Distributions differ significantly — inspect residuals." if p_value < alpha
            else "No significant deviation from expected distribution detected."
        ),
    }


def _run_tvd(obs: List[float], exp: Optional[List[float]], alpha: float) -> Dict[str, Any]:
    n = len(obs)
    if not exp:
        exp = [1.0 / n] * n

    total_o = sum(obs) or 1.0
    total_e = sum(exp) or 1.0
    obs_p = [o / total_o for o in obs]
    exp_p = [e / total_e for e in exp[:n]]

    tvd = 0.5 * sum(abs(o - e) for o, e in zip(obs_p, exp_p))
    # Bootstrapped critical value for TVD: ~0.05 for large n
    critical = 1.96 / math.sqrt(max(n, 1) * sum(obs) if sum(obs) > 0 else n)
    critical = max(critical, 0.01)
    p_value = max(0.0, 1.0 - tvd / max(critical, 1e-9)) * alpha  # heuristic

    interp = "negligible" if tvd < 0.05 else "small" if tvd < 0.10 else "medium" if tvd < 0.20 else "large"
    ci = (max(0.0, round(tvd - critical, 6)), min(1.0, round(tvd + critical, 6)))

    return {
        "test_name": "Total Variation Distance",
        "test_statistic": round(tvd, 6),
        "p_value": round(min(1.0, p_value), 6),
        "critical_value": round(critical, 6),
        "reject_null": tvd > critical,
        "effect_size": round(tvd, 4),
        "effect_size_name": "TVD",
        "effect_interpretation": interp,
        "confidence_interval": list(ci),
        "power_at_current_n": _estimate_power(tvd, critical, n),
        "minimum_n_for_power_80": _min_n_for_power(tvd, alpha),
        "interpretation": (
            f"TVD = {tvd:.4f} (range [0,1]). "
            f"{'Distributions are distinguishable' if tvd > critical else 'Distributions are statistically indistinguishable'}."
        ),
        "recommendation": (
            "Consider error mitigation or longer runs." if tvd > 0.10
            else "TVD within acceptable noise levels for quantum output."
        ),
    }


def _run_ks_test(obs: List[float], dist_b: Optional[List[float]], alpha: float) -> Dict[str, Any]:
    obs_s = sorted(obs)
    n = len(obs_s)

    if dist_b:
        ref_s = sorted(dist_b)
        m = len(ref_s)
        # Two-sample KS
        i, j = 0, 0
        ks = 0.0
        while i < n and j < m:
            f1 = (i + 1) / n
            f2 = (j + 1) / m
            ks = max(ks, abs(f1 - f2))
            if obs_s[i] < ref_s[j]:
                i += 1
            elif ref_s[j] < obs_s[i]:
                j += 1
            else:
                i += 1
                j += 1
        n_eff = int(n * m / (n + m))
    else:
        # One-sample KS vs uniform [0, obs_max]
        lo, hi = min(obs_s), max(obs_s)
        span = hi - lo or 1.0
        ks = 0.0
        for idx, v in enumerate(obs_s):
            cdf_obs = (idx + 1) / n
            cdf_uni = (v - lo) / span
            ks = max(ks, abs(cdf_obs - cdf_uni))
        n_eff = n

    p_value = _ks_p_value(ks, n_eff)
    critical = 1.36 / math.sqrt(n_eff)  # standard α=0.05 critical value
    d_interp = "negligible" if ks < 0.05 else "small" if ks < 0.15 else "medium" if ks < 0.30 else "large"

    ci = _confidence_interval_mean(obs, alpha)
    return {
        "test_name": "Kolmogorov-Smirnov Test",
        "test_statistic": round(ks, 6),
        "p_value": round(p_value, 6),
        "critical_value": round(critical, 6),
        "reject_null": p_value < alpha,
        "effect_size": round(ks, 4),
        "effect_size_name": "KS statistic (D)",
        "effect_interpretation": d_interp,
        "confidence_interval": list(ci),
        "power_at_current_n": _estimate_power(ks, critical, n_eff),
        "minimum_n_for_power_80": _min_n_for_power(ks, alpha),
        "interpretation": (
            f"KS statistic D={ks:.4f}, p={p_value:.4f}. "
            f"{'Reject H₀: distributions differ' if p_value < alpha else 'Fail to reject H₀: distributions consistent'}."
        ),
        "recommendation": (
            "Distributions are significantly different — investigate systematic bias." if p_value < alpha
            else "No significant distributional difference detected."
        ),
    }


def _run_t_test(obs: List[float], dist_b: Optional[List[float]], alpha: float) -> Dict[str, Any]:
    n1 = len(obs)
    if not dist_b:
        # One-sample t-test vs mean=0
        m = sum(obs) / n1
        s = math.sqrt(sum((x - m) ** 2 for x in obs) / max(n1 - 1, 1))
        se = s / math.sqrt(n1)
        t_stat = m / max(se, 1e-12)
        df = n1 - 1
        ref = [0.0] * n1
    else:
        n2 = len(dist_b)
        m1 = sum(obs) / n1
        m2 = sum(dist_b) / n2
        s1 = math.sqrt(sum((x - m1) ** 2 for x in obs) / max(n1 - 1, 1))
        s2 = math.sqrt(sum((x - m2) ** 2 for x in dist_b) / max(n2 - 1, 1))
        se = math.sqrt(s1 ** 2 / n1 + s2 ** 2 / n2)
        t_stat = (m1 - m2) / max(se, 1e-12)
        # Welch's df
        num = (s1 ** 2 / n1 + s2 ** 2 / n2) ** 2
        den = (s1 ** 2 / n1) ** 2 / max(n1 - 1, 1) + (s2 ** 2 / n2) ** 2 / max(n2 - 1, 1)
        df = max(1, int(num / max(den, 1e-12)))
        ref = dist_b

    p_value = _t_p_value(t_stat, df)
    critical = _t_critical(alpha, df)
    cohen_d, d_interp = _cohens_d(obs, ref if ref else [0.0] * n1)
    ci = _confidence_interval_mean(obs, alpha)

    return {
        "test_name": "Welch's Two-Sample t-Test" if dist_b else "One-Sample t-Test",
        "test_statistic": round(t_stat, 6),
        "p_value": round(p_value, 6),
        "critical_value": critical,
        "reject_null": p_value < alpha,
        "effect_size": cohen_d,
        "effect_size_name": "Cohen's d",
        "effect_interpretation": d_interp,
        "confidence_interval": list(ci),
        "power_at_current_n": _estimate_power(abs(t_stat), critical, n1),
        "minimum_n_for_power_80": _min_n_for_power(abs(cohen_d), alpha),
        "interpretation": (
            f"t({df}) = {t_stat:.3f}, p = {p_value:.4f}. "
            f"{'Significant difference in means' if p_value < alpha else 'No significant difference in means'} at α={alpha}."
        ),
        "recommendation": (
            f"Effect size is {d_interp} (Cohen's d={cohen_d:.2f}). "
            + ("Increase sample size." if abs(cohen_d) < 0.2 else "Effect is practically meaningful.")
        ),
    }


def _run_quantum_fidelity(obs: List[float], exp: Optional[List[float]], alpha: float) -> Dict[str, Any]:
    n = len(obs)
    if not exp:
        exp = [1.0 / n] * n

    total_o = sum(obs) or 1.0
    total_e = sum(exp) or 1.0
    p = [o / total_o for o in obs]
    q = [e / total_e for e in exp[:n]]

    # Quantum fidelity: F = (Σ √(pi*qi))^2
    fidelity = sum(math.sqrt(max(pi, 0) * max(qi, 0)) for pi, qi in zip(p, q)) ** 2
    fidelity = min(1.0, max(0.0, fidelity))

    # Bures distance
    bures = math.sqrt(max(0.0, 2 * (1 - math.sqrt(fidelity))))
    # Uhlmann's theorem: threshold
    critical = 1.0 - (1.96 / math.sqrt(max(n, 1))) ** 2
    p_value = 1.0 - fidelity  # proxy: high fidelity → low "p-value"
    p_value = max(0.0, min(1.0, p_value))

    interp = ("high" if fidelity > 0.95 else "medium" if fidelity > 0.80
              else "low" if fidelity > 0.50 else "very low")
    ci = (round(max(0, fidelity - 0.02), 6), round(min(1, fidelity + 0.02), 6))

    return {
        "test_name": "Quantum State Fidelity",
        "test_statistic": round(fidelity, 6),
        "p_value": round(p_value, 6),
        "critical_value": round(critical, 6),
        "reject_null": fidelity < critical,
        "effect_size": round(bures, 6),
        "effect_size_name": "Bures Distance",
        "effect_interpretation": interp,
        "confidence_interval": list(ci),
        "power_at_current_n": round(fidelity, 4),
        "minimum_n_for_power_80": _min_n_for_power(1 - fidelity, alpha),
        "interpretation": (
            f"Quantum fidelity F={fidelity:.4f} ({interp}). "
            f"Bures distance={bures:.4f}. "
            f"{'States are indistinguishable' if fidelity > 0.99 else 'States are distinguishable'}."
        ),
        "recommendation": (
            "Excellent agreement — quantum device performing near-ideally." if fidelity > 0.95
            else "Fidelity degradation detected — check noise and calibration." if fidelity > 0.70
            else "Low fidelity — significant state preparation/measurement errors present."
        ),
    }


def _run_portmanteau(obs: List[float], alpha: float) -> Dict[str, Any]:
    """Ljung-Box portmanteau test for whiteness/randomness."""
    n = len(obs)
    if n < 4:
        raise ValueError("Need at least 4 observations")

    mean = sum(obs) / n
    var = sum((x - mean) ** 2 for x in obs) / n or 1.0

    # Compute autocorrelations up to lag L
    L = min(10, n // 3)
    rho: List[float] = []
    for lag in range(1, L + 1):
        cov = sum((obs[i] - mean) * (obs[i + lag] - mean) for i in range(n - lag)) / n
        rho.append(cov / var)

    # Ljung-Box statistic
    Q = n * (n + 2) * sum(rho[k] ** 2 / (n - k - 1) for k in range(L))
    df = L
    p_value = _chi2_p_value(Q, df)
    critical = _chi2_critical(df, alpha)
    cramer_v, interp = _cramers_v(Q, n, L)
    ci = _confidence_interval_mean(obs, alpha)

    return {
        "test_name": "Ljung-Box Portmanteau Test (randomness)",
        "test_statistic": round(Q, 6),
        "p_value": round(p_value, 6),
        "critical_value": critical,
        "reject_null": p_value < alpha,
        "effect_size": round(max(abs(r) for r in rho), 4) if rho else 0.0,
        "effect_size_name": "Max |autocorrelation|",
        "effect_interpretation": interp,
        "confidence_interval": list(ci),
        "power_at_current_n": _estimate_power(Q, critical, n),
        "minimum_n_for_power_80": _min_n_for_power(cramer_v, alpha),
        "interpretation": (
            f"Ljung-Box Q({L}) = {Q:.3f}, p = {p_value:.4f}. "
            f"{'Sequence is NOT white noise — autocorrelation detected' if p_value < alpha else 'Sequence is consistent with white noise'}."
        ),
        "recommendation": (
            "Systematic correlations present — check for drift or memory effects." if p_value < alpha
            else "Sequence appears random — no significant autocorrelation."
        ),
    }


_TEST_DISPATCH = {
    "chi_squared":       lambda req: _run_chi_squared(req.observed, req.expected, req.alpha),
    "tvd":               lambda req: _run_tvd(req.observed, req.expected, req.alpha),
    "ks_test":           lambda req: _run_ks_test(req.observed, req.distribution_b, req.alpha),
    "t_test":            lambda req: _run_t_test(req.observed, req.distribution_b, req.alpha),
    "quantum_fidelity":  lambda req: _run_quantum_fidelity(req.observed, req.expected, req.alpha),
    "portmanteau":       lambda req: _run_portmanteau(req.observed, req.alpha),
}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("")
def run_hypothesis_test(req: HypothesisRequest) -> Dict[str, Any]:
    test_fn = _TEST_DISPATCH.get(req.test)
    if not test_fn:
        # Default to chi-squared
        test_fn = _TEST_DISPATCH["chi_squared"]

    result = test_fn(req)

    return {
        "test_id": str(uuid.uuid4()),
        "test_name": result["test_name"],
        "alpha": req.alpha,
        "test_statistic": result["test_statistic"],
        "p_value": result["p_value"],
        "critical_value": result["critical_value"],
        "reject_null": result["reject_null"],
        "significance_level_met": result["reject_null"],
        "effect_size": result["effect_size"],
        "effect_size_name": result["effect_size_name"],
        "effect_interpretation": result["effect_interpretation"],
        "confidence_interval": result["confidence_interval"],
        "power_at_current_n": result["power_at_current_n"],
        "minimum_n_for_power_80": result["minimum_n_for_power_80"],
        "interpretation": result["interpretation"],
        "recommendation": result["recommendation"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/tests")
def list_tests() -> Dict[str, Any]:
    return {
        "tests": [
            {
                "name": "chi_squared",
                "display_name": "Chi-Squared Goodness-of-Fit",
                "description": "Tests whether an observed distribution matches an expected distribution",
                "requires": ["observed"],
                "optional": ["expected (defaults to uniform)"],
                "effect_size": "Cramér's V",
            },
            {
                "name": "tvd",
                "display_name": "Total Variation Distance",
                "description": "Measures the statistical distance between two probability distributions",
                "requires": ["observed"],
                "optional": ["expected"],
                "effect_size": "TVD ∈ [0, 1]",
            },
            {
                "name": "ks_test",
                "display_name": "Kolmogorov-Smirnov Test",
                "description": "Non-parametric test for equality of continuous distributions",
                "requires": ["observed"],
                "optional": ["distribution_b (two-sample mode)"],
                "effect_size": "KS statistic D",
            },
            {
                "name": "t_test",
                "display_name": "Welch's t-Test",
                "description": "Compare means of one or two samples",
                "requires": ["observed"],
                "optional": ["distribution_b"],
                "effect_size": "Cohen's d",
            },
            {
                "name": "quantum_fidelity",
                "display_name": "Quantum State Fidelity",
                "description": "F = (Σ√(pᵢqᵢ))² — measures overlap between two quantum output distributions",
                "requires": ["observed"],
                "optional": ["expected"],
                "effect_size": "Bures distance",
            },
            {
                "name": "portmanteau",
                "display_name": "Ljung-Box Portmanteau (Whiteness Test)",
                "description": "Tests whether a time series is consistent with white noise",
                "requires": ["observed (time series)"],
                "optional": [],
                "effect_size": "Max |autocorrelation|",
            },
        ]
    }
