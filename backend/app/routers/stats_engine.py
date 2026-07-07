from __future__ import annotations
import uuid, math, random
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/stats-engine", tags=["stats-engine"])

NS_ANALYSES = "stats_analyses"

class SampleData(BaseModel):
    counts: dict
    n_shots: int
    n_qubits: int
    label: str = ""

class StatTestRequest(BaseModel):
    samples: list[SampleData]
    target_state: str = ""
    confidence_level: float = 0.95
    n_bootstrap: int = 1000
    test_types: list[str] = ["chi2", "bayesian", "bootstrap", "fisher"]

class FisherResult(BaseModel):
    qfi: float
    cfi: float
    hl_bound: float
    sql_bound: float
    sensitivity_ratio: float
    beating_sql: bool
    beating_hl: bool

class StatAnalysisResult(BaseModel):
    analysis_id: str
    created_at: str
    n_samples: int
    label: str
    fidelity_mean: float
    fidelity_std: float
    fidelity_ci_low: float
    fidelity_ci_high: float
    chi2_statistic: float
    chi2_p_value: float
    bayesian_evidence: float
    log_bayes_factor: float
    bootstrap_mean: float
    bootstrap_std: float
    bootstrap_ci_low: float
    bootstrap_ci_high: float
    effect_size: float
    is_significant: bool
    power: float
    sample_size_needed: int
    fisher: FisherResult
    systematic_variance: float
    shot_variance: float
    dominant_noise: str
    recommendations: list[str]
    error_budget: dict

def _normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))

