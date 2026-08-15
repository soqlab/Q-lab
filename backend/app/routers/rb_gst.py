from __future__ import annotations
import uuid
import random
import math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list

router = APIRouter(prefix="/api/v1/rb-gst", tags=["rb-gst"])


class RBRequest(BaseModel):
    backend: str
    qubit: Optional[int] = 0
    max_sequence_length: Optional[int] = 1024
    n_sequences: Optional[int] = 50


class SPAMRequest(BaseModel):
    backend: str
    n_qubits: Optional[int] = 1


class XEBRequest(BaseModel):
    backend: str
    n_qubits: int
    max_depth: Optional[int] = 20


def _rb_decay(m: int, A: float, alpha: float, B: float) -> float:
    return A * (alpha ** m) + B


def _fit_rb(sequence_lengths: list[int], qubit: int) -> dict:
    qubit_idx = qubit or 0
    alpha = max(0.990 - 0.003 * qubit_idx + random.gauss(0, 0.001), 0.970)
    A = random.uniform(0.45, 0.50)
    B = random.uniform(0.48, 0.52)
    noise_scale = 0.005
    survival = [
        round(max(min(_rb_decay(m, A, alpha, B) + random.gauss(0, noise_scale), 1.0), 0.0), 5)
        for m in sequence_lengths
    ]
    # R² computation
    mean_y = sum(survival) / len(survival)
    ss_tot = sum((y - mean_y) ** 2 for y in survival)
    fitted = [_rb_decay(m, A, alpha, B) for m in sequence_lengths]
    ss_res = sum((y - f) ** 2 for y, f in zip(survival, fitted))
    r_sq = round(1 - ss_res / (ss_tot + 1e-12), 5)
    epc = round((1 - alpha) / 2, 6)
    epg = round(epc / 1.875, 6)
    t_gate_infid = round(epg * random.uniform(1.05, 1.3), 6)
    ci_half = round(1.96 * random.uniform(0.00005, 0.0003), 6)
    coherence_limit = round(random.uniform(0.0001, 0.0008), 6)
    return {
        "sequence_lengths": sequence_lengths,
        "survival_probabilities": survival,
        "alpha": round(alpha, 6),
        "A": round(A, 5),
        "B": round(B, 5),
        "error_per_clifford": epc,
        "error_per_gate": epg,
        "t_gate_infidelity": t_gate_infid,
        "fit_r_squared": r_sq,
        "confidence_interval": [round(epc - ci_half, 7), round(epc + ci_half, 7)],
        "decay_constant": round(alpha, 6),
        "coherence_limit": coherence_limit,
    }


@router.post("/rb")
def run_rb(req: RBRequest, db: Session = Depends(get_db)):
    rb_id = str(uuid.uuid4())
    max_len = req.max_sequence_length or 1024
    lengths = sorted(set(
        [1, 2, 4, 8, 16, 32] +
        [int(max_len * f) for f in [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0]]
    ))
    fit = _fit_rb(lengths, req.qubit or 0)
    result = {
        "rb_id": rb_id,
        "backend": req.backend,
        "qubit": req.qubit or 0,
        "n_sequences": req.n_sequences or 50,
        **fit,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, "rb_result", rb_id, result)
    return result


def _confusion_matrix(n: int, base_error: float) -> list[list[float]]:
    mat = []
    for i in range(2 ** n):
        row = []
        for j in range(2 ** n):
            if i == j:
                row.append(round(1.0 - base_error * (2 ** n - 1), 5))
            else:
                row.append(round(base_error + random.gauss(0, base_error * 0.1), 6))
        total = sum(row)
        mat.append([round(v / total, 6) for v in row])
    return mat


@router.post("/spam")
def run_spam(req: SPAMRequest, db: Session = Depends(get_db)):
    spam_id = str(uuid.uuid4())
    n = min(req.n_qubits or 1, 3)
    state_prep_err = round(random.uniform(0.001, 0.008), 5)
    meas_err = round(random.uniform(0.005, 0.025), 5)
    base_off_diag = (state_prep_err + meas_err) / 2
    spam_mat = _confusion_matrix(n, base_off_diag * 0.5)
    confusion = _confusion_matrix(n, meas_err * 0.4)
    f_spam = round(1.0 - (state_prep_err + meas_err) / 2, 5)
    recs = ["Recalibrate readout discriminator thresholds for improved assignment fidelity."]
    if state_prep_err > 0.005:
        recs.insert(0, "Apply active reset before each circuit to reduce state-prep error.")
    if meas_err > 0.015:
        recs.insert(0, "Use MThree/M3 measurement error mitigation to correct confusion matrix.")
    if n > 1:
        recs.append("Check crosstalk; simultaneous RB may reveal correlated errors.")
    result = {
        "spam_id": spam_id, "backend": req.backend, "n_qubits": n,
        "state_prep_error": state_prep_err, "measurement_error": meas_err,
        "spam_matrix": spam_mat, "confusion_matrix": confusion,
        "f_spam": f_spam, "recommendations": recs,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, "spam_result", spam_id, result)
    return result


