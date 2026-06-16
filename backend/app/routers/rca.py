"""Root Cause Analysis Engine — diagnoses quality issues for any run."""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["rca"])

_TWO_QUBIT_GATES = {
    "cx", "cz", "cy", "ecr", "rzx", "swap", "dcx", "ccx",
    "cswap", "iswap", "cs", "csx", "cp", "cu", "cu1", "cu3",
}
_GATE_NS = {"single": 50, "two": 300, "measure": 3000}
_SEV_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def _analyse(run: Run) -> dict[str, Any]:
    causes: list[dict[str, Any]] = []

    fp = run.fingerprint or {}
    cal = run.calibration or {}
    results = run.results or {}
    transpiler = run.transpiler or {}
    shadow = run.shadow_results or {}
    execution = run.execution or {}
    params = run.parameters or {}

    depth = int(fp.get("depth") or 0)
    num_qubits = int(fp.get("num_qubits") or 0)
    size = int(fp.get("size") or 0)
    nc_ratio = float(fp.get("non_clifford_ratio") or 0.0)
    gate_counts: dict = fp.get("gate_counts") or {}

    two_q = sum(int(v) for k, v in gate_counts.items() if k.lower() in _TWO_QUBIT_GATES)
    measures = int(gate_counts.get("measure", 0))
    single_q = max(0, size - two_q - measures)

    circuit_time_us = (
        single_q * _GATE_NS["single"] + two_q * _GATE_NS["two"] + measures * _GATE_NS["measure"]
    ) / 1000.0

    # Calibration averages
    t1_map: dict = cal.get("t1_us") or {}
    t2_map: dict = cal.get("t2_us") or {}
    ge_map: dict = cal.get("gate_errors") or {}
    ro_map: dict = cal.get("readout_errors") or {}

    t1_vals = [float(v) for v in t1_map.values() if v]
    t2_vals = [float(v) for v in t2_map.values() if v]
    ge_vals = [float(v) for v in ge_map.values() if v]
    ro_vals = [float(v) for v in ro_map.values() if v]

    avg_t1 = sum(t1_vals) / len(t1_vals) if t1_vals else None
    avg_t2 = sum(t2_vals) / len(t2_vals) if t2_vals else None
    avg_ge = sum(ge_vals) / len(ge_vals) if ge_vals else None
    avg_ro = sum(ro_vals) / len(ro_vals) if ro_vals else None

    # ------------------------------------------------------------------
    # Rule 1 — Execution failure
    # ------------------------------------------------------------------
    if run.status == "failed":
        etype = str(execution.get("error_type") or "")
        emsg = str(execution.get("error_message") or "")[:300]
        causes.append({
            "id": "execution_failed",
            "severity": "critical",
            "confidence": 1.0,
            "category": "execution",
            "title": "Circuit execution failed",
            "description": f"The job terminated with error: {etype or 'unknown'}. {emsg}",
            "evidence": {"error_type": etype, "error_message": emsg},
            "suggestions": [
                "Check if the circuit uses gates not supported by this backend",
                "Verify qubit indices are within the backend's qubit range",
                "Ensure the job was not cancelled due to a queue timeout",
            ],
        })

    # ------------------------------------------------------------------
    # Rule 2 — T1 decoherence threat
    # ------------------------------------------------------------------
    if avg_t1 and circuit_time_us > 0:
        ratio = circuit_time_us / avg_t1
        if ratio > 0.4:
            sev = "critical" if ratio >= 1.0 else "high" if ratio >= 0.6 else "medium"
            causes.append({
                "id": "t1_decoherence",
                "severity": sev,
                "confidence": round(min(0.95, 0.45 + ratio * 0.45), 3),
                "category": "decoherence",
                "title": "Circuit time approaches T1 relaxation limit",
                "description": (
                    f"Estimated circuit execution time ({circuit_time_us:.1f} µs) is "
                    f"{ratio:.1%} of average qubit T1 ({avg_t1:.1f} µs). "
                    "Qubits may relax to the ground state before measurement completes."
                ),
                "evidence": {
                    "circuit_time_us": round(circuit_time_us, 2),
                    "avg_t1_us": round(avg_t1, 2),
                    "utilisation_ratio": round(ratio, 3),
                },
                "suggestions": [
                    "Reduce circuit depth — each gate layer adds ~50–300 ns",
                    "Use Dynamic Decoupling (DD) sequences to combat T1 decay",
                    f"Safe budget: keep circuit time below {avg_t1 * 0.3:.0f} µs (30% of T1)",
                    "Apply qlab.optimize() and choose the level with minimum depth",
                ],
            })

    # ------------------------------------------------------------------
    # Rule 3 — T2 dephasing threat
    # ------------------------------------------------------------------
    if avg_t2 and circuit_time_us > 0:
        ratio = circuit_time_us / avg_t2
        if ratio > 0.25:
            sev = "high" if ratio >= 0.5 else "medium"
            causes.append({
                "id": "t2_dephasing",
                "severity": sev,
                "confidence": round(min(0.90, 0.35 + ratio * 0.5), 3),
                "category": "decoherence",
                "title": "Circuit time approaches T2 dephasing limit",
                "description": (
                    f"Circuit time ({circuit_time_us:.1f} µs) is {ratio:.1%} of "
                    f"average T2 ({avg_t2:.1f} µs). Phase coherence may be lost, "
                    "reducing interference that algorithms rely on."
                ),
                "evidence": {
                    "circuit_time_us": round(circuit_time_us, 2),
                    "avg_t2_us": round(avg_t2, 2),
                    "utilisation_ratio": round(ratio, 3),
                },
                "suggestions": [
                    "Insert echo sequences (X–X or Y–Y) between idle periods to refocus dephasing",
                    "Minimise idle time — route critical-path gates without gaps",
                    "Use Hahn echo or CPMG dynamical decoupling for long idle windows",
                ],
            })

    # ------------------------------------------------------------------
    # Rule 4 — Elevated gate error rate
    # ------------------------------------------------------------------
    if avg_ge and avg_ge > 0.003:
        expected_f = (1 - avg_ge) ** size if size else None
        sev = "critical" if avg_ge > 0.05 else "high" if avg_ge > 0.01 else "medium"
        causes.append({
            "id": "high_gate_error",
            "severity": sev,
            "confidence": 0.85,
            "category": "gate_errors",
            "title": f"Elevated gate error rate ({avg_ge:.3%})",
            "description": (
                f"Average gate error is {avg_ge:.3%} across all qubits. "
                f"Across {size} total gates, expected gate fidelity ≈ "
                f"{expected_f:.3f}." if expected_f else ""
            ),
            "evidence": {
                "avg_gate_error": round(avg_ge, 6),
                "gate_count": size,
                "expected_gate_fidelity": round(expected_f, 4) if expected_f else None,
            },
            "suggestions": [
                "Run at a time when calibration data shows lower error rates",
                "Apply Zero-Noise Extrapolation (ZNE) to extrapolate to zero noise",
                "Use Probabilistic Error Cancellation (PEC) for unbiased mitigation",
                "Reduce total gate count to limit fidelity multiplication",
            ],
        })

    # ------------------------------------------------------------------
    # Rule 5 — Two-qubit gate overhead
    # ------------------------------------------------------------------
    if two_q > 4:
        avg_2q = (avg_ge or 0.001) * 10
        exp_2q_f = (1 - avg_2q) ** two_q
        sev = "high" if two_q > 12 else "medium"
        causes.append({
            "id": "two_qubit_gate_overhead",
            "severity": sev,
            "confidence": 0.80,
            "category": "gate_errors",
            "title": f"High two-qubit gate count ({two_q})",
            "description": (
                f"Two-qubit gates have ~10× higher error than single-qubit gates. "
                f"{two_q} 2Q gates at ~{avg_2q:.1%} error each → "
                f"expected 2Q fidelity ≈ {exp_2q_f:.3f}."
            ),
            "evidence": {
                "two_qubit_gate_count": two_q,
                "single_qubit_gate_count": single_q,
                "avg_2q_error_estimate": round(avg_2q, 4),
                "expected_2q_fidelity": round(exp_2q_f, 4),
            },
            "suggestions": [
                "Use KAK decomposition to merge adjacent two-qubit gate blocks",
                "Check if SWAP insertions can be reduced with better qubit mapping",
                "qlab.optimize() finds the transpilation level that minimises 2Q gates",
                "Gate cancellation passes (optimization_level ≥ 2) eliminate redundant gates",
            ],
        })

    # ------------------------------------------------------------------
    # Rule 6 — Readout error
    # ------------------------------------------------------------------
    if avg_ro and avg_ro > 0.015:
        combined_ro = (1 - avg_ro) ** num_qubits if num_qubits else None
        sev = "high" if avg_ro > 0.08 else "medium"
        causes.append({
            "id": "readout_error",
            "severity": sev,
            "confidence": 0.82,
            "category": "readout",
            "title": f"High readout error ({avg_ro:.2%} per qubit)",
            "description": (
                f"Average readout error is {avg_ro:.2%}. "
                + (f"For {num_qubits} qubits, combined measurement fidelity ≈ {combined_ro:.3f}." if combined_ro else "")
            ),
            "evidence": {
                "avg_readout_error": round(avg_ro, 5),
                "num_qubits": num_qubits,
                "combined_readout_fidelity": round(combined_ro, 4) if combined_ro else None,
            },
            "suggestions": [
                "Apply M3 (mthree) matrix-free measurement error mitigation",
                "Use Twirled Readout Error eXtinction (TREX)",
                "Increase shot count — more shots reduce statistical spread around the biased mean",
                "Consider mid-circuit measurement error correction if backend supports reset",
            ],
        })

    # ------------------------------------------------------------------
    # Rule 7 — Shadow simulation TVD
    # ------------------------------------------------------------------
    tvd = shadow.get("tvd")
    if tvd is not None:
        if tvd > 0.25:
            causes.append({
                "id": "high_shadow_tvd",
                "severity": "high",
                "confidence": 0.72,
                "category": "noise",
                "title": f"QPU results diverge significantly from noise model (TVD = {tvd:.3f})",
                "description": (
                    f"Shadow simulation TVD = {tvd:.3f}. The QPU is behaving worse than a standard "
                    "depolarising noise model predicts. This may indicate calibration drift, "
                    "leakage, or crosstalk not captured in the model."
                ),
                "evidence": {"tvd": tvd, "threshold": 0.25, "sim_backend": shadow.get("sim_backend")},
                "suggestions": [
                    "Check the Calibration Drift page for this backend",
                    "Re-run with more shots to confirm (TVD can be inflated by low shot counts)",
                    "Try error mitigation or a different backend",
                ],
            })
        elif tvd > 0.10:
            causes.append({
                "id": "moderate_shadow_tvd",
                "severity": "medium",
                "confidence": 0.58,
                "category": "noise",
                "title": f"Moderate noise deviation from shadow simulation (TVD = {tvd:.3f})",
                "description": f"Results deviate noticeably from ideal simulation. Error mitigation may improve fidelity.",
                "evidence": {"tvd": tvd},
                "suggestions": [
                    "Apply error mitigation (ZNE, PEC, or M3 for readout)",
                    "Increase shot count to reduce statistical noise contribution to TVD",
                ],
            })

    # ------------------------------------------------------------------
    # Rule 8 — Low shot count
    # ------------------------------------------------------------------
    shots = results.get("shots") or params.get("shots")
    if shots is not None:
        try:
            shots_int = int(shots)
            if shots_int < 512:
                causes.append({
                    "id": "low_shot_count",
                    "severity": "medium",
                    "confidence": 0.92,
                    "category": "execution",
                    "title": f"Low shot count ({shots_int} shots)",
                    "description": (
                        f"With {shots_int} shots, statistical uncertainty is "
                        f"~{100 / (shots_int ** 0.5):.1f}% (1σ) per bitstring. "
                        f"States with probability < {1/shots_int:.3f} may not appear."
                    ),
                    "evidence": {"shots": shots_int, "statistical_uncertainty_pct": round(100 / (shots_int ** 0.5), 1)},
                    "suggestions": [
                        "Use ≥1024 shots for 1% precision, ≥4096 for 0.5%, ≥10000 for 0.1%",
                        "For VQE/QAOA gradient estimates, use ≥4096 shots per iteration",
                        "The Resource Estimator tab shows recommended shot counts for your circuit",
                    ],
                })
        except (TypeError, ValueError):
            pass

    # ------------------------------------------------------------------
    # Rule 9 — High non-Clifford ratio
    # ------------------------------------------------------------------
    if nc_ratio > 0.30 and size > 8:
        causes.append({
            "id": "high_non_clifford_ratio",
            "severity": "low",
            "confidence": 0.68,
            "category": "circuit_complexity",
            "title": f"High non-Clifford gate ratio ({nc_ratio:.1%})",
            "description": (
                f"{nc_ratio:.1%} of gates are non-Clifford (T, Rz, Rx, Ry, U gates). "
                "These have higher intrinsic error and cannot be simulated efficiently for verification."
            ),
            "evidence": {"non_clifford_ratio": round(nc_ratio, 4), "total_gates": size},
            "suggestions": [
                "Replace small-angle rotations with approximate Clifford decompositions where tolerance allows",
                "Clifford circuits can be exactly simulated — useful as a noise-free baseline",
                "Consider Clifford+T compilation strategies for fault-tolerant targets",
            ],
        })

    # ------------------------------------------------------------------
    # Rule 10 — Transpilation depth overhead
    # ------------------------------------------------------------------
    before = transpiler.get("before") or {}
    after = transpiler.get("after") or {}
    if before.get("depth") and after.get("depth") and before["depth"] > 0:
        overhead = after["depth"] / before["depth"]
        if overhead > 2.5:
            sev = "high" if overhead > 5.0 else "medium"
            causes.append({
                "id": "transpilation_overhead",
                "severity": sev,
                "confidence": 0.87,
                "category": "transpilation",
                "title": f"Transpilation expanded circuit depth {overhead:.1f}×",
                "description": (
                    f"Circuit grew from depth {before['depth']} to {after['depth']} after transpilation. "
                    "SWAP gate insertions for qubit routing are the most likely cause."
                ),
                "evidence": {"before_depth": before["depth"], "after_depth": after["depth"], "overhead_factor": round(overhead, 2)},
                "suggestions": [
                    "Use optimization_level=3 for best routing at cost of compile time",
                    "Specify layout_method='sabre' routing_method='sabre' for better initial qubit placement",
                    "Run qlab.optimize() to compare all optimization levels systematically",
                    "Consider a backend with higher qubit connectivity (fewer SWAPs needed)",
                ],
            })

    # ------------------------------------------------------------------
    # Rule 11 — No transpilation optimisation
    # ------------------------------------------------------------------
    settings = transpiler.get("settings") or {}
    if settings.get("optimization_level") == 0 and depth > 4:
        causes.append({
            "id": "no_transpiler_optimization",
            "severity": "low",
            "confidence": 0.95,
            "category": "transpilation",
            "title": "Circuit not transpiler-optimised (level 0)",
            "description": (
                "optimization_level=0 disables gate cancellation, commutativity analysis, "
                "and routing heuristics. Higher levels almost always produce shorter circuits."
            ),
            "evidence": {"optimization_level": 0, "circuit_depth": depth},
            "suggestions": [
                "Use optimization_level=1 (fast) or optimization_level=3 (best quality)",
                "Run qlab.optimize(circuit, backend) for a systematic level comparison",
            ],
        })

    # Sort by severity then descending confidence
    causes.sort(key=lambda c: (_SEV_ORDER.get(c["severity"], 99), -c["confidence"]))

    # Overall prognosis
    critical_count = sum(1 for c in causes if c["severity"] == "critical")
    high_count = sum(1 for c in causes if c["severity"] == "high")

    if critical_count >= 1:
        prognosis = "critical"
    elif high_count >= 2:
        prognosis = "degraded"
    elif high_count >= 1 or len(causes) >= 3:
        prognosis = "warning"
    elif causes:
        prognosis = "notice"
    else:
        prognosis = "healthy"

    return {
        "run_id": run.run_id,
        "backend": run.backend,
        "status": run.status,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "has_calibration": bool(t1_vals or ge_vals),
        "circuit_time_us": round(circuit_time_us, 2) if circuit_time_us else None,
        "two_qubit_gate_count": two_q,
        "overall_prognosis": prognosis,
        "cause_count": len(causes),
        "causes": causes,
    }


@router.get("/{run_id}/rca")
def root_cause_analysis(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return _analyse(run)
