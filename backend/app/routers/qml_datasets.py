from __future__ import annotations

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/qml-datasets", tags=["QML Datasets"])

NS_DATASETS = "qml_datasets"
NS_BENCHMARKS = "qml_benchmarks"


class QMLDataset(BaseModel):
    dataset_id: str
    name: str
    description: str
    task: str
    n_samples: int
    n_features: int
    n_qubits: int
    encoding: str
    benchmark_accuracy: float
    size_mb: float
    license: str
    authors: List[str]
    paper_doi: Optional[str]
    tags: List[str]
    download_url: str
    created_at: str


class BenchmarkRun(BaseModel):
    run_id: str
    dataset_id: str
    model_type: str
    n_params: int
    accuracy: float
    f1_score: float
    training_time_sec: float
    n_qubits_used: int
    optimizer: str
    created_at: str


class UploadDatasetRequest(BaseModel):
    name: str
    description: str
    task: str
    n_samples: int
    n_features: int
    n_qubits: int
    encoding: str
    license: str
    authors: List[str]
    paper_doi: Optional[str] = None
    tags: List[str] = []


class BenchmarkRequest(BaseModel):
    dataset_id: str
    model_type: str
    n_params: int
    optimizer: str = "adam"


_VALID_TASKS = {"classification", "regression", "generation", "reinforcement"}
_VALID_ENCODINGS = {"amplitude", "angle", "basis"}
_VALID_MODEL_TYPES = {"vqc", "qnn", "hybrid_cnn", "classical_baseline"}

# Accuracy baseline by model type — classical_baseline is deliberately lower
_MODEL_ACCURACY_BASE = {
    "vqc": (0.78, 0.93),
    "qnn": (0.75, 0.91),
    "hybrid_cnn": (0.82, 0.96),
    "classical_baseline": (0.68, 0.88),
}

