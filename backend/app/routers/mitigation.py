"""Error Mitigation Advisor — rule-based recommendations for ZNE, PEC, MEM, twirling."""

import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..calibration_utils import per_qubit

router = APIRouter(prefix="/api/v1/runs", tags=["mitigation"])

# ------------------------------------------------------------------
# Recommendation data
# ------------------------------------------------------------------

def _make_rec(method, title, confidence, reasoning, params, expected_tvd_reduction, priority):
    return {
        "method": method,
        "title": title,
        "confidence": confidence,
        "priority": priority,
        "reasoning": reasoning,
        "suggested_parameters": params,
        "expected_tvd_reduction_pct": expected_tvd_reduction,
        "docs_hint": _DOCS.get(method, ""),
    }


_DOCS = {
    "ZNE": "Zero-Noise Extrapolation: run circuit at noise scales 1×, 2×, 3× then extrapolate to 0 noise.",
    "PEC": "Probabilistic Error Cancellation: decompose ideal gate as sum of noisy gates with quasi-probabilities.",
    "MEM": "Measurement Error Mitigation: build calibration matrix from |0⟩/|1⟩ prep circuits, invert it.",
    "Clifford-Data-Regression": "CDR: train a regression model on near-Clifford circuits whose exact output is known.",
    "Pauli-Twirling": "Convert coherent errors into stochastic Pauli channels via random Clifford gates before each 2Q gate.",
    "Dynamical-Decoupling": "Insert XY4 or CPMG pulses during idle periods to suppress T2 dephasing.",
}


