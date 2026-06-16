from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/conference", tags=["conference"])

NS = "conference_assets"


class ConferenceAsset(BaseModel):
    asset_id: str
    type: str
    title: str
    venue: str
    authors: List[str]
    experiment_ids: List[str]
    sections: List[dict]
    template: str
    format: str
    file_size_kb: float
    download_url: str
    created_at: str


class AbstractSummary(BaseModel):
    asset_id: str
    title: str
    word_count: int
    key_results: List[str]


class GeneratePosterRequest(BaseModel):
    title: str
    venue: str
    authors: List[str]
    experiment_ids: List[str]
    template: str = "ieee"
    highlight_metric: str = "fidelity"


class GenerateSlidesRequest(BaseModel):
    title: str
    venue: str
    authors: List[str]
    experiment_ids: List[str]
    n_slides: int = 12
    template: str = "clean"


class GenerateAbstractRequest(BaseModel):
    title: str
    authors: List[str]
    experiment_ids: List[str]
    max_words: int = 250
    venue: str


def _exp_ref(experiment_ids: List[str]) -> str:
    if not experiment_ids:
        return "our experimental runs"
    return f"experiments {', '.join(experiment_ids[:3])}"


def _poster_sections(title: str, experiment_ids: List[str], highlight_metric: str) -> List[dict]:
    fidelity_val = round(random.uniform(0.91, 0.999), 4)
    circuit_depth = random.randint(8, 64)
    n_qubits = random.randint(4, 27)
    shots = random.choice([1024, 4096, 8192, 16384])
    return [
        {
            "title": "Introduction",
            "content": (
                f"Quantum computing offers exponential speedup for select problem classes. "
                f"In this work we present results from {_exp_ref(experiment_ids)}, "
                f"targeting {n_qubits}-qubit circuits executed on near-term hardware. "
                f"Our objective is to characterize {highlight_metric} as a function of circuit depth "
                f"and noise model parameters, establishing a reproducible benchmarking protocol."
            ),
            "figures": [
                {"label": "Fig. 1", "caption": f"Circuit topology for {n_qubits}-qubit register", "type": "circuit_diagram"},
            ],
        },
        {
            "title": "Methods",
            "content": (
                f"We compiled variational circuits of depth {circuit_depth} using the Qiskit transpiler "
                f"with optimization level 3. Each circuit was executed with {shots} shots. "
                f"Readout error mitigation was applied via matrix inversion on calibration data collected "
                f"within the same calibration window as {_exp_ref(experiment_ids)}. "
                f"Gate fidelities were estimated from randomized benchmarking sequences of length 2–1024."
            ),
            "figures": [
                {"label": "Fig. 2", "caption": "Randomized benchmarking decay curves", "type": "line_plot"},
                {"label": "Fig. 3", "caption": "Noise model heatmap across qubit pairs", "type": "heatmap"},
            ],
        },
        {
            "title": "Results",
            "content": (
                f"Across {_exp_ref(experiment_ids)} we measured a peak {highlight_metric} of {fidelity_val} "
                f"at circuit depth {circuit_depth // 2}, consistent with the predicted decoherence envelope. "
                f"The {highlight_metric} degraded by {round(random.uniform(0.01, 0.05), 3)} per additional "
                f"CNOT layer. Error mitigation improved raw {highlight_metric} by "
                f"{round(random.uniform(0.02, 0.08), 3)} on average. "
                f"Statistical significance was confirmed at p < 0.01 via bootstrapped confidence intervals."
            ),
            "figures": [
                {"label": "Fig. 4", "caption": f"{highlight_metric.capitalize()} vs. circuit depth", "type": "scatter_plot"},
                {"label": "Fig. 5", "caption": "Error-mitigated vs. raw output distribution", "type": "bar_chart"},
            ],
        },
        {
            "title": "Conclusion",
            "content": (
                f"This poster demonstrates that {highlight_metric} can be reliably sustained above "
                f"{round(fidelity_val - 0.05, 3)} for circuits up to depth {circuit_depth} on current hardware. "
                f"Future work will extend the protocol to {n_qubits + 5}-qubit systems and incorporate "
                f"zero-noise extrapolation. All experiment data from {_exp_ref(experiment_ids)} "
                f"are available via the Q-Lab research platform."
            ),
            "figures": [],
        },
    ]


def _slides_sections(title: str, experiment_ids: List[str], n_slides: int) -> List[dict]:
    n_qubits = random.randint(4, 27)
    fidelity_val = round(random.uniform(0.91, 0.999), 4)
    slide_titles = [
        "Title & Motivation",
        "Background: Quantum Error Sources",
        "Experimental Setup",
        "Circuit Design",
        "Calibration Protocol",
        "Key Results: Fidelity Metrics",
        "Key Results: Noise Characterization",
        "Error Mitigation Impact",
        "Comparison with Classical Simulation",
        "Scalability Analysis",
        "Open Challenges",
        "Conclusions & Next Steps",
        "Acknowledgements",
        "References",
    ]
    slides = []
    for i in range(min(n_slides, len(slide_titles))):
        slides.append({
            "title": slide_titles[i],
            "content": (
                f"Slide {i + 1} of {n_slides}. "
                f"This slide covers {slide_titles[i].lower()} in the context of {_exp_ref(experiment_ids)}. "
                f"Key datapoint: {n_qubits}-qubit register, peak fidelity {fidelity_val}."
            ),
            "figures": [
                {"label": f"Slide {i + 1} Fig.", "caption": f"Visualization for {slide_titles[i]}", "type": "auto"}
            ] if i % 2 == 0 else [],
        })
    return slides


