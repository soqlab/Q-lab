"""
Computes a 0–100 health score for a run from available data.

Weights:
  - Success probability (from counts or explicit field): 40 %
  - Gate fidelity (1 – avg gate error from calibration):  30 %
  - Readout fidelity (1 – avg readout error):             20 %
  - Circuit efficiency (1 – non-Clifford ratio):          10 %
"""
from typing import Any


def compute_health_score(run: dict[str, Any]) -> float | None:
    results = run.get("results") or {}
    calibration = run.get("calibration") or {}
    fingerprint = run.get("fingerprint") or {}

    components: list[float] = []
    weights: list[float] = []

    # --- success probability (40 %) ---
    if "success_probability" in results:
        components.append(float(results["success_probability"]) * 100)
        weights.append(0.40)
    elif isinstance(results.get("counts"), dict) and results["counts"]:
        counts: dict = results["counts"]
        total = sum(counts.values())
        if total > 0:
            best = max(counts.values())
            components.append(best / total * 100)
            weights.append(0.40)

    # --- gate fidelity (30 %) ---
    gate_errors: dict = calibration.get("gate_errors") or {}
    if gate_errors:
        avg_err = sum(gate_errors.values()) / len(gate_errors)
        components.append(max(0.0, (1 - avg_err) * 100))
        weights.append(0.30)

    # --- readout fidelity (20 %) ---
    readout_errors: dict = calibration.get("readout_errors") or {}
    if readout_errors:
        avg_ro = sum(readout_errors.values()) / len(readout_errors)
        components.append(max(0.0, (1 - avg_ro) * 100))
        weights.append(0.20)

    # --- circuit efficiency (10 %) ---
    non_clifford = fingerprint.get("non_clifford_ratio")
    if non_clifford is not None:
        components.append(max(0.0, (1 - float(non_clifford)) * 100))
        weights.append(0.10)

    if not components:
        return None

    total_w = sum(weights)
    return round(sum(c * w for c, w in zip(components, weights)) / total_w, 1)


def health_breakdown(run: dict[str, Any]) -> dict[str, Any]:
    results = run.get("results") or {}
    calibration = run.get("calibration") or {}
    fingerprint = run.get("fingerprint") or {}

    breakdown: dict[str, Any] = {}

    if "success_probability" in results:
        breakdown["success_probability"] = round(float(results["success_probability"]) * 100, 1)
    elif isinstance(results.get("counts"), dict) and results["counts"]:
        counts = results["counts"]
        total = sum(counts.values())
        if total > 0:
            breakdown["success_probability"] = round(max(counts.values()) / total * 100, 1)

    gate_errors = calibration.get("gate_errors") or {}
    if gate_errors:
        avg = sum(gate_errors.values()) / len(gate_errors)
        breakdown["gate_fidelity"] = round((1 - avg) * 100, 1)
        breakdown["avg_gate_error"] = round(avg, 6)

    readout_errors = calibration.get("readout_errors") or {}
    if readout_errors:
        avg = sum(readout_errors.values()) / len(readout_errors)
        breakdown["readout_fidelity"] = round((1 - avg) * 100, 1)
        breakdown["avg_readout_error"] = round(avg, 6)

    nc = fingerprint.get("non_clifford_ratio")
    if nc is not None:
        breakdown["circuit_efficiency"] = round((1 - float(nc)) * 100, 1)

    breakdown["overall"] = compute_health_score(run)
    return breakdown