@router.get("/{run_id}/mitigation-advice")
def mitigation_advice(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")

    fp = run.fingerprint or {}
    cal = run.calibration or {}
    shadow = run.shadow_results or {}
    results = run.results or {}
    transpiler = run.transpiler or {}
    ts = (transpiler.get("settings") or {})

    # Extract key parameters
    depth = int(fp.get("depth") or 0)
    size = int(fp.get("size") or 0)
    num_qubits = int(fp.get("num_qubits") or 0)
    nc_ratio = float(fp.get("non_clifford_ratio") or 0)
    shots = int(results.get("shots") or fp.get("shots") or 0)
    opt_level = int(ts.get("optimization_level") or 0)

    gate_counts: dict = fp.get("gate_counts") or {}
    _TWO_Q = {"cx", "cz", "cy", "ecr", "rzx", "swap", "iswap"}
    n2q = sum(int(v) for k, v in gate_counts.items() if k.lower() in _TWO_Q)

    t1_vals = [float(v) for v in per_qubit(cal.get("t1_us")).values() if v]
    t2_vals = [float(v) for v in per_qubit(cal.get("t2_us")).values() if v]
    ge_vals = [float(v) for v in per_qubit(cal.get("gate_errors")).values() if v]
    ro_vals = [float(v) for v in per_qubit(cal.get("readout_errors")).values() if v]

    avg_t1 = sum(t1_vals) / len(t1_vals) if t1_vals else None
    avg_t2 = sum(t2_vals) / len(t2_vals) if t2_vals else None
    avg_ge = sum(ge_vals) / len(ge_vals) if ge_vals else None
    avg_ro = sum(ro_vals) / len(ro_vals) if ro_vals else None

    has_cal = bool(t1_vals or ge_vals)
    tvd = float(shadow.get("tvd") or 0) if shadow.get("has_shadow") else None

    # Estimated circuit time
    circuit_time_us = (
        (size - n2q) * 50 / 1000 + n2q * 300 / 1000
    ) if size else 0

    recommendations = []
    context_flags = {
        "depth": depth,
        "n_2q_gates": n2q,
        "non_clifford_ratio": round(nc_ratio, 3),
        "avg_t1_us": round(avg_t1, 1) if avg_t1 else None,
        "avg_t2_us": round(avg_t2, 1) if avg_t2 else None,
        "avg_gate_error": round(avg_ge, 6) if avg_ge else None,
        "avg_readout_error": round(avg_ro, 4) if avg_ro else None,
        "tvd_from_shadow": round(tvd, 4) if tvd is not None else None,
        "shots": shots,
        "has_calibration": has_cal,
    }

    # ----------------------------------------------------------------
    # Rule 1: MEM — readout error dominant
    # ----------------------------------------------------------------
    if avg_ro and avg_ro > 0.02:
        confidence = min(0.95, 0.5 + avg_ro * 10)
        reduction = min(60, int(avg_ro * 800))
        recommendations.append(_make_rec(
            "MEM",
            "Measurement Error Mitigation",
            round(confidence, 2),
            f"Average readout error {avg_ro*100:.2f}% is significant. "
            "MEM corrects bit-flip errors in measurement outcomes by building a calibration matrix.",
            {"num_calibration_circuits": 2 ** min(num_qubits, 12), "method": "least_squares"},
            reduction,
            1 if avg_ro > 0.05 else 2,
        ))

    # ----------------------------------------------------------------
    # Rule 2: ZNE — high TVD or high gate error
    # ----------------------------------------------------------------
    zne_trigger = (tvd is not None and tvd > 0.10) or (avg_ge and avg_ge > 0.005)
    if zne_trigger and depth <= 200:
        confidence = 0.85 if (tvd or 0) > 0.15 else 0.65
        reduction = min(50, int((tvd or 0.1) * 200))
        recommendations.append(_make_rec(
            "ZNE",
            "Zero-Noise Extrapolation",
            round(confidence, 2),
            (f"Shadow simulation TVD={tvd:.3f} shows significant noise deviation. " if tvd else "")
            + (f"Gate error {avg_ge*100:.4f}% accumulates over {size} gates. " if avg_ge else "")
            + "ZNE runs the circuit at amplified noise levels and extrapolates back to zero noise.",
            {
                "noise_factors": [1, 2, 3],
                "extrapolation": "richardson",
                "gate_folding": "global" if depth < 50 else "local",
            },
            reduction,
            1,
        ))

    # ----------------------------------------------------------------
    # Rule 3: Pauli Twirling — coherent 2Q gate errors present
    # ----------------------------------------------------------------
    cx_keys = [k for k in per_qubit(cal.get("gate_errors")) if any(c in k for c in ["cx", "ecr", "cz"])]
    cx_errors = [per_qubit(cal.get("gate_errors"))[k] for k in cx_keys]
    avg_cx = sum(float(v) for v in cx_errors) / len(cx_errors) if cx_errors else None
    if n2q >= 2 and (avg_cx or avg_ge) and (avg_cx or avg_ge or 0) > 0.003:
        recommendations.append(_make_rec(
            "Pauli-Twirling",
            "Pauli Twirling of 2Q Gates",
            0.75,
            f"Circuit has {n2q} two-qubit gates with error rate "
            f"~{(avg_cx or avg_ge or 0)*100:.3f}%. "
            "Pauli twirling converts coherent errors into depolarising channels, making noise more predictable for ZNE.",
            {"twirl_2q_gates": ["cx", "ecr"], "num_twirled_circuits": 8, "combine_with": "ZNE"},
            15,
            3,
        ))

    # ----------------------------------------------------------------
    # Rule 4: Dynamical Decoupling — T2 decoherence dominant
    # ----------------------------------------------------------------
    if avg_t2 and circuit_time_us > 0:
        t2_ratio = circuit_time_us / avg_t2
        if t2_ratio > 0.05:
            confidence = min(0.90, 0.4 + t2_ratio * 2)
            recommendations.append(_make_rec(
                "Dynamical-Decoupling",
                "Dynamical Decoupling",
                round(confidence, 2),
                f"Circuit time {circuit_time_us:.1f} µs is "
                f"{t2_ratio*100:.1f}% of avg T2 ({avg_t2:.0f} µs). "
                "XY4 DD sequences can extend effective T2 during idle qubit periods.",
                {"sequence": "XY4" if num_qubits <= 5 else "CPMG", "apply_to_idle_qubits": True},
                int(min(40, t2_ratio * 100)),
                2,
            ))

    # ----------------------------------------------------------------
    # Rule 5: CDR — low non-Clifford ratio
    # ----------------------------------------------------------------
    if nc_ratio < 0.25 and depth >= 5:
        recommendations.append(_make_rec(
            "Clifford-Data-Regression",
            "Clifford Data Regression (CDR)",
            0.60,
            f"Non-Clifford gate ratio is {nc_ratio*100:.1f}% — low enough for CDR. "
            "CDR trains a linear model on nearby all-Clifford circuits (exact simulable) "
            "to predict the noise-free expectation value.",
            {"num_training_circuits": 20, "clifford_replacement_fraction": 0.1},
            20,
            4,
        ))

    # ----------------------------------------------------------------
    # Rule 6: PEC — calibrated backend with low depth
    # ----------------------------------------------------------------
    if has_cal and depth <= 50 and n2q >= 1:
        recommendations.append(_make_rec(
            "PEC",
            "Probabilistic Error Cancellation",
            0.55,
            f"Shallow circuit (depth={depth}) on a calibrated backend makes PEC feasible. "
            "PEC achieves near-unbiased estimates at the cost of exponential shot overhead ~γ^depth, "
            f"estimated γ^{depth} ≈ {math.exp((avg_ge or 0.001) * 10 * depth):.1f}×.",
            {
                "sampling_overhead": round(math.exp((avg_ge or 0.001) * 10 * depth), 1),
                "noise_model": "depolarizing",
                "caution": "shot overhead grows exponentially with depth",
            },
            30,
            5,
        ))

    # Sort by priority
    recommendations.sort(key=lambda r: (r["priority"], -r["confidence"]))

    overall_severity = (
        "critical" if (tvd or 0) > 0.25 or (avg_ge or 0) > 0.02 else
        "high"     if (tvd or 0) > 0.10 or (avg_ge or 0) > 0.008 else
        "moderate" if (tvd or 0) > 0.05 or (avg_ge or 0) > 0.003 else
        "low"
    )

    return {
        "run_id": run_id,
        "backend": run.backend,
        "overall_severity": overall_severity,
        "has_calibration": has_cal,
        "has_shadow_simulation": tvd is not None,
        "recommendation_count": len(recommendations),
        "top_recommendation": recommendations[0]["method"] if recommendations else None,
        "recommendations": recommendations,
        "context": context_flags,
    }
