from __future__ import annotations
import uuid, math
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/noise-marketplace", tags=["noise-marketplace"])

NS_MODELS = "noise_market_listings"
NS_DOWNLOADS = "noise_market_downloads"

SEED_MODELS = [
    {"name": "ibm_brisbane_2024_q1", "backend": "ibm_brisbane", "description": "Empirically calibrated noise model for ibm_brisbane Q1 2024 from 10k+ randomized benchmarking circuits. Includes T1/T2 relaxation, depolarizing, and SPAM errors.", "model_type": "empirical", "n_qubits": 127, "date_captured": "2024-01-15", "author": "ibm_calibration_team", "institution": "IBM Research", "downloads": 2341, "stars": 187, "tags": ["ibm","superconducting","empirical","brisbane"], "fidelity_error": 0.0003, "methods": ["randomized_benchmarking","process_tomography","ptm"]},
    {"name": "ionq_aria_depolarizing_2024", "backend": "ionq_aria_1", "description": "IonQ Aria 1 depolarizing noise model with realistic MS gate errors. Validated against XEB data. All-to-all connectivity modeled accurately.", "model_type": "fitted_depolarizing", "n_qubits": 25, "date_captured": "2024-03-01", "author": "ionq_research", "institution": "IonQ", "downloads": 891, "stars": 94, "tags": ["ionq","trapped-ion","depolarizing","aria"], "fidelity_error": 0.0001, "methods": ["xeb","direct_fidelity_estimation"]},
    {"name": "fake_ibm_127_thermal", "backend": "ibm_generic_127", "description": "Thermal relaxation + depolarizing noise model matching median IBM Eagle r3 specifications. Suitable for realistic simulation without hardware access.", "model_type": "thermal_relaxation", "n_qubits": 127, "date_captured": "2024-06-01", "author": "qlab_community", "institution": "Open Source", "downloads": 5823, "stars": 412, "tags": ["ibm","superconducting","thermal","simulation","free"], "fidelity_error": 0.001, "methods": ["published_specs"]},
    {"name": "rigetti_ankaa2_crosstalk_2024", "backend": "rigetti_ankaa_2", "description": "Comprehensive noise model including ZZ crosstalk terms between neighboring qubits. Captures non-Markovian effects observed in Rigetti Ankaa-2.", "model_type": "crosstalk_aware", "n_qubits": 84, "date_captured": "2024-04-10", "author": "rigetti_team", "institution": "Rigetti Computing", "downloads": 634, "stars": 71, "tags": ["rigetti","superconducting","crosstalk","ankaa"], "fidelity_error": 0.0005, "methods": ["cross_rb","simultaneous_rb","ptm"]},
    {"name": "generic_photonic_loss_model", "backend": "generic_photonic", "description": "Photon loss model for linear optical quantum computing. Includes beamsplitter errors and detector efficiency < 1. Compatible with PennyLane.", "model_type": "loss_model", "n_qubits": 8, "date_captured": "2024-02-20", "author": "photon_research", "institution": "University of Vienna", "downloads": 428, "stars": 55, "tags": ["photonic","loss","linear-optical","pennylane"], "fidelity_error": 0.01, "methods": ["hong_ou_mandel","homodyne_tomography"]},
]

class NoiseModel(BaseModel):
    model_id: str
    name: str
    backend: str
    description: str
    model_type: str
    n_qubits: int
    date_captured: str
    published_at: str
    author: str
    institution: str
    downloads: int
    stars: int
    tags: list[str]
    fidelity_error: float
    methods: list[str]
    qasm_snippet: str
    qiskit_snippet: str
    pennylane_snippet: str

class PublishModelRequest(BaseModel):
    name: str
    backend: str
    description: str
    model_type: str = "empirical"
    n_qubits: int = 5
    date_captured: str = ""
    author: str = "anonymous"
    institution: str = ""
    tags: list[str] = []
    fidelity_error: float = 0.001
    methods: list[str] = []

class ApplyModelRequest(BaseModel):
    model_id: str
    circuit_qasm: str
    n_shots: int = 1024