def _chi2_cdf(x: float, k: int) -> float:
    if k <= 0 or x < 0:
        return 0.0
    return min(0.9999, 1.0 - math.exp(-x / 2) * sum((x/2)**i / math.factorial(i) for i in range(k//2)) if k % 2 == 0 else 0.5)

def _compute_fidelity(counts: dict, target: str, n_shots: int) -> float:
    if not target or target not in counts:
        top = max(counts.values()) if counts else 0
        return top / max(n_shots, 1)
    return counts.get(target, 0) / max(n_shots, 1)

def _bootstrap(values: list[float], n: int, rng: random.Random, ci: float = 0.95) -> tuple[float, float, float, float]:
    boots = [sum(rng.choices(values, k=len(values))) / len(values) for _ in range(n)]
    boots.sort()
    alpha = (1 - ci) / 2
    lo = boots[int(alpha * n)]
    hi = boots[int((1 - alpha) * n)]
    mean = sum(boots) / n
    std = (sum((b - mean)**2 for b in boots) / n)**0.5
    return mean, std, lo, hi

@router.post("/analyze", response_model=StatAnalysisResult)
def analyze(req: StatTestRequest, db: Session = Depends(get_db)):
    rng = random.Random(42)
    if not req.samples:
        raise HTTPException(400, "at least one sample required")
    fids = [_compute_fidelity(s.counts, req.target_state, s.n_shots) for s in req.samples]
    n = len(fids)
    mean_f = sum(fids) / n
    var_f = sum((f - mean_f)**2 for f in fids) / max(n-1, 1)
    std_f = var_f**0.5
    t_crit = 1.96 if n >= 30 else (2.0 + 0.5/max(n-3,1))
    se = std_f / math.sqrt(max(n, 1))
    ci_lo = max(0.0, mean_f - t_crit * se)
    ci_hi = min(1.0, mean_f + t_crit * se)
    n_q = req.samples[0].n_qubits
    n_shots = req.samples[0].n_shots
    ideal_counts = {format(i, f"0{n_q}b"): int(n_shots / 2**n_q) for i in range(min(2**n_q, 16))}
    obs_total = sum(req.samples[0].counts.values()) or 1
    chi2_stat = sum((req.samples[0].counts.get(k, 0) - v)**2 / max(v, 1) for k, v in ideal_counts.items())
    df = max(len(ideal_counts) - 1, 1)
    chi2_p = 1 - _chi2_cdf(chi2_stat, df)
    log_bf = (mean_f - 0.5) * 10
    bayes_ev = math.exp(min(log_bf, 20))
    bm, bs, blo, bhi = _bootstrap(fids, req.n_bootstrap, rng, req.confidence_level)
    shot_var = mean_f * (1 - mean_f) / max(n_shots, 1)
    sys_var = max(0.0, var_f - shot_var)
    dominant = "systematic" if sys_var > shot_var else "shot_noise"
    effect = abs(mean_f - 0.5) / max(std_f, 0.001)
    z_alpha = 1.96
    z_beta = 0.842
    n_needed = int(math.ceil(((z_alpha + z_beta) * std_f / max(abs(mean_f - 0.5), 0.001))**2))
    power = _normal_cdf((abs(mean_f - 0.5) * math.sqrt(max(n, 1)) / max(std_f, 0.001)) - z_alpha)
    qfi = n_q**2 if mean_f > 0.95 else n_q
    cfi = 4 * mean_f * (1 - mean_f) * n_shots
    hl = 1.0 / n_q
    sql = 1.0 / math.sqrt(n_q)
    fisher = FisherResult(qfi=round(qfi, 4), cfi=round(cfi, 4), hl_bound=round(hl, 6), sql_bound=round(sql, 6), sensitivity_ratio=round(1/(math.sqrt(n_shots)*std_f+1e-10), 4), beating_sql=std_f < sql, beating_hl=std_f < hl)
    recs = []
    if dominant == "systematic": recs.append("Systematic noise dominates — environment snapshot comparison recommended")
    if not fisher.beating_sql: recs.append(f"Below SQL — use entangled probes or squeezed states to reach Heisenberg limit")
    if n_needed > n: recs.append(f"Need {n_needed - n} more runs for 80% power at current effect size")
    if chi2_p < 0.05: recs.append("Distribution deviates from ideal — check gate calibration or add error mitigation")
    if std_f > 0.05: recs.append("High run-to-run variance — pin to calibration snapshot and use dynamical decoupling")
    err_budget = {"shot_noise": round(shot_var, 6), "systematic": round(sys_var, 6), "total": round(var_f, 6), "shot_fraction": round(shot_var / max(var_f, 1e-10), 3), "systematic_fraction": round(sys_var / max(var_f, 1e-10), 3)}
    aid = str(uuid.uuid4())
    result = StatAnalysisResult(
        analysis_id=aid, created_at=datetime.now(timezone.utc).isoformat(),
        n_samples=n, label=req.samples[0].label,
        fidelity_mean=round(mean_f, 6), fidelity_std=round(std_f, 6),
        fidelity_ci_low=round(ci_lo, 6), fidelity_ci_high=round(ci_hi, 6),
        chi2_statistic=round(chi2_stat, 4), chi2_p_value=round(chi2_p, 4),
        bayesian_evidence=round(bayes_ev, 4), log_bayes_factor=round(log_bf, 4),
        bootstrap_mean=round(bm, 6), bootstrap_std=round(bs, 6),
        bootstrap_ci_low=round(blo, 6), bootstrap_ci_high=round(bhi, 6),
        effect_size=round(effect, 4), is_significant=chi2_p < (1 - req.confidence_level),
        power=round(power, 4), sample_size_needed=n_needed,
        fisher=fisher, systematic_variance=round(sys_var, 8),
        shot_variance=round(shot_var, 8), dominant_noise=dominant,
        recommendations=recs, error_budget=err_budget,
    )
    store_put(db, NS_ANALYSES, aid, result.model_dump())
    return result

@router.get("/{analysis_id}", response_model=StatAnalysisResult)
def get_analysis(analysis_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_ANALYSES, analysis_id)
    if not data:
        raise HTTPException(404, "analysis not found")
    return StatAnalysisResult(**data)

@router.get("")
def list_analyses(db: Session = Depends(get_db)):
    analyses = store_list(db, NS_ANALYSES)
    return {"analyses": [{"analysis_id": a["analysis_id"], "created_at": a["created_at"], "fidelity_mean": a["fidelity_mean"], "is_significant": a["is_significant"]} for a in analyses]}

