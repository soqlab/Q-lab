"""Observable Estimation from Measurement Counts — Feature #7.

Derives Z-basis expectation values, ZZ correlations, Rényi-2 entropy, and
entanglement indicators directly from the bitstring count distributions
stored in run.results. No extra hardware runs required.
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["shadow_tomo"])

_NOTE = (
    "Computed from computational-basis measurement counts. "
    "For arbitrary Pauli observables, submit runs with per-shot "
    "random-Clifford measurement records."
)

# Maximum number of qubits considered when computing ZZ correlations
# (avoids O(n²) explosion on wide circuits).
_MAX_CORR_QUBITS = 6


# ---------------------------------------------------------------------------
# Counts extraction
# ---------------------------------------------------------------------------

def _extract_counts(results: dict[str, Any]) -> dict[str, int] | None:
    """Find the bitstring count dict inside run.results.

    Accepts {"counts": {...}} or a bare dict of bitstring→int.
    """
    if not results:
        return None

    # Explicit "counts" key
    if "counts" in results and isinstance(results["counts"], dict):
        candidate = results["counts"]
    else:
        candidate = results

    # Validate: values must be int-like, keys must look like bitstrings
    def _is_bitstring(s: str) -> bool:
        return bool(s) and all(c in "01 " for c in s.replace(" ", ""))

    filtered = {
        k: int(v)
        for k, v in candidate.items()
        if isinstance(k, str) and _is_bitstring(k) and isinstance(v, (int, float))
    }
    if not filtered:
        return None
    return filtered


# ---------------------------------------------------------------------------
# Statistical helpers
# ---------------------------------------------------------------------------

def _bit(bitstring: str, i: int) -> int:
    """Return the i-th bit value (0 or 1) from a bitstring (left = qubit 0)."""
    s = bitstring.replace(" ", "")
    return int(s[i]) if i < len(s) else 0


def _compute_observables(counts: dict[str, int]) -> dict[str, Any]:
    total = sum(counts.values())
    if total == 0:
        return {}

    example_key = next(iter(counts))
    n_qubits = len(example_key.replace(" ", ""))

    # Per-qubit marginal probabilities
    p0 = [0.0] * n_qubits  # P(qubit i = 0)
    p1 = [0.0] * n_qubits  # P(qubit i = 1)
    for bitstring, cnt in counts.items():
        w = cnt / total
        for i in range(n_qubits):
            b = _bit(bitstring, i)
            if b == 0:
                p0[i] += w
            else:
                p1[i] += w

    z_expectations = [round(p0[i] - p1[i], 6) for i in range(n_qubits)]

    # Two-qubit ZZ correlations (cap at _MAX_CORR_QUBITS)
    corr_n = min(n_qubits, _MAX_CORR_QUBITS)
    zz_correlations: dict[str, float] = {}
    for i in range(corr_n):
        for j in range(i + 1, corr_n):
            same = 0.0
            diff = 0.0
            for bitstring, cnt in counts.items():
                w = cnt / total
                bi = _bit(bitstring, i)
                bj = _bit(bitstring, j)
                if bi == bj:
                    same += w
                else:
                    diff += w
            zz_correlations[f"Z{i}Z{j}"] = round(same - diff, 6)

    # Global parity: sum of (-1)^popcount(bitstring) * prob
    global_parity = 0.0
    for bitstring, cnt in counts.items():
        s = bitstring.replace(" ", "")
        pop = s.count("1")
        global_parity += ((-1) ** pop) * (cnt / total)
    global_parity = round(global_parity, 6)

    # Rényi-2 entropy: -log2(sum p²)
    sum_p2 = sum((cnt / total) ** 2 for cnt in counts.values())
    renyi2_entropy = round(-math.log2(sum_p2) if sum_p2 > 0 else 0.0, 6)

    # Entanglement indicator: max_ij |<ZiZj> - <Zi><Zj>|
    entanglement_indicator = 0.0
    for i in range(corr_n):
        for j in range(i + 1, corr_n):
            key = f"Z{i}Z{j}"
            zizj = zz_correlations.get(key, 0.0)
            zi   = z_expectations[i]
            zj   = z_expectations[j]
            dev  = abs(zizj - zi * zj)
            if dev > entanglement_indicator:
                entanglement_indicator = dev
    entanglement_indicator = round(entanglement_indicator, 6)

    # Most probable state
    most_probable_state = max(counts, key=lambda k: counts[k])
    most_probable_prob  = round(counts[most_probable_state] / total, 6)

    # Success probability: |0...0> / total
    zero_state = "0" * n_qubits
    success_count = counts.get(zero_state, counts.get("0" * n_qubits, 0))
    success_probability = round(success_count / total, 6)

    return {
        "n_qubits":                n_qubits,
        "n_shots":                 total,
        "method":                  "computational_basis_shadows",
        "z_expectations":          z_expectations,
        "zz_correlations":         zz_correlations,
        "global_parity":           global_parity,
        "renyi2_entropy":          renyi2_entropy,
        "entanglement_indicator":  entanglement_indicator,
        "most_probable_state":     most_probable_state,
        "most_probable_probability": most_probable_prob,
        "success_probability":     success_probability,
        "note":                    _NOTE,
    }


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.get("/runs/{run_id}/shadow-tomo")
def shadow_tomo(run_id: str, db: Session = Depends(get_db)):
    """Estimate observables from computational-basis measurement counts.

    Computes Z expectations, ZZ correlations, Rényi-2 entropy, and an
    entanglement indicator without any additional hardware experiments.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    counts = _extract_counts(run.results or {})
    if counts is None:
        raise HTTPException(
            422,
            "No bitstring count data found in run.results. "
            "Expected {'counts': {'00': N, ...}} or a bare bitstring dict.",
        )

    observables = _compute_observables(counts)
    return {"run_id": run_id, **observables}
