from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid, random, math

from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/synthetic-data", tags=["synthetic-data"])

# ---------------------------------------------------------------------------
# Namespace constants
# ---------------------------------------------------------------------------

NS_DATASETS = "synthetic_datasets"


class SyntheticDataset(BaseModel):
    dataset_id: str
    name: str
    type: str
    n_samples: int
    n_features: int
    n_qubits: int
    noise_level: float
    backend_model: str
    label_distribution: dict
    feature_stats: dict
    preview: List[dict]
    download_url: str
    size_mb: float
    created_at: str


class DatasetStats(BaseModel):
    dataset_id: str
    mean_fidelity: float
    std_fidelity: float
    class_balance: dict
    circuit_depth_range: List[int]
    gate_count_range: List[int]


class GenerateRequest(BaseModel):
    name: str
    type: str
    n_samples: int
    n_qubits: int
    noise_level: float = 0.01
    backend_model: str = "ibm_generic"
    seed: Optional[int] = None


def _gaussian(mean: float, std: float, rng: random.Random) -> float:
    return rng.gauss(mean, std)


def _make_preview_row(dataset_type: str, n_features: int, n_qubits: int, noise_level: float, rng: random.Random) -> dict:
    if dataset_type == "classification":
        label = rng.choice([0, 1])
        features = {f"f{i}": round(_gaussian(label * 0.5, 0.3 + noise_level, rng), 5) for i in range(min(n_features, 6))}
        return {"label": label, **features, "fidelity": round(rng.uniform(0.85, 0.99), 4)}
    elif dataset_type == "regression":
        x = [round(rng.uniform(-1, 1), 4) for _ in range(min(n_features, 4))]
        y = round(sum(xi ** 2 for xi in x) + _gaussian(0, noise_level, rng), 5)
        return {"target": y, **{f"f{i}": x[i] for i in range(len(x))}}
    elif dataset_type == "vqe_landscape":
        theta = round(rng.uniform(0, 2 * math.pi), 5)
        phi = round(rng.uniform(0, math.pi), 5)
        energy = round(-1.1361 + 0.4 * math.cos(theta) + 0.2 * math.sin(phi) + _gaussian(0, noise_level * 0.1, rng), 6)
        return {"theta": theta, "phi": phi, "energy": energy, "n_qubits": n_qubits, "circuit_depth": rng.randint(4, 20)}
    else:
        t1 = round(rng.uniform(80, 200) * (1 - noise_level), 2)
        t2 = round(t1 * rng.uniform(0.4, 0.9), 2)
        readout_err = round(rng.uniform(0.005, 0.05) * (1 + noise_level * 10), 5)
        cx_err = round(rng.uniform(0.005, 0.02) * (1 + noise_level * 5), 5)
        return {"t1_us": t1, "t2_us": t2, "readout_error": readout_err, "cx_error": cx_err, "qubit": rng.randint(0, n_qubits - 1)}


@router.post("/generate", response_model=SyntheticDataset)
def generate(req: GenerateRequest, db: Session = Depends(get_db)) -> SyntheticDataset:
    valid_types = ("classification", "regression", "vqe_landscape", "noise_model")
    if req.type not in valid_types:
        raise HTTPException(status_code=422, detail=f"type must be one of {valid_types}")
    if req.n_samples < 1 or req.n_samples > 100_000:
        raise HTTPException(status_code=422, detail="n_samples must be between 1 and 100000")

    rng = random.Random(req.seed if req.seed is not None else random.randint(0, 2**31))
    dataset_id = str(uuid.uuid4())
    n_features = req.n_qubits * 2 if req.type in ("classification", "regression") else req.n_qubits

    if req.type == "classification":
        n_classes = rng.randint(2, 4)
        raw_weights = [rng.uniform(1, 5) for _ in range(n_classes)]
        total = sum(raw_weights)
        label_distribution = {str(i): round(raw_weights[i] / total, 4) for i in range(n_classes)}
    elif req.type == "vqe_landscape":
        label_distribution = {"energy_min": round(rng.uniform(-2.0, -0.8), 4), "energy_max": round(rng.uniform(0.5, 2.0), 4)}
    elif req.type == "noise_model":
        label_distribution = {"backend": req.backend_model, "noise_level": req.noise_level}
    else:
        label_distribution = {"continuous": True, "range": [round(rng.uniform(-3, 0), 3), round(rng.uniform(0, 3), 3)]}

    feature_stats = {
        "mean": round(rng.uniform(-0.2, 0.2), 5),
        "std": round(rng.uniform(0.3, 1.2), 5),
        "min": round(rng.uniform(-3, -1), 5),
        "max": round(rng.uniform(1, 3), 5),
        "missing_rate": 0.0,
    }

    preview = [_make_preview_row(req.type, n_features, req.n_qubits, req.noise_level, rng) for _ in range(5)]
    size_mb = round(req.n_samples * n_features * 8 / 1_048_576, 3)

    dataset = SyntheticDataset(
        dataset_id=dataset_id,
        name=req.name,
        type=req.type,
        n_samples=req.n_samples,
        n_features=n_features,
        n_qubits=req.n_qubits,
        noise_level=req.noise_level,
        backend_model=req.backend_model,
        label_distribution=label_distribution,
        feature_stats=feature_stats,
        preview=preview,
        download_url=f"/api/v1/synthetic-data/download/{dataset_id}",
        size_mb=size_mb,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    store_put(db, NS_DATASETS, dataset_id, dataset.model_dump())
    return dataset


@router.get("/datasets", response_model=List[SyntheticDataset])
def list_datasets(db: Session = Depends(get_db)) -> List[SyntheticDataset]:
    return store_list(db, NS_DATASETS)


@router.get("/dataset/{dataset_id}", response_model=SyntheticDataset)
def get_dataset(dataset_id: str, db: Session = Depends(get_db)) -> SyntheticDataset:
    ds = store_get(db, NS_DATASETS, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


@router.get("/dataset/{dataset_id}/stats", response_model=DatasetStats)
def get_stats(dataset_id: str, db: Session = Depends(get_db)) -> DatasetStats:
    ds = store_get(db, NS_DATASETS, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rng = random.Random(dataset_id)
    mean_fidelity = round(rng.uniform(0.88, 0.99) * (1 - ds["noise_level"]), 5)
    std_fidelity = round(rng.uniform(0.005, 0.04), 5)

    if ds["type"] == "classification":
        class_balance = ds["label_distribution"]
    else:
        class_balance = {"n/a": 1.0}

    min_depth = max(2, ds["n_qubits"] * 2)
    max_depth = min_depth + ds["n_qubits"] * rng.randint(3, 8)
    min_gates = min_depth + rng.randint(1, 5)
    max_gates = max_depth + rng.randint(5, 20)

    return DatasetStats(
        dataset_id=dataset_id,
        mean_fidelity=mean_fidelity,
        std_fidelity=std_fidelity,
        class_balance=class_balance,
        circuit_depth_range=[min_depth, max_depth],
        gate_count_range=[min_gates, max_gates],
    )