_SEED_DATASETS = [
    {
        "name": "MNIST-Quantum-4qubit",
        "description": (
            "4-class subset of MNIST encoded into 4-qubit amplitude states. "
            "Designed for benchmarking VQC classifiers against classical CNNs."
        ),
        "task": "classification",
        "n_samples": 10000,
        "n_features": 16,
        "n_qubits": 4,
        "encoding": "amplitude",
        "benchmark_accuracy": 0.921,
        "size_mb": 12.4,
        "license": "CC-BY-4.0",
        "authors": ["Farhi, E.", "Neven, H."],
        "paper_doi": "10.48550/arXiv.1802.06002",
        "tags": ["image", "classification", "4-qubit", "mnist", "vqc"],
        "download_url": "https://qml-hub.q-lab.io/datasets/mnist-quantum-4qubit.hdf5",
    },
    {
        "name": "Quantum-Phase-Classification",
        "description": (
            "Ground-state configurations of 1D transverse-field Ising model "
            "spanning paramagnetic and ferromagnetic phases. Labels are phase indices."
        ),
        "task": "classification",
        "n_samples": 25000,
        "n_features": 64,
        "n_qubits": 8,
        "encoding": "angle",
        "benchmark_accuracy": 0.974,
        "size_mb": 38.1,
        "license": "MIT",
        "authors": ["Carrasquilla, J.", "Melko, R. G."],
        "paper_doi": "10.1038/nphys4035",
        "tags": ["condensed-matter", "phase-transition", "ising", "8-qubit"],
        "download_url": "https://qml-hub.q-lab.io/datasets/quantum-phase-classification.hdf5",
    },
    {
        "name": "VQE-Energy-Landscapes",
        "description": (
            "Energy landscape samples for H2, LiH, and BeH2 molecules "
            "computed with VQE at varying bond lengths. Target: ground-state energy."
        ),
        "task": "regression",
        "n_samples": 8500,
        "n_features": 32,
        "n_qubits": 6,
        "encoding": "amplitude",
        "benchmark_accuracy": 0.963,
        "size_mb": 9.7,
        "license": "Apache-2.0",
        "authors": ["Peruzzo, A.", "McClean, J.", "Shadbolt, P."],
        "paper_doi": "10.1038/ncomms5213",
        "tags": ["chemistry", "vqe", "energy", "regression", "molecules"],
        "download_url": "https://qml-hub.q-lab.io/datasets/vqe-energy-landscapes.hdf5",
    },
    {
        "name": "Noise-Fingerprints",
        "description": (
            "Noise characterisation snapshots (T1, T2, gate errors, readout errors) "
            "collected across 12 IBM Quantum backends over 18 months. "
            "Suitable for noise prediction and anomaly detection."
        ),
        "task": "classification",
        "n_samples": 54000,
        "n_features": 128,
        "n_qubits": 5,
        "encoding": "angle",
        "benchmark_accuracy": 0.887,
        "size_mb": 67.2,
        "license": "CC-BY-NC-4.0",
        "authors": ["Nation, P. D.", "Kang, H.", "Sundaresan, N."],
        "paper_doi": "10.1103/PRXQuantum.2.040326",
        "tags": ["noise", "ibm", "characterization", "anomaly-detection", "5-qubit"],
        "download_url": "https://qml-hub.q-lab.io/datasets/noise-fingerprints.hdf5",
    },
    {
        "name": "Gate-Error-Prediction",
        "description": (
            "Two-qubit gate fidelity measurements from randomised benchmarking "
            "across multiple superconducting processors. Predict CX error rates "
            "from environmental covariates."
        ),
        "task": "regression",
        "n_samples": 15000,
        "n_features": 48,
        "n_qubits": 4,
        "encoding": "basis",
        "benchmark_accuracy": 0.849,
        "size_mb": 21.5,
        "license": "MIT",
        "authors": ["Proctor, T.", "Rudinger, K.", "Young, K."],
        "paper_doi": "10.1103/PhysRevLett.119.130502",
        "tags": ["gate-error", "benchmarking", "regression", "superconducting"],
        "download_url": "https://qml-hub.q-lab.io/datasets/gate-error-prediction.hdf5",
    },
    {
        "name": "Quantum-Advantage-Benchmarks",
        "description": (
            "Structured random circuit sampling outputs from 20–53 qubit devices, "
            "paired with classical simulation cross-entropy benchmarking scores. "
            "Reference dataset for quantum supremacy studies."
        ),
        "task": "classification",
        "n_samples": 3000,
        "n_features": 256,
        "n_qubits": 20,
        "encoding": "amplitude",
        "benchmark_accuracy": 0.812,
        "size_mb": 204.8,
        "license": "CC-BY-4.0",
        "authors": ["Arute, F.", "Arya, K.", "Babbush, R."],
        "paper_doi": "10.1038/s41586-019-1666-5",
        "tags": ["supremacy", "random-circuits", "xeb", "large-scale"],
        "download_url": "https://qml-hub.q-lab.io/datasets/quantum-advantage-benchmarks.hdf5",
    },
    {
        "name": "Molecular-Hamiltonians",
        "description": (
            "Qubit-mapped Pauli Hamiltonian representations of 200+ small organic "
            "molecules derived from PySCF/OpenFermion. Labels include ground-state "
            "energies, dipole moments, and HOMO-LUMO gaps."
        ),
        "task": "regression",
        "n_samples": 12000,
        "n_features": 512,
        "n_qubits": 12,
        "encoding": "amplitude",
        "benchmark_accuracy": 0.941,
        "size_mb": 145.6,
        "license": "Apache-2.0",
        "authors": ["McArdle, S.", "Endo, S.", "Aspuru-Guzik, A."],
        "paper_doi": "10.1103/RevModPhys.92.015003",
        "tags": ["chemistry", "hamiltonian", "molecules", "openfermion", "regression"],
        "download_url": "https://qml-hub.q-lab.io/datasets/molecular-hamiltonians.hdf5",
    },
    {
        "name": "Circuit-Complexity-Classes",
        "description": (
            "Randomly generated quantum circuits annotated with computational "
            "complexity class labels (BQP-easy, BQP-hard, QMA-complete proxies). "
            "Enables studies on learnability of circuit complexity."
        ),
        "task": "classification",
        "n_samples": 30000,
        "n_features": 96,
        "n_qubits": 10,
        "encoding": "basis",
        "benchmark_accuracy": 0.856,
        "size_mb": 55.3,
        "license": "CC-BY-4.0",
        "authors": ["Bravyi, S.", "Gosset, D.", "König, R."],
        "paper_doi": "10.1126/science.aag2302",
        "tags": ["complexity", "circuits", "classification", "bqp", "qma"],
        "download_url": "https://qml-hub.q-lab.io/datasets/circuit-complexity-classes.hdf5",
    },
]


