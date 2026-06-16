"""Quantum Chaos Engine — Fault Injection for QPU Resilience Testing.

Deliberately injects errors into quantum circuits to measure algorithm resilience.
This is chaos engineering for quantum programs — nothing like this exists in production.

Fault models:
  - bit_flip:    Insert X gate after random gates (probability = fault_rate)
  - phase_flip:  Insert Z gate after random gates
  - depolarizing: Insert random {X, Y, Z} or nothing
  - amplitude_damping: Zero out qubit via reset + partial re-preparation

Resilience score = fraction of trials where TVD(noisy, clean) < threshold
"""
from __future__ import annotations

import math
import random
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import FaultInjectionResult

router = APIRouter(prefix="/api/v1/chaos", tags=["fault_injector"])

FAULT_TYPES = ["bit_flip", "phase_flip", "depolarizing", "amplitude_damping"]


def _inject_faults(gate_lines: list[str], n_qubits: int, fault_type: str, fault_rate: float, rng: random.Random) -> list[str]:
    result: list[str] = []
    for line in gate_lines:
        result.append(line)
        if not re.match(r"(h|x|y|z|s|t|cx|rz|rx|ry|swap)", line.strip()):
            continue
        qs = re.findall(r"q\[(\d+)\]", line)
        for q_str in qs:
            q = int(q_str)
            if rng.random() < fault_rate:
                if fault_type == "bit_flip":
                    result.append(f"x q[{q}];")
                elif fault_type == "phase_flip":
                    result.append(f"z q[{q}];")
                elif fault_type == "depolarizing":
                    g = rng.choice(["x", "y", "z"])
                    result.append(f"{g} q[{q}];")
                elif fault_type == "amplitude_damping":
                    if rng.random() < fault_rate:
                        result.append(f"reset q[{q}];")
    return result


def _total_variation_distance(a: dict[str, int], b: dict[str, int]) -> float:
    keys = set(a) | set(b)
    total_a = sum(a.values()) or 1
    total_b = sum(b.values()) or 1
    return 0.5 * sum(abs(a.get(k, 0) / total_a - b.get(k, 0) / total_b) for k in keys)


def _grade(score: float) -> str:
    if score >= 0.95: return "A"
    if score >= 0.85: return "B"
    if score >= 0.70: return "C"
    if score >= 0.50: return "D"
    return "F"


def _run_fault_injection(
    qasm: str, fault_type: str, fault_rate: float, n_trials: int,
    tvd_threshold: float, shots: int, seed: int,
) -> dict[str, Any]:
    from .job_executor import _simulate_qasm

    rng = random.Random(seed)
    lines = qasm.strip().split("\n")
    header, gate_lines, n_qubits = [], [], 2
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if s.startswith(("OPENQASM", "include", "qreg", "creg", "//")):
            if s.startswith("qreg"):
                m = re.search(r"\[(\d+)\]", s)
                if m:
                    n_qubits = int(m.group(1))
            header.append(line)
        elif not s.startswith("measure"):
            gate_lines.append(s)

    measures = "\n".join(f"measure q[{i}] -> c[{i}];" for i in range(n_qubits))

    # Clean run
    clean_counts = _simulate_qasm(qasm, shots, seed=rng.randint(0, 2 ** 30))

    trial_tvds: list[float] = []
    trial_fidelities: list[float] = []

    for trial in range(n_trials):
        faulty_gates = _inject_faults(gate_lines, n_qubits, fault_type, fault_rate, rng)
        faulty_qasm = "\n".join(header) + "\n" + "\n".join(faulty_gates) + "\n" + measures
        try:
            noisy_counts = _simulate_qasm(faulty_qasm, shots, seed=rng.randint(0, 2 ** 30))
        except Exception:
            noisy_counts = {}
        tvd = _total_variation_distance(clean_counts, noisy_counts)
        trial_tvds.append(round(tvd, 4))
        fidelity = 1 - tvd
        trial_fidelities.append(round(fidelity, 4))

    mean_tvd = sum(trial_tvds) / len(trial_tvds) if trial_tvds else 0
    mean_fidelity = sum(trial_fidelities) / len(trial_fidelities) if trial_fidelities else 0
    min_fidelity = min(trial_fidelities) if trial_fidelities else 0
    resilience = sum(1 for t in trial_tvds if t < tvd_threshold) / max(len(trial_tvds), 1)

    return {
        "fault_type": fault_type, "fault_rate": fault_rate, "n_trials": n_trials,
        "mean_fidelity": round(mean_fidelity, 4), "min_fidelity": round(min_fidelity, 4),
        "mean_tvd": round(mean_tvd, 4), "resilience_score": round(resilience, 4),
        "grade": _grade(resilience), "trial_tvds": trial_tvds,
        "trial_fidelities": trial_fidelities,
        "n_gates_before": len(gate_lines), "shots": shots,
        "interpretation": (
            "Excellent resilience — algorithm survives injected errors" if resilience >= 0.85
            else "Moderate resilience — consider error mitigation" if resilience >= 0.6
            else "Poor resilience — algorithm highly sensitive to noise"
        ),
    }