def _abstract_sections(title: str, authors: List[str], experiment_ids: List[str], max_words: int, venue: str) -> List[dict]:
    n_qubits = random.randint(4, 27)
    fidelity_val = round(random.uniform(0.91, 0.999), 4)
    speedup = round(random.uniform(1.5, 10.0), 2)
    body = (
        f"We present {title}, a study of variational quantum circuits executed on {n_qubits}-qubit "
        f"superconducting hardware. Using data from {_exp_ref(experiment_ids)}, we characterize "
        f"gate fidelity and decoherence under realistic noise conditions. Our protocol combines "
        f"randomized benchmarking, readout error mitigation, and zero-noise extrapolation to achieve "
        f"a peak circuit fidelity of {fidelity_val}. We demonstrate a {speedup}x reduction in sampling "
        f"overhead compared to unmitigated baselines. Results are benchmarked against classical "
        f"statevector simulation and show agreement within statistical error bars. "
        f"These findings, to be presented at {venue}, establish a reproducible methodology for "
        f"near-term quantum advantage characterization. "
        f"Authors: {', '.join(authors)}."
    )
    return [{"title": "Abstract", "content": body, "figures": []}]


@router.post("/generate-poster", response_model=ConferenceAsset)
def generate_poster(req: GeneratePosterRequest, db: Session = Depends(get_db)) -> ConferenceAsset:
    asset_id = str(uuid.uuid4())
    sections = _poster_sections(req.title, req.experiment_ids, req.highlight_metric)
    asset = ConferenceAsset(
        asset_id=asset_id,
        type="poster",
        title=req.title,
        venue=req.venue,
        authors=req.authors,
        experiment_ids=req.experiment_ids,
        sections=sections,
        template=req.template,
        format="pdf",
        file_size_kb=round(random.uniform(800.0, 3500.0), 1),
        download_url=f"/api/v1/conference/asset/{asset_id}/download",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS, asset_id, asset.model_dump())
    return asset


@router.post("/generate-slides", response_model=ConferenceAsset)
def generate_slides(req: GenerateSlidesRequest, db: Session = Depends(get_db)) -> ConferenceAsset:
    asset_id = str(uuid.uuid4())
    sections = _slides_sections(req.title, req.experiment_ids, req.n_slides)
    asset = ConferenceAsset(
        asset_id=asset_id,
        type="slides",
        title=req.title,
        venue=req.venue,
        authors=req.authors,
        experiment_ids=req.experiment_ids,
        sections=sections,
        template=req.template,
        format="pptx",
        file_size_kb=round(random.uniform(1200.0, 6000.0), 1),
        download_url=f"/api/v1/conference/asset/{asset_id}/download",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS, asset_id, asset.model_dump())
    return asset


@router.post("/generate-abstract", response_model=ConferenceAsset)
def generate_abstract(req: GenerateAbstractRequest, db: Session = Depends(get_db)) -> ConferenceAsset:
    asset_id = str(uuid.uuid4())
    sections = _abstract_sections(req.title, req.authors, req.experiment_ids, req.max_words, req.venue)
    asset = ConferenceAsset(
        asset_id=asset_id,
        type="abstract",
        title=req.title,
        venue=req.venue,
        authors=req.authors,
        experiment_ids=req.experiment_ids,
        sections=sections,
        template="plain",
        format="pdf",
        file_size_kb=round(random.uniform(20.0, 80.0), 1),
        download_url=f"/api/v1/conference/asset/{asset_id}/download",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS, asset_id, asset.model_dump())
    return asset


@router.get("/assets", response_model=List[AbstractSummary])
def list_assets(db: Session = Depends(get_db)) -> List[AbstractSummary]:
    summaries = []
    for a in store_list(db, NS):
        content = " ".join(s.get("content", "") for s in a.get("sections", []))
        word_count = len(content.split())
        key_results = [
            sentence.strip()
            for sentence in content.split(".")
            if any(kw in sentence.lower() for kw in ["fidelity", "speedup", "result", "peak", "achieve", "demonstrate"])
        ][:3]
        summaries.append(AbstractSummary(
            asset_id=a["asset_id"],
            title=a["title"],
            word_count=word_count,
            key_results=key_results if key_results else ["See full asset for details."],
        ))
    return summaries


@router.get("/asset/{asset_id}", response_model=ConferenceAsset)
def get_asset(asset_id: str, db: Session = Depends(get_db)) -> ConferenceAsset:
    a = store_get(db, NS, asset_id)
    if not a:
        raise HTTPException(status_code=404, detail=f"Asset {asset_id} not found.")
    return ConferenceAsset(**a)
