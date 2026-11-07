"""Cross-entropy benchmarking statistics of recorded counts against an exact ideal distribution.

Linear XEB (Arute et al., Nature 574, 2019): F = 2^n * mean over shots of P_ideal(x) - 1.
About 1 for a perfect device, 0 for uniformly random output. Under the null hypothesis that the
samples are uniform, the mean of 2^n P_ideal(x) has expectation 1 and variance
(2^n * sum_x P_ideal(x)^2 - 1) / shots.

Heavy output probability (Cross et al., PRA 100, 2019): the fraction of shots that land on
outcomes whose ideal probability is above the median of all 2^n ideal probabilities.
"""
from __future__ import annotations

import math
from typing import Optional


def norm_sf(z: float) -> float:
    """P(Z > z) for a standard normal."""
    return 0.5 * math.erfc(z / math.sqrt(2))


def bitstring(key: str, n_bits: int) -> Optional[str]:
    key = str(key).replace(" ", "")
    if key.lower().startswith("0x"):
        try:
            return format(int(key, 16), f"0{n_bits}b")
        except ValueError:
            return None
    return key if len(key) == n_bits and set(key) <= {"0", "1"} else None


def _clean_counts(counts: dict, n_bits: int) -> dict[str, int]:
    out: dict[str, int] = {}
    for key, c in counts.items():
        bits = bitstring(key, n_bits)
        if bits is None:
            raise ValueError(f"Outcome '{key}' does not match the circuit's {n_bits} classical bits.")
        out[bits] = out.get(bits, 0) + int(c)
    if sum(out.values()) <= 0:
        raise ValueError("The run has no recorded shots.")
    return out


def linear_xeb(counts: dict, ideal: dict[str, float], n_bits: int) -> tuple[float, float, int]:
    """(F, standard error of F under the uniform-noise null, shots used)."""
    clean = _clean_counts(counts, n_bits)
    shots = sum(clean.values())
    dim = 2 ** n_bits
    xeb = dim * sum(c * ideal.get(k, 0.0) for k, c in clean.items()) / shots - 1.0
    null_var = dim * sum(p * p for p in ideal.values()) - 1.0
    return xeb, math.sqrt(max(null_var, 0.0) / shots), shots


def heavy_outputs(ideal: dict[str, float], n_bits: int) -> set[str]:
    """Outcomes with ideal probability strictly above the median over all 2^n outcomes."""
    dim = 2 ** n_bits
    probs = sorted(list(ideal.values()) + [0.0] * (dim - len(ideal)))
    median = (probs[(dim - 1) // 2] + probs[dim // 2]) / 2
    return {k for k, p in ideal.items() if p > median}


def heavy_output_probability(counts: dict, ideal: dict[str, float], n_bits: int) -> tuple[float, float]:
    """(measured HOP, ideal HOP)."""
    clean = _clean_counts(counts, n_bits)
    heavy = heavy_outputs(ideal, n_bits)
    measured = sum(c for k, c in clean.items() if k in heavy) / sum(clean.values())
    return measured, sum(ideal[k] for k in heavy)
