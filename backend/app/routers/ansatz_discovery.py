"""Automatic Ansatz Discovery Engine — Feature #3 of 10.

Analyses a run's circuit fingerprint and execution history to recommend
the best variational ansatz structure for follow-up VQE/QAOA experiments.

What it does
────────────
• Classifies the circuit's structural family (hardware-efficient, QAOA,
  EfficientSU2, QNN, etc.) from gate-count fingerprints and depth.
• Scores candidate ansatz templates against the circuit's qubit topology,
  entanglement structure, and hardware backend constraints.
• Returns a ranked list of ansatz recommendations with parameter counts,
  expected fidelity range, and a justification string.
• Suggests the optimal repetition depth (`reps`) for each template.

No external ML model required: scoring is deterministic and based on
circuit-theory heuristics, making it instantly available on any run.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["ansatz_discovery"])

# ──────────────────────────────────────────────────────────────────────
# Ansatz template database
# ──────────────────────────────────────────────────────────────────────

_ANSATZ_TEMPLATES = [
    {
        "name": "EfficientSU2",
        "family": "hardware_efficient",
        "description": "Alternating SU(2) single-qubit rotations and CNOT entanglers. "
                       "Designed for hardware with linear or all-to-all connectivity.",
        "params_per_qubit_per_rep": 2,
        "entangler": "cx",
        "connectivity": "linear",
        "expressibility": 0.92,
        "trainability_ceiling_qubits": 12,
        "best_for": ["VQE", "ground_state", "chemistry"],
    },
    {
        "name": "TwoLocal",
        "family": "hardware_efficient",
        "description": "Two-local rotation gates + entanglement block. Highly configurable "
                       "rotation and entanglement strategies.",
        "params_per_qubit_per_rep": 2,
        "entangler": "cx",
        "connectivity": "full",
        "expressibility": 0.88,
        "trainability_ceiling_qubits": 16,
        "best_for": ["VQE", "QAOA", "general"],
    },
    {
        "name": "QAOA",
        "family": "problem_inspired",
        "description": "Alternating cost and mixer Hamiltonians. Optimal for combinatorial "
                       "optimisation problems (MaxCut, TSP, portfolio).",
        "params_per_qubit_per_rep": 0,   # global params: 2 per layer (gamma, beta)
        "global_params_per_rep": 2,
        "entangler": "cx",
        "connectivity": "problem_graph",
        "expressibility": 0.70,
        "trainability_ceiling_qubits": 20,
        "best_for": ["combinatorial_optimization", "MaxCut", "QAOA"],
    },
    {
        "name": "UCCSDSingles",
        "family": "chemistry",
        "description": "Unitary Coupled Cluster Singles ansatz. Best for molecular "
                       "ground-state VQE with few electrons.",
        "params_per_qubit_per_rep": 1,
        "entangler": "cx",
        "connectivity": "full",
        "expressibility": 0.95,
        "trainability_ceiling_qubits": 8,
        "best_for": ["VQE", "chemistry", "molecular_simulation"],
    },
    {
        "name": "RealAmplitudes",
        "family": "hardware_efficient",
        "description": "Pure real amplitudes with RY rotations + CNOT entanglers. "
                       "Low gate count, good for noisy devices.",
        "params_per_qubit_per_rep": 1,
        "entangler": "cx",
        "connectivity": "linear",
        "expressibility": 0.75,
        "trainability_ceiling_qubits": 20,
        "best_for": ["noisy_devices", "VQE", "low_depth"],
    },
    {
        "name": "PauliTwoDesign",
        "family": "hardware_efficient",
        "description": "Random Pauli-gate two-design for benchmarking. Maximally "
                       "expressible but suffers from barren plateaus at large n.",
        "params_per_qubit_per_rep": 0,
        "entangler": "cz",
        "connectivity": "nearest_neighbour",
        "expressibility": 0.99,
        "trainability_ceiling_qubits": 6,
        "best_for": ["benchmarking", "expressibility_test"],
    },
    {
        "name": "ExcitationPreserving",
        "family": "chemistry",
        "description": "Preserves particle number — ideal for fermionic simulations and "
                       "number-conserving Hamiltonians.",
        "params_per_qubit_per_rep": 1,
        "entangler": "iswap",
        "connectivity": "linear",
        "expressibility": 0.85,
        "trainability_ceiling_qubits": 12,
        "best_for": ["fermionic_simulation", "chemistry", "spin_systems"],
    },
]


# ──────────────────────────────────────────────────────────────────────
# Classification helpers
# ──────────────────────────────────────────────────────────────────────

def _classify_circuit(fp: dict, qasm: str | None) -> dict:
    """Classify a circuit's structural family from its fingerprint."""
    n_qubits = int(fp.get("num_qubits") or 1)
    depth    = int(fp.get("depth") or 0)
    gc       = fp.get("gate_counts") or {}
    nc_ratio = float(fp.get("non_clifford_ratio") or 0)

    total_gates = sum(gc.values()) if gc else 0
    cx_count   = int(gc.get("cx", 0) + gc.get("cnot", 0) + gc.get("ecr", 0))
    rz_count   = int(gc.get("rz", 0) + gc.get("rz", 0))
    ry_count   = int(gc.get("ry", 0))
    rx_count   = int(gc.get("rx", 0))
    t_count    = int(gc.get("t", 0) + gc.get("tdg", 0))
    h_count    = int(gc.get("h", 0))

    layers_per_qubit = depth / n_qubits if n_qubits > 0 else 0
    cx_per_qubit = cx_count / n_qubits if n_qubits > 0 else 0

    # Heuristic classification
    if ry_count > 0 and cx_count > 0 and nc_ratio < 0.15:
        family = "hardware_efficient"
    elif t_count > n_qubits and nc_ratio > 0.2:
        family = "chemistry"
    elif h_count > 0 and cx_count > 0 and t_count == 0:
        family = "problem_inspired"
    elif nc_ratio > 0.5:
        family = "deep_quantum"
    else:
        family = "general"

    entanglement_density = cx_per_qubit / max(layers_per_qubit, 1)

    return {
        "family":               family,
        "n_qubits":             n_qubits,
        "depth":                depth,
        "cx_count":             cx_count,
        "nc_ratio":             round(nc_ratio, 3),
        "entanglement_density": round(entanglement_density, 3),
        "layers_per_qubit":     round(layers_per_qubit, 2),
    }


