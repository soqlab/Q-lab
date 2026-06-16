"""Noise Model Simulator.

Extracts per-qubit calibration data, builds a Qiskit NoiseModel
(depolarizing + thermal relaxation + readout), and runs an Aer simulation.
Compares noisy-simulated TVD to ideal and to real hardware results.
"""

from __future__ import annotations

import math
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["noise_sim"])

_GATE_TIMES_NS = {
    "id": 35, "u1": 0, "u2": 50, "u3": 100,
    "rx": 35, "ry": 35, "rz": 0, "x": 35, "y": 35, "z": 0,
    "h": 35, "s": 0, "t": 0, "sx": 35,
    "cx": 300, "cz": 300, "ecr": 400, "rzx": 300, "swap": 600,
}


def _safe_float(v: Any) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _parse_calibration(cal: dict, num_qubits: int) -> dict:
    """Extract per-qubit T1, T2, readout error and 2Q gate errors."""
    qubit_data: dict[int, dict] = {}
    gate_errors_2q: dict[str, float] = {}

    for key, val in cal.items():
        if not isinstance(val, dict):
            continue
        # Per-qubit entries: q0, q1, qubit_0, etc.
        q_idx = None
        if key.startswith("q") and key[1:].isdigit():
            q_idx = int(key[1:])
        elif key.startswith("qubit_") and key[6:].isdigit():
            q_idx = int(key[6:])

        if q_idx is not None and 0 <= q_idx < num_qubits:
            qubit_data[q_idx] = {
                "t1": _safe_float(val.get("T1") or val.get("t1")),
                "t2": _safe_float(val.get("T2") or val.get("t2")),
                "readout_error": _safe_float(val.get("readout_error") or val.get("prob_meas1_prep0")),
                "gate_error_1q": _safe_float(val.get("gate_error") or val.get("u3_error")),
            }
            continue

        # 2Q gate entries: cx0_1, cx_0_1, ecr0_1, etc.
        ge_2q = _safe_float(val.get("cx_error") or val.get("ecr_error") or val.get("cz_error") or val.get("gate_error"))
        if ge_2q is not None:
            gate_errors_2q[key] = ge_2q

    return {"qubits": qubit_data, "gate_errors_2q": gate_errors_2q}


