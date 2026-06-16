from __future__ import annotations
import uuid, math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/cross-bench", tags=["cross-bench"])

NS = "cross_bench_submissions"

PUBLISHED_BENCHMARKS: dict = {
    "qaoa_maxcut_3reg_20": {
        "name": "QAOA MaxCut — 3-Regular 20 Nodes",
        "description": "QAOA on 3-regular random graph, 20 nodes. Goemans-Williamson classical bound: 0.878.",
        "metric": "approximation_ratio", "higher_is_better": True,
        "classical_optimal": 1.0, "classical_polynomial": 0.878,
        "sota_value": 0.934, "sota_reference": "Harrigan et al. 2021 (Nature Physics)",
        "sota_n_qubits": 23, "sota_backend": "google_sycamore",
        "entries": [
            {"label": "Harrigan 2021", "value": 0.934, "n_qubits": 23, "backend": "Google Sycamore", "year": 2021, "doi": "10.1038/s41567-021-01287-z"},
            {"label": "Zhou 2020", "value": 0.891, "n_qubits": 23, "backend": "IBM Q", "year": 2020, "doi": "10.1103/PRXQuantum.1.020141"},
            {"label": "Farhi 2019", "value": 0.879, "n_qubits": 20, "backend": "Google XMon", "year": 2019, "doi": "arxiv:1910.08187"},
        ],
    },
    "vqe_h2_chemical_accuracy": {
        "name": "VQE — H₂ Molecule Chemical Accuracy",
        "description": "VQE ground state energy for H₂. Chemical accuracy = 1.6 mHartree from FCI reference.",
        "metric": "energy_error_mhartree", "higher_is_better": False,
        "classical_optimal": 0.0, "classical_polynomial": None,
        "sota_value": 0.8, "sota_reference": "Peruzzo et al. 2014 (Nature Comm.)",
        "sota_n_qubits": 2, "sota_backend": "photonic",
        "entries": [
            {"label": "Peruzzo 2014", "value": 0.8, "n_qubits": 2, "backend": "Photonic", "year": 2014, "doi": "10.1038/ncomms5213"},
            {"label": "O'Malley 2016", "value": 1.4, "n_qubits": 2, "backend": "Google Xmon", "year": 2016, "doi": "10.1103/PhysRevX.6.031007"},
            {"label": "Nam 2020", "value": 1.0, "n_qubits": 2, "backend": "IonQ", "year": 2020, "doi": "10.1038/s41534-020-0259-3"},
        ],
    },
    "quantum_volume": {
        "name": "Quantum Volume Record",
        "description": "Quantum Volume (QV) as defined by IBM. Measures effective qubit number accounting for gate fidelity.",
        "metric": "quantum_volume", "higher_is_better": True,
        "classical_optimal": None, "classical_polynomial": None,
        "sota_value": 524288, "sota_reference": "Quantinuum H2-1 (2024)",
        "sota_n_qubits": 32, "sota_backend": "quantinuum_h2_1",
        "entries": [
            {"label": "Quantinuum 2024", "value": 524288, "n_qubits": 32, "backend": "H2-1", "year": 2024, "doi": "arxiv:2402.00935"},
            {"label": "Quantinuum 2023", "value": 65536, "n_qubits": 20, "backend": "H1-1", "year": 2023, "doi": "arxiv:2301.07059"},
            {"label": "IBM 2021", "value": 512, "n_qubits": 10, "backend": "IBM Eagle", "year": 2021, "doi": "arxiv:2008.08571"},
        ],
    },
    "rb_1q_gate_fidelity": {
        "name": "Randomized Benchmarking — 1Q Gate Fidelity",
        "description": "Average single-qubit Clifford gate fidelity via randomized benchmarking. Record on trapped-ion hardware.",
        "metric": "average_gate_fidelity", "higher_is_better": True,
        "classical_optimal": 1.0, "classical_polynomial": None,
        "sota_value": 0.999999, "sota_reference": "Harty et al. 2014 (PRL)",
        "sota_n_qubits": 1, "sota_backend": "calcium_ion_trap",
        "entries": [
            {"label": "Harty 2014", "value": 0.999999, "n_qubits": 1, "backend": "Ca+ ion trap", "year": 2014, "doi": "10.1103/PhysRevLett.113.220501"},
            {"label": "Quantinuum 2023", "value": 0.99997, "n_qubits": 1, "backend": "H2-1", "year": 2023, "doi": "arxiv:2301.07059"},
            {"label": "Google 2023", "value": 0.9998, "n_qubits": 1, "backend": "Sycamore", "year": 2023, "doi": "arxiv:2307.14192"},
        ],
    },
    "xeb_2q_fidelity": {
        "name": "XEB — Two-Qubit Gate Fidelity",
        "description": "Cross-entropy benchmarking of two-qubit gate fidelity. Google Sycamore ECR gate record.",
        "metric": "xeb_fidelity", "higher_is_better": True,
        "classical_optimal": 1.0, "classical_polynomial": None,
        "sota_value": 0.9985, "sota_reference": "Google Quantum AI 2023",
        "sota_n_qubits": 2, "sota_backend": "google_sycamore_70",
        "entries": [
            {"label": "Google 2023", "value": 0.9985, "n_qubits": 2, "backend": "Sycamore 70Q", "year": 2023, "doi": "arxiv:2307.14192"},
            {"label": "IBM 2023", "value": 0.9975, "n_qubits": 2, "backend": "ibm_brisbane", "year": 2023, "doi": "arxiv:2309.02194"},
            {"label": "IonQ 2023", "value": 0.9970, "n_qubits": 2, "backend": "Aria", "year": 2023, "doi": "arxiv:2303.12815"},
        ],
    },
}

