from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
import fnmatch
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/github-ci", tags=["github-ci"])

NS_PIPELINES = "github_pipelines"
NS_RUNS = "github_runs"


class CIPipeline(BaseModel):
    pipeline_id: str
    name: str
    repo: str
    branch_pattern: str
    trigger: str
    experiment_template: dict
    backend: str
    shots: int
    fidelity_threshold: float
    status: str
    created_at: str


class PipelineRun(BaseModel):
    run_id: str
    pipeline_id: str
    repo: str
    branch: str
    commit_sha: str
    triggered_by: str
    experiment_run_id: Optional[str] = None
    status: str
    fidelity_threshold: float
    achieved_fidelity: Optional[float] = None
    duration_sec: Optional[int] = None
    log_url: str
    started_at: str
    completed_at: Optional[str] = None


class WebhookPayload(BaseModel):
    repo: str
    branch: str
    commit_sha: str
    pusher: str
    event_type: str


class CreatePipelineRequest(BaseModel):
    name: str
    repo: str
    branch_pattern: str
    trigger: str
    experiment_template: dict
    backend: str
    shots: int
    fidelity_threshold: float = 0.95


class TriggerRunRequest(BaseModel):
    pipeline_id: str
    branch: str = "main"
    commit_sha: Optional[str] = None
    triggered_by: str = "manual"


def _simulate_run(pipeline: dict, branch: str, commit_sha: str, triggered_by: str) -> PipelineRun:
    run_id = str(uuid.uuid4())
    experiment_run_id = str(uuid.uuid4())
    threshold = pipeline["fidelity_threshold"]
    pass_probability = 0.82
    passed = random.random() < pass_probability
    achieved_fidelity = round(
        random.uniform(threshold + 0.01, min(threshold + 0.06, 0.9999)) if passed
        else random.uniform(max(threshold - 0.08, 0.80), threshold - 0.001),
        4,
    )
    duration_sec = random.randint(45, 420)
    now = datetime.now(timezone.utc).isoformat()
    status = "passed" if passed else "failed"
    run = PipelineRun(
        run_id=run_id,
        pipeline_id=pipeline["pipeline_id"],
        repo=pipeline["repo"],
        branch=branch,
        commit_sha=commit_sha,
        triggered_by=triggered_by,
        experiment_run_id=experiment_run_id,
        status=status,
        fidelity_threshold=threshold,
        achieved_fidelity=achieved_fidelity,
        duration_sec=duration_sec,
        log_url=f"/api/v1/github-ci/runs/{pipeline['pipeline_id']}/{run_id}/log",
        started_at=now,
        completed_at=datetime.now(timezone.utc).isoformat(),
    )
    return run


@router.post("/pipeline", response_model=CIPipeline)
def create_pipeline(req: CreatePipelineRequest, db: Session = Depends(get_db)) -> CIPipeline:
    pipeline_id = str(uuid.uuid4())
    pipeline = CIPipeline(
        pipeline_id=pipeline_id,
        name=req.name,
        repo=req.repo,
        branch_pattern=req.branch_pattern,
        trigger=req.trigger,
        experiment_template=req.experiment_template,
        backend=req.backend,
        shots=req.shots,
        fidelity_threshold=req.fidelity_threshold,
        status="active",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_PIPELINES, pipeline_id, pipeline.model_dump())
    return pipeline


@router.get("/pipelines", response_model=List[CIPipeline])
def list_pipelines(db: Session = Depends(get_db)) -> List[CIPipeline]:
    return [CIPipeline(**p) for p in store_list(db, NS_PIPELINES)]


@router.get("/pipeline/{pipeline_id}", response_model=CIPipeline)
def get_pipeline(pipeline_id: str, db: Session = Depends(get_db)) -> CIPipeline:
    p = store_get(db, NS_PIPELINES, pipeline_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found.")
    return CIPipeline(**p)


@router.post("/trigger", response_model=PipelineRun)
def trigger_run(req: TriggerRunRequest, db: Session = Depends(get_db)) -> PipelineRun:
    pipeline = store_get(db, NS_PIPELINES, req.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline {req.pipeline_id} not found.")
    if pipeline["status"] != "active":
        raise HTTPException(status_code=400, detail=f"Pipeline {req.pipeline_id} is paused and cannot be triggered.")
    commit_sha = req.commit_sha or uuid.uuid4().hex[:10]
    run = _simulate_run(pipeline, req.branch, commit_sha, req.triggered_by)
    run_data = run.model_dump()
    store_put(db, NS_RUNS, run.run_id, run_data)
    return run


@router.post("/webhook", response_model=PipelineRun)
def webhook(payload: WebhookPayload, db: Session = Depends(get_db)) -> PipelineRun:
    matching_pipeline = None
    for pipeline in store_list(db, NS_PIPELINES):
        if pipeline["status"] != "active":
            continue
        if pipeline["repo"] != payload.repo:
            continue
        trigger_ok = (
            (pipeline["trigger"] == "push" and payload.event_type == "push")
            or (pipeline["trigger"] == "pr" and payload.event_type in ("pull_request", "pr"))
            or pipeline["trigger"] == "schedule"
        )
        if not trigger_ok:
            continue
        if fnmatch.fnmatch(payload.branch, pipeline["branch_pattern"]):
            matching_pipeline = pipeline
            break

    if matching_pipeline is None:
        raise HTTPException(
            status_code=404,
            detail=f"No active pipeline found matching repo '{payload.repo}', branch '{payload.branch}', event '{payload.event_type}'.",
        )

    run = _simulate_run(matching_pipeline, payload.branch, payload.commit_sha, payload.event_type)
    store_put(db, NS_RUNS, run.run_id, run.model_dump())
    return run


@router.get("/runs/{pipeline_id}", response_model=List[PipelineRun])
def list_runs(pipeline_id: str, db: Session = Depends(get_db)) -> List[PipelineRun]:
    pipeline = store_get(db, NS_PIPELINES, pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail=f"Pipeline {pipeline_id} not found.")
    all_runs = store_list(db, NS_RUNS)
    runs = [r for r in all_runs if r["pipeline_id"] == pipeline_id]
    return [PipelineRun(**r) for r in runs]
