"""ZX-Calculus Circuit Simplification — Feature #6.

Attempts to simplify a run's QASM circuit using pyzx full_reduce (primary)
with a fallback to Qiskit transpile at optimization_level=3.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["zx_simplify"])


# ---------------------------------------------------------------------------
# Simplification backends
# ---------------------------------------------------------------------------

def _simplify_pyzx(qasm: str) -> dict:
    import pyzx as zx  # type: ignore

    circuit = zx.Circuit.from_qasm(qasm)
    orig_t = sum(1 for g in circuit.gates if g.name in ("T", "Tdg"))
    graph = circuit.to_graph()
    zx.simplify.full_reduce(graph)
    c2 = zx.extract_circuit(graph)
    c2.to_basic_gates()
    new_t = sum(1 for g in c2.gates if g.name in ("T", "Tdg"))
    return {
        "simplified_qasm":       c2.to_qasm(),
        "original_t_count":      orig_t,
        "simplified_t_count":    new_t,
        "t_count_reduction":     orig_t - new_t,
        "reduction_pct":         round((orig_t - new_t) / max(orig_t, 1) * 100, 1),
        "original_gate_count":   len(circuit.gates),
        "simplified_gate_count": len(c2.gates),
        "method":                "pyzx_full_reduce",
    }


def _simplify_qiskit(qasm: str) -> dict:
    from qiskit import qasm2, transpile  # type: ignore

    qc = qasm2.loads(qasm)
    orig_count = qc.size()
    orig_t = sum(
        1 for inst in qc.data if inst.operation.name in ("t", "tdg")
    )
    qc_opt = transpile(
        qc,
        basis_gates=["cx", "rz", "sx", "x"],
        optimization_level=3,
        seed_transpiler=42,
    )
    new_count = qc_opt.size()
    new_t = sum(
        1 for inst in qc_opt.data
        if inst.operation.name in ("t", "tdg", "rz")
    )

    simplified_qasm: str | None = None
    try:
        simplified_qasm = qasm2.dumps(qc_opt) if hasattr(qasm2, "dumps") else None
    except Exception:
        pass

    return {
        "simplified_qasm":       simplified_qasm,
        "original_t_count":      orig_t,
        "simplified_t_count":    new_t,
        "t_count_reduction":     max(0, orig_t - new_t),
        "reduction_pct":         round(max(0, orig_t - new_t) / max(orig_t, 1) * 100, 1),
        "original_gate_count":   orig_count,
        "simplified_gate_count": new_count,
        "method":                "qiskit_transpiler_opt3",
    }


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/runs/{run_id}/zx-simplify")
def zx_simplify(run_id: str, db: Session = Depends(get_db)):
    """Simplify a run's circuit using ZX-calculus (pyzx) or Qiskit transpiler.

    Returns T-count reduction stats and the simplified QASM when available.
    """
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")

    has_qasm = bool(run.qasm)

    if not has_qasm:
        return {
            "run_id":   run_id,
            "has_qasm": False,
            "error":    "No QASM stored for this run — simplification requires circuit source.",
        }

    qasm = run.qasm

    # Try pyzx first
    pyzx_error: str | None = None
    try:
        result = _simplify_pyzx(qasm)
        return {"run_id": run_id, "has_qasm": True, "saved_to_run": False, **result}
    except ImportError:
        pyzx_error = "pyzx not installed"
    except Exception as exc:
        pyzx_error = str(exc)

    # Fallback: Qiskit
    qiskit_error: str | None = None
    try:
        result = _simplify_qiskit(qasm)
        return {"run_id": run_id, "has_qasm": True, "saved_to_run": False, **result}
    except ImportError:
        qiskit_error = "qiskit not installed"
    except Exception as exc:
        qiskit_error = str(exc)

    raise HTTPException(
        501,
        {
            "detail":       "No simplification backend available.",
            "pyzx_error":   pyzx_error,
            "qiskit_error": qiskit_error,
        },
    )