def _build_seed_records() -> list[tuple[str, dict]]:
    """Build the 8 canonical QML dataset seed records."""
    records: list[tuple[str, dict]] = []
    for raw in _SEED_DATASETS:
        ds_id = str(uuid.uuid4())
        ds = QMLDataset(
            dataset_id=ds_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            **raw,
        )
        records.append((ds_id, ds.model_dump()))
    return records


@router.get("/", response_model=List[QMLDataset])
def list_datasets(db: Session = Depends(get_db)) -> List[QMLDataset]:
    store_seed(db, NS_DATASETS, _build_seed_records())
    return [QMLDataset(**d) for d in store_list(db, NS_DATASETS)]


@router.get("/{dataset_id}", response_model=QMLDataset)
def get_dataset(dataset_id: str, db: Session = Depends(get_db)) -> QMLDataset:
    d = store_get(db, NS_DATASETS, dataset_id)
    if not d:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return QMLDataset(**d)


@router.post("/upload", response_model=QMLDataset)
def upload_dataset(req: UploadDatasetRequest, db: Session = Depends(get_db)) -> QMLDataset:
    if req.task not in _VALID_TASKS:
        raise HTTPException(
            status_code=422,
            detail=f"task must be one of {sorted(_VALID_TASKS)}",
        )
    if req.encoding not in _VALID_ENCODINGS:
        raise HTTPException(
            status_code=422,
            detail=f"encoding must be one of {sorted(_VALID_ENCODINGS)}",
        )

    ds_id = str(uuid.uuid4())
    # Estimate size from samples × features (float32 = 4 bytes)
    size_mb = round((req.n_samples * req.n_features * 4) / (1024 ** 2), 2)
    benchmark_acc = round(random.uniform(0.70, 0.95), 4)

    ds = QMLDataset(
        dataset_id=ds_id,
        name=req.name,
        description=req.description,
        task=req.task,
        n_samples=req.n_samples,
        n_features=req.n_features,
        n_qubits=req.n_qubits,
        encoding=req.encoding,
        benchmark_accuracy=benchmark_acc,
        size_mb=size_mb,
        license=req.license,
        authors=req.authors,
        paper_doi=req.paper_doi,
        tags=req.tags,
        download_url=f"https://qml-hub.q-lab.io/datasets/{ds_id}.hdf5",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_DATASETS, ds_id, ds.model_dump())
    return ds


@router.post("/benchmark", response_model=BenchmarkRun)
def run_benchmark(req: BenchmarkRequest, db: Session = Depends(get_db)) -> BenchmarkRun:
    ds = store_get(db, NS_DATASETS, req.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if req.model_type not in _VALID_MODEL_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"model_type must be one of {sorted(_VALID_MODEL_TYPES)}",
        )

    lo, hi = _MODEL_ACCURACY_BASE.get(req.model_type, (0.70, 0.90))

    # Scale accuracy slightly with n_params (log saturation)
    param_boost = min(0.05, math.log1p(req.n_params / 500) * 0.015)
    accuracy = round(min(0.999, random.uniform(lo, hi) + param_boost), 4)
    f1 = round(accuracy * random.uniform(0.96, 1.00), 4)

    # Training time scales with n_params and n_samples
    base_time = (req.n_params * ds["n_samples"]) / 500_000
    training_time = round(base_time * random.uniform(0.8, 1.3), 2)

    run_id = str(uuid.uuid4())
    run = BenchmarkRun(
        run_id=run_id,
        dataset_id=req.dataset_id,
        model_type=req.model_type,
        n_params=req.n_params,
        accuracy=accuracy,
        f1_score=f1,
        training_time_sec=training_time,
        n_qubits_used=ds["n_qubits"],
        optimizer=req.optimizer,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_BENCHMARKS, run_id, run.model_dump())
    return run


@router.get("/{dataset_id}/benchmarks", response_model=List[BenchmarkRun])
def list_benchmarks(dataset_id: str, db: Session = Depends(get_db)) -> List[BenchmarkRun]:
    ds = store_get(db, NS_DATASETS, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    all_runs = store_list(db, NS_BENCHMARKS)
    return [BenchmarkRun(**b) for b in all_runs if b["dataset_id"] == dataset_id]
