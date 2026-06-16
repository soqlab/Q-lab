from __future__ import annotations

import math
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/multi-comparisons", tags=["multi-comparisons"])

# ---------------------------------------------------------------------------
# Statistical helpers (no scipy)
# ---------------------------------------------------------------------------

def _normal_cdf(z: float) -> float:
    sign = 1.0 if z >= 0 else -1.0; z = abs(z)
    t = 1.0 / (1.0 + 0.2316419*z)
    poly = t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))))
    prob = 1.0 - math.exp(-0.5*z*z)/math.sqrt(2*math.pi)*poly
    return prob if sign > 0 else 1.0 - prob

def _normal_ppf(p: float) -> float:
    if p <= 0.0: return -8.0
    if p >= 1.0: return 8.0
    t = math.sqrt(-2.0*math.log(p if p<0.5 else 1-p))
    z = t - (2.515517+0.802853*t+0.010328*t*t)/(1+1.432788*t+0.189269*t*t+0.001308*t*t*t)
    return -z if p < 0.5 else z

def _t_cdf(t: float, df: int) -> float:
    x = df / (df + t*t); a, b = df/2.0, 0.5
    if x <= 0.0: return 1.0
    if x >= 1.0: return 0.0
    lbeta = math.lgamma(a)+math.lgamma(b)-math.lgamma(a+b)
    front = math.exp(a*math.log(x)+b*math.log(1-x)-lbeta)/a
    FPMIN = 1e-30; qab=a+b; qap=a+1.0; qam=a-1.0
    c=1.0; d=1.0-qab*x/(a+1.0); d=1.0/max(abs(d),FPMIN); h=d
    for m in range(1, 201):
        m2=2*m; aa=m*(b-m)*x/((qam+m2)*(a+m2))
        d=1.0+aa*d; d=1.0/max(abs(d),FPMIN); c=1.0+aa/c; c=max(abs(c),FPMIN); h*=d*c
        aa=-(a+m)*(qab+m)*x/((a+m2)*(qap+m2))
        d=1.0+aa*d; d=1.0/max(abs(d),FPMIN); c=1.0+aa/c; c=max(abs(c),FPMIN)
        delta=d*c; h*=delta
        if abs(delta-1.0)<1e-10: break
    return min(1.0, max(0.0, front*h))

def _bonferroni(ps: List[float], _: float) -> List[float]:
    return [min(1.0, p*len(ps)) for p in ps]

def _holm(ps: List[float], _: float) -> List[float]:
    n=len(ps); indexed=sorted(enumerate(ps),key=lambda x:x[1]); corr=[0.0]*n
    for rank,(i,p) in enumerate(indexed): corr[i]=min(1.0,p*(n-rank))
    order=[x[0] for x in indexed]
    for k in range(1,n): corr[order[k]]=max(corr[order[k]],corr[order[k-1]])
    return corr

def _bh(ps: List[float], _: float) -> List[float]:
    n=len(ps); indexed=sorted(enumerate(ps),key=lambda x:x[1]); corr=[0.0]*n; mn=1.0
    for rank in range(n-1,-1,-1):
        i,p=indexed[rank]; mn=min(mn,p*n/(rank+1)); corr[i]=min(1.0,mn)
    return corr

def _by(ps: List[float], _: float) -> List[float]:
    n=len(ps); cn=sum(1.0/k for k in range(1,n+1)); indexed=sorted(enumerate(ps),key=lambda x:x[1])
    corr=[0.0]*n; mn=1.0
    for rank in range(n-1,-1,-1):
        i,p=indexed[rank]; mn=min(mn,p*n*cn/(rank+1)); corr[i]=min(1.0,mn)
    return corr

_METHODS = {"bonferroni": _bonferroni, "holm": _holm, "bh": _bh, "by": _by}

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CorrectPayload(BaseModel):
    p_values: List[float]; method: Optional[str]="bh"; alpha: Optional[float]=0.05
    labels: Optional[List[str]]=None

class PowerPayload(BaseModel):
    effect_size: float; alpha: Optional[float]=0.05; power: Optional[float]=0.80; n_groups: Optional[int]=1

class EquivPayload(BaseModel):
    mean_a: float; std_a: float; n_a: int; mean_b: float; std_b: float; n_b: int; margin: float

class StudyItem(BaseModel):
    value: float; uncertainty: float; n_shots: int

class MetaPayload(BaseModel):
    studies: List[StudyItem]

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/correct")
def correct_pvalues(payload: CorrectPayload):
    ps = payload.p_values
    if not ps: raise HTTPException(status_code=400, detail="p_values list is empty.")
    if any(p < 0 or p > 1 for p in ps): raise HTTPException(status_code=400, detail="All p-values must be in [0,1].")
    method = (payload.method or "bh").lower()
    if method not in _METHODS: raise HTTPException(status_code=400, detail=f"Unknown method. Valid: {list(_METHODS)}")
    alpha = payload.alpha or 0.05
    labels = payload.labels or [f"test_{i+1}" for i in range(len(ps))]
    if len(labels) != len(ps): raise HTTPException(status_code=400, detail="labels length must match p_values.")
    corrected = _METHODS[method](ps, alpha)
    sorted_orig = sorted(enumerate(ps), key=lambda x: x[1])
    results = [{"label": labels[i], "original_p": round(ps[i],6), "corrected_p": round(corrected[i],6),
                "significant": corrected[i] < alpha, "rank": rank+1}
               for rank,(i,_) in enumerate(sorted_orig)]
    results.sort(key=lambda x: x["rank"])
    n_sig = sum(1 for r in results if r["significant"])
    fdr_q = round(corrected[sorted_orig[-1][0]],6) if method in ("bh","by") else None
    recs = []
    if n_sig == 0: recs.append("No significant results — consider increasing sample size.")
    if method == "bonferroni" and len(ps) > 10: recs.append("Bonferroni is conservative with many tests; consider Holm or BH.")
    if n_sig / max(len(ps),1) > 0.5: recs.append("Over 50% significant — verify hypotheses are independent.")
    return {"method": method, "alpha": alpha, "results": results, "n_significant": n_sig, "n_total": len(ps),
            "fdr_q": fdr_q, "family_wise_error": round(1-(1-alpha)**len(ps),4), "recommendations": recs}

