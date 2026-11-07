"""Cross-entropy benchmarking of the user's recorded runs.

For each run, the counts recorded with it are scored against the exact ideal distribution of the
run's stored circuit (statevector simulation): linear XEB with its standard error under the
uniform-noise null, and the heavy output probability next to its ideal value. Nothing is sampled
or assumed about the device. See app/xeb_stats.py for the definitions.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..local_sim import ideal_probabilities
from ..models import Run
from ..xeb_stats import heavy_output_probability, linear_xeb

router = APIRouter(prefix="/api/v1/xeb", tags=["xeb"])

SOURCE = ("Counts recorded with your runs, scored against exact ideal probabilities from a "
          "statevector simulation of each run's stored circuit.")


class XEBRequest(BaseModel):
    run_ids: list[str] = Field(min_length=1, max_length=50)


def _score(run: Run) -> dict:
    counts = (run.results or {}).get("counts") or {}
    if not run.qasm:
        raise ValueError("The run has no stored circuit (QASM), so its ideal distribution is unknown.")
    if not counts:
        raise ValueError("The run has no recorded counts.")
    ideal = ideal_probabilities(run.qasm)
    n_bits = len(next(iter(ideal)))
    xeb, se, shots = linear_xeb(counts, ideal, n_bits)
    hop, ideal_hop = heavy_output_probability(counts, ideal, n_bits)
    return {
        "run_id": run.run_id, "backend": run.backend, "n_bits": n_bits, "shots": shots,
        "linear_xeb": round(xeb, 6),
        "null_std_error": round(se, 6),
        "heavy_output_probability": round(hop, 6),
        "ideal_heavy_output_probability": round(ideal_hop, 6),
    }


@router.post("")
def run_xeb(req: XEBRequest, db: Session = Depends(get_db)):
    run_ids = list(dict.fromkeys(req.run_ids))
    found = {r.run_id: r for r in db.scalars(select(Run).where(Run.run_id.in_(run_ids)))}
    missing = [rid for rid in run_ids if rid not in found]
    if missing:
        raise HTTPException(status_code=404, detail=f"Run(s) not found: {', '.join(missing)}")
    runs, skipped = [], []
    for rid in run_ids:
        try:
            runs.append(_score(found[rid]))
        except ValueError as exc:
            skipped.append({"run_id": rid, "reason": str(exc)})
    total = sum(r["shots"] for r in runs)
    return {
        "runs": runs,
        "skipped": skipped,
        "linear_xeb": round(sum(r["linear_xeb"] * r["shots"] for r in runs) / total, 6) if runs else None,
        "heavy_output_probability": round(sum(r["heavy_output_probability"] * r["shots"] for r in runs) / total, 6)
        if runs else None,
        "source": SOURCE,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
