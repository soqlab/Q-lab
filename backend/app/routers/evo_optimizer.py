"""Circuit optimiser for a stored run: real transpiled variants of the run's own circuit.

The run's stored QASM is transpiled with Qiskit at optimization levels 0 to 3 and several
transpiler seeds (no target device, so the gate set is kept). Every candidate is a circuit that
was actually produced, and its depth, size, two-qubit count and non-Clifford ratio are measured
on it. Candidates are ranked by a fixed weighted score of those four figures (_W below) relative
to the original circuit. Nothing is randomised beyond the transpiler seed, which is reported.

The route keeps its old name and query parameters: `generations` caps how many seeds are tried
per level and `pop_size` how many candidates come back.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1", tags=["evo_optimizer"])

# Weights of the ranking score (sum to 1).
_W = {"depth": 0.30, "size": 0.25, "nc": 0.25, "cx": 0.20}
_TWO_QUBIT_MIN = 2


def _figures(circuit) -> dict:
    from qiskit.quantum_info import Clifford

    def clifford(op) -> bool:
        try:
            Clifford(op)
            return True
        except Exception:
            return False

    gates = [i for i in circuit.data if i.operation.name not in ("measure", "barrier", "reset")]
    non_clifford = sum(1 for i in gates if not clifford(i.operation))
    return {
        "num_qubits": circuit.num_qubits,
        "depth": circuit.depth(filter_function=lambda i: i.operation.name not in ("measure", "barrier")),
        "size": len(gates),
        "cx_count": sum(1 for i in gates if len(i.qubits) >= _TWO_QUBIT_MIN),
        "non_clifford_ratio": round(non_clifford / len(gates), 4) if gates else 0.0,
    }


def _score(ind: dict, base: dict) -> float:
    """Weighted improvement over the original, per figure 1 - value/original (0 = no change)."""
    def rel(key: str) -> float:
        b = float(base[key])
        return 0.0 if b <= 0 else 1.0 - float(ind[key]) / b
    return round(_W["depth"] * rel("depth") + _W["size"] * rel("size")
                 + _W["nc"] * rel("non_clifford_ratio") + _W["cx"] * rel("cx_count"), 4)


@router.get("/runs/{run_id}/evo-optimize")
def evo_optimize(
    run_id: str,
    generations: int = Query(default=20, ge=1, le=100, description="Transpiler seeds to try per level (at most 8 used)"),
    pop_size: int = Query(default=8, ge=1, le=32, description="Candidates to return (at most 5 distinct)"),
    seed: int = Query(default=42, description="First transpiler seed"),
    db: Session = Depends(get_db),
):
    from qiskit import qasm2, transpile

    from ..local_sim import _parse

    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(404, "Run not found")
    if not run.qasm:
        raise HTTPException(422, "The run has no stored circuit (QASM) to optimise.")
    try:
        original = _parse(run.qasm)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None

    baseline = _figures(original)
    seeds = [seed + k for k in range(min(generations, 8))]
    seen: dict[tuple, dict] = {}
    for level in range(4):
        for s in seeds:
            out = transpile(original, optimization_level=level, seed_transpiler=s)
            fig = _figures(out)
            key = (fig["depth"], fig["size"], fig["cx_count"], fig["non_clifford_ratio"])
            if key in seen:
                continue
            try:
                text = qasm2.dumps(out)
            except Exception:
                text = None
            seen[key] = {"fig": fig, "level": level, "seed": s, "qasm": text}
            if level < 2:
                break  # levels 0 and 1 do not depend on the seed without a target

    candidates = []
    for c in sorted(seen.values(), key=lambda c: _score(c["fig"], baseline), reverse=True)[:min(pop_size, 5)]:
        fig = c["fig"]
        deltas = {
            "depth": fig["depth"] - baseline["depth"],
            "size": fig["size"] - baseline["size"],
            "cx_count": fig["cx_count"] - baseline["cx_count"],
            "non_clifford_ratio": round(fig["non_clifford_ratio"] - baseline["non_clifford_ratio"], 4),
        }
        parts = [f"{label} {deltas[k]:+d}" for k, label in (("depth", "depth"), ("size", "gates"), ("cx_count", "2Q"))
                 if deltas[k] < 0]
        score = _score(fig, baseline)
        candidates.append({
            "fingerprint": fig,
            "mutations_applied": [f"optimization_level={c['level']}", f"seed_transpiler={c['seed']}"],
            "fitness": score,
            "improvement_pct": round(score * 100, 1),
            "deltas": deltas,
            "summary": ("Improvements: " + ", ".join(parts)) if parts else "No reduction over the original circuit.",
            "qasm": c["qasm"],
        })

    best = candidates[0] if candidates else None
    narrative = (
        f"Transpiled the stored circuit at optimization levels 0-3 with {len(seeds)} seed(s); "
        f"{len(seen)} distinct circuit(s) came out. "
        + (best["summary"] + f" (level and seed: {', '.join(best['mutations_applied'])})."
           if best and best["fitness"] > 0 else "None was smaller than the original.")
    )
    return {
        "run_id": run_id,
        "n_qubits": baseline["num_qubits"],
        "baseline": baseline,
        "baseline_fitness": 0.0,
        "generations": len(seeds),
        "pop_size": len(candidates),
        "seed": seed,
        "candidates": candidates,
        "narrative": narrative,
        "method": "Qiskit transpile of the run's stored circuit, optimization levels 0-3, no target device.",
        "optimized_at": datetime.now(timezone.utc).isoformat(),
    }
