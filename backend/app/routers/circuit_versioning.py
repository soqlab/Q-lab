"""Circuit Versioning — git-like version history for QASM circuits.

Each "circuit family" (logical circuit name) can have many versions.
Versions are created when you submit a QASM that differs from the previous
version of the same family. Versions are immutable once created.

Diff computation
────────────────
We compute a structural diff between QASM versions:
• Gate-level diff: added/removed/changed gates
• Metric delta: Δdepth, Δgates, Δcx_count, Δnon_clifford_ratio
• Textual unified diff (same as git diff)

Semantic versioning
────────────────────
• MAJOR bump: qubit count changed
• MINOR bump: gate set changed significantly (>10% gate count change)
• PATCH bump: minor optimisation (≤10% change)

Version IDs are stable content-addressed hashes (SHA-256 of canonical QASM).
"""
from __future__ import annotations

import difflib
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CircuitVersion

router = APIRouter(prefix="/api/v1/circuits/versions", tags=["circuit_versioning"])


# ─────────────────────────────────────────────────────────────────────────────
# QASM analysis helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_qasm_stats(qasm: str) -> dict[str, Any]:
    lines = [l.strip() for l in qasm.splitlines() if l.strip()]
    n_qubits, n_clbits = 1, 1
    for l in lines:
        if l.startswith("qreg"):
            try:
                n_qubits = int(l.split("[")[1].split("]")[0])
            except Exception:
                pass
        if l.startswith("creg"):
            try:
                n_clbits = int(l.split("[")[1].split("]")[0])
            except Exception:
                pass
    gate_lines = [l for l in lines if not l.startswith(
        ("//", "OPENQASM", "include", "qreg", "creg", "measure", "barrier"))]
    gate_counts: dict[str, int] = {}
    for l in gate_lines:
        parts = l.split("(")[0].split()
        if parts:
            g = parts[0].lower().rstrip(";")
            gate_counts[g] = gate_counts.get(g, 0) + 1
    ncg = {"t", "tdg", "s", "sdg", "rz", "u1", "u2", "u3", "rx", "ry", "p"}
    non_clifford = sum(v for k, v in gate_counts.items() if k in ncg)
    total = sum(gate_counts.values())
    cx = gate_counts.get("cx", 0) + gate_counts.get("cnot", 0)
    return {
        "num_qubits": n_qubits,
        "num_clbits": n_clbits,
        "depth": len(gate_lines),
        "gate_count": total,
        "cx_count": cx,
        "non_clifford_ratio": round(non_clifford / max(1, total), 4),
        "gate_counts": gate_counts,
    }


def _qasm_hash(qasm: str) -> str:
    """Content-addressed ID (first 24 chars of SHA-256 of normalised QASM)."""
    normalised = "\n".join(l.strip() for l in qasm.splitlines() if l.strip() and not l.strip().startswith("//"))
    return hashlib.sha256(normalised.encode()).hexdigest()[:24]


def _compute_diff_stats(old_stats: dict, new_stats: dict) -> dict[str, Any]:
    return {
        "delta_depth": new_stats["depth"] - old_stats.get("depth", 0),
        "delta_gates": new_stats["gate_count"] - old_stats.get("gate_count", 0),
        "delta_cx": new_stats["cx_count"] - old_stats.get("cx_count", 0),
        "delta_nc_ratio": round(new_stats["non_clifford_ratio"] - old_stats.get("non_clifford_ratio", 0), 4),
        "delta_qubits": new_stats["num_qubits"] - old_stats.get("num_qubits", 0),
        "old_stats": old_stats,
        "new_stats": new_stats,
    }


def _semantic_version(version_num: int, diff_stats: dict, parent_stats: Optional[dict]) -> str:
    if parent_stats is None:
        return "1.0.0"
    dq = diff_stats.get("delta_qubits", 0)
    dg = diff_stats.get("delta_gates", 0)
    old_gates = parent_stats.get("gate_count", 1)
    if dq != 0:
        major = version_num
        return f"{major}.0.0"
    if abs(dg) > old_gates * 0.1:
        # Find existing MINOR from same MAJOR
        return f"1.{version_num}.0"
    return f"1.0.{version_num}"


def _text_diff(old_qasm: str, new_qasm: str) -> str:
    old_lines = old_qasm.splitlines(keepends=True)
    new_lines = new_qasm.splitlines(keepends=True)
    return "".join(difflib.unified_diff(old_lines, new_lines, fromfile="v_old.qasm", tofile="v_new.qasm"))


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class VersionCreate(BaseModel):
    circuit_family: str
    qasm: str
    commit_message: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    project_slug: Optional[str] = None
    run_ids: list[str] = Field(default_factory=list)