@router.post("/power-analysis")
def power_analysis(payload: PowerPayload):
    d=max(payload.effect_size,1e-6); alpha=payload.alpha or 0.05; power=payload.power or 0.80
    k=max(payload.n_groups or 1,1)
    za=_normal_ppf(1-alpha/2); zb=_normal_ppf(power)
    n_per=math.ceil(((za+zb)/d)**2); n_total=n_per*k
    se=math.sqrt(2.0/n_per) if n_per>0 else 1.0
    ach_pow=round(_normal_cdf(d/se-za),4)
    mde=round((za+zb)*math.sqrt(2.0/n_per),4) if n_per>0 else float("inf")
    return {"effect_size": d, "alpha": alpha, "target_power": power, "n_groups": k,
            "n_per_group": n_per, "n_total": n_total, "achievable_power": ach_pow,
            "minimum_detectable_effect": mde,
            "note": "Approximation via two-sample z-test; adjust for multiple groups if needed."}

@router.post("/equivalence-test")
def equivalence_test(payload: EquivPayload):
    if payload.margin <= 0: raise HTTPException(status_code=400, detail="margin must be positive.")
    diff = payload.mean_a - payload.mean_b
    se = math.sqrt(payload.std_a**2/max(payload.n_a,1)+payload.std_b**2/max(payload.n_b,1))
    if se == 0: raise HTTPException(status_code=400, detail="Pooled SE is zero.")
    df = max(1, payload.n_a+payload.n_b-2)
    t_lo=(diff+payload.margin)/se; t_hi=(diff-payload.margin)/se
    p_lo=round(1.0-_t_cdf(abs(t_lo),df)/2,6); p_hi=round(_t_cdf(abs(t_hi),df)/2,6)
    p_tost=round(max(p_lo,p_hi),6); equiv=p_tost<0.05
    return {"mean_difference": round(diff,6), "standard_error": round(se,6),
            "equivalence_margin": payload.margin, "t_lower": round(t_lo,4), "t_upper": round(t_hi,4),
            "p_lower": p_lo, "p_upper": p_hi, "p_tost": p_tost, "df": df, "equivalent": equiv,
            "interpretation": "Groups are statistically equivalent." if equiv else "Equivalence not established at alpha=0.05."}

@router.post("/meta-analysis")
def meta_analysis(payload: MetaPayload):
    studies=payload.studies
    if len(studies)<2: raise HTTPException(status_code=400, detail="At least 2 studies required.")
    vals=[s.value for s in studies]; vars_=[max(s.uncertainty**2,1e-12) for s in studies]
    ws=[1/v for v in vars_]; W=sum(ws)
    fe_mean=sum(w*v for w,v in zip(ws,vals))/W; fe_se=math.sqrt(1/W)
    fe_ci=(round(fe_mean-1.96*fe_se,6),round(fe_mean+1.96*fe_se,6))
    Q=sum(w*(v-fe_mean)**2 for w,v in zip(ws,vals)); k=len(studies); df=k-1
    I2=round(max(0.0,(Q-df)/Q)*100,2) if Q>0 else 0.0
    c=W-sum(w**2 for w in ws)/W; tau2=max(0.0,(Q-df)/c) if c>0 else 0.0
    ws_re=[1/(v+tau2) for v in vars_]; Wre=sum(ws_re)
    re_mean=sum(w*v for w,v in zip(ws_re,vals))/Wre; re_se=math.sqrt(1/Wre)
    re_ci=(round(re_mean-1.96*re_se,6),round(re_mean+1.96*re_se,6))
    forest=[{"study_index":i+1,"value":s.value,"uncertainty":s.uncertainty,
              "ci_low":round(s.value-1.96*s.uncertainty,6),"ci_high":round(s.value+1.96*s.uncertainty,6),
              "weight_pct":round(100*ws_re[i]/Wre,2)} for i,s in enumerate(studies)]
    return {"fixed_effects":{"mean":round(fe_mean,6),"se":round(fe_se,6),"ci_95":list(fe_ci)},
            "random_effects":{"mean":round(re_mean,6),"se":round(re_se,6),"ci_95":list(re_ci),"tau2":round(tau2,6)},
            "heterogeneity":{"Q":round(Q,4),"df":df,"I_squared_pct":I2,
                             "interpretation":"low" if I2<25 else "moderate" if I2<75 else "high"},
            "forest_plot_data":forest,"n_studies":k}
