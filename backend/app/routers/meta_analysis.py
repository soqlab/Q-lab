"""Meta-Analysis — pool quantum computing studies using fixed/random effects models."""

from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/meta-analysis", tags=["meta_analysis"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_STUDIES = "meta_studies"
NS_ANALYSES = "meta_analyses"

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class Study(BaseModel):
    study_id: str
    title: str
    authors: List[str]
    year: int
    effect_size: float
    std_error: float
    sample_size: int
    backend: str
    metric: str
    doi: Optional[str] = None
    added_at: str


class ForestPlotPoint(BaseModel):
    study_id: str
    title: str
    effect_size: float
    ci_lower: float
    ci_upper: float
    weight: float


class MetaAnalysis(BaseModel):
    analysis_id: str
    name: str
    metric: str
    studies: List[str]
    pooled_effect: float
    pooled_se: float
    i_squared: float
    q_statistic: float
    p_heterogeneity: float
    z_score: float
    p_value: float
    confidence_interval_95: List[float]
    model: str
    forest_plot_data: List[dict]
    created_at: str


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class StudyRequest(BaseModel):
    title: str
    authors: List[str]
    year: int
    effect_size: float
    std_error: float
    sample_size: int
    backend: str
    metric: str
    doi: Optional[str] = None


class AnalyzeRequest(BaseModel):
    name: str
    metric: str
    study_ids: List[str]
    model: str = "random"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _chi2_sf_approx(q: float, df: int) -> float:
    """Approximate chi-squared survival function using Wilson-Hilferty transformation."""
    if df <= 0:
        return 1.0
    if q <= 0:
        return 1.0
    mu = df
    sigma2 = 2.0 * df
    # Normal approximation: z = (q - mu) / sqrt(sigma2)
    z = (q - mu) / math.sqrt(sigma2)
    # Approximate p-value from z (one-tail upper)
    p = 0.5 * math.erfc(z / math.sqrt(2))
    return round(max(0.0, min(1.0, p)), 6)


def _normal_sf(z: float) -> float:
    """Two-tailed p-value from z-score using standard normal."""
    p = math.erfc(abs(z) / math.sqrt(2))
    return round(max(1e-15, min(1.0, p)), 8)


def _fixed_effects(effects: List[float], ses: List[float]) -> dict:
    """Inverse-variance weighted fixed-effects pooling."""
    weights = [1.0 / (se**2) for se in ses]
    total_weight = sum(weights)
    pooled_effect = sum(w * e for w, e in zip(weights, effects)) / total_weight
    pooled_se = math.sqrt(1.0 / total_weight)

    # Q statistic
    q = sum(w * (e - pooled_effect) ** 2 for w, e in zip(weights, effects))
    k = len(effects)
    df = k - 1
    i_squared = max(0.0, ((q - df) / q) * 100) if q > 0 else 0.0
    p_het = _chi2_sf_approx(q, df)

    return {
        "pooled_effect": pooled_effect,
        "pooled_se": pooled_se,
        "weights": weights,
        "q_statistic": q,
        "i_squared": i_squared,
        "p_heterogeneity": p_het,
    }


def _random_effects(effects: List[float], ses: List[float]) -> dict:
    """DerSimonian-Laird random-effects pooling."""
    fe = _fixed_effects(effects, ses)
    q = fe["q_statistic"]
    k = len(effects)
    df = k - 1
    weights_fe = [1.0 / (se**2) for se in ses]
    total_w = sum(weights_fe)
    sum_w2 = sum(w**2 for w in weights_fe)
    c = total_w - sum_w2 / total_w

    # Between-study variance tau^2 (DL estimator)
    tau2 = max(0.0, (q - df) / c) if c > 0 else 0.0

    weights_re = [1.0 / (se**2 + tau2) for se in ses]
    total_weight_re = sum(weights_re)
    pooled_effect = sum(w * e for w, e in zip(weights_re, effects)) / total_weight_re
    pooled_se = math.sqrt(1.0 / total_weight_re)

    return {
        "pooled_effect": pooled_effect,
        "pooled_se": pooled_se,
        "weights": weights_re,
        "q_statistic": q,
        "i_squared": fe["i_squared"],
        "p_heterogeneity": fe["p_heterogeneity"],
        "tau2": tau2,
    }