class TagRequest(BaseModel):
    tags: list[str]


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def create_version(req: VersionCreate, db: Session = Depends(get_db)):
    """Create a new circuit version. Skips creation if content is identical to HEAD."""
    # Find the latest version of this family
    existing = db.scalars(
        select(CircuitVersion)
        .where(CircuitVersion.circuit_family == req.circuit_family)
        .order_by(CircuitVersion.version_num.desc())
    ).all()

    content_hash = _qasm_hash(req.qasm)
    new_stats = _parse_qasm_stats(req.qasm)

    # Dedup: if the hash matches the HEAD version, return existing
    if existing:
        head = existing[0]
        if _qasm_hash(head.qasm) == content_hash:
            return {**_version_to_dict(head), "created": False, "reason": "identical_to_head"}

    version_num = len(existing) + 1
    parent = existing[0] if existing else None
    parent_stats = parent.diff_stats.get("new_stats") if parent else None

    diff_stats = _compute_diff_stats(parent_stats or {}, new_stats) if parent else {"new_stats": new_stats}
    sem_ver = _semantic_version(version_num, diff_stats, parent_stats)

    version = CircuitVersion(
        version_id=f"cv-{content_hash}",
        circuit_family=req.circuit_family,
        version_num=version_num,
        qasm=req.qasm,
        parent_version_id=parent.version_id if parent else None,
        diff_stats=diff_stats,
        commit_message=req.commit_message,
        tags=req.tags,
        project_slug=req.project_slug,
        run_ids=req.run_ids,
    )
    try:
        db.add(version)
        db.commit()
        db.refresh(version)
    except Exception:
        db.rollback()
        # version_id collision (same content) — return existing
        v = db.scalar(select(CircuitVersion).where(CircuitVersion.version_id == f"cv-{content_hash}"))
        if v:
            return {**_version_to_dict(v), "created": False, "reason": "duplicate_content"}
        raise

    return {**_version_to_dict(version), "semantic_version": sem_ver, "created": True}


@router.get("")
def list_versions(
    family: Optional[str] = None,
    project: Optional[str] = None,
    tag: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """List circuit versions, optionally filtered by family or project."""
    q = select(CircuitVersion).order_by(
        CircuitVersion.circuit_family, CircuitVersion.version_num.desc()
    )
    if family:
        q = q.where(CircuitVersion.circuit_family == family)
    if project:
        q = q.where(CircuitVersion.project_slug == project)
    versions = db.scalars(q.limit(limit)).all()
    if tag:
        versions = [v for v in versions if tag in (v.tags or [])]
    return [_version_to_dict(v) for v in versions]


@router.get("/families")
def list_families(db: Session = Depends(get_db)):
    """List all circuit families with their HEAD version."""
    versions = db.scalars(
        select(CircuitVersion).order_by(CircuitVersion.circuit_family, CircuitVersion.version_num.desc())
    ).all()
    families: dict[str, dict] = {}
    for v in versions:
        if v.circuit_family not in families:
            families[v.circuit_family] = {
                "circuit_family": v.circuit_family,
                "head_version": _version_to_dict(v),
                "version_count": 0,
                "project_slug": v.project_slug,
            }
        families[v.circuit_family]["version_count"] += 1
    return list(families.values())


@router.get("/{version_id}")
def get_version(version_id: str, db: Session = Depends(get_db)):
    v = _get_or_404(db, version_id)
    return _version_to_dict(v, include_qasm=True)


@router.get("/{v1_id}/diff/{v2_id}")
def diff_versions(v1_id: str, v2_id: str, db: Session = Depends(get_db)):
    """Compute structural and textual diff between two circuit versions."""
    v1 = _get_or_404(db, v1_id)
    v2 = _get_or_404(db, v2_id)
    s1 = _parse_qasm_stats(v1.qasm)
    s2 = _parse_qasm_stats(v2.qasm)
    ds = _compute_diff_stats(s1, s2)
    text_diff = _text_diff(v1.qasm, v2.qasm)
    return {
        "v1": _version_to_dict(v1),
        "v2": _version_to_dict(v2),
        "diff_stats": ds,
        "text_diff": text_diff,
        "is_identical": _qasm_hash(v1.qasm) == _qasm_hash(v2.qasm),
    }


@router.post("/{version_id}/tag")
def add_tags(version_id: str, req: TagRequest, db: Session = Depends(get_db)):
    v = _get_or_404(db, version_id)
    existing = list(v.tags or [])
    for t in req.tags:
        if t not in existing:
            existing.append(t)
    v.tags = existing
    db.commit()
    return {"version_id": version_id, "tags": v.tags}


@router.get("/{version_id}/history")
def version_history(version_id: str, db: Session = Depends(get_db)):
    """Walk back through the parent chain from this version."""
    v = _get_or_404(db, version_id)
    chain = [_version_to_dict(v)]
    seen = {version_id}
    current = v
    for _ in range(50):
        if not current.parent_version_id or current.parent_version_id in seen:
            break
        seen.add(current.parent_version_id)
        parent = db.scalar(select(CircuitVersion).where(CircuitVersion.version_id == current.parent_version_id))
        if parent is None:
            break
        chain.append(_version_to_dict(parent))
        current = parent
    return {"version_id": version_id, "history": chain}


def _get_or_404(db: Session, version_id: str) -> CircuitVersion:
    v = db.scalar(select(CircuitVersion).where(CircuitVersion.version_id == version_id))
    if v is None:
        raise HTTPException(404, f"Circuit version '{version_id}' not found")
    return v


def _version_to_dict(v: CircuitVersion, include_qasm: bool = False) -> dict:
    d: dict[str, Any] = {
        "version_id": v.version_id,
        "circuit_family": v.circuit_family,
        "version_num": v.version_num,
        "parent_version_id": v.parent_version_id,
        "diff_stats": v.diff_stats,
        "commit_message": v.commit_message,
        "tags": v.tags,
        "project_slug": v.project_slug,
        "run_ids": v.run_ids,
        "created_at": v.created_at.isoformat(),
        "content_hash": v.version_id.replace("cv-", "") if v.version_id.startswith("cv-") else v.version_id,
    }
    if include_qasm:
        d["qasm"] = v.qasm
    return d