def _analytical_noise_budget(cal_parsed: dict, fp: dict) -> dict:
    """Compute an analytical noise budget without running Aer simulation."""
    qubits = cal_parsed["qubits"]
    gate_errors_2q = cal_parsed["gate_errors_2q"]
    num_qubits = fp.get("num_qubits", 1) or 1
    depth = fp.get("depth", 1) or 1
    size = fp.get("size", 1) or 1
    nc_ratio = fp.get("non_clifford_ratio", 0) or 0

    # Average 1Q gate error
    ge_1q_vals = [q.get("gate_error_1q") for q in qubits.values() if q.get("gate_error_1q") is not None]
    avg_ge_1q = sum(ge_1q_vals) / len(ge_1q_vals) if ge_1q_vals else 0.001

    # Average 2Q gate error
    ge_2q_vals = list(gate_errors_2q.values())
    avg_ge_2q = sum(ge_2q_vals) / len(ge_2q_vals) if ge_2q_vals else 0.01

    # Average readout error
    ro_vals = [q.get("readout_error") for q in qubits.values() if q.get("readout_error") is not None]
    avg_ro = sum(ro_vals) / len(ro_vals) if ro_vals else 0.02

    # Average T1/T2
    t1_vals = [q.get("t1") for q in qubits.values() if q.get("t1") is not None]
    t2_vals = [q.get("t2") for q in qubits.values() if q.get("t2") is not None]
    avg_t1 = sum(t1_vals) / len(t1_vals) if t1_vals else 100.0
    avg_t2 = sum(t2_vals) / len(t2_vals) if t2_vals else 50.0

    # Estimate number of 2Q gates
    n_2q = int(size * 0.25)  # rough: ~25% of gates are 2Q
    n_1q = size - n_2q

    # Gate error contribution
    gate_fidelity = (1 - avg_ge_1q) ** n_1q * (1 - avg_ge_2q) ** n_2q
    gate_infidelity = 1 - gate_fidelity

    # Coherence contribution: circuit time ≈ depth * avg_1q_gate_time (50ns)
    circuit_time_us = depth * 50e-9 * 1e6  # convert ns to µs
    coherence_infidelity = 0.0
    if avg_t1 > 0:
        coherence_infidelity = 1 - math.exp(-circuit_time_us / avg_t1) * num_qubits / max(num_qubits, 1)

    # Readout contribution
    ro_infidelity = 1 - (1 - avg_ro) ** num_qubits

    # Total estimated infidelity (independent approximation)
    total_infidelity = min(0.99, gate_infidelity + coherence_infidelity + ro_infidelity)
    estimated_tvd = total_infidelity / 2  # TVD ≤ infidelity

    total = gate_infidelity + coherence_infidelity + ro_infidelity + 1e-9
    return {
        "method": "analytical",
        "estimated_tvd": round(estimated_tvd, 4),
        "estimated_success_probability": round(max(0, 1 - total_infidelity), 4),
        "noise_budget": {
            "gate_errors": round(gate_infidelity / total * 100, 1),
            "coherence": round(coherence_infidelity / total * 100, 1),
            "readout": round(ro_infidelity / total * 100, 1),
        },
        "noise_budget_absolute": {
            "gate_errors": round(gate_infidelity, 4),
            "coherence": round(coherence_infidelity, 4),
            "readout": round(ro_infidelity, 4),
            "total_infidelity": round(total_infidelity, 4),
        },
        "parameters_used": {
            "avg_ge_1q": round(avg_ge_1q, 6) if ge_1q_vals else None,
            "avg_ge_2q": round(avg_ge_2q, 6) if ge_2q_vals else None,
            "avg_ro": round(avg_ro, 4) if ro_vals else None,
            "avg_t1_us": round(avg_t1, 1) if t1_vals else None,
            "avg_t2_us": round(avg_t2, 1) if t2_vals else None,
            "estimated_circuit_time_us": round(circuit_time_us, 2),
        },
    }


def _aer_simulate(qasm: str, cal_parsed: dict, shots: int = 2000) -> Optional[dict]:
    """Try Aer simulation. Returns None if Aer not available."""
    try:
        from qiskit import qasm2
        from qiskit_aer import AerSimulator
        from qiskit_aer.noise import (
            NoiseModel, depolarizing_error, thermal_relaxation_error, ReadoutError,
        )
    except ImportError:
        return None

    try:
        qc = qasm2.loads(qasm)
    except Exception:
        return None

    num_qubits = qc.num_qubits
    noise_model = NoiseModel()
    qubits = cal_parsed["qubits"]
    gate_errors_2q = cal_parsed["gate_errors_2q"]

    # Per-qubit noise
    for q_idx in range(num_qubits):
        qdata = qubits.get(q_idx, {})
        t1 = qdata.get("t1")  # in µs
        t2 = qdata.get("t2")
        ge_1q = qdata.get("gate_error_1q")
        ro = qdata.get("readout_error")

        if t1 and t2:
            try:
                t1_s = max(t1, 1) * 1e-6
                t2_s = min(max(t2, 0.1), 2 * t1) * 1e-6
                gate_time = 50e-9  # 50 ns for 1Q gates
                err = thermal_relaxation_error(t1_s, t2_s, gate_time)
                noise_model.add_quantum_error(err, ["u1", "u2", "u3", "rx", "ry", "rz", "x", "h", "sx"], [q_idx])
            except Exception:
                pass

        if ge_1q and ge_1q > 0:
            try:
                err = depolarizing_error(min(ge_1q, 0.75), 1)
                noise_model.add_quantum_error(err, ["u1", "u2", "u3", "rx", "ry", "rz", "x", "h", "sx"], [q_idx])
            except Exception:
                pass

        if ro and ro > 0:
            try:
                ro_c = min(ro, 0.49)
                readout_err = ReadoutError([[1 - ro_c, ro_c], [ro_c, 1 - ro_c]])
                noise_model.add_readout_error(readout_err, [q_idx])
            except Exception:
                pass

    # 2Q gate noise (average over all pairs)
    avg_ge_2q_vals = list(gate_errors_2q.values())
    if avg_ge_2q_vals:
        avg_ge_2q = sum(avg_ge_2q_vals) / len(avg_ge_2q_vals)
        try:
            err = depolarizing_error(min(avg_ge_2q * 1.5, 0.75), 2)
            noise_model.add_all_qubit_quantum_error(err, ["cx", "cz", "ecr", "rzx"])
        except Exception:
            pass

    try:
        backend = AerSimulator(noise_model=noise_model)
        from qiskit import transpile
        qc_t = transpile(qc, backend)
        job = backend.run(qc_t, shots=shots)
        counts = job.result().get_counts()
        return {k.replace(" ", ""): v for k, v in counts.items()}
    except Exception:
        return None


