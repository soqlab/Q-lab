"""Universal Algorithmic Fingerprinting and Cross-Platform Transpilation.

UAF-CPT normalises a stored circuit into a provider-agnostic intent profile,
then estimates portability and fidelity across provider families and the
backends already observed in Q-Lab.
"""

from __future__ import annotations

import hashlib
import math
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run
from ..calibration_utils import per_qubit

router = APIRouter(prefix="/api/v1/runs", tags=["uaf_cpt"])

_TWO_Q = {"cx", "cz", "cy", "ecr", "rzx", "rxx", "ryy", "rzz", "swap", "iswap", "xx", "zz", "ms", "cp", "cu", "ccx"}
_PARAMETRIC = {"rx", "ry", "rz", "p", "u", "u1", "u2", "u3", "cp", "rxx", "ryy", "rzz", "rzx"}
_NON_CLIFFORD = {"t", "tdg", "p", "rx", "ry", "rz", "u", "u1", "u2", "u3", "rxx", "ryy", "rzz", "rzx", "cp"}

_PROVIDER_PROFILES: dict[str, dict[str, Any]] = {
    "ibm": {
        "native": {"cx", "ecr", "rz", "sx", "x", "measure", "reset"},
        "all_to_all": False,
        "base_1q": 0.001,
        "base_2q": 0.010,
        "readout": 0.020,
        "t1_us": 180.0,
        "translation": {"cp": 2, "swap": 3, "rxx": 3, "ryy": 3, "rzz": 2, "xx": 3, "zz": 2, "ms": 4},
    },
    "ionq": {
        "native": {"xx", "rx", "ry", "rz", "measure"},
        "all_to_all": True,
        "base_1q": 0.0008,
        "base_2q": 0.006,
        "readout": 0.010,
        "t1_us": 1_000_000.0,
        "translation": {"cx": 2, "cz": 2, "ecr": 2, "cp": 2, "swap": 3, "rxx": 1, "ryy": 2, "rzz": 2, "ms": 1},
    },
    "quantinuum": {
        "native": {"zz", "rx", "ry", "rz", "measure"},
        "all_to_all": True,
        "base_1q": 0.0005,
        "base_2q": 0.004,
        "readout": 0.006,
        "t1_us": 1_000_000.0,
        "translation": {"cx": 2, "cz": 1, "ecr": 2, "cp": 1, "swap": 3, "rxx": 2, "ryy": 2, "xx": 2, "ms": 1},
    },
    "rigetti": {
        "native": {"cz", "rx", "rz", "measure"},
        "all_to_all": False,
        "base_1q": 0.002,
        "base_2q": 0.025,
        "readout": 0.030,
        "t1_us": 45.0,
        "translation": {"cx": 2, "ecr": 3, "cp": 2, "swap": 3, "rxx": 4, "ryy": 4, "rzz": 2, "xx": 4, "zz": 1, "ms": 4},
    },
}


