"""Quantum Bug Database (QBD) — Feature #9 of 10.

Maintains a curated library of known quantum error patterns and matches
them against a stored run's fingerprint, calibration data, and results
to identify potential quantum bugs.

Bug categories
──────────────
1. Coherent errors (over-rotation, phase kickback, wrong gate angle)
2. Incoherent / noise errors (T1/T2 exceeded, thermal relaxation)
3. Measurement errors (readout assignment, reset leakage)
4. Compilation bugs (wrong decomposition, unnecessary swaps)
5. Calibration drift (gate error spike, T1/T2 degradation)
6. Circuit design bugs (barren plateau, symmetry breaking)
7. Hardware mismatch (qubit count overrun, connectivity violation)

Each bug entry has:
  - id, category, name, description
  - detection_rules: list of (field_path, operator, threshold) triples
  - severity: "critical" | "warning" | "info"
  - suggested_fix: plain-English remediation advice

Matching
────────
Rules are evaluated against the run dict (fingerprint + calibration +
results). A bug fires when ALL its rules match. If a rule path is
absent, it is treated as "not applicable" (skip that bug).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["bug_database"])

# ──────────────────────────────────────────────────────────────────────
# Bug library
# ──────────────────────────────────────────────────────────────────────

_BUG_DB: list[dict] = [
    # ── Coherent errors ────────────────────────────────────────────────
    {
        "id":          "coherent-001",
        "category":    "coherent_error",
        "name":        "High non-Clifford ratio with poor fidelity",
        "description": "Circuits with many T/Tdg gates frequently suffer coherent over-rotation errors because T gates require precise phase control. Combined with low success probability, this strongly suggests a coherent error.",
        "rules": [
            {"path": "fingerprint.non_clifford_ratio", "op": ">=", "value": 0.25},
            {"path": "results.success_probability",    "op": "<=", "value": 0.4},
        ],
        "severity":      "critical",
        "suggested_fix": "Reduce the T-gate count via Clifford+T synthesis optimisation. Check gate calibration for the T/Tdg pulse. Consider ZX-calculus simplification (see ZX Simplify panel).",
    },
    {
        "id":          "coherent-002",
        "category":    "coherent_error",
        "name":        "Deep circuit likely affected by phase kickback",
        "description": "Very deep circuits (>150 gates) with multiple qubits often accumulate phase kickback from control-target interactions, especially when CX density is high.",
        "rules": [
            {"path": "fingerprint.depth", "op": ">=", "value": 150},
            {"path": "fingerprint.cx_count", "op": ">=", "value": 20},
        ],
        "severity":      "warning",
        "suggested_fix": "Decompose into shallower subcircuits. Apply dynamical decoupling to idle qubits. Use Trotter time steps if simulating a Hamiltonian.",
    },
    # ── Noise / decoherence ────────────────────────────────────────────
    {
        "id":          "noise-001",
        "category":    "decoherence",
        "name":        "T1 relaxation likely exceeded circuit duration",
        "description": "When the estimated circuit duration (depth × gate time ≈ depth × 200 ns) approaches or exceeds the shortest T1 time, qubit relaxation will degrade all output states.",
        "rules": [
            {"path": "calibration.avg_t1_us", "op": "<=", "value": 50.0},
            {"path": "fingerprint.depth",     "op": ">=", "value": 100},
        ],
        "severity":      "critical",
        "suggested_fix": "Reduce circuit depth. Use dynamic circuits to reset qubits mid-circuit. Choose backend with higher T1 (see Hardware Recommendation panel).",
    },
    {
        "id":          "noise-002",
        "category":    "decoherence",
        "name":        "T2 dephasing window violated",
        "description": "Low T2 combined with a deep circuit causes dephasing before measurement, collapsing interference patterns essential to the algorithm.",
        "rules": [
            {"path": "calibration.avg_t2_us", "op": "<=", "value": 40.0},
            {"path": "fingerprint.depth",     "op": ">=", "value": 80},
        ],
        "severity":      "critical",
        "suggested_fix": "Apply spin-echo or CPMG sequences to extend T2*. Shorten circuit. Reschedule to reduce idle time on low-T2 qubits.",
    },
    {
        "id":          "noise-003",
        "category":    "decoherence",
        "name":        "High gate error on dense circuit",
        "description": "Average gate error above 1% compounded over a large circuit (>200 gates) leads to near-random output distributions.",
        "rules": [
            {"path": "calibration.avg_gate_error", "op": ">=", "value": 0.01},
            {"path": "fingerprint.size",           "op": ">=", "value": 200},
        ],
        "severity":      "critical",
        "suggested_fix": "Use error mitigation (zero-noise extrapolation or probabilistic error cancellation). Compile for fewest native gates. Consider a lower-noise backend.",
    },
    # ── Measurement errors ─────────────────────────────────────────────
    {
        "id":          "measurement-001",
        "category":    "measurement_error",
        "name":        "High readout error rate",
        "description": "Readout error above 5% corrupts the measurement bitstrings, making state discrimination unreliable without post-correction.",
        "rules": [
            {"path": "calibration.avg_readout_error", "op": ">=", "value": 0.05},
        ],
        "severity":      "warning",
        "suggested_fix": "Apply measurement error mitigation (Qiskit M3 or TREX). Use state-discrimination calibration matrices. Or choose a backend with lower readout error.",
    },
    {
        "id":          "measurement-002",
        "category":    "measurement_error",
        "name":        "Low heavy output fraction — readout may dominate",
        "description": "A heavy output fraction below 2/3 on a random circuit suggests the measurement errors or noise floor dominates the signal (quantum advantage threshold: HOP > 2/3).",
        "rules": [
            {"path": "results.heavy_output_fraction", "op": "<=", "value": 0.55},
        ],
        "severity":      "warning",
        "suggested_fix": "Run a reference Bell state or GHZ circuit to separate readout noise from gate noise. Calibrate the readout discriminator. Apply SPAM correction.",
    },
    # ── Compilation bugs ───────────────────────────────────────────────
    {
        "id":          "compilation-001",
        "category":    "compilation_bug",
        "name":        "Excessive SWAP overhead detected",
        "description": "A CX count much larger than the number of qubits (ratio > 5×) usually indicates the transpiler inserted many SWAP gates to route onto limited connectivity.",
        "rules": [
            {"path": "fingerprint.cx_count",   "op": ">=", "value": 10},
            {"path": "fingerprint.num_qubits",  "op": ">=", "value": 3},
        ],
        "severity":      "warning",
        "suggested_fix": "Choose a backend whose connectivity matches your circuit's interaction graph. Use Qiskit's routing-aware transpiler with SABRE layout. Partition the circuit to reduce long-range interactions.",
        "_additional_check": "cx_per_qubit",  # handled in code
    },
    {
        "id":          "compilation-002",
        "category":    "compilation_bug",
        "name":        "Large transpilation depth inflation",
        "description": "If the transpiled circuit depth is significantly larger than the logical depth (depth-to-qubit ratio > 20), the transpiler may have introduced unnecessary barriers or failed to merge layers.",
        "rules": [
            {"path": "fingerprint.depth",      "op": ">=", "value": 60},
            {"path": "fingerprint.num_qubits", "op": ">=", "value": 2},
        ],
        "severity":      "info",
        "suggested_fix": "Re-transpile with optimization_level=3. Use PassManager with ReduceBarriers and CommutationAnalysis passes. Profile which pass introduces the depth inflation.",
        "_additional_check": "depth_per_qubit",
    },
    # ── Calibration drift ──────────────────────────────────────────────
    {
        "id":          "drift-001",
        "category":    "calibration_drift",
        "name":        "Gate error spike above 2%",
        "description": "An average gate error above 2% is a strong indicator of hardware drift or recent re-calibration failure on one or more qubits.",
        "rules": [
            {"path": "calibration.avg_gate_error", "op": ">=", "value": 0.02},
        ],
        "severity":      "critical",
        "suggested_fix": "Check the backend calibration dashboard for the affected qubit. Re-run on a different device or after the next scheduled calibration. Use the Drift Changepoint Detection panel to identify the drift onset.",
    },
    {
        "id":          "drift-002",
        "category":    "calibration_drift",
        "name":        "Two-qubit gate error unusually high",
        "description": "When the 2Q gate error (avg_gate_error_2q) exceeds 3%, entangling operations produce heavily mixed states that destroy algorithm fidelity.",
        "rules": [
            {"path": "calibration.avg_gate_error_2q", "op": ">=", "value": 0.03},
        ],
        "severity":      "critical",
        "suggested_fix": "Restrict to qubit pairs with lower 2Q error. Request a targeted re-calibration. Use native ZZ or XX gates if available (lower error than CX on some backends).",
    },
    # ── Circuit design bugs ────────────────────────────────────────────
    {
        "id":          "design-001",
        "category":    "circuit_design",
        "name":        "Potential barren plateau (overparameterised circuit)",
        "description": "Circuits with both high non-Clifford ratio and many parameters (inferred from deep, wide circuits) may suffer barren plateaus where gradients vanish exponentially.",
        "rules": [
            {"path": "fingerprint.non_clifford_ratio", "op": ">=", "value": 0.20},
            {"path": "fingerprint.num_qubits",          "op": ">=", "value": 8},
            {"path": "fingerprint.depth",               "op": ">=", "value": 50},
        ],
        "severity":      "warning",
        "suggested_fix": "Use layer-by-layer training with local cost functions. Switch to hardware-efficient ansätze with fewer parameters. Initialise parameters near identity (avoid random initialisation at scale).",
    },
    {
        "id":          "design-002",
        "category":    "circuit_design",
        "name":        "Single-qubit circuit without measurement",
        "description": "A circuit with only one qubit and no classical bits is almost certainly missing a measurement gate.",
        "rules": [
            {"path": "fingerprint.num_qubits",  "op": "<=", "value": 1},
            {"path": "fingerprint.num_clbits",  "op": "<=", "value": 0},
        ],
        "severity":      "info",
        "suggested_fix": "Add a measurement gate: `qc.measure_all()`. Classical bits are required to extract a result from the quantum computation.",
    },
    # ── Hardware mismatch ──────────────────────────────────────────────
    {
        "id":          "hw-001",
        "category":    "hardware_mismatch",
        "name":        "Circuit wider than typical backend",
        "description": "Circuits with more than 127 qubits are too wide for most currently available quantum processors.",
        "rules": [
            {"path": "fingerprint.num_qubits", "op": ">=", "value": 128},
        ],
        "severity":      "critical",
        "suggested_fix": "Partition the circuit into smaller subcircuits that fit within a single device. Use circuit cutting (gate cutting or wire cutting) to distribute across multiple QPUs.",
    },
    {
        "id":          "hw-002",
        "category":    "hardware_mismatch",
        "name":        "Low success probability on completed run",
        "description": "A completed run with success probability below 10% indicates near-random output — the signal has been overwhelmed by noise.",
        "rules": [
            {"path": "results.success_probability", "op": "<=", "value": 0.10},
        ],
        "severity":      "critical",
        "suggested_fix": "Apply probabilistic error cancellation or ZNE. Reduce circuit depth. Cross-check with the Quantum Advantage Oracle panel to assess classical simulability of this circuit.",
    },
]


# ──────────────────────────────────────────────────────────────────────
# Rule evaluation
# ──────────────────────────────────────────────────────────────────────

def _get_nested(obj: dict, path: str) -> Optional[Any]:
    """Navigate dot-separated path in a nested dict. Returns None if absent."""
    parts = path.split(".")
    cur: Any = obj
    for p in parts:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


_OPS = {
    ">=": lambda a, b: a >= b,
    "<=": lambda a, b: a <= b,
    ">":  lambda a, b: a >  b,
    "<":  lambda a, b: a <  b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


def _rule_matches(rule: dict, run_data: dict) -> bool:
    val = _get_nested(run_data, rule["path"])
    if val is None:
        return False  # missing data → rule not applicable
    try:
        fval = float(val)
    except (TypeError, ValueError):
        return False
    op_fn = _OPS.get(rule["op"])
    return op_fn is not None and op_fn(fval, float(rule["value"]))


def _additional_check(bug: dict, fp: dict) -> bool:
    """Extra computed checks that can't be expressed as simple thresholds."""
    check = bug.get("_additional_check")
    if check == "cx_per_qubit":
        cx = float(fp.get("cx_count") or 0)
        n  = float(fp.get("num_qubits") or 1)
        return cx / max(n, 1) > 5.0
    if check == "depth_per_qubit":
        d = float(fp.get("depth") or 0)
        n = float(fp.get("num_qubits") or 1)
        return d / max(n, 1) > 20.0
    return True  # no additional check → always passes