def _score_ansatz(template: dict, circuit_info: dict, cal: dict | None) -> float:
    """Score a template (0–1) given the detected circuit characteristics."""
    n = circuit_info["n_qubits"]
    family = circuit_info["family"]
    score = 0.5  # base

    # Family match
    if family in ("hardware_efficient",) and template["family"] == "hardware_efficient":
        score += 0.25
    elif family == "chemistry" and template["family"] == "chemistry":
        score += 0.25
    elif family == "problem_inspired" and "QAOA" in template["name"]:
        score += 0.30

    # Qubit count vs trainability ceiling
    ceil = template.get("trainability_ceiling_qubits", 12)
    if n <= ceil:
        score += 0.10
    elif n <= ceil * 1.5:
        score += 0.05
    else:
        score -= 0.15  # barren plateau risk

    # Expressibility weight
    score += (template.get("expressibility", 0.8) - 0.7) * 0.3

    # Hardware noise preference
    if cal and (cal.get("avg_gate_error") or 0) > 0.01:
        # Noisy device — prefer low-depth ansätze
        if template["name"] in ("RealAmplitudes", "EfficientSU2"):
            score += 0.10

    return round(min(1.0, max(0.0, score)), 3)


def _recommend_reps(template: dict, n_qubits: int) -> int:
    """Suggest optimal repetition depth to balance expressibility and barren plateaus."""
    ceil = template.get("trainability_ceiling_qubits", 12)
    if n_qubits <= 4:
        return 3
    elif n_qubits <= 8:
        return 2
    elif n_qubits <= ceil:
        return 1
    else:
        return 1  # barren plateau risk; keep reps=1


