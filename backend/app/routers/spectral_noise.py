from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete

router = APIRouter(prefix="/api/v1/spectral-noise", tags=["Spectral Noise"])

NS = "spectral_analyses"


class NoisePSD(BaseModel):
    analysis_id: str
    backend: str
    qubit: int
    metric: str
    frequencies_hz: List[float]
    psd_values: List[float]
    noise_floor: float
    one_over_f_coefficient: float
    one_over_f_exponent: float
    white_noise_level: float
    dominant_frequency: Optional[float]
    tls_detected: bool
    tls_frequencies: List[float]
    created_at: str


class TLSReport(BaseModel):
    report_id: str
    backend: str
    qubit: int
    n_tls_detected: int
    tls_list: List[dict]
    mitigation_suggestions: List[str]
    created_at: str


class AnalyzeRequest(BaseModel):
    backend: str
    qubit: int
    metric: str
    duration_sec: int = 3600


class TLSDetectRequest(BaseModel):
    backend: str
    qubit: int


def _generate_noise_psd(metric: str) -> dict:
    """Generate realistic 1/f noise power spectral density data."""
    n_points = 50
    f_min = 1.0
    f_max = 100_000.0

    # Logarithmically spaced frequencies from 1 Hz to 100 kHz
    frequencies = [
        f_min * (f_max / f_min) ** (i / (n_points - 1))
        for i in range(n_points)
    ]

    # Metric-dependent noise parameters
    params = {
        "t1_fluctuation": {"alpha": 1.2, "coeff": 1e-9, "white": 5e-12},
        "t2_fluctuation": {"alpha": 0.9, "coeff": 3e-9, "white": 8e-12},
        "charge_noise": {"alpha": 1.0, "coeff": 2e-8, "white": 1e-11},
        "flux_noise": {"alpha": 0.85, "coeff": 5e-9, "white": 3e-12},
    }
    p = params.get(metric, params["charge_noise"])

    alpha = p["alpha"] + random.uniform(-0.1, 0.1)
    coeff = p["coeff"] * random.uniform(0.7, 1.4)
    white_noise = p["white"] * random.uniform(0.8, 1.2)
    noise_floor = white_noise * random.uniform(0.5, 0.9)

    # Simulate possible TLS (two-level system) bumps
    tls_detected = random.random() < 0.45
    tls_freqs = []
    if tls_detected:
        n_tls = random.randint(1, 3)
        tls_freqs = [random.uniform(500, 50000) for _ in range(n_tls)]

    psd_values = []
    for f in frequencies:
        # 1/f^alpha component + white noise floor
        psd = coeff / (f ** alpha) + white_noise
        # Add TLS Lorentzian bumps
        for tls_f in tls_freqs:
            gamma = tls_f * 0.05  # linewidth ~ 5% of center freq
            psd += (coeff * 0.3) * (gamma ** 2) / ((f - tls_f) ** 2 + gamma ** 2)
        # Add small random jitter
        psd *= random.uniform(0.95, 1.05)
        psd_values.append(max(psd, noise_floor))

    # Find dominant frequency (peak above 1/f baseline)
    dominant_freq = None
    if tls_freqs:
        dominant_freq = max(tls_freqs, key=lambda tf: 1 / (1 + abs(tf - 5000)))

    return {
        "frequencies_hz": [round(f, 4) for f in frequencies],
        "psd_values": [round(v, 20) for v in psd_values],
        "noise_floor": round(noise_floor, 20),
        "one_over_f_coefficient": round(coeff, 20),
        "one_over_f_exponent": round(alpha, 4),
        "white_noise_level": round(white_noise, 20),
        "dominant_frequency": round(dominant_freq, 2) if dominant_freq else None,
        "tls_detected": tls_detected,
        "tls_frequencies": [round(f, 2) for f in tls_freqs],
    }


@router.post("/analyze", response_model=NoisePSD)
def analyze(req: AnalyzeRequest, db: Session = Depends(get_db)) -> NoisePSD:
    valid_metrics = {"t1_fluctuation", "t2_fluctuation", "charge_noise", "flux_noise"}
    if req.metric not in valid_metrics:
        raise HTTPException(
            status_code=422,
            detail=f"metric must be one of {sorted(valid_metrics)}",
        )
    if req.qubit < 0:
        raise HTTPException(status_code=422, detail="qubit index must be >= 0")

    noise_data = _generate_noise_psd(req.metric)
    analysis_id = str(uuid.uuid4())

    record = NoisePSD(
        analysis_id=analysis_id,
        backend=req.backend,
        qubit=req.qubit,
        metric=req.metric,
        created_at=datetime.now(timezone.utc).isoformat(),
        **noise_data,
    )
    store_put(db, NS, analysis_id, record.model_dump())
    return record


@router.get("/analyses", response_model=List[NoisePSD])
def list_analyses(db: Session = Depends(get_db)) -> List[NoisePSD]:
    return [NoisePSD(**a) for a in store_list(db, NS)]


@router.get("/analysis/{analysis_id}", response_model=NoisePSD)
def get_analysis(analysis_id: str, db: Session = Depends(get_db)) -> NoisePSD:
    a = store_get(db, NS, analysis_id)
    if not a:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return NoisePSD(**a)


@router.post("/detect-tls", response_model=TLSReport)
def detect_tls(req: TLSDetectRequest, db: Session = Depends(get_db)) -> TLSReport:
    n_tls = random.randint(0, 3)

    tls_list = []
    for _ in range(n_tls):
        freq_ghz = round(random.uniform(4.0, 8.0), 4)
        coupling = round(random.uniform(0.5, 15.0), 3)   # MHz
        t_coh = round(random.uniform(0.1, 5.0), 3)        # microseconds
        tls_list.append(
            {
                "frequency_ghz": freq_ghz,
                "coupling_strength": coupling,
                "coherence_time_us": t_coh,
            }
        )

    suggestions = []
    if n_tls == 0:
        suggestions.append("No TLS defects detected — qubit environment appears clean.")
    else:
        suggestions.append(
            f"Detected {n_tls} TLS defect(s); consider frequency tuning to avoid resonances."
        )
        suggestions.append(
            "Apply dynamical decoupling sequences (CPMG or XY-8) to suppress TLS coupling."
        )
        if n_tls >= 2:
            suggestions.append(
                "High TLS density detected — inspect substrate surface and junction oxide quality."
            )
        if any(t["coupling_strength"] > 10 for t in tls_list):
            suggestions.append(
                "Strong TLS coupling (>10 MHz) detected; device may require re-fabrication."
            )

    report_id = str(uuid.uuid4())
    report = TLSReport(
        report_id=report_id,
        backend=req.backend,
        qubit=req.qubit,
        n_tls_detected=n_tls,
        tls_list=tls_list,
        mitigation_suggestions=suggestions,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS, report_id, report.model_dump())
    return report