def _safe_float(value: Any) -> float | None:
    try:
        f = float(value)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _gate_counts_from_qasm(qasm: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for raw in qasm.splitlines():
        line = raw.strip().lower()
        if not line or line.startswith("//") or line.startswith(("openqasm", "include", "qreg", "creg", "barrier", "measure")):
            continue
        match = re.match(r"^([a-z][a-z0-9_]*)\s*(?:\([^)]*\))?\s+", line)
        if match:
            gate = match.group(1)
            counts[gate] = counts.get(gate, 0) + 1
    return counts


def _extract_interactions(qasm: str) -> dict[str, int]:
    interactions: dict[str, int] = {}
    for raw in qasm.splitlines():
        line = raw.strip().lower()
        match = re.match(r"^([a-z][a-z0-9_]*)\s*(?:\([^)]*\))?\s+q\[(\d+)\]\s*,\s*q\[(\d+)\]\s*;", line)
        if not match:
            continue
        gate = match.group(1)
        if gate not in _TWO_Q:
            continue
        a, b = sorted((int(match.group(2)), int(match.group(3))))
        key = f"{a}-{b}"
        interactions[key] = interactions.get(key, 0) + 1
    return interactions


def _detect_family(backend: str) -> str:
    name = backend.lower()
    if "ionq" in name:
        return "ionq"
    if "quantinuum" in name or "h1" in name or "h2" in name or "aria" in name or "forte" in name:
        return "quantinuum"
    if "rigetti" in name or "aspen" in name or "ankaa" in name:
        return "rigetti"
    return "ibm"


def _cal_summary(cal: dict[str, Any]) -> dict[str, float | None]:
    gate_errors = [_safe_float(v) for v in per_qubit(cal.get("gate_errors")).values()]
    readout_errors = [_safe_float(v) for v in per_qubit(cal.get("readout_errors")).values()]
    t1_vals = [_safe_float(v) for v in per_qubit(cal.get("t1_us")).values()]
    t2_vals = [_safe_float(v) for v in per_qubit(cal.get("t2_us")).values()]
    gate_errors = [v for v in gate_errors if v is not None]
    readout_errors = [v for v in readout_errors if v is not None]
    t1_vals = [v for v in t1_vals if v is not None]
    t2_vals = [v for v in t2_vals if v is not None]
    return {
        "gate_error": sum(gate_errors) / len(gate_errors) if gate_errors else None,
        "readout_error": sum(readout_errors) / len(readout_errors) if readout_errors else None,
        "t1_us": sum(t1_vals) / len(t1_vals) if t1_vals else None,
        "t2_us": sum(t2_vals) / len(t2_vals) if t2_vals else None,
    }


def _intent_profile(run: Run) -> dict[str, Any]:
    fp = run.fingerprint or {}
    qasm = run.qasm or ""
    gate_counts = {str(k).lower(): int(v) for k, v in (fp.get("gate_counts") or {}).items()}
    if not gate_counts and qasm:
        gate_counts = _gate_counts_from_qasm(qasm)
    interactions = _extract_interactions(qasm) if qasm else {}
    two_q = sum(v for k, v in gate_counts.items() if k in _TWO_Q)
    parametric = sum(v for k, v in gate_counts.items() if k in _PARAMETRIC)
    non_clifford = int(fp.get("non_clifford_count") or sum(v for k, v in gate_counts.items() if k in _NON_CLIFFORD))
    n_qubits = int(fp.get("num_qubits") or 0)
    depth = int(fp.get("depth") or 0)
    size = int(fp.get("size") or sum(gate_counts.values()))
    topology_tokens = sorted(interactions.items())
    semantic_material = {
        "n_qubits": n_qubits,
        "depth": depth,
        "gate_families": {
            "single": max(0, size - two_q),
            "two_qubit": two_q,
            "parametric": parametric,
            "non_clifford": non_clifford,
        },
        "interactions": topology_tokens,
    }
    digest = hashlib.sha256(repr(semantic_material).encode("utf-8")).hexdigest()
    return {
        "semantic_hash": digest,
        "n_qubits": n_qubits,
        "depth": depth,
        "size": size,
        "gate_counts": gate_counts,
        "two_qubit_gate_count": two_q,
        "parametric_gate_count": parametric,
        "non_clifford_count": non_clifford,
        "interaction_edges": [{"edge": edge, "count": count} for edge, count in topology_tokens],
        "interaction_density": round(len(interactions) / max(1, n_qubits * (n_qubits - 1) / 2), 4) if n_qubits > 1 else 0.0,
    }


def _score_target(intent: dict[str, Any], target_name: str, family: str, cal: dict[str, float | None] | None = None) -> dict[str, Any]:
    profile = _PROVIDER_PROFILES[family]
    native = profile["native"]
    gate_counts: dict[str, int] = intent["gate_counts"]
    n_qubits = int(intent["n_qubits"])
    size = int(intent["size"])
    two_q = int(intent["two_qubit_gate_count"])
    depth = int(intent["depth"])

    translation_overhead = 0
    unsupported = []
    for gate, count in gate_counts.items():
        if gate in native or gate == "measure":
            continue
        multiplier = int((profile["translation"] or {}).get(gate, 2 if gate in _TWO_Q else 1))
        translation_overhead += count * max(0, multiplier - 1)
        if gate not in _PARAMETRIC and gate not in _TWO_Q and gate not in {"h", "s", "sdg", "t", "tdg", "x", "y", "z"}:
            unsupported.append(gate)

    connectivity_penalty = 0.0
    if not profile["all_to_all"]:
        density = float(intent["interaction_density"])
        connectivity_penalty = min(18.0, density * 22.0 + max(0, two_q - n_qubits) * 0.2)

    cal = cal or {}
    ge = cal.get("gate_error") or float(profile["base_1q"])
    ge2 = max(float(profile["base_2q"]), ge * 6)
    ro = cal.get("readout_error") or float(profile["readout"])
    t1 = cal.get("t1_us") or float(profile["t1_us"])
    single_q = max(0, size - two_q)
    translated_two_q = two_q + translation_overhead
    circuit_time_us = (single_q * 0.05 + translated_two_q * 0.3 + n_qubits * 3.0)

    f_1q = (1.0 - ge) ** single_q if single_q else 1.0
    f_2q = (1.0 - ge2) ** translated_two_q if translated_two_q else 1.0
    f_ro = (1.0 - ro) ** n_qubits if n_qubits else 1.0
    f_t1 = math.exp(-circuit_time_us / t1) if t1 else 1.0
    estimated_fidelity = max(0.0, min(1.0, f_1q * f_2q * f_ro * f_t1))

    overhead_ratio = translation_overhead / max(1, size)
    portability = 100.0
    portability -= min(35.0, overhead_ratio * 100.0)
    portability -= connectivity_penalty
    portability -= min(20.0, len(set(unsupported)) * 5.0)
    portability -= min(20.0, max(0, depth - 200) * 0.05)
    portability = round(max(0.0, portability), 1)

    fidelity_score = round(estimated_fidelity * 100.0, 1)
    combined = round(0.55 * portability + 0.45 * fidelity_score, 1)
    return {
        "target": target_name,
        "family": family,
        "portability_score": portability,
        "estimated_fidelity_score": fidelity_score,
        "combined_score": combined,
        "translation_overhead_gates": translation_overhead,
        "connectivity_penalty": round(connectivity_penalty, 1),
        "unsupported_gates": sorted(set(unsupported)),
        "estimated_circuit_time_us": round(circuit_time_us, 3),
        "basis_translation": {
            "native_gates": sorted(native),
            "translated_two_qubit_gate_count": translated_two_q,
        },
    }


@router.get("/{run_id}/uaf-cpt")
def uaf_cpt(run_id: str, db: Session = Depends(get_db)):
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    intent = _intent_profile(run)
    since = datetime.now(timezone.utc) - timedelta(days=120)
    observed = db.scalars(
        select(Run).where(Run.created_at >= since, Run.backend.isnot(None)).order_by(Run.created_at.desc()).limit(2000)
    ).all()

    latest_cal: dict[str, dict[str, float | None]] = {}
    for item in observed:
        if item.backend and item.backend not in latest_cal and item.calibration:
            latest_cal[item.backend] = _cal_summary(item.calibration)

    targets = [
        _score_target(intent, label, family)
        for label, family in [
            ("IBM superconducting baseline", "ibm"),
            ("IonQ trapped-ion baseline", "ionq"),
            ("Quantinuum trapped-ion baseline", "quantinuum"),
            ("Rigetti superconducting baseline", "rigetti"),
        ]
    ]
    for backend, cal in latest_cal.items():
        family = _detect_family(backend)
        targets.append(_score_target(intent, backend, family, cal))

    targets.sort(key=lambda item: item["combined_score"], reverse=True)
    best = targets[0] if targets else None
    return {
        "run_id": run_id,
        "algorithmic_fingerprint": intent,
        "best_target": best["target"] if best else None,
        "portability_grade": "A" if best and best["combined_score"] >= 85 else "B" if best and best["combined_score"] >= 70 else "C" if best and best["combined_score"] >= 55 else "D",
        "targets": targets,
        "note": "Scores are model-based estimates from stored QASM/fingerprint/calibration data, not guaranteed provider execution results.",
    }