def _param_count(template: dict, n_qubits: int, reps: int) -> int:
    ppr = template.get("params_per_qubit_per_rep", 1)
    global_ppr = template.get("global_params_per_rep", 0)
    # +1 final rotation layer
    return (ppr * n_qubits + global_ppr) * reps + ppr * n_qubits


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/ansatz-discovery")
def ansatz_discovery(run_id: str, db: Session = Depends(get_db)):
    """
    Analyse the circuit fingerprint and return ranked ansatz recommendations
    for follow-up VQE / QAOA experiments.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    fp = run.fingerprint or {}
    n_qubits = int(fp.get("num_qubits") or 0)
    if n_qubits == 0:
        raise HTTPException(422, "Circuit fingerprint missing num_qubits — run must have a fingerprint.")

    cal = run.calibration or {}
    circuit_info = _classify_circuit(fp, run.qasm)

    # Score and rank all templates
    scored = []
    for tmpl in _ANSATZ_TEMPLATES:
        s = _score_ansatz(tmpl, circuit_info, cal)
        reps = _recommend_reps(tmpl, n_qubits, )
        params = _param_count(tmpl, n_qubits, reps)
        scored.append({
            "name":          tmpl["name"],
            "family":        tmpl["family"],
            "score":         s,
            "description":   tmpl["description"],
            "recommended_reps": reps,
            "parameter_count": params,
            "entangler":     tmpl["entangler"],
            "connectivity":  tmpl["connectivity"],
            "expressibility": tmpl["expressibility"],
            "trainability_ceiling_qubits": tmpl["trainability_ceiling_qubits"],
            "best_for":      tmpl["best_for"],
            "expected_fidelity_range": _fidelity_range(tmpl, circuit_info, cal),
        })

    scored.sort(key=lambda x: x["score"], reverse=True)
    top = scored[0]

    # Barren plateau warning
    barren_warning = None
    if n_qubits > 10 and top["expressibility"] > 0.9:
        barren_warning = (
            f"With {n_qubits} qubits, highly expressible ansätze risk barren plateaus. "
            f"Consider gradient-free optimisers (COBYLA, SPSA) or layerwise training."
        )

    # Circuit-theory justification
    justification = _justify(circuit_info, top)

    return {
        "run_id":          run_id,
        "backend":         run.backend,
        "circuit_family":  circuit_info["family"],
        "circuit_info":    circuit_info,
        "top_recommendation": top,
        "all_recommendations": scored,
        "barren_plateau_warning": barren_warning,
        "justification":   justification,
        "analyzed_at":     datetime.now(timezone.utc).isoformat(),
    }


def _fidelity_range(template: dict, circuit_info: dict, cal: dict | None) -> dict:
    n = circuit_info["n_qubits"]
    base_fidelity = template["expressibility"] * 0.9
    # Noise degradation
    gate_err = float((cal or {}).get("avg_gate_error") or 0.001)
    noise_factor = max(0.0, 1.0 - gate_err * n * 5)
    low  = round(base_fidelity * noise_factor * 0.85, 2)
    high = round(min(0.99, base_fidelity * noise_factor), 2)
    return {"low": low, "high": high}


def _justify(ci: dict, top: dict) -> str:
    parts = []
    n = ci["n_qubits"]
    family = ci["family"]

    if family == "hardware_efficient":
        parts.append(
            f"Your circuit uses a hardware-efficient gate set (RY/RZ + CX). "
            f"{top['name']} matches this structure directly."
        )
    elif family == "chemistry":
        parts.append(
            f"T-gate count and non-Clifford ratio suggest a chemistry-type circuit. "
            f"{top['name']} is designed for fermionic and molecular Hamiltonians."
        )
    elif family == "problem_inspired":
        parts.append(
            f"H + CX pattern with no T gates matches a QAOA-like structure. "
            f"{top['name']} will naturally encode cost/mixer alternation."
        )

    if top["recommended_reps"] == 1:
        parts.append(
            f"With {n} qubits, keeping reps=1 minimises barren plateau risk while "
            "maintaining sufficient expressibility for most VQE landscapes."
        )
    else:
        parts.append(
            f"reps={top['recommended_reps']} provides good depth-expressibility balance for {n} qubits."
        )

    parts.append(
        f"Parameter count {top['parameter_count']} is {'manageable' if top['parameter_count'] < 50 else 'large — consider gradient-free optimisers'}."
    )

    return " ".join(parts)