def _forest_plot_data(
    studies_data: List[dict], weights: List[float]
) -> List[dict]:
    total_weight = sum(weights) or 1.0
    points = []
    for study, w in zip(studies_data, weights):
        se = study["std_error"]
        ci_lower = round(study["effect_size"] - 1.96 * se, 6)
        ci_upper = round(study["effect_size"] + 1.96 * se, 6)
        points.append(
            ForestPlotPoint(
                study_id=study["study_id"],
                title=study["title"],
                effect_size=round(study["effect_size"], 6),
                ci_lower=ci_lower,
                ci_upper=ci_upper,
                weight=round(w / total_weight * 100, 2),
            ).model_dump()
        )
    return points


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/study", response_model=Study)
def add_study(body: StudyRequest, db: Session = Depends(get_db)):
    """Add a study to the meta-analysis database."""
    if body.std_error <= 0:
        raise HTTPException(status_code=422, detail="std_error must be positive")
    if body.sample_size < 1:
        raise HTTPException(status_code=422, detail="sample_size must be at least 1")

    study_id = str(uuid.uuid4())
    study = Study(
        study_id=study_id,
        title=body.title,
        authors=body.authors,
        year=body.year,
        effect_size=body.effect_size,
        std_error=body.std_error,
        sample_size=body.sample_size,
        backend=body.backend,
        metric=body.metric,
        doi=body.doi,
        added_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_STUDIES, study_id, study.model_dump())
    return study


@router.get("/studies")
def list_studies(db: Session = Depends(get_db)):
    """List all studies in the database."""
    records = store_list(db, NS_STUDIES)
    return {"count": len(records), "studies": records}


@router.post("/analyze", response_model=MetaAnalysis)
def run_meta_analysis(body: AnalyzeRequest, db: Session = Depends(get_db)):
    """Run a fixed or random effects meta-analysis over the specified studies."""
    if body.model not in ("random", "fixed"):
        raise HTTPException(status_code=422, detail="model must be 'random' or 'fixed'")
    if len(body.study_ids) < 2:
        raise HTTPException(status_code=422, detail="at least 2 studies are required for meta-analysis")

    # Resolve studies
    studies_data = []
    for sid in body.study_ids:
        s = store_get(db, NS_STUDIES, sid)
        if not s:
            raise HTTPException(status_code=404, detail=f"study '{sid}' not found")
        if s["metric"] != body.metric:
            raise HTTPException(
                status_code=422,
                detail=f"study '{sid}' has metric '{s['metric']}', expected '{body.metric}'",
            )
        studies_data.append(s)

    effects = [s["effect_size"] for s in studies_data]
    ses = [s["std_error"] for s in studies_data]

    if body.model == "random":
        stats = _random_effects(effects, ses)
    else:
        stats = _fixed_effects(effects, ses)

    pooled_effect = round(stats["pooled_effect"], 6)
    pooled_se = round(stats["pooled_se"], 6)
    z_score = round(pooled_effect / pooled_se, 4) if pooled_se > 0 else 0.0
    p_value = _normal_sf(z_score)
    ci95 = [round(pooled_effect - 1.96 * pooled_se, 6), round(pooled_effect + 1.96 * pooled_se, 6)]
    forest = _forest_plot_data(studies_data, stats["weights"])

    analysis_id = str(uuid.uuid4())
    analysis = MetaAnalysis(
        analysis_id=analysis_id,
        name=body.name,
        metric=body.metric,
        studies=body.study_ids,
        pooled_effect=pooled_effect,
        pooled_se=pooled_se,
        i_squared=round(stats["i_squared"], 2),
        q_statistic=round(stats["q_statistic"], 4),
        p_heterogeneity=stats["p_heterogeneity"],
        z_score=z_score,
        p_value=p_value,
        confidence_interval_95=ci95,
        model=body.model,
        forest_plot_data=forest,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_ANALYSES, analysis_id, analysis.model_dump())
    return analysis


@router.get("/analyses")
def list_analyses(db: Session = Depends(get_db)):
    """List all completed meta-analyses."""
    records = store_list(db, NS_ANALYSES)
    summaries = [
        {k: v for k, v in a.items() if k != "forest_plot_data"}
        for a in records
    ]
    return {"count": len(records), "analyses": summaries}


@router.get("/analysis/{analysis_id}", response_model=MetaAnalysis)
def get_analysis(analysis_id: str, db: Session = Depends(get_db)):
    """Retrieve a single meta-analysis with full forest plot data."""
    analysis = store_get(db, NS_ANALYSES, analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="analysis not found")
    return analysis
