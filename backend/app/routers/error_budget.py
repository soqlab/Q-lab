"""Error budget of a circuit, from its real gate counts and recorded or stated error rates.

Gate counts, depth and qubit count come from parsing the circuit (a stored run's QASM, or QASM
the caller sends). Error rates come from the run's recorded calibration (averages) or from values
the caller states; nothing is filled in from a table of typical devices. A component whose inputs
are missing is left out and listed in `missing_inputs`. Each component is the standard first-order
estimate: gates x error per gate, n_qubits x (1 - exp(-t/T1)) and (1 - exp(-t/T2))/2 with
t = depth x gate time, and n_qubits x readout error.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..calibration_history import calibration_metric
from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/error-budget", tags=["error-budget"])

FT_THRESHOLD = 0.01  # a commonly quoted surface-code threshold, for orientation only


class ErrorComponent(BaseModel):
    name: str
    category: str
    contribution_pct: float
    absolute_error: float
    description: str
    mitigatable: bool
    mitigation_strategy: str


class ErrorBudgetReport(BaseModel):
    report_id: str
    created_at: str
    circuit_name: str
    run_id: Optional[str]
    n_qubits: int
    circuit_depth: int
    n_1q_gates: int
    n_2q_gates: int
    backend: Optional[str]
    total_error: float
    infidelity: float
    measured_fidelity: Optional[float]
    components: list[ErrorComponent]
    gate_error_total: float
    decoherence_total: Optional[float]
    measurement_total: Optional[float]
    dominant_error: Optional[str]
    fault_tolerant_threshold: float
    below_ft_threshold: bool
    inputs_used: dict
    missing_inputs: list[str]
    recommendations: list[str]


class BudgetRequest(BaseModel):
    run_id: Optional[str] = None
    qasm: Optional[str] = None
    circuit_name: str = "circuit"
    backend: Optional[str] = None
    measured_fidelity: Optional[float] = None
    single_q_error_rate: Optional[float] = None
    two_q_error_rate: Optional[float] = None
    t1_us: Optional[float] = None
    t2_us: Optional[float] = None
    gate_time_ns: Optional[float] = None
    readout_error: Optional[float] = None


def _counts(qasm: str) -> tuple[int, int, int, int]:
    from ..local_sim import _parse

    try:
        c = _parse(qasm)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    gates = [i for i in c.data if i.operation.name not in ("measure", "barrier", "reset")]
    n2 = sum(1 for i in gates if len(i.qubits) >= 2)
    depth = c.depth(filter_function=lambda i: i.operation.name not in ("measure", "barrier"))
    return c.num_qubits, depth, len(gates) - n2, n2


@router.post("/analyze", response_model=ErrorBudgetReport)
def analyze(req: BudgetRequest, db: Session = Depends(get_db)):
    qasm, cal, backend, sources = req.qasm, {}, req.backend, {}
    if req.run_id:
        run = db.scalar(select(Run).where(Run.run_id == req.run_id))
        if run is None:
            raise HTTPException(404, f"Run {req.run_id} not found")
        qasm = qasm or run.qasm
        cal = run.calibration or {}
        backend = backend or run.backend
    if not qasm:
        raise HTTPException(422, "Give a run with a stored circuit, or the circuit's QASM.")
    n_qubits, depth, n1, n2 = _counts(qasm)

    def pick(stated: Optional[float], metric: Optional[str], name: str) -> Optional[float]:
        if stated is not None:
            sources[name] = "stated"
            return stated
        value = calibration_metric(cal, metric) if metric else None
        if value is not None:
            sources[name] = "run calibration (average)"
        return value

    p1 = pick(req.single_q_error_rate, None, "single_q_error_rate")
    p2 = pick(req.two_q_error_rate, None, "two_q_error_rate")
    if p1 is None and p2 is None:
        avg = pick(None, "avg_gate_error", "gate_error")
        if avg is not None:
            p1 = p2 = avg  # one recorded average, applied to every gate
    t1 = pick(req.t1_us, "avg_t1_us", "t1_us")
    t2 = pick(req.t2_us, "avg_t2_us", "t2_us")
    ro = pick(req.readout_error, "avg_readout_error", "readout_error")
    gt = req.gate_time_ns

    comps: list[tuple[str, str, float, str, bool, str]] = []
    missing: list[str] = []
    if p1 is not None:
        comps.append(("Single-qubit gates", "gate", n1 * p1, f"{n1} gates x {p1:.2e}", True, "Gate fusion, ZNE"))
    else:
        missing.append("single_q_error_rate")
    if p2 is not None:
        comps.append(("Two-qubit gates", "gate", n2 * p2, f"{n2} gates x {p2:.2e}", True, "Fewer two-qubit gates, ZNE"))
    else:
        missing.append("two_q_error_rate")
    if gt is not None and (t1 or t2):
        t = depth * gt * 1e-9
        if t1:
            comps.append(("T1 relaxation", "decoherence", n_qubits * (1 - math.exp(-t / (t1 * 1e-6))),
                          f"{t * 1e9:.0f} ns of circuit vs T1 = {t1:.0f} us", True, "Shorter circuits, dynamical decoupling"))
        if t2:
            comps.append(("T2 dephasing", "decoherence", n_qubits * (1 - math.exp(-t / (t2 * 1e-6))) * 0.5,
                          f"{t * 1e9:.0f} ns of circuit vs T2 = {t2:.0f} us", True, "Echo sequences, dynamical decoupling"))
    else:
        if gt is None:
            missing.append("gate_time_ns")
        if not (t1 or t2):
            missing.append("t1_us/t2_us")
    if ro is not None:
        comps.append(("Readout errors", "measurement", n_qubits * ro, f"{n_qubits} qubits x {ro:.2%}", True,
                      "Readout calibration matrix"))
    else:
        missing.append("readout_error")

    total = sum(c[2] for c in comps)
    components = [ErrorComponent(name=n, category=cat, absolute_error=round(e, 8),
                                 contribution_pct=round(e / total * 100, 2) if total else 0.0,
                                 description=d, mitigatable=m, mitigation_strategy=s)
                  for n, cat, e, d, m, s in comps]
    dominant = max(components, key=lambda c: c.absolute_error) if components else None
    infidelity = 1 - math.exp(-total)
    recs = []
    if dominant:
        recs.append(f"Largest estimated contribution: {dominant.name} ({dominant.contribution_pct:.1f}%).")
    if missing:
        recs.append("Not estimated for lack of inputs: " + ", ".join(missing) + ".")
    if req.measured_fidelity is not None and components:
        recs.append(f"Estimated fidelity {1 - infidelity:.4f} vs measured {req.measured_fidelity:.4f}.")
    decoh = [c.absolute_error for c in components if c.category == "decoherence"]
    meas = [c.absolute_error for c in components if c.category == "measurement"]
    return ErrorBudgetReport(
        report_id=str(uuid.uuid4()), created_at=datetime.now(timezone.utc).isoformat(),
        circuit_name=req.circuit_name, run_id=req.run_id, n_qubits=n_qubits, circuit_depth=depth,
        n_1q_gates=n1, n_2q_gates=n2, backend=backend, total_error=round(total, 8),
        infidelity=round(infidelity, 8), measured_fidelity=req.measured_fidelity, components=components,
        gate_error_total=round(sum(c.absolute_error for c in components if c.category == "gate"), 8),
        decoherence_total=round(sum(decoh), 8) if decoh else None,
        measurement_total=round(sum(meas), 8) if meas else None,
        dominant_error=dominant.name if dominant else None, fault_tolerant_threshold=FT_THRESHOLD,
        below_ft_threshold=infidelity < FT_THRESHOLD, inputs_used=sources, missing_inputs=missing,
        recommendations=recs,
    )