class CompareRequest(BaseModel):
    benchmark_id: str
    your_value: float
    n_qubits: int = 1
    backend: str = ""
    label: str = "Your Result"
    run_ids: list[str] = []

class CompareResult(BaseModel):
    benchmark_id: str
    benchmark_name: str
    metric: str
    higher_is_better: bool
    your_value: float
    your_percentile: float
    sota_value: float
    sota_reference: str
    classical_polynomial: float | None
    beats_sota: bool
    beats_classical: bool
    rank: int
    total_entries: int
    gap_to_sota_pct: float
    gap_to_classical_pct: float | None
    all_entries: list[dict]
    verdict: str
    generated_at: str

@router.post("/compare", response_model=CompareResult)
def compare_to_benchmark(req: CompareRequest, db: Session = Depends(get_db)):
    if req.benchmark_id not in PUBLISHED_BENCHMARKS:
        raise HTTPException(404, f"Benchmark {req.benchmark_id} not found")
    bm = PUBLISHED_BENCHMARKS[req.benchmark_id]
    your_entry = {"label": req.label, "value": req.your_value, "n_qubits": req.n_qubits, "backend": req.backend, "year": 2026, "doi": None, "is_yours": True}
    user_subs = [r for r in store_list(db, NS) if r.get("benchmark_id") == req.benchmark_id]
    all_entries = bm["entries"] + [{"is_yours": False, **e} for e in user_subs] + [your_entry]
    hib = bm["higher_is_better"]
    all_sorted = sorted(all_entries, key=lambda e: e["value"], reverse=hib)
    rank = next((i+1 for i, e in enumerate(all_sorted) if e.get("is_yours")), len(all_sorted))
    vals = [e["value"] for e in all_sorted]
    n_better = sum(1 for v in vals if (v > req.your_value if hib else v < req.your_value))
    percentile = (1 - n_better / len(vals)) * 100
    gap_to_sota = abs(req.your_value - bm["sota_value"]) / max(abs(bm["sota_value"]), 1e-10) * 100
    gap_classical = None
    if bm["classical_polynomial"] is not None:
        gap_classical = abs(req.your_value - bm["classical_polynomial"]) / max(abs(bm["classical_polynomial"]), 1e-10) * 100
    beats_sota = req.your_value > bm["sota_value"] if hib else req.your_value < bm["sota_value"]
    beats_classical = False
    if bm["classical_polynomial"] is not None:
        beats_classical = req.your_value > bm["classical_polynomial"] if hib else req.your_value < bm["classical_polynomial"]
    if beats_sota:
        verdict = "New state-of-the-art! Consider submitting to arXiv."
    elif beats_classical:
        verdict = f"Beats classical polynomial bound ({bm['classical_polynomial']:.3f}). Strong result."
    elif percentile >= 75:
        verdict = f"Top {100-int(percentile)}% of published results. Competitive performance."
    elif percentile >= 50:
        verdict = "Above median published performance."
    else:
        verdict = f"Gap to SOTA: {gap_to_sota:.1f}%. Room for improvement."
    sub_id = str(uuid.uuid4())
    store_put(db, NS, sub_id, {"id": sub_id, "benchmark_id": req.benchmark_id, **your_entry})
    return CompareResult(
        benchmark_id=req.benchmark_id, benchmark_name=bm["name"],
        metric=bm["metric"], higher_is_better=hib,
        your_value=req.your_value, your_percentile=round(percentile, 1),
        sota_value=bm["sota_value"], sota_reference=bm["sota_reference"],
        classical_polynomial=bm.get("classical_polynomial"),
        beats_sota=beats_sota, beats_classical=beats_classical,
        rank=rank, total_entries=len(all_sorted),
        gap_to_sota_pct=round(gap_to_sota, 2),
        gap_to_classical_pct=round(gap_classical, 2) if gap_classical is not None else None,
        all_entries=all_sorted, verdict=verdict,
        generated_at=datetime.now(timezone.utc).isoformat(),
    )

@router.get("/benchmarks")
def list_benchmarks():
    return {"benchmarks": [{"id": k, "name": v["name"], "description": v["description"], "metric": v["metric"], "higher_is_better": v["higher_is_better"], "sota_value": v["sota_value"], "sota_reference": v["sota_reference"], "n_published_entries": len(v["entries"])} for k, v in PUBLISHED_BENCHMARKS.items()]}

@router.get("/benchmarks/{benchmark_id}")
def get_benchmark(benchmark_id: str):
    if benchmark_id not in PUBLISHED_BENCHMARKS:
        raise HTTPException(404, "benchmark not found")
    return PUBLISHED_BENCHMARKS[benchmark_id]
