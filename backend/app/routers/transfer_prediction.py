"""Cross-Backend Transfer Prediction — Feature #6 of 10.

Predicts how well a circuit that ran on backend A will perform when
transferred to backend B, using calibration similarity and structural
circuit compatibility.

Model
─────
Transfer score = w_cal × cal_similarity + w_struct × struct_compat
                 + w_noise × noise_compat

• cal_similarity : cosine similarity of calibration vectors
                   [T₁, T₂, gate_error, readout_error]
                   between the source run's calibration and target backend's
                   last known calibration.

• struct_compat  : circuit-to-backend structural fit score
                   (qubit count vs target, native gate set match,
                   connectivity sufficiency)

• noise_compat   : noise tier comparison — a circuit designed for a
                   low-noise backend may fail badly on a noisy one.

Returns
───────
For every known backend in the database, a predicted transfer score (0–1),
ranked. Also returns gate-set translation hints and a human-readable reason
per backend.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func as sqlfunc
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["transfer_prediction"])

_CAL_KEYS = ["avg_t1_us", "avg_t2_us", "avg_gate_error", "avg_readout_error"]

# Gate-set families known to IBM-style backends and their native gate sets
_BACKEND_GATE_SETS: dict[str, list[str]] = {
    "ibm":     ["cx", "rz", "sx", "x", "measure", "reset"],
    "ibmq":    ["cx", "rz", "sx", "x", "measure", "reset"],
    "falcon":  ["cx", "rz", "sx", "x", "measure"],
    "heron":   ["ecr", "rz", "sx", "x", "measure"],
    "eagle":   ["cx", "rz", "sx", "x", "measure"],
    "osprey":  ["cx", "rz", "sx", "x", "measure"],
    "condor":  ["cx", "rz", "sx", "x", "measure"],
    "ionq":    ["xx", "rx", "ry", "rz", "measure"],
    "aria":    ["xx", "rx", "ry", "rz", "ms", "measure"],
    "forte":   ["zz", "rx", "ry", "rz", "measure"],
    "quantinuum": ["zz", "rx", "ry", "rz", "measure"],
    "rigetti": ["cz", "rx", "rz", "measure"],
    "aspen":   ["cz", "rx", "rz", "measure"],
    "ankaa":   ["cz", "rx", "rz", "measure"],
    "default": ["cx", "rz", "sx", "x", "measure"],
}

_WEIGHTS = {"cal": 0.45, "struct": 0.35, "noise": 0.20}

# Known qubit counts for common backends — fallback when DB has no run history
_KNOWN_BACKEND_QUBITS: dict[str, int] = {
    "ibm_brisbane": 127, "ibm_kyoto": 127, "ibm_osaka": 127, "ibm_sherbrooke": 127,
    "ibm_nairobi": 7, "ibm_perth": 7, "ibm_lagos": 7, "ibm_cairo": 27,
    "ionq_aria_1": 25, "ionq_aria_2": 25, "ionq_forte": 36,
    "rigetti_ankaa_2": 84, "rigetti_aspen_m_3": 79,
    "quantinuum_h1": 20, "quantinuum_h2": 32,
}


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _cal_vector(cal: dict) -> list[float]:
    """Normalised calibration feature vector."""
    vals = []
    for k in _CAL_KEYS:
        v = cal.get(k)
        try:
            vals.append(float(v) if v is not None else None)
        except (TypeError, ValueError):
            vals.append(None)
    return vals


def _cosine_sim(a: list[float | None], b: list[float | None]) -> float:
    """Cosine similarity between two calibration vectors (skip None dims)."""
    pairs = [(x, y) for x, y in zip(a, b) if x is not None and y is not None]
    if not pairs:
        return 0.5  # unknown → neutral
    # Normalise each dimension by log scale (T1/T2 in µs, errors tiny)
    def lscale(v: float) -> float:
        return math.log1p(abs(v)) if v > 0 else 0.0
    na = [lscale(x) for x, _ in pairs]
    nb = [lscale(y) for _, y in pairs]
    dot = sum(x * y for x, y in zip(na, nb))
    ma = math.sqrt(sum(x * x for x in na)) or 1.0
    mb = math.sqrt(sum(y * y for y in nb)) or 1.0
    return round(min(1.0, max(0.0, dot / (ma * mb))), 4)


def _gate_set_compat(circuit_gc: dict, backend_family: str) -> float:
    """Fraction of circuit's gate types that are in the target backend's native set."""
    native = set(_BACKEND_GATE_SETS.get(backend_family.lower(), _BACKEND_GATE_SETS["default"]))
    if not circuit_gc:
        return 0.7  # unknown → slightly positive
    used = set(circuit_gc.keys())
    overlap = len(used & native)
    score = overlap / len(used) if used else 0.7
    return round(score, 4)


def _detect_backend_family(backend_name: str) -> str:
    name = backend_name.lower()
    for key in _BACKEND_GATE_SETS:
        if key in name:
            return key
    return "default"


def _struct_compat(fp: dict, target_n_qubits: int) -> float:
    """Score how well the circuit fits the target backend's qubit count."""
    n = int(fp.get("num_qubits") or 0)
    if n == 0 or target_n_qubits == 0:
        return 0.5
    if n > target_n_qubits:
        return 0.0  # circuit too wide for target
    ratio = n / target_n_qubits
    if ratio >= 0.5:
        return 1.0  # good fit
    return round(ratio * 2, 4)  # linear penalty for large slack


