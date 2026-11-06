"""The software environment each run was executed in, as the Q-Lab SDK recorded it.

The SDK sends a `context` with every run: Python version, platform, git commit and branch, the
versions of the quantum and numeric libraries it found, and optionally a full `pip freeze`. This
router reads that record back and compares two runs' environments. Nothing is captured on the
server: the server's own packages say nothing about where the user's circuit ran. A run uploaded
without that context is reported as not recorded, with no values filled in.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Run

router = APIRouter(prefix="/api/v1/environment", tags=["environment"])

SOURCE = "Recorded by the Q-Lab SDK on the machine that ran the circuit (the run's context)."


class EnvPackage(BaseModel):
    name: str
    version: str
    source: str  # "library_versions" or "pip_freeze"


class EnvironmentSnapshot(BaseModel):
    run_id: str
    captured_at: Optional[str]
    backend: Optional[str]
    recorded: bool
    python_version: Optional[str]
    platform: Optional[str]
    git_commit: Optional[str]
    git_branch: Optional[str]
    setup_fingerprint: Optional[str]
    packages: list[EnvPackage]
    env_hash: Optional[str]
    source: str = SOURCE


class EnvDiff(BaseModel):
    run_a: str
    run_b: str
    added: list[EnvPackage]
    removed: list[EnvPackage]
    changed: list[dict]
    python_changed: bool
    platform_changed: bool
    git_commit_changed: bool
    identical: bool
    warnings: list[str]
    source: str = SOURCE


class DiffRequest(BaseModel):
    run_id_a: str
    run_id_b: str


def _str(value: Any) -> Optional[str]:
    text = "" if value is None else str(value).strip()
    return text or None


def _packages(ctx: dict) -> list[EnvPackage]:
    found: dict[str, EnvPackage] = {}
    for line in str(ctx.get("pip_freeze") or "").splitlines():
        name, sep, version = line.strip().partition("==")
        if sep and name and version:
            found[name.lower()] = EnvPackage(name=name.lower(), version=version, source="pip_freeze")
    versions = ctx.get("library_versions")
    if isinstance(versions, dict):
        for name, version in versions.items():
            if version:
                found[str(name).lower()] = EnvPackage(name=str(name).lower(), version=str(version),
                                                      source="library_versions")
    return sorted(found.values(), key=lambda p: p.name)


def snapshot_of(run: Run) -> EnvironmentSnapshot:
    ctx = run.context if isinstance(run.context, dict) else {}
    python_full = _str(ctx.get("python_version"))
    python_version = python_full.split()[0] if python_full else None
    packages = _packages(ctx)
    recorded = bool(python_version or packages)
    env_hash = None
    if recorded:
        material = {"python": python_version, "packages": {p.name: p.version for p in packages}}
        env_hash = hashlib.sha256(json.dumps(material, sort_keys=True).encode()).hexdigest()[:16]
    return EnvironmentSnapshot(
        run_id=run.run_id,
        captured_at=run.created_at.isoformat() if run.created_at else None,
        backend=run.backend,
        recorded=recorded,
        python_version=python_version,
        platform=_str(ctx.get("platform")),
        git_commit=_str(ctx.get("git_commit")),
        git_branch=_str(ctx.get("git_branch")),
        setup_fingerprint=_str(ctx.get("setup_fingerprint")),
        packages=packages,
        env_hash=env_hash,
    )


def _run(db: Session, run_id: str) -> Run:
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found.")
    return run


@router.get("")
def list_snapshots(limit: int = 200, db: Session = Depends(get_db)):
    """Your most recent runs that carry an environment record."""
    runs = db.scalars(select(Run).order_by(Run.created_at.desc()).limit(max(1, min(limit, 1000))))
    snaps = [s for s in (snapshot_of(r) for r in runs) if s.recorded]
    return {
        "source": SOURCE,
        "snapshots": [{"run_id": s.run_id, "captured_at": s.captured_at, "backend": s.backend,
                       "python_version": s.python_version, "n_packages": len(s.packages),
                       "env_hash": s.env_hash} for s in snaps],
    }


@router.get("/runs/{run_id}", response_model=EnvironmentSnapshot)
def get_snapshot(run_id: str, db: Session = Depends(get_db)):
    return snapshot_of(_run(db, run_id))


@router.post("/diff", response_model=EnvDiff)
def diff_environments(req: DiffRequest, db: Session = Depends(get_db)):
    a, b = snapshot_of(_run(db, req.run_id_a)), snapshot_of(_run(db, req.run_id_b))
    for s in (a, b):
        if not s.recorded:
            raise HTTPException(status_code=422, detail=f"Run {s.run_id} has no recorded environment to compare.")
    a_map = {p.name: p for p in a.packages}
    b_map = {p.name: p for p in b.packages}
    added = [p for n, p in b_map.items() if n not in a_map]
    removed = [p for n, p in a_map.items() if n not in b_map]
    changed = [{"name": n, "from": a_map[n].version, "to": b_map[n].version}
               for n in a_map if n in b_map and a_map[n].version != b_map[n].version]
    python_changed = a.python_version != b.python_version
    platform_changed = a.platform != b.platform
    git_changed = a.git_commit != b.git_commit
    warnings = []
    names = {c["name"] for c in changed}
    if names & {"qiskit", "qiskit-terra"}:
        warnings.append("Qiskit version changed: transpilation, and so the executed circuit, may differ.")
    if names & {"qiskit-aer"}:
        warnings.append("Qiskit Aer version changed: simulator results may differ.")
    if "numpy" in names:
        warnings.append("NumPy version changed: floating-point results may differ.")
    if python_changed:
        warnings.append(f"Python version changed: {a.python_version} -> {b.python_version}.")
    if git_changed and a.git_commit and b.git_commit:
        warnings.append(f"Code changed: git commit {a.git_commit[:10]} -> {b.git_commit[:10]}.")
    if {p.source for p in a.packages} != {p.source for p in b.packages}:
        warnings.append("Only one run recorded a full pip freeze; packages missing from the other may just be unrecorded.")
    return EnvDiff(
        run_a=a.run_id, run_b=b.run_id, added=added, removed=removed, changed=changed,
        python_changed=python_changed, platform_changed=platform_changed, git_commit_changed=git_changed,
        identical=not (added or removed or changed or python_changed or platform_changed or git_changed),
        warnings=warnings,
    )
