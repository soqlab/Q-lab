"""Gate Characterization — per-qubit T1, T2, single-gate RB.

Ingest time-series calibration data and fit exponential decay curves:
  T1 decay:  P(|0>) = A·exp(-t/T1) + B
  T2 decay:  P(|+>) = A·exp(-t/T2)·cos(2π·f·t + φ) + B
  RB decay:  F(m) = A·p^m + B    where EPC = (1-p)·(1 - 1/2^n) / 1

Results are stored per (backend, qubit, char_type) and can be visualized
as decay curves + tracked over time.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import GateCharResult

router = APIRouter(prefix="/api/v1/gate-char", tags=["gate_char"])


# ─────────────────────────────────────────────────────────────────────────────
# Curve fitting helpers (pure Python, no scipy)
# ─────────────────────────────────────────────────────────────────────────────

def _linreg(xs: list[float], ys: list[float]) -> tuple[float, float]:
    n = len(xs)
    if n < 2:
        return 0.0, ys[0] if ys else 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs) or 1e-9
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    b = sxy / sxx
    a = my - b * mx
    return b, a


def _fit_t1(times_us: list[float], probs: list[float]) -> dict[str, float]:
    """Fit P = A·exp(-t/T1) + B via log-linear regression."""
    pairs = [(t, p) for t, p in zip(times_us, probs) if p > 0.01]
    if len(pairs) < 2:
        return {"T1_us": 100.0, "A": 1.0, "B": 0.0, "r2": 0.0}
    log_p = [math.log(p) for _, p in pairs]
    ts = [t for t, _ in pairs]
    slope, intercept = _linreg(ts, log_p)
    t1 = -1 / slope if slope < -1e-9 else 999.0
    a = math.exp(intercept)
    # R²
    mean_lp = sum(log_p) / len(log_p)
    ss_tot = sum((v - mean_lp) ** 2 for v in log_p)
    ss_res = sum((v - (intercept + slope * t)) ** 2 for t, v in zip(ts, log_p))
    r2 = 1 - ss_res / max(ss_tot, 1e-9)
    return {"T1_us": round(min(t1, 9999.0), 2), "A": round(a, 4), "B": 0.0, "r2": round(max(r2, 0.0), 4)}


def _fit_t2(times_us: list[float], probs: list[float]) -> dict[str, float]:
    """Fit T2 via envelope: log|P - 0.5| = log(A) - t/T2."""
    pairs = [(t, abs(p - 0.5)) for t, p in zip(times_us, probs) if abs(p - 0.5) > 0.01]
    if len(pairs) < 2:
        return {"T2_us": 80.0, "A": 0.5, "B": 0.5, "r2": 0.0}
    log_amp = [math.log(amp) for _, amp in pairs]
    ts = [t for t, _ in pairs]
    slope, intercept = _linreg(ts, log_amp)
    t2 = -1 / slope if slope < -1e-9 else 999.0
    return {"T2_us": round(min(t2, 9999.0), 2), "A": round(math.exp(intercept), 4), "B": 0.5, "r2": 0.0}


def _fit_rb(gate_counts: list[int], fidelities: list[float], n_qubits: int = 1) -> dict[str, float]:
    """Fit RB decay F = A·p^m + B, return p and EPC."""
    if len(gate_counts) < 2:
        return {"p": 0.99, "A": 0.5, "B": 0.5, "EPC": 0.005, "gate_fidelity": 0.995}
    log_f = [math.log(max(f - 0.5, 0.001)) for f in fidelities]
    xs = [float(m) for m in gate_counts]
    slope, intercept = _linreg(xs, log_f)
    p = math.exp(slope) if slope < 0 else 0.99
    p = max(0.0, min(1.0, p))
    epc = (1 - p) * (1 - 1 / 2 ** n_qubits)
    return {
        "p": round(p, 6),
        "A": round(math.exp(intercept), 4),
        "B": 0.5,
        "EPC": round(epc, 6),
        "gate_fidelity": round(1 - epc, 6),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class CurvePoint(BaseModel):
    x: float   # time (µs for T1/T2) or gate count (RB)
    y: float   # measured probability


class GateCharRequest(BaseModel):
    backend: str
    char_type: str = Field(..., description="t1 | t2 | rb_single | rb_two")
    qubit: Optional[int] = None
    qubit_pair: Optional[list[int]] = None
    gate: Optional[str] = None
    curve_data: list[CurvePoint]
    n_qubits: int = Field(default=1, ge=1, le=10)
    run_id: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Serializer
# ─────────────────────────────────────────────────────────────────────────────

def _to_dict(r: GateCharResult) -> dict:
    return {
        "char_id": r.char_id,
        "backend": r.backend,
        "char_type": r.char_type,
        "qubit": r.qubit,
        "qubit_pair": r.qubit_pair,
        "gate": r.gate,
        "curve_data": r.curve_data,
        "fit_params": r.fit_params,
        "metric_value": r.metric_value,
        "metric_unit": r.metric_unit,
        "run_id": r.run_id,
        "created_at": r.created_at.isoformat(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def characterize(req: GateCharRequest, db: Session = Depends(get_db)):
    """Submit curve data, fit the model, store the result."""
    xs = [p.x for p in req.curve_data]
    ys = [p.y for p in req.curve_data]

    if req.char_type == "t1":
        fit = _fit_t1(xs, ys)
        metric, unit = fit["T1_us"], "us"
    elif req.char_type == "t2":
        fit = _fit_t2(xs, ys)
        metric, unit = fit["T2_us"], "us"
    elif req.char_type in ("rb_single", "rb_two"):
        gate_counts = [int(x) for x in xs]
        fit = _fit_rb(gate_counts, ys, req.n_qubits)
        metric, unit = fit["EPC"], "epc"
    else:
        raise HTTPException(422, f"Unknown char_type '{req.char_type}'")

    row = GateCharResult(
        char_id=f"gc-{uuid.uuid4().hex[:12]}",
        backend=req.backend,
        char_type=req.char_type,
        qubit=req.qubit,
        qubit_pair=req.qubit_pair,
        gate=req.gate,
        curve_data=[{"x": p.x, "y": p.y} for p in req.curve_data],
        fit_params=fit,
        metric_value=metric,
        metric_unit=unit,
        run_id=req.run_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_dict(row)


@router.get("")
def list_results(
    backend: Optional[str] = None,
    char_type: Optional[str] = None,
    qubit: Optional[int] = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    q = select(GateCharResult).order_by(GateCharResult.created_at.desc())
    if backend:
        q = q.where(GateCharResult.backend == backend)
    if char_type:
        q = q.where(GateCharResult.char_type == char_type)
    if qubit is not None:
        q = q.where(GateCharResult.qubit == qubit)
    return [_to_dict(r) for r in db.scalars(q.limit(limit)).all()]


@router.get("/trend/{backend}/{char_type}")
def trend(backend: str, char_type: str, qubit: Optional[int] = None, limit: int = 30, db: Session = Depends(get_db)):
    """Time series of a metric (T1/T2/EPC) per qubit."""
    q = (select(GateCharResult)
         .where(GateCharResult.backend == backend, GateCharResult.char_type == char_type)
         .order_by(GateCharResult.created_at.asc()))
    if qubit is not None:
        q = q.where(GateCharResult.qubit == qubit)
    rows = db.scalars(q.limit(limit)).all()
    return {
        "backend": backend,
        "char_type": char_type,
        "qubit": qubit,
        "series": [{"date": r.created_at.isoformat(), "value": r.metric_value,
                    "unit": r.metric_unit, "char_id": r.char_id, "qubit": r.qubit} for r in rows],
    }


@router.get("/summary/{backend}")
def backend_summary(backend: str, db: Session = Depends(get_db)):
    """Latest T1/T2/EPC for each qubit on a backend."""
    rows = db.scalars(
        select(GateCharResult)
        .where(GateCharResult.backend == backend)
        .order_by(GateCharResult.created_at.desc())
        .limit(200)
    ).all()

    # Group by (qubit, char_type) — take latest
    seen: dict[tuple, dict] = {}
    for r in rows:
        key = (r.qubit, r.char_type)
        if key not in seen:
            seen[key] = _to_dict(r)
    return {"backend": backend, "qubits": list(seen.values())}


@router.get("/{char_id}")
def get_result(char_id: str, db: Session = Depends(get_db)):
    r = db.scalar(select(GateCharResult).where(GateCharResult.char_id == char_id))
    if r is None:
        raise HTTPException(404, "Characterization result not found")
    return _to_dict(r)