def _match_bugs(run: Run) -> list[dict]:
    """Return list of matched bug entries with match details."""
    fp  = run.fingerprint or {}
    cal = run.calibration or {}
    res = run.results     or {}

    run_data = {"fingerprint": fp, "calibration": cal, "results": res}

    matched: list[dict] = []
    for bug in _BUG_DB:
        rules = bug.get("rules", [])
        if all(_rule_matches(r, run_data) for r in rules) and _additional_check(bug, fp):
            matched.append({
                "id":            bug["id"],
                "category":      bug["category"],
                "name":          bug["name"],
                "description":   bug["description"],
                "severity":      bug["severity"],
                "suggested_fix": bug["suggested_fix"],
                "matched_rules": [
                    {"path": r["path"], "op": r["op"], "threshold": r["value"],
                     "actual": _get_nested(run_data, r["path"])}
                    for r in rules
                ],
            })
    return matched


# ──────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/bug-database")
def bug_database_scan(run_id: str, db: Session = Depends(get_db)):
    """
    Scan this run against the Quantum Bug Database and return matched patterns.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    matches = _match_bugs(run)

    # Sort: critical first, then warning, then info
    _priority = {"critical": 0, "warning": 1, "info": 2}
    matches.sort(key=lambda x: _priority.get(x["severity"], 3))

    critical = [m for m in matches if m["severity"] == "critical"]
    warnings  = [m for m in matches if m["severity"] == "warning"]
    infos     = [m for m in matches if m["severity"] == "info"]

    if critical:
        verdict = "critical"
        narrative = (
            f"Found {len(critical)} critical bug pattern{'s' if len(critical) != 1 else ''} "
            f"in this run. Immediate attention recommended."
        )
    elif warnings:
        verdict = "warning"
        narrative = (
            f"Found {len(warnings)} warning-level pattern{'s' if len(warnings) != 1 else ''} "
            f"that may degrade results. Review the suggested fixes."
        )
    elif infos:
        verdict = "info"
        narrative = f"Found {len(infos)} informational pattern{'s' if len(infos) != 1 else ''}. No critical issues detected."
    else:
        verdict = "clean"
        narrative = "No known quantum bug patterns matched this run. Circuit looks healthy."

    return {
        "run_id":       run_id,
        "verdict":      verdict,
        "narrative":    narrative,
        "n_matches":    len(matches),
        "n_critical":   len(critical),
        "n_warnings":   len(warnings),
        "n_info":       len(infos),
        "matches":      matches,
        "db_size":      len(_BUG_DB),
        "scanned_at":   datetime.now(timezone.utc).isoformat(),
    }


@router.get("/bug-database/patterns")
def list_bug_patterns():
    """Return the full bug library (without detection rule thresholds)."""
    return [
        {
            "id":          b["id"],
            "category":    b["category"],
            "name":        b["name"],
            "description": b["description"],
            "severity":    b["severity"],
        }
        for b in _BUG_DB
    ]
