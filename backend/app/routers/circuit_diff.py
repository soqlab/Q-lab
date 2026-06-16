"""QASM-level circuit diff between two runs."""

from __future__ import annotations

import re
from difflib import SequenceMatcher, unified_diff

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/runs", tags=["circuit_diff"])

_GATE_RE = re.compile(r"^\s*([a-zA-Z][a-zA-Z0-9_]*(?:\([^)]*\))?)\s+(.*?)\s*;")
_HEADER_RE = re.compile(r"^\s*(OPENQASM|include|qreg|creg|barrier|measure)", re.IGNORECASE)


def _parse_gates(qasm: str) -> list[str]:
    gates = []
    for line in qasm.splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        if _HEADER_RE.match(line):
            continue
        if _GATE_RE.match(line):
            gates.append(line)
    return gates


def _gate_name(line: str) -> str:
    m = _GATE_RE.match(line)
    return m.group(1).split("(")[0].lower() if m else "unknown"


def _diff_stats(a_gates: list[str], b_gates: list[str]) -> dict:
    added = removed = unchanged = 0
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a_gates, b_gates, autojunk=False).get_opcodes():
        if tag == "equal":
            unchanged += i2 - i1
        elif tag == "insert":
            added += j2 - j1
        elif tag == "delete":
            removed += i2 - i1
        elif tag == "replace":
            removed += i2 - i1
            added += j2 - j1
    return {"added": added, "removed": removed, "unchanged": unchanged}


def _gate_histogram(gates: list[str]) -> dict[str, int]:
    hist: dict[str, int] = {}
    for g in gates:
        name = _gate_name(g)
        hist[name] = hist.get(name, 0) + 1
    return hist


@router.get("/{run_id}/diff/{other_id}")
def circuit_diff(run_id: str, other_id: str, db: Session = Depends(get_db)):
    run_a = db.scalar(select(Run).where(Run.run_id == run_id))
    if run_a is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    run_b = db.scalar(select(Run).where(Run.run_id == other_id))
    if run_b is None:
        raise HTTPException(status_code=404, detail=f"Run {other_id} not found")

    a_gates = _parse_gates(run_a.qasm or "")
    b_gates = _parse_gates(run_b.qasm or "")

    diff_lines = list(unified_diff(
        a_gates, b_gates,
        fromfile=run_a.circuit_name or run_id,
        tofile=run_b.circuit_name or other_id,
        lineterm="",
        n=2,
    ))

    stats = _diff_stats(a_gates, b_gates)
    a_hist = _gate_histogram(a_gates)
    b_hist = _gate_histogram(b_gates)
    all_gates = sorted(set(a_hist) | set(b_hist))
    gate_delta = {
        g: {"a": a_hist.get(g, 0), "b": b_hist.get(g, 0), "delta": b_hist.get(g, 0) - a_hist.get(g, 0)}
        for g in all_gates
    }

    a_fp = run_a.fingerprint or {}
    b_fp = run_b.fingerprint or {}
    fp_delta = {k: {"a": a_fp.get(k), "b": b_fp.get(k)} for k in set(a_fp) | set(b_fp) if a_fp.get(k) != b_fp.get(k)}

    similarity = round(SequenceMatcher(None, a_gates, b_gates).ratio(), 4)

    return {
        "run_a": {"run_id": run_id, "circuit_name": run_a.circuit_name, "gate_count": len(a_gates)},
        "run_b": {"run_id": other_id, "circuit_name": run_b.circuit_name, "gate_count": len(b_gates)},
        "similarity": similarity,
        "diff_stats": stats,
        "gate_histogram_delta": gate_delta,
        "fingerprint_delta": fp_delta,
        "unified_diff": diff_lines[:500],
        "diff_lines_truncated": len(diff_lines) > 500,
    }