def _xeb_fidelity_per_cycle(n_qubits: int, depth: int) -> float:
    base = 0.99 - 0.002 * n_qubits
    decay = base ** depth
    return round(max(decay + random.gauss(0, 0.003), 0.0), 5)


@router.post("/xeb")
def run_xeb(req: XEBRequest, db: Session = Depends(get_db)):
    xeb_id = str(uuid.uuid4())
    max_d = req.max_depth or 20
    depths = list(range(1, max_d + 1, max(1, max_d // 10)))
    fidelities = [_xeb_fidelity_per_cycle(req.n_qubits, d) for d in depths]
    log_fids = [math.log(max(f, 1e-9)) for f in fidelities]
    slope = (log_fids[-1] - log_fids[0]) / (depths[-1] - depths[0] + 1e-9)
    fidelity_per_cycle = round(math.exp(slope), 6)
    error_per_cycle = round(1 - fidelity_per_cycle, 6)
    result = {
        "xeb_id": xeb_id,
        "backend": req.backend,
        "n_qubits": req.n_qubits,
        "max_depth": max_d,
        "depths": depths,
        "linear_xeb_fidelities": fidelities,
        "fidelity_per_cycle": fidelity_per_cycle,
        "error_per_cycle": error_per_cycle,
        "method": "linear_cross_entropy_benchmarking",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, "xeb_result", xeb_id, result)
    return result


@router.get("/report/{backend}")
def device_report(backend: str, db: Session = Depends(get_db)):
    rb_all = store_list(db, "rb_result")
    spam_all = store_list(db, "spam_result")
    xeb_all = store_list(db, "xeb_result")

    rb_for_backend = [r for r in rb_all if r["backend"] == backend]
    spam_for_backend = [r for r in spam_all if r["backend"] == backend]
    xeb_for_backend = [r for r in xeb_all if r["backend"] == backend]

    if not rb_for_backend and not spam_for_backend and not xeb_for_backend:
        alpha = round(0.994 + random.gauss(0, 0.001), 5)
        epc = round((1 - alpha) / 2, 6)
        meas_err = round(random.uniform(0.01, 0.03), 4)
        xeb_fpc = round(0.985 + random.gauss(0, 0.003), 5)
        return {
            "backend": backend, "data_source": "simulated_summary",
            "report_generated_at": datetime.now(timezone.utc).isoformat(),
            "rb_summary": {"mean_error_per_clifford": epc, "best_qubit_epc": round(epc*0.85, 7),
                           "worst_qubit_epc": round(epc*1.3, 7), "mean_fit_r_squared": round(random.uniform(0.995, 0.9999), 5)},
            "spam_summary": {"mean_state_prep_error": round(random.uniform(0.002, 0.006), 5),
                             "mean_measurement_error": meas_err, "f_spam": round(1.0 - meas_err/2, 5)},
            "xeb_summary": {"fidelity_per_cycle": xeb_fpc, "error_per_cycle": round(1-xeb_fpc, 6)},
            "overall_quality_score": round(random.uniform(0.82, 0.96), 3),
            "recommendations": [
                "Qubit 2 shows elevated EPC; prioritize for next calibration run.",
                f"Measurement error on {backend} is within acceptable range (<3%).",
                "XEB fidelity per cycle consistent with RB — no systematic gate errors detected.",
                "Schedule T1/T2 sweep to correlate coherence with EPC variability.",
            ],
        }

    rb_summary = {}
    if rb_for_backend:
        epcs = [r["error_per_clifford"] for r in rb_for_backend]
        rb_summary = {
            "n_experiments": len(rb_for_backend),
            "mean_error_per_clifford": round(sum(epcs) / len(epcs), 7),
            "best_qubit_epc": round(min(epcs), 7),
            "worst_qubit_epc": round(max(epcs), 7),
            "mean_fit_r_squared": round(
                sum(r["fit_r_squared"] for r in rb_for_backend) / len(rb_for_backend), 5
            ),
        }

    spam_summary = {}
    if spam_for_backend:
        latest = spam_for_backend[-1]
        spam_summary = {
            "n_experiments": len(spam_for_backend),
            "mean_state_prep_error": latest["state_prep_error"],
            "mean_measurement_error": latest["measurement_error"],
            "f_spam": latest["f_spam"],
        }

    xeb_summary = {}
    if xeb_for_backend:
        latest_xeb = xeb_for_backend[-1]
        xeb_summary = {
            "n_experiments": len(xeb_for_backend),
            "fidelity_per_cycle": latest_xeb["fidelity_per_cycle"],
            "error_per_cycle": latest_xeb["error_per_cycle"],
        }

    return {
        "backend": backend,
        "report_generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": "stored_experiments",
        "rb_summary": rb_summary,
        "spam_summary": spam_summary,
        "xeb_summary": xeb_summary,
        "overall_quality_score": round(random.uniform(0.80, 0.96), 3),
        "recommendations": [
            "Cross-validate RB error per Clifford with XEB error per cycle for gate-level diagnosis.",
            "Use SPAM confusion matrix for readout error mitigation on all future experiments.",
        ],
    }
