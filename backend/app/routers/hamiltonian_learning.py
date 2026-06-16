"""Effective Hamiltonian Learning — Novel Feature D.

Reconstructs the effective Ising Hamiltonian that best explains the
measurement statistics accumulated across all runs on a backend,
using the inverse Ising / maximum-entropy approach.

Physics
───────
We measure in the computational (Z) basis, so our observables are:
  ⟨Z_i⟩     = magnetisation of qubit i
  ⟨Z_i Z_j⟩ = pairwise correlation

Maximum-entropy Hamiltonian consistent with these constraints:
  H = Σ_i  h_i Z_i  +  Σ_{i<j} J_{ij} Z_i Z_j

Local fields h_i and couplings J_{ij} are estimated via:
  h_i   ≈ atanh(⟨Z_i⟩)          (mean-field, exact for 1-qubit systems)
  J_{ij} ≈ C_{ij} / (1 − ⟨Z_i⟩²) / (1 − ⟨Z_j⟩²)   (Sessak-Monasson)

where C_{ij} = ⟨Z_i Z_j⟩ − ⟨Z_i⟩⟨Z_j⟩ is the connected correlator.

This is the standard inverse Ising approach used in statistical physics
and neuroscience (spike-train analysis), here applied to quantum hardware.
It tells you: "if the device were sampling from a Boltzmann distribution,
which Hamiltonian would produce the observed correlations?"

Output
──────
  • h_i:   local field (qubit bias) for each qubit
  • J_{ij}: coupling strength between each qubit pair
  • Connectivity graph (edges with |J| > threshold)
  • Dominant coupling pairs
  • Estimated energy scale (β J_max)
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["hamiltonian_learning"])

_MIN_RUNS    = 5
_MAX_QUBITS  = 12   # coupling matrix explodes beyond this


def _safe(v, default=0.0) -> float:
    try:
        return float(v or default)
    except Exception:
        return default


# ──────────────────────────────────────────────────────────────────────
# Correlator estimation from bitstring counts
# ──────────────────────────────────────────────────────────────────────

def _bitstring_to_zvals(bitstring: str) -> list[int]:
    """'101' → [+1, -1, +1]  (Z eigenvalues: 0→+1, 1→-1)."""
    return [1 - 2 * int(b) for b in bitstring]


def _accumulate_correlators(counts: dict, n: int) -> tuple[list[float], list[list[float]], int]:
    """
    Returns:
      mag[i]   = ⟨Z_i⟩      (magnetisation)
      corr[i][j] = ⟨Z_i Z_j⟩ (correlation)
      N_total   = total shots
    """
    mag  = [0.0] * n
    corr = [[0.0] * n for _ in range(n)]
    N    = 0

    for bs, cnt in counts.items():
        try:
            cnt = int(cnt)
        except Exception:
            continue
        bs = bs.replace(" ", "").replace("|", "").replace(">", "").replace("<", "")
        if len(bs) < n:
            bs = bs.zfill(n)
        if len(bs) > n:
            bs = bs[-n:]          # take least-significant qubits
        zv = _bitstring_to_zvals(bs[-n:])
        for i in range(n):
            mag[i] += cnt * zv[i]
        for i in range(n):
            for j in range(n):
                corr[i][j] += cnt * zv[i] * zv[j]
        N += cnt

    if N == 0:
        return mag, corr, 0
    mag  = [m / N for m in mag]
    corr = [[corr[i][j] / N for j in range(n)] for i in range(n)]
    return mag, corr, N


def _merge_correlators(
    all_mags: list[list[float]], all_corrs: list[list[list[float]]], weights: list[int]
) -> tuple[list[float], list[list[float]]]:
    """Weighted average of correlators across runs."""
    if not all_mags:
        return [], []
    n = len(all_mags[0])
    W = sum(weights)
    mag_avg  = [sum(all_mags[r][i] * weights[r] for r in range(len(weights))) / W
                for i in range(n)]
    corr_avg = [[sum(all_corrs[r][i][j] * weights[r] for r in range(len(weights))) / W
                 for j in range(n)] for i in range(n)]
    return mag_avg, corr_avg


# ──────────────────────────────────────────────────────────────────────
# Inverse Ising (Sessak-Monasson approximation)
# ──────────────────────────────────────────────────────────────────────

def _atanh_safe(x: float) -> float:
    x = max(-0.999, min(0.999, x))
    return 0.5 * math.log((1 + x) / (1 - x))


def _inverse_ising(
    mag: list[float], corr: list[list[float]]
) -> tuple[list[float], list[list[float]]]:
    n = len(mag)
    # Local fields
    h = [_atanh_safe(mag[i]) for i in range(n)]

    # Connected correlator C_ij
    C = [[corr[i][j] - mag[i] * mag[j] for j in range(n)] for i in range(n)]

    # Sessak-Monasson: J_ij = C_ij / ((1-mi²)(1-mj²))
    J = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            denom = max(1e-9, (1 - mag[i] ** 2) * (1 - mag[j] ** 2))
            Jij   = -C[i][j] / denom    # negative sign: antiferro = positive energy
            J[i][j] = round(Jij, 5)
            J[j][i] = round(Jij, 5)

    return h, J


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/backends/{backend}/hamiltonian")
def learn_hamiltonian(
    backend: str,
    limit: int = Query(default=200, ge=10, le=2000),
    coupling_threshold: float = Query(default=0.02, ge=0.0, le=1.0),
    db: Session = Depends(get_db),
):
    """
    Reconstruct the effective Ising Hamiltonian from Z-basis measurement
    statistics accumulated across stored runs on this backend.
    """
    runs = db.execute(
        select(Run)
        .where(Run.backend == backend, Run.results.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(limit)
    ).scalars().all()

    if len(runs) < _MIN_RUNS:
        raise HTTPException(422, f"Need ≥ {_MIN_RUNS} runs with results — found {len(runs)}.")

    # Determine max qubits (cap at _MAX_QUBITS for feasibility)
    n_max = 0
    usable = []
    for r in runs:
        fp     = r.fingerprint or {}
        res    = r.results or {}
        counts = res.get("counts") or res.get("counts_dict") or {}
        nq     = int(_safe(fp.get("num_qubits"), 0))
        if nq < 2 or nq > _MAX_QUBITS or not counts:
            continue
        usable.append((r, nq, counts))
        n_max = max(n_max, nq)

    if not usable:
        raise HTTPException(422, "No runs with bitstring counts and ≥2 qubits found.")

    # Use a fixed n = mode of qubit counts (most common width)
    from collections import Counter
    nq_counts = Counter(nq for _, nq, _ in usable)
    n = nq_counts.most_common(1)[0][0]
    usable = [(r, nq, c) for r, nq, c in usable if nq == n]

    if len(usable) < _MIN_RUNS:
        raise HTTPException(422, f"Not enough runs with {n} qubits and counts data.")

    # Accumulate correlators
    all_mags, all_corrs, weights = [], [], []
    for r, nq, counts in usable:
        shots = int(_safe((r.results or {}).get("shots"), 1)) or 1
        mag, corr, N = _accumulate_correlators(counts, n)
        if N > 0:
            all_mags.append(mag)
            all_corrs.append(corr)
            weights.append(N)

    if not all_mags:
        raise HTTPException(422, "Could not parse bitstring counts from any run.")

    mag_avg, corr_avg = _merge_correlators(all_mags, all_corrs, weights)
    h, J = _inverse_ising(mag_avg, corr_avg)

    # Build connectivity graph
    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            if abs(J[i][j]) >= coupling_threshold:
                edges.append({
                    "i": i, "j": j,
                    "J": round(J[i][j], 5),
                    "strength": "strong" if abs(J[i][j]) > 3 * coupling_threshold else "moderate",
                    "type": "ferromagnetic" if J[i][j] < 0 else "antiferromagnetic",
                })
    edges.sort(key=lambda e: abs(e["J"]), reverse=True)

    # Energy scale estimate
    j_max = max((abs(J[i][j]) for i in range(n) for j in range(i+1, n)), default=0.0)
    h_max = max((abs(hi) for hi in h), default=0.0)

    narrative = (
        f"Effective Ising Hamiltonian reconstructed from {len(usable)} runs "
        f"on backend '{backend}' ({n} qubits). "
        f"Found {len(edges)} significant coupling{'s' if len(edges) != 1 else ''} "
        f"(|J| ≥ {coupling_threshold}). "
        f"Max coupling: {j_max:.4f}, max local field: {h_max:.4f}. "
        + ("Device shows strong qubit–qubit interactions." if j_max > 0.1
           else "Coupling strengths are weak — qubits behave nearly independently.")
    )

    return {
        "backend":        backend,
        "n_qubits":       n,
        "n_runs_used":    len(usable),
        "local_fields":   [{"qubit": i, "h": round(hi, 5)} for i, hi in enumerate(h)],
        "couplings":      edges,
        "coupling_matrix": [[round(J[i][j], 5) for j in range(n)] for i in range(n)],
        "magnetisation":  [round(m, 4) for m in mag_avg],
        "max_coupling":   round(j_max, 5),
        "max_local_field": round(h_max, 5),
        "coupling_threshold": coupling_threshold,
        "narrative":      narrative,
        "computed_at":    datetime.now(timezone.utc).isoformat(),
    }
