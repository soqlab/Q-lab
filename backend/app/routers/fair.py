"""FAIR Data Compliance Checker — evaluate runs against FAIR data principles.

FAIR = Findable, Accessible, Interoperable, Reusable
Journals like Nature, Science, and PRL now mandate FAIR-compliant datasets.

Router prefix: /api/v1/fair
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project, Run
from ..store import store_list

router = APIRouter(prefix="/api/v1/fair", tags=["fair"])


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class FAIRCriterion(BaseModel):
    code: str
    principle: str
    name: str
    passed: bool
    score: int  # 0, 1, or 2 (0=fail, 1=partial, 2=pass)
    evidence: str
    recommendation: Optional[str] = None


class FAIRReport(BaseModel):
    run_id: str
    overall_score: float
    grade: str
    findable_score: float
    accessible_score: float
    interoperable_score: float
    reusable_score: float
    criteria: List[FAIRCriterion]
    journal_readiness: dict
    summary: str
    generated_at: str


class ProjectFAIRReport(BaseModel):
    project_slug: str
    run_count: int
    overall_score: float
    grade: str
    findable_score: float
    accessible_score: float
    interoperable_score: float
    reusable_score: float
    per_run_scores: List[dict]
    journal_readiness: dict
    summary: str
    generated_at: str


# ---------------------------------------------------------------------------
# Core FAIR check logic
# ---------------------------------------------------------------------------


def _check_fair(run: Run, db: Session) -> FAIRReport:
    criteria: List[FAIRCriterion] = []

    # -----------------------------------------------------------------------
    # F — Findable
    # -----------------------------------------------------------------------

    # F1: Unique persistent identifier (DOI)
    doi_records = store_list(db, "doi_records")
    has_doi = any(r.get("run_id") == run.run_id for r in doi_records)
    criteria.append(FAIRCriterion(
        code="F1",
        principle="Findable",
        name="Unique persistent identifier (DOI)",
        passed=has_doi,
        score=2 if has_doi else 0,
        evidence=f"DOI {'found' if has_doi else 'not found'} for this run",
        recommendation=None if has_doi else "Mint a DOI via the DOI panel in run details",
    ))

    # F2: Rich metadata
    has_name = bool(run.circuit_name)
    has_backend = bool(run.backend)
    has_cal = bool(run.calibration)
    has_params = bool(run.parameters)
    metadata_score = sum([has_name, has_backend, has_cal, has_params])
    criteria.append(FAIRCriterion(
        code="F2",
        principle="Findable",
        name="Rich metadata (name, backend, calibration, parameters)",
        passed=metadata_score >= 3,
        score=min(2, metadata_score // 2),
        evidence=f"{metadata_score}/4 metadata fields present",
        recommendation=(
            "Ensure circuit_name, backend, calibration, and parameters are captured"
            if metadata_score < 3 else None
        ),
    ))

    # F3: Metadata includes identifier
    criteria.append(FAIRCriterion(
        code="F3",
        principle="Findable",
        name="Metadata includes run identifier",
        passed=True,
        score=2,
        evidence=f"run_id {run.run_id} present in all API responses",
        recommendation=None,
    ))

    # F4: Registered in searchable resource
    has_share = bool(getattr(run, "share_token", None))
    criteria.append(FAIRCriterion(
        code="F4",
        principle="Findable",
        name="Registered in searchable resource",
        passed=has_share,
        score=1 if has_share else 0,
        evidence="Public share token generated" if has_share else "Run is private",
        recommendation=(
            "Generate a public share link to make the run discoverable"
            if not has_share else None
        ),
    ))

    # -----------------------------------------------------------------------
    # A — Accessible
    # -----------------------------------------------------------------------

    # A1: HTTP retrievable
    criteria.append(FAIRCriterion(
        code="A1",
        principle="Accessible",
        name="Retrievable via standard protocol (HTTP REST)",
        passed=True,
        score=2,
        evidence=f"GET /api/v1/runs/{run.run_id} endpoint available",
        recommendation=None,
    ))

    # A1.1: Open protocol
    criteria.append(FAIRCriterion(
        code="A1.1",
        principle="Accessible",
        name="Protocol is open and free",
        passed=True,
        score=2,
        evidence="HTTP REST is an open standard",
        recommendation=None,
    ))

    # A1.2: Authentication
    criteria.append(FAIRCriterion(
        code="A1.2",
        principle="Accessible",
        name="Authentication where necessary",
        passed=True,
        score=2,
        evidence="JWT + API key authentication available",
        recommendation=None,
    ))

    # A2: Metadata persists even when data removed
    criteria.append(FAIRCriterion(
        code="A2",
        principle="Accessible",
        name="Metadata accessible if data removed",
        passed=has_doi,
        score=2 if has_doi else 1,
        evidence=(
            "Provenance endpoint always available; DOI ensures permanent metadata"
            if has_doi
            else "Run provenance available while run exists"
        ),
        recommendation=(
            "Mint a DOI to ensure permanent metadata preservation"
            if not has_doi else None
        ),
    ))

    # -----------------------------------------------------------------------
    # I — Interoperable
    # -----------------------------------------------------------------------

    # I1: Standard format (QASM)
    has_qasm = bool(run.qasm)
    criteria.append(FAIRCriterion(
        code="I1",
        principle="Interoperable",
        name="Uses standard knowledge representation (OpenQASM)",
        passed=has_qasm,
        score=2 if has_qasm else 0,
        evidence="OpenQASM circuit present" if has_qasm else "No QASM circuit stored",
        recommendation=(
            "Ensure QASM is captured during experiment submission"
            if not has_qasm else None
        ),
    ))

    # I2: Standard vocabulary
    criteria.append(FAIRCriterion(
        code="I2",
        principle="Interoperable",
        name="Uses standard vocabulary (OpenQASM, JSON)",
        passed=True,
        score=2,
        evidence="OpenQASM 2.0 standard gates; JSON-LD compatible metadata",
        recommendation=None,
    ))

    # I3: Cross-references to literature
    tags = run.tags or []
    arxiv_tags = [t for t in tags if t.startswith("arxiv:") or "arxiv.org" in t]
    has_refs = len(arxiv_tags) > 0
    criteria.append(FAIRCriterion(
        code="I3",
        principle="Interoperable",
        name="References to related data/literature",
        passed=has_refs,
        score=1 if has_refs else 0,
        evidence=f"{len(arxiv_tags)} literature reference(s) found" if has_refs else "No literature references",
        recommendation="Add arXiv paper references via the Citations panel" if not has_refs else None,
    ))

    # -----------------------------------------------------------------------
    # R — Reusable
    # -----------------------------------------------------------------------

    # R1: Accurate attributes
    has_transpiler = bool(run.transpiler)
    has_timing = bool(run.timing)
    attr_score = sum([bool(run.calibration), has_transpiler, has_timing, bool(run.results)])
    criteria.append(FAIRCriterion(
        code="R1",
        principle="Reusable",
        name="Accurate and relevant attributes",
        passed=attr_score >= 3,
        score=min(2, attr_score // 2),
        evidence=f"{attr_score}/4 attribute sets captured (calibration, transpiler, timing, results)",
        recommendation=None if attr_score >= 3 else "Ensure qlab.init() captures all metadata",
    ))

    # R1.1: License
    has_license = has_doi  # DOI records include license
    criteria.append(FAIRCriterion(
        code="R1.1",
        principle="Reusable",
        name="Clear usage license",
        passed=has_license,
        score=2 if has_license else 0,
        evidence="License specified in DOI record" if has_license else "No license specified",
        recommendation="Mint a DOI with CC-BY-4.0 license" if not has_license else None,
    ))

    # R1.2: Provenance
    criteria.append(FAIRCriterion(
        code="R1.2",
        principle="Reusable",
        name="Detailed provenance available",
        passed=True,
        score=2,
        evidence=f"Full provenance at /api/v1/runs/{run.run_id}/provenance",
        recommendation=None,
    ))

    # R1.3: Community standards
    criteria.append(FAIRCriterion(
        code="R1.3",
        principle="Reusable",
        name="Meets community standards (Qiskit, OpenQASM)",
        passed=has_qasm,
        score=2 if has_qasm else 1,
        evidence=(
            "OpenQASM circuit follows community standard"
            if has_qasm
            else "No QASM; JSON metadata follows informal standard"
        ),
        recommendation=None,
    ))

    # -----------------------------------------------------------------------
    # Scores
    # -----------------------------------------------------------------------

    def _principle_score(letter: str) -> float:
        p_criteria = [c for c in criteria if c.code.startswith(letter)]
        if not p_criteria:
            return 0.0
        return sum(c.score for c in p_criteria) / (len(p_criteria) * 2) * 100

    f_score = _principle_score("F")
    a_score = _principle_score("A")
    i_score = _principle_score("I")
    r_score = _principle_score("R")
    overall = (f_score + a_score + i_score + r_score) / 4

    grade = (
        "A" if overall >= 85 else
        "B" if overall >= 70 else
        "C" if overall >= 55 else
        "D" if overall >= 40 else
        "F"
    )

    journal_readiness = {
        "Nature Scientific Data": overall >= 80 and has_doi,
        "Physical Review Letters": overall >= 65,
        "arXiv (preprint)": overall >= 50,
        "Zenodo Dataset": overall >= 70 and has_doi,
    }

    return FAIRReport(
        run_id=run.run_id,
        overall_score=round(overall, 1),
        grade=grade,
        findable_score=round(f_score, 1),
        accessible_score=round(a_score, 1),
        interoperable_score=round(i_score, 1),
        reusable_score=round(r_score, 1),
        criteria=criteria,
        journal_readiness=journal_readiness,
        summary=(
            f"This experiment scores {overall:.0f}/100 for FAIR compliance (grade {grade}). "
            + ("Ready for journal submission." if overall >= 70 else "Improvements needed before journal submission.")
        ),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/check/{run_id}", response_model=FAIRReport)
def check_run_fair(run_id: str, db: Session = Depends(get_db)):
    """Run FAIR compliance check for a single experiment run."""
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if run is None:
        raise HTTPException(status_code=404, detail="run not found")
    return _check_fair(run, db)


@router.get("/check/project/{project_slug}", response_model=ProjectFAIRReport)
def check_project_fair(project_slug: str, db: Session = Depends(get_db)):
    """Check all runs in a project and return aggregate FAIR scores."""
    project = db.scalar(select(Project).where(Project.slug == project_slug))
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    runs = db.scalars(select(Run).where(Run.project_slug == project_slug)).all()
    if not runs:
        raise HTTPException(status_code=404, detail="no runs found in this project")

    reports = [_check_fair(r, db) for r in runs]
    n = len(reports)

    avg_overall = sum(r.overall_score for r in reports) / n
    avg_f = sum(r.findable_score for r in reports) / n
    avg_a = sum(r.accessible_score for r in reports) / n
    avg_i = sum(r.interoperable_score for r in reports) / n
    avg_r = sum(r.reusable_score for r in reports) / n

    grade = (
        "A" if avg_overall >= 85 else
        "B" if avg_overall >= 70 else
        "C" if avg_overall >= 55 else
        "D" if avg_overall >= 40 else
        "F"
    )

    per_run = [
        {
            "run_id": r.run_id,
            "overall_score": r.overall_score,
            "grade": r.grade,
            "findable_score": r.findable_score,
            "accessible_score": r.accessible_score,
            "interoperable_score": r.interoperable_score,
            "reusable_score": r.reusable_score,
        }
        for r in reports
    ]

    journal_readiness = {
        "Nature Scientific Data": avg_overall >= 80 and all(r.journal_readiness.get("Nature Scientific Data") for r in reports),
        "Physical Review Letters": avg_overall >= 65,
        "arXiv (preprint)": avg_overall >= 50,
        "Zenodo Dataset": avg_overall >= 70 and all(r.journal_readiness.get("Zenodo Dataset") for r in reports),
    }

    return ProjectFAIRReport(
        project_slug=project_slug,
        run_count=n,
        overall_score=round(avg_overall, 1),
        grade=grade,
        findable_score=round(avg_f, 1),
        accessible_score=round(avg_a, 1),
        interoperable_score=round(avg_i, 1),
        reusable_score=round(avg_r, 1),
        per_run_scores=per_run,
        journal_readiness=journal_readiness,
        summary=(
            f"Project '{project_slug}' averages {avg_overall:.0f}/100 FAIR score across {n} run(s) (grade {grade}). "
            + ("Ready for journal submission." if avg_overall >= 70 else "Improvements needed before journal submission.")
        ),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/journal-requirements")
def journal_requirements():
    """Return FAIR data requirements for major quantum computing journals."""
    return {
        "journals": [
            {
                "name": "Nature Scientific Data",
                "min_fair_score": 80,
                "requires_doi": True,
                "requires_qasm": True,
                "requires_license": True,
                "data_repository": "Zenodo or Figshare",
                "url": "https://www.nature.com/sdata/policies/data-availability",
                "notes": "Requires full metadata, persistent identifier, and open license. Recommends CC-BY 4.0.",
            },
            {
                "name": "Physical Review Letters",
                "min_fair_score": 65,
                "requires_doi": False,
                "requires_qasm": True,
                "requires_license": False,
                "data_repository": "Zenodo, Dryad, or institutional repository",
                "url": "https://journals.aps.org/prl/",
                "notes": "Encourages data availability statements and supplementary code. QASM or circuit diagram required.",
            },
            {
                "name": "arXiv (preprint)",
                "min_fair_score": 50,
                "requires_doi": False,
                "requires_qasm": False,
                "requires_license": False,
                "data_repository": "Any public link",
                "url": "https://arxiv.org",
                "notes": "No formal FAIR requirement, but data links and code availability are community expectations.",
            },
            {
                "name": "Zenodo Dataset",
                "min_fair_score": 70,
                "requires_doi": True,
                "requires_qasm": True,
                "requires_license": True,
                "data_repository": "Zenodo",
                "url": "https://zenodo.org",
                "notes": "Zenodo auto-assigns DOIs. Include circuit QASM, calibration snapshots, and a README. License required.",
            },
        ]
    }
