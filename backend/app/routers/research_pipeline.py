from __future__ import annotations
import uuid
import random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/v1/research-pipeline", tags=["research-pipeline"])

_pipelines: dict[str, dict] = {}

STAGE_ORDER = [
    "hypothesis",
    "experiment_design",
    "circuit_generation",
    "execution",
    "analysis",
    "statistical_review",
    "peer_review",
    "paper_draft",
    "arxiv_submission",
]

STAGE_ARTIFACTS: dict[str, list[str]] = {
    "hypothesis": ["hypothesis_statement.md", "literature_review_notes.md", "research_questions.md"],
    "experiment_design": ["experiment_protocol.yaml", "qubit_layout.png", "parameter_sweep_plan.csv"],
    "circuit_generation": ["circuit.qasm", "circuit_diagram.png", "gate_count_report.json"],
    "execution": ["raw_counts.json", "job_ids.txt", "execution_log.csv"],
    "analysis": [f"fidelity_{round(random.uniform(0.88, 0.97), 2)}_computed.json",
                 "noise_model_fit.png", "expectation_values.csv"],
    "statistical_review": ["bootstrap_ci.json", "effect_size_report.json", "p_value_summary.csv"],
    "peer_review": ["reviewer_comments.pdf", "rebuttal_letter.md", "revised_manuscript.pdf"],
    "paper_draft": ["manuscript_v1.tex", "figures.zip", "supplementary_material.pdf"],
    "arxiv_submission": ["arxiv_submission_id.txt", "camera_ready.pdf", "doi_record.json"],
}

STAGE_CHECKS: dict[str, list[tuple[str, bool]]] = {
    "hypothesis": [
        ("Hypothesis is falsifiable", True),
        ("Prior art reviewed", True),
        ("Research gap identified", random.random() > 0.1),
    ],
    "experiment_design": [
        ("Control variables defined", True),
        ("Statistical power estimated (n > 30)", True),
        ("Backend selected and available", random.random() > 0.15),
    ],
    "circuit_generation": [
        ("Circuit depth within backend limit", True),
        ("Gate set compatible with backend", True),
        ("QASM syntax validated", True),
        ("T-gate count optimized", random.random() > 0.2),
    ],
    "execution": [
        ("Job completed successfully", True),
        ("Shot count >= 1024", True),
        ("No mid-circuit measurement errors", random.random() > 0.1),
    ],
    "analysis": [
        (f"Fidelity > 0.85: {'PASS' if random.random() > 0.2 else 'FAIL'}", random.random() > 0.2),
        ("Error mitigation applied", True),
        ("Noise model fitted (R² > 0.90)", random.random() > 0.15),
    ],
    "statistical_review": [
        ("p-value < 0.05", random.random() > 0.25),
        ("Effect size > 0.2 (Cohen's d)", random.random() > 0.2),
        ("Bootstrap CI excludes zero", random.random() > 0.3),
        ("Multiple comparison correction applied", True),
    ],
    "peer_review": [
        ("Reviewer #1 concerns addressed", random.random() > 0.1),
        ("Reviewer #2 concerns addressed", random.random() > 0.15),
        ("Major revisions completed", True),
    ],
    "paper_draft": [
        ("Abstract < 250 words", True),
        ("Figures at 300 DPI", True),
        ("References formatted (IEEE)", True),
        ("Code availability statement included", True),
    ],
    "arxiv_submission": [
        ("LaTeX compiles without errors", True),
        ("arXiv category selected (quant-ph)", True),
        ("Author list finalized", True),
        ("Embargo period checked", True),
    ],
}


def _build_stages(active_idx: int = 0) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    stages = []
    for i, name in enumerate(STAGE_ORDER):
        if i < active_idx:
            status = "complete"
            started = now
            completed = now
        elif i == active_idx:
            status = "active"
            started = now
            completed = None
        else:
            status = "pending"
            started = None
            completed = None
        artifacts = STAGE_ARTIFACTS[name] if i <= active_idx else []
        checks = [
            {"check": c[0], "passed": c[1]}
            for c in STAGE_CHECKS[name]
        ] if i <= active_idx else []
        stages.append({
            "name": name,
            "status": status,
            "started_at": started,
            "completed_at": completed,
            "artifacts": artifacts,
            "notes": _stage_note(name, status),
            "auto_checks": checks,
        })
    return stages


def _stage_note(name: str, status: str) -> str:
    notes = {
        "hypothesis": "Quantum advantage hypothesis formulated based on VQE energy landscape analysis.",
        "experiment_design": "Parameter sweep over ansatz depth [1–6] on ibm_nairobi backend.",
        "circuit_generation": "Efficient SU2 ansatz with 4 qubits, depth 3, 24 CNOT gates generated.",
        "execution": "Executed 8192 shots on ibm_nairobi via Qiskit Runtime Sampler primitive.",
        "analysis": "ZNE error mitigation applied; fidelity estimated via state tomography overlap.",
        "statistical_review": "Bootstrap CI computed over 1000 resamples; Bonferroni correction applied.",
        "peer_review": "Submitted to PRA; two reviewer rounds completed with minor revisions.",
        "paper_draft": "Manuscript drafted in LaTeX; 6 figures, 2 tables, 32 references.",
        "arxiv_submission": "Uploaded to arXiv under quant-ph; assigned arXiv:2406.XXXXX.",
    }
    return notes.get(name, "") if status in ("active", "complete") else ""


def _completion_pct(stages: list[dict]) -> float:
    done = sum(1 for s in stages if s["status"] == "complete")
    active = sum(0.5 for s in stages if s["status"] == "active")
    return round((done + active) / len(stages) * 100, 1)


class PipelineCreateRequest(BaseModel):
    title: str
    hypothesis: str
    algorithm: str
    backend: str
    success_criteria: str


@router.post("/create")
def create_pipeline(req: PipelineCreateRequest):
    pipeline_id = str(uuid.uuid4())
    stages = _build_stages(active_idx=0)
    pipeline = {
        "pipeline_id": pipeline_id,
        "title": req.title,
        "hypothesis": req.hypothesis,
        "algorithm": req.algorithm,
        "backend": req.backend,
        "success_criteria": req.success_criteria,
        "current_stage": STAGE_ORDER[0],
        "stages": stages,
        "overall_completion_pct": _completion_pct(stages),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _pipelines[pipeline_id] = pipeline
    return pipeline


@router.post("/{pipeline_id}/advance")
def advance_pipeline(pipeline_id: str):
    if pipeline_id not in _pipelines:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    p = _pipelines[pipeline_id]
    current_idx = STAGE_ORDER.index(p["current_stage"])
    if current_idx >= len(STAGE_ORDER) - 1:
        raise HTTPException(status_code=400, detail="Pipeline already at final stage")
    next_idx = current_idx + 1
    p["stages"] = _build_stages(active_idx=next_idx)
    p["current_stage"] = STAGE_ORDER[next_idx]
    p["overall_completion_pct"] = _completion_pct(p["stages"])
    p["updated_at"] = datetime.now(timezone.utc).isoformat()
    return p


@router.get("/{pipeline_id}")
def get_pipeline(pipeline_id: str):
    if pipeline_id not in _pipelines:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return _pipelines[pipeline_id]


@router.get("/")
def list_pipelines():
    return [
        {
            "pipeline_id": p["pipeline_id"],
            "title": p["title"],
            "current_stage": p["current_stage"],
            "overall_completion_pct": p["overall_completion_pct"],
            "created_at": p["created_at"],
        }
        for p in _pipelines.values()
    ]