class FaultRequest(BaseModel):
    qasm: str
    circuit_name: str = ""
    fault_type: str = Field(default="depolarizing", description="bit_flip | phase_flip | depolarizing | amplitude_damping")
    fault_rate: float = Field(default=0.05, ge=0.001, le=0.5)
    n_trials: int = Field(default=50, ge=5, le=500)
    tvd_threshold: float = Field(default=0.15, ge=0.01, le=0.5, description="TVD < threshold = resilient trial")
    shots: int = Field(default=256, ge=64, le=2048)
    seed: int = 42


@router.post("")
def inject_faults(req: FaultRequest, db: Session = Depends(get_db)):
    if req.fault_type not in FAULT_TYPES:
        raise HTTPException(422, f"fault_type must be one of {FAULT_TYPES}")
    data = _run_fault_injection(req.qasm, req.fault_type, req.fault_rate, req.n_trials,
                                req.tvd_threshold, req.shots, req.seed)
    result_id = f"chaos-{uuid.uuid4().hex[:12]}"
    record = FaultInjectionResult(
        result_id=result_id, circuit_name=req.circuit_name or result_id,
        fault_type=data["fault_type"], fault_rate=data["fault_rate"], n_trials=data["n_trials"],
        mean_fidelity=data["mean_fidelity"], min_fidelity=data["min_fidelity"],
        resilience_score=data["resilience_score"], grade=data["grade"],
        trial_results=[{"tvd": t, "fidelity": f} for t, f in zip(data["trial_tvds"], data["trial_fidelities"])],
    )
    db.add(record); db.commit(); db.refresh(record)
    return {"result_id": result_id, "circuit_name": record.circuit_name, **data,
            "created_at": record.created_at.isoformat()}


@router.get("")
def list_fault_results(fault_type: Optional[str] = None, db: Session = Depends(get_db)):
    q = select(FaultInjectionResult).order_by(FaultInjectionResult.created_at.desc()).limit(100)
    if fault_type:
        q = q.where(FaultInjectionResult.fault_type == fault_type)
    rows = db.scalars(q).all()
    return [{"result_id": r.result_id, "circuit_name": r.circuit_name, "fault_type": r.fault_type,
             "fault_rate": r.fault_rate, "resilience_score": r.resilience_score, "grade": r.grade,
             "mean_fidelity": r.mean_fidelity, "created_at": r.created_at.isoformat()} for r in rows]


@router.post("/sweep")
def fault_sweep(qasm: str, fault_type: str = "depolarizing", n_points: int = 8, shots: int = 256, seed: int = 42,
                db: Session = Depends(get_db)):
    """Sweep fault_rate from 0 to 0.4 and return resilience curve."""
    rates = [round(i * 0.05, 3) for i in range(1, n_points + 1)]
    curve = []
    for rate in rates:
        data = _run_fault_injection(qasm, fault_type, rate, 20, 0.15, shots, seed)
        curve.append({"fault_rate": rate, "resilience_score": data["resilience_score"],
                      "mean_fidelity": data["mean_fidelity"]})
    return {"fault_type": fault_type, "curve": curve}