def _noise_compat(source_cal: dict | None, target_cal: dict | None) -> float:
    """Estimate how noise-matched source and target are."""
    if not source_cal or not target_cal:
        return 0.5
    src_err = float(source_cal.get("avg_gate_error") or 0.003)
    tgt_err = float(target_cal.get("avg_gate_error") or 0.003)
    # Ratio: target better or similar → high score
    if tgt_err <= 0 or src_err <= 0:
        return 0.5
    ratio = src_err / tgt_err  # > 1 means target is better
    return round(min(1.0, ratio), 4)


def _get_latest_cal(backend: str, db: Session) -> dict | None:
    run = db.scalar(
        select(Run)
        .where(Run.backend == backend, Run.calibration.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(1)
    )
    return run.calibration if run else None


def _get_backend_n_qubits(backend: str, db: Session) -> int:
    """Estimate max qubits of a backend from run history, with a static fallback."""
    runs = db.scalars(
        select(Run)
        .where(Run.backend == backend, Run.fingerprint.isnot(None))
        .order_by(Run.created_at.desc())
        .limit(20)
    ).all()
    from_runs = max(
        (int((r.fingerprint or {}).get("num_qubits") or 0) for r in runs), default=0
    )
    if from_runs > 0:
        return from_runs
    return _KNOWN_BACKEND_QUBITS.get(backend, 0)


def _get_target_backends(source_backend: str, db: Session) -> list[str]:
    """All distinct backends in the DB, excluding the source."""
    rows = db.execute(
        select(Run.backend).where(Run.backend.isnot(None)).distinct()
    ).scalars().all()
    return [b for b in rows if b != source_backend]


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/transfer-prediction")
def transfer_prediction(run_id: str, db: Session = Depends(get_db)):
    """
    Predict performance transfer scores to all other backends for this run's circuit.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp = run.fingerprint or {}
    n_qubits = int(fp.get("num_qubits") or 0)
    if n_qubits == 0:
        raise HTTPException(422, "Circuit fingerprint missing num_qubits.")

    source_backend = run.backend or "unknown"
    source_cal     = run.calibration or {}
    source_cal_vec = _cal_vector(source_cal)
    source_family  = _detect_backend_family(source_backend)
    circuit_gc     = fp.get("gate_counts") or {}

    target_backends = _get_target_backends(source_backend, db)
    if not target_backends:
        raise HTTPException(404, "No other backends found in the database to compare against.")

    predictions = []
    for target in target_backends:
        target_cal     = _get_latest_cal(target, db)
        target_cal_vec = _cal_vector(target_cal or {})
        target_family  = _detect_backend_family(target)

        # Component scores
        cal_sim    = _cosine_sim(source_cal_vec, target_cal_vec)
        gate_compat = _gate_set_compat(circuit_gc, target_family)
        noise_c    = _noise_compat(source_cal, target_cal)

        target_n = _get_backend_n_qubits(target, db)
        struct_c = _struct_compat(fp, target_n)

        transfer_score = round(
            _WEIGHTS["cal"]    * cal_sim    +
            _WEIGHTS["struct"] * (struct_c * 0.5 + gate_compat * 0.5) +
            _WEIGHTS["noise"]  * noise_c,
            3,
        )

        tier = (
            "excellent" if transfer_score >= 0.75 else
            "good"      if transfer_score >= 0.55 else
            "fair"      if transfer_score >= 0.35 else
            "poor"
        )

        # Translation hints
        src_native = set(_BACKEND_GATE_SETS.get(source_family, _BACKEND_GATE_SETS["default"]))
        tgt_native = set(_BACKEND_GATE_SETS.get(target_family, _BACKEND_GATE_SETS["default"]))
        gates_needing_decomp = [
            g for g in circuit_gc if g not in tgt_native
        ]

        reason = _build_reason(
            target, transfer_score, tier, cal_sim, struct_c,
            gate_compat, noise_c, n_qubits, target_n, gates_needing_decomp,
        )

        predictions.append({
            "target_backend":     target,
            "target_family":      target_family,
            "transfer_score":     transfer_score,
            "tier":               tier,
            "component_scores": {
                "calibration_similarity": cal_sim,
                "gate_compatibility":     gate_compat,
                "structural_fit":         struct_c,
                "noise_compatibility":    noise_c,
            },
            "gates_needing_decomposition": gates_needing_decomp[:10],
            "target_n_qubits":    target_n or "unknown",
            "reason":             reason,
            "has_calibration_data": target_cal is not None,
        })

    predictions.sort(key=lambda x: x["transfer_score"], reverse=True)
    best = predictions[0]

    return {
        "run_id":          run_id,
        "source_backend":  source_backend,
        "n_qubits":        n_qubits,
        "circuit_family":  source_family,
        "top_recommendation": best["target_backend"],
        "top_score":          best["transfer_score"],
        "predictions":     predictions,
        "analyzed_at":     datetime.now(timezone.utc).isoformat(),
    }


def _build_reason(
    target: str, score: float, tier: str,
    cal: float, struct: float, gate: float, noise: float,
    src_n: int, tgt_n: int, bad_gates: list[str],
) -> str:
    parts = []
    if tier == "excellent":
        parts.append(f"{target} is an excellent transfer target (score {score:.2f}).")
    elif tier == "good":
        parts.append(f"{target} is a good transfer target (score {score:.2f}).")
    elif tier == "fair":
        parts.append(f"{target} is a fair transfer target — some adaptation needed (score {score:.2f}).")
    else:
        parts.append(f"{target} is a poor transfer target (score {score:.2f}).")

    if cal < 0.5:
        parts.append("Calibration metrics differ significantly — results may not be comparable.")
    if tgt_n > 0 and src_n > tgt_n:
        parts.append(f"Circuit needs {src_n} qubits but target only has {tgt_n} — transfer impossible.")
    elif tgt_n > 0 and src_n / tgt_n < 0.3:
        parts.append(f"Circuit uses only {src_n}/{tgt_n} qubits — low utilisation on target.")
    if bad_gates:
        parts.append(f"Gates needing transpilation: {', '.join(bad_gates[:5])}.")
    if noise < 0.5:
        parts.append("Target backend has higher noise — expect degraded fidelity.")
    return " ".join(parts)