def _tvd(counts_a: dict, counts_b: dict) -> float:
    """Total Variation Distance between two count distributions."""
    all_keys = set(counts_a) | set(counts_b)
    total_a = sum(counts_a.values()) or 1
    total_b = sum(counts_b.values()) or 1
    return 0.5 * sum(
        abs(counts_a.get(k, 0) / total_a - counts_b.get(k, 0) / total_b)
        for k in all_keys
    )


@router.get("/{run_id}/noise-sim")
def noise_sim(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        raise HTTPException(404, "Run not found")

    fp = run.fingerprint or {}
    cal = run.calibration or {}
    num_qubits = int(fp.get("num_qubits", 1) or 1)
    cal_parsed = _parse_calibration(cal, num_qubits)

    has_calibration = bool(cal_parsed["qubits"] or cal_parsed["gate_errors_2q"])
    has_qasm = bool(run.qasm)

    # Always compute analytical model
    analytical = _analytical_noise_budget(cal_parsed, fp)

    # Try Aer simulation if QASM available
    aer_result = None
    aer_tvd = None
    real_tvd = None
    comparison = None

    if has_qasm:
        aer_counts = _aer_simulate(run.qasm, cal_parsed)
        if aer_counts:
            aer_result = {"counts": dict(list(sorted(aer_counts.items(), key=lambda x: -x[1]))[:20]), "shots": sum(aer_counts.values())}
            # Compare noisy sim to real hardware counts
            real_counts = (run.results or {}).get("counts") or {}
            if real_counts:
                real_tvd = round(_tvd(aer_counts, {str(k): v for k, v in real_counts.items()}), 4)
                aer_tvd = real_tvd
                # Also TVD between noisy sim and ideal (uniform over most likely state)
                comparison = {
                    "noisy_sim_vs_real_tvd": real_tvd,
                    "verdict": (
                        "hardware matches model" if real_tvd < 0.05
                        else "hardware slightly worse than model" if real_tvd < 0.15
                        else "hardware significantly worse than noise model"
                    ),
                }

    # Real hardware TVD from shadow simulation
    shadow_tvd = None
    if run.shadow_results:
        shadow_tvd = _safe_float(run.shadow_results.get("tvd"))

    return {
        "run_id": run_id,
        "has_calibration": has_calibration,
        "has_qasm": has_qasm,
        "analytical": analytical,
        "aer_simulation": aer_result,
        "aer_tvd": aer_tvd,
        "real_hardware_tvd": shadow_tvd,
        "comparison": comparison,
        "qubit_noise_summary": [
            {
                "qubit": q_idx,
                **{k: round(v, 6) if isinstance(v, float) else v for k, v in qdata.items() if v is not None},
            }
            for q_idx, qdata in sorted(cal_parsed["qubits"].items())
        ],
        "dominant_noise_source": max(
            analytical["noise_budget"],
            key=lambda k: analytical["noise_budget"][k],
        ) if analytical.get("noise_budget") else None,
    }
