"""Cross-backend comparison of the user's own recorded runs of one circuit.

Q-Lab does not run anything here. It takes runs the user already captured (the same circuit on
different backends), and compares the counts each backend actually returned:

  - total variation distance (TVD) between every pair of runs;
  - when the run stores its circuit, the TVD and Hellinger fidelity of each run's counts to the
    exact ideal distribution of that circuit (statevector simulation).

GET lists groups of the user's runs that share a circuit and span at least two backends. Runs
without recorded counts are reported, never filled in.
"""
from __future__ import annotations

import hashlib
import math
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..local_sim import ideal_probabilities
from ..models import Run

router = APIRouter(prefix="/api/v1/cross-backend", tags=["cross_backend"])

SOURCE = ("Counts recorded with your runs. Ideal distribution, where shown, from an exact statevector "
          "simulation of the run's stored circuit.")


def circuit_key(run: Run) -> Optional[str]:
    """Identifies the circuit: the SDK's QASM hash, else a hash of the stored QASM."""
    fp = run.fingerprint if isinstance(run.fingerprint, dict) else {}
    if fp.get("qasm_sha256"):
        return str(fp["qasm_sha256"])
    if run.qasm:
        return hashlib.sha256(run.qasm.encode("utf-8")).hexdigest()
    return None


def _distribution(counts: dict[str, Any]) -> dict[str, float]:
    clean = {str(k).replace(" ", ""): float(v) for k, v in counts.items() if float(v) > 0}
    total = sum(clean.values())
    return {k: v / total for k, v in clean.items()} if total > 0 else {}


def tvd(p: dict[str, float], q: dict[str, float]) -> float:
    return 0.5 * sum(abs(p.get(k, 0.0) - q.get(k, 0.0)) for k in set(p) | set(q))


def hellinger_fidelity(p: dict[str, float], q: dict[str, float]) -> float:
    return sum(math.sqrt(p[k] * q[k]) for k in set(p) & set(q)) ** 2


class CompareRequest(BaseModel):
    run_ids: list[str] = Field(min_length=2, max_length=12)


@router.post("")
def compare_runs(req: CompareRequest, db: Session = Depends(get_db)):
    run_ids = list(dict.fromkeys(req.run_ids))
    if len(run_ids) < 2:
        raise HTTPException(status_code=422, detail="Choose at least two different runs.")
    found = {r.run_id: r for r in db.scalars(select(Run).where(Run.run_id.in_(run_ids)))}
    missing = [rid for rid in run_ids if rid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Run(s) not found: {', '.join(missing)}")

    rows, dists, skipped, warnings = [], {}, [], []
    ideal_cache: dict[str, Optional[dict[str, float]]] = {}
    for rid in run_ids:
        run = found[rid]
        dist = _distribution((run.results or {}).get("counts") or {})
        if not dist:
            skipped.append({"run_id": rid, "reason": "The run has no recorded counts."})
            continue
        dists[rid] = dist
        key = circuit_key(run)
        ideal = None
        if run.qasm and key:
            if key not in ideal_cache:
                try:
                    ideal_cache[key] = ideal_probabilities(run.qasm)
                except ValueError as exc:
                    ideal_cache[key] = None
                    warnings.append(f"No ideal distribution for run {rid}: {exc}")
            ideal = ideal_cache[key]
        shots = sum(int(v) for v in ((run.results or {}).get("counts") or {}).values())
        rows.append({
            "run_id": rid,
            "backend": run.backend,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "circuit_key": key,
            "shots": shots,
            "top_bitstring": max(dist, key=lambda k: dist[k]),
            "tvd_to_ideal": None if ideal is None else round(tvd(dist, ideal), 6),
            "hellinger_fidelity_to_ideal": None if ideal is None else round(hellinger_fidelity(dist, ideal), 6),
        })

    keys = {r["circuit_key"] for r in rows}
    same_circuit = len(keys) == 1 and None not in keys
    if not same_circuit and len(rows) > 1:
        warnings.append("These runs are not all of the same circuit, so their outputs need not agree.")

    pairwise = [
        {"run_a": a["run_id"], "run_b": b["run_id"], "tvd": round(tvd(dists[a["run_id"]], dists[b["run_id"]]), 6)}
        for i, a in enumerate(rows) for b in rows[i + 1:]
    ]
    scored = [r for r in rows if r["hellinger_fidelity_to_ideal"] is not None]
    best = max(scored, key=lambda r: r["hellinger_fidelity_to_ideal"]) if scored else None
    return {
        "same_circuit": same_circuit,
        "runs": rows,
        "skipped": skipped,
        "pairwise_tvd": pairwise,
        "best_by_fidelity": None if best is None else {"run_id": best["run_id"], "backend": best["backend"]},
        "warnings": warnings,
        "source": SOURCE,
    }


@router.get("")
def list_comparable(limit: int = 1000, db: Session = Depends(get_db)):
    """Your circuits that have recorded runs on two or more backends."""
    runs = db.scalars(select(Run).order_by(Run.created_at.desc()).limit(max(1, min(limit, 5000))))
    groups: dict[str, dict] = {}
    for run in runs:
        key = circuit_key(run)
        if not key or not run.backend or not (run.results or {}).get("counts"):
            continue
        g = groups.setdefault(key, {"circuit_key": key, "circuit_name": run.circuit_name,
                                    "backends": [], "run_ids": [], "latest_at": None})
        g["run_ids"].append(run.run_id)
        if run.backend not in g["backends"]:
            g["backends"].append(run.backend)
        if g["latest_at"] is None and run.created_at:
            g["latest_at"] = run.created_at.isoformat()
        g["circuit_name"] = g["circuit_name"] or run.circuit_name
    return {
        "source": SOURCE,
        "groups": [g for g in groups.values() if len(g["backends"]) >= 2],
    }
