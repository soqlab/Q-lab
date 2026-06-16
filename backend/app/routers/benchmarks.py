from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity
from ..models import Benchmark, Run

router = APIRouter(prefix="/api/v1/benchmarks", tags=["benchmarks"])


class BenchmarkPayload(BaseModel):
    benchmark_id: str
    name: Optional[str] = None
    circuit_qasm: Optional[str] = None
    backends: List[str] = Field(default_factory=list)
    run_ids: List[str] = Field(default_factory=list)
    project: Optional[str] = None


def _benchmark_to_dict(bm: Benchmark) -> Dict[str, Any]:
    return {
        "benchmark_id": bm.benchmark_id,
        "name": bm.name,
        "backends": bm.backends or [],
        "run_ids": bm.run_ids or [],
        "status": bm.status,
        "project": bm.project_slug,
        "created_at": bm.created_at.isoformat(),
    }


def _compare_runs(runs: List[Dict]) -> Dict[str, Any]:
    if not runs:
        return {}
    comparison: Dict[str, Any] = {}
    for run in runs:
        backend = run.get("backend") or "unknown"
        fp = run.get("fingerprint") or {}
        timing = run.get("timing") or {}
        calibration = run.get("calibration") or {}
        results = run.get("results") or {}
        comparison[backend] = {
            "run_id": run.get("run_id"),
            "status": run.get("status"),
            "depth": fp.get("depth"),
            "num_qubits": fp.get("num_qubits"),
            "non_clifford_ratio": fp.get("non_clifford_ratio"),
            "submit_time": timing.get("submit_time"),
            "result_time": timing.get("result_time"),
            "avg_t1_us": _avg(calibration.get("t1_us", {})),
            "avg_gate_error": _avg(calibration.get("gate_errors", {})),
            "success_probability": results.get("success_probability"),
        }
    return comparison


def _avg(d: Dict) -> Optional[float]:
    vals = [v for v in d.values() if v is not None]
    return round(sum(vals) / len(vals), 6) if vals else None


@router.post("")
def create_benchmark(
    payload: BenchmarkPayload,
    identity: Optional[Identity] = Depends(get_identity),
    db: Session = Depends(get_db),
):
    existing = db.scalar(select(Benchmark).where(Benchmark.benchmark_id == payload.benchmark_id))
    if existing:
        return _benchmark_to_dict(existing)

    bm = Benchmark(
        benchmark_id=payload.benchmark_id,
        name=payload.name,
        circuit_qasm=payload.circuit_qasm,
        backends=payload.backends,
        run_ids=payload.run_ids,
        project_slug=payload.project,
        status="running",
        created_by_user_id=identity.user_id if identity else None,
        org_id=identity.org_id if identity else None,
    )
    db.add(bm)
    db.commit()
    db.refresh(bm)
    return _benchmark_to_dict(bm)


@router.get("")
def list_benchmarks(
    project: Optional[str] = None,
    db: Session = Depends(get_db),
):
    query = select(Benchmark).order_by(Benchmark.created_at.desc())
    if project:
        query = query.where(Benchmark.project_slug == project)
    benchmarks = db.scalars(query).all()
    return [_benchmark_to_dict(bm) for bm in benchmarks]


@router.get("/{benchmark_id}")
def get_benchmark(benchmark_id: str, db: Session = Depends(get_db)):
    bm = db.scalar(select(Benchmark).where(Benchmark.benchmark_id == benchmark_id))
    if not bm:
        raise HTTPException(status_code=404, detail="Benchmark not found")

    run_ids = bm.run_ids or []
    runs_raw: List[Run] = []
    if run_ids:
        runs_raw = list(db.scalars(select(Run).where(Run.run_id.in_(run_ids))).all())

    from ..health_score import compute_health_score
    runs_dicts = []
    for r in runs_raw:
        d = {
            "run_id": r.run_id,
            "backend": r.backend,
            "status": r.status,
            "fingerprint": r.fingerprint or {},
            "timing": r.timing or {},
            "calibration": r.calibration or {},
            "results": r.results or {},
            "project": r.project_slug,
            "created_at": r.created_at.isoformat(),
        }
        d["health_score"] = compute_health_score(d)
        runs_dicts.append(d)

    # Auto-update benchmark status
    statuses = {r.status for r in runs_raw}
    if statuses and all(s in ("completed", "failed") for s in statuses):
        bm.status = "completed" if "failed" not in statuses else "partial"
        db.commit()

    return {
        **_benchmark_to_dict(bm),
        "runs": runs_dicts,
        "comparison": _compare_runs(runs_dicts),
    }