def _make_snippets(m: dict) -> tuple[str, str, str]:
    qasm = f"// Noise model: {m['name']}\n// Apply via Qiskit AER before executing your circuit"
    qiskit = f"""from qiskit_aer.noise import NoiseModel, depolarizing_error, thermal_relaxation_error
import numpy as np

# Load {m['name']} noise model
noise_model = NoiseModel()
# Single-qubit depolarizing
p1q = {m['fidelity_error']:.6f}
noise_model.add_all_qubit_quantum_error(depolarizing_error(p1q, 1), ['u1', 'u2', 'u3'])
# Two-qubit depolarizing
p2q = {m['fidelity_error'] * 10:.6f}
noise_model.add_all_qubit_quantum_error(depolarizing_error(p2q, 2), ['cx', 'ecr'])
# T1/T2 thermal relaxation
t1, t2 = {m.get('t1_us', 280):.0f}e-6, {m.get('t2_us', 150):.0f}e-6
gate_time = 50e-9
noise_model.add_all_qubit_quantum_error(
    thermal_relaxation_error(t1, t2, gate_time), ['u3']
)"""
    pennylane = f"""import pennylane as qml

# {m['name']} noise model for PennyLane
# Use with qml.device('default.mixed', ...)
def add_noise(circuit):
    depol_strength = {m['fidelity_error']:.6f}
    readout_error = {m['fidelity_error'] * 5:.6f}
    # Apply after each gate
    qml.DepolarizingChannel(depol_strength, wires=0)
    qml.BitFlip(readout_error, wires=0)
    return circuit"""
    return qasm, qiskit, pennylane

def _seed_db(db: Session):
    seed_records = []
    for s in SEED_MODELS:
        mid = str(uuid.uuid4())
        q, qi, pl = _make_snippets(s)
        record = {
            "model_id": mid,
            "published_at": datetime.now(timezone.utc).isoformat(),
            "qasm_snippet": q,
            "qiskit_snippet": qi,
            "pennylane_snippet": pl,
            **s,
        }
        seed_records.append((mid, record))
    store_seed(db, NS_MODELS, seed_records)

@router.get("/", response_model=dict)
def list_models(model_type: str | None = None, backend: str | None = None, sort_by: str = "downloads", db: Session = Depends(get_db)):
    _seed_db(db)
    models = [NoiseModel(**r) for r in store_list(db, NS_MODELS)]
    if model_type:
        models = [m for m in models if m.model_type == model_type]
    if backend:
        models = [m for m in models if backend in m.backend]
    models.sort(key=lambda m: m.downloads if sort_by == "downloads" else m.stars, reverse=True)
    all_models = [NoiseModel(**r) for r in store_list(db, NS_MODELS)]
    return {"models": models, "total": len(models),
            "stats": {"total_downloads": sum(m.downloads for m in all_models), "total_models": len(all_models), "model_types": list({m.model_type for m in all_models})}}

@router.get("/{model_id}", response_model=NoiseModel)
def get_model(model_id: str, db: Session = Depends(get_db)):
    data = store_get(db, NS_MODELS, model_id)
    if data is None:
        raise HTTPException(404, "model not found")
    data["downloads"] += 1
    store_put(db, NS_MODELS, model_id, data)
    dl_key = model_id
    dl_data = store_get(db, NS_DOWNLOADS, dl_key) or {"count": 0}
    dl_data["count"] = dl_data.get("count", 0) + 1
    store_put(db, NS_DOWNLOADS, dl_key, dl_data)
    return NoiseModel(**data)

@router.post("/", response_model=NoiseModel)
def publish_model(req: PublishModelRequest, db: Session = Depends(get_db)):
    mid = str(uuid.uuid4())
    q, qi, pl = _make_snippets(req.model_dump())
    record = {
        "model_id": mid,
        "published_at": datetime.now(timezone.utc).isoformat(),
        "downloads": 0,
        "stars": 0,
        "qasm_snippet": q,
        "qiskit_snippet": qi,
        "pennylane_snippet": pl,
        **req.model_dump(),
    }
    store_put(db, NS_MODELS, mid, record)
    return NoiseModel(**record)

@router.post("/{model_id}/apply")
def apply_model(model_id: str, req: ApplyModelRequest, db: Session = Depends(get_db)):
    data = store_get(db, NS_MODELS, model_id)
    if data is None:
        raise HTTPException(404, "model not found")
    import random; rng = random.Random(hash(model_id + req.circuit_qasm) & 0xFFFFFF)
    m = NoiseModel(**data)
    n_gates = max(1, req.circuit_qasm.count(";") - 3)
    noiseless_fid = (1 - m.fidelity_error * 0.1) ** n_gates
    noisy_fid = (1 - m.fidelity_error) ** n_gates
    n_q = max(2, req.circuit_qasm.count("qubit"))
    ideal = {format(i, f"0{min(n_q,4)}b"): rng.randint(50, 200) for i in range(2**min(n_q,4))}
    noisy = {k: max(0, int(v * noisy_fid + rng.gauss(0, math.sqrt(v * 0.05)))) for k, v in ideal.items()}
    return {"model_id": model_id, "model_name": m.name, "noiseless_fidelity_estimate": round(noiseless_fid, 6), "noisy_fidelity_estimate": round(noisy_fid, 6), "fidelity_degradation": round(noiseless_fid - noisy_fid, 6), "ideal_counts": ideal, "noisy_counts": noisy, "noise_method": m.model_type}
