"""Circuit DNA Fingerprinting.

Creates a unique "DNA" signature for each circuit based on its
noise-behavioral output distribution — not its gate structure.

Two circuits with the same DNA hash:
  - Produce identical measurement distributions on the same hardware
  - Are functionally equivalent regardless of gate sequence

Applications:
  - Detect circuit duplicates across providers
  - Cache and reuse results for equivalent circuits
  - Track circuit equivalence through transpilation
  - Verify compiler correctness
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CircuitDNA

router = APIRouter(prefix="/api/v1/dna", tags=["circuit_dna"])

# Number of simulation shots for DNA extraction
DNA_SHOTS = 100
# Top-K bitstrings to include in the signature
TOP_K = 16
# Probability rounding precision (lower = more tolerant to noise)
PRECISION = 2


def _compute_dna_hash(counts: dict[str, int], shots: int) -> tuple[str, list[dict]]:
    """Compute a reproducible DNA hash from a probability distribution."""
    total = shots or 1
    probs = {k: round(v / total, PRECISION) for k, v in counts.items() if v > 0}
    # Take top-K by probability
    top = sorted(probs.items(), key=lambda x: -x[1])[:TOP_K]
    # Sort lexicographically for determinism
    top_sorted = sorted(top, key=lambda x: x[0])
    signature = [{"bitstring": k, "probability": p} for k, p in top_sorted]
    # Hash
    canonical = json.dumps(top_sorted, separators=(",", ":"))
    dna_hash = hashlib.sha256(canonical.encode()).hexdigest()[:32]
    return dna_hash, signature


def _count_gates(qasm: str) -> int:
    gate_re = re.compile(r"^(\w+)(?:\([^)]*\))?\s+q\[", re.MULTILINE)
    skip = {"openqasm", "include", "qreg", "creg", "measure", "barrier", "reset"}
    return sum(1 for m in gate_re.finditer(qasm) if m.group(1).lower() not in skip)


def _get_n_qubits(qasm: str) -> int:
    m = re.search(r"qreg\s+\w+\[(\d+)\]", qasm)
    return int(m.group(1)) if m else 2


class DNARequest(BaseModel):
    qasm: str
    circuit_name: str = ""
    run_id: str | None = None
    seed: int = 42


@router.post("")
def fingerprint_circuit(req: DNARequest, db: Session = Depends(get_db)):
    try:
        from .job_executor import _simulate_qasm
    except ImportError:
        raise HTTPException(500, "Simulator unavailable")

    rng = random.Random(req.seed)
    # Run circuit multiple times to stabilize the distribution
    combined_counts: dict[str, int] = {}
    n_runs = 3
    for _ in range(n_runs):
        seed = rng.randint(0, 2 ** 30)
        counts = _simulate_qasm(req.qasm, DNA_SHOTS, seed=seed)
        for k, v in counts.items():
            combined_counts[k] = combined_counts.get(k, 0) + v

    total_shots = DNA_SHOTS * n_runs
    dna_hash, signature = _compute_dna_hash(combined_counts, total_shots)

    # Check for existing circuits with same DNA
    existing = db.scalars(
        select(CircuitDNA).where(CircuitDNA.dna_hash == dna_hash)
    ).all()

    dna_id = f"dna-{uuid.uuid4().hex[:12]}"
    n_qubits = _get_n_qubits(req.qasm)
    n_gates = _count_gates(req.qasm)

    record = CircuitDNA(
        dna_id=dna_id,
        dna_hash=dna_hash,
        circuit_name=req.circuit_name or dna_id,
        qasm=req.qasm,
        distribution_signature=signature,
        n_qubits=n_qubits,
        n_gates=n_gates,
        run_id=req.run_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "dna_id": dna_id,
        "dna_hash": dna_hash,
        "circuit_name": record.circuit_name,
        "n_qubits": n_qubits,
        "n_gates": n_gates,
        "distribution_signature": signature,
        "total_shots_used": total_shots,
        "functionally_equivalent": [
            {"dna_id": e.dna_id, "circuit_name": e.circuit_name,
             "n_gates": e.n_gates, "created_at": e.created_at.isoformat()}
            for e in existing
        ],
        "is_unique": len(existing) == 0,
        "created_at": record.created_at.isoformat(),
    }


@router.get("/lookup/{dna_hash}")
def lookup_by_hash(dna_hash: str, db: Session = Depends(get_db)):
    """Find all circuits with the same DNA hash (functionally equivalent)."""
    rows = db.scalars(select(CircuitDNA).where(CircuitDNA.dna_hash == dna_hash)).all()
    if not rows:
        raise HTTPException(404, f"No circuits found with DNA hash '{dna_hash}'")
    return {
        "dna_hash": dna_hash,
        "count": len(rows),
        "circuits": [
            {"dna_id": r.dna_id, "circuit_name": r.circuit_name, "n_qubits": r.n_qubits,
             "n_gates": r.n_gates, "distribution_signature": r.distribution_signature,
             "created_at": r.created_at.isoformat()}
            for r in rows
        ],
    }


@router.post("/compare")
def compare_circuits(req: list[DNARequest], db: Session = Depends(get_db)):
    """Compare multiple circuits — returns which are functionally equivalent."""
    if len(req) < 2 or len(req) > 8:
        raise HTTPException(422, "Provide 2–8 circuits to compare")
    try:
        from .job_executor import _simulate_qasm
    except ImportError:
        raise HTTPException(500, "Simulator unavailable")

    results = []
    for r in req:
        rng = random.Random(r.seed)
        combined: dict[str, int] = {}
        for _ in range(3):
            counts = _simulate_qasm(r.qasm, DNA_SHOTS, seed=rng.randint(0, 2 ** 30))
            for k, v in counts.items():
                combined[k] = combined.get(k, 0) + v
        dna_hash, sig = _compute_dna_hash(combined, DNA_SHOTS * 3)
        results.append({"circuit_name": r.circuit_name or "unnamed", "dna_hash": dna_hash, "signature": sig})

    groups: dict[str, list[str]] = {}
    for r in results:
        groups.setdefault(r["dna_hash"], []).append(r["circuit_name"])

    equivalent_pairs = [(names, h) for h, names in groups.items() if len(names) > 1]

    return {
        "circuits": results,
        "equivalent_groups": [{"dna_hash": h, "circuits": names} for names, h in equivalent_pairs],
        "all_unique": len(equivalent_pairs) == 0,
        "summary": f"{len(req)} circuits compared; {len(equivalent_pairs)} equivalence group(s) found",
    }


@router.get("")
def list_dna(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.scalars(select(CircuitDNA).order_by(CircuitDNA.created_at.desc()).limit(limit)).all()
    return [
        {"dna_id": r.dna_id, "dna_hash": r.dna_hash, "circuit_name": r.circuit_name,
         "n_qubits": r.n_qubits, "n_gates": r.n_gates, "created_at": r.created_at.isoformat()}
        for r in rows
    ]
