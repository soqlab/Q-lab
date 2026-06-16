"""Quantum Machine Learning Workbench.

Simulates VQC training curves and quantum kernel methods using pure Python math.
No real Qiskit execution — all numerics are analytical/stochastic approximations.
"""

from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..store import store_put, store_get, store_list, store_delete, store_seed

router = APIRouter(prefix="/api/v1/qml", tags=["qml_workbench"])

NS_RESULTS = "qml_results"

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class QMLRequest(BaseModel):
    dataset: str = Field("moons", description="Dataset name")
    encoding: str = Field("angle", description="Quantum encoding strategy")
    n_qubits: int = Field(4, ge=1, le=20)
    n_layers: int = Field(2, ge=1, le=10)
    optimizer: str = Field("adam", description="Classical optimizer")
    n_epochs: int = Field(50, ge=1, le=500)
    task: str = Field("classification", description="classification or kernel")
    seed: Optional[int] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DATASETS = {
    "moons":   {"n_train": 100, "n_test": 30, "classes": 2},
    "circles": {"n_train": 100, "n_test": 30, "classes": 2},
    "xor":     {"n_train": 80,  "n_test": 20, "classes": 2},
    "iris2":   {"n_train": 100, "n_test": 50, "classes": 2},
    "random":  {"n_train": 120, "n_test": 40, "classes": 2},
}

_ENCODINGS = ["angle", "amplitude", "iqp"]
_OPTIMIZERS = ["adam", "sgd", "adagrad", "rms", "cobyla"]


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _binary_cross_entropy(p: float) -> float:
    p = max(1e-9, min(1 - 1e-9, p))
    return -math.log(p)


def _simulate_training(
    n_qubits: int,
    n_layers: int,
    n_epochs: int,
    optimizer: str,
    seed: Optional[int],
) -> List[Dict[str, Any]]:
    """Simulate VQC training loss/accuracy curves with realistic convergence."""
    rng = random.Random(seed)

    # Optimizer-dependent convergence speed
    speed_map = {"adam": 1.0, "sgd": 0.55, "adagrad": 0.8, "rms": 0.9, "cobyla": 0.7}
    speed = speed_map.get(optimizer, 0.8)

    # Target values
    loss_start, loss_end = 0.693, 0.18 + rng.uniform(-0.03, 0.04)
    acc_start, acc_end  = 0.52,  0.87  + rng.uniform(-0.04, 0.05)
    acc_end = min(acc_end, 0.96)

    # Noise scale: more qubits/layers → slightly noisier gradients
    noise_scale = 0.015 + 0.003 * n_qubits * n_layers / 8

    history: List[Dict[str, Any]] = []
    for epoch in range(1, n_epochs + 1):
        t = (epoch / n_epochs) ** (1.0 / speed)          # convergence curve
        smoothing = 1 - math.exp(-epoch * speed * 0.12)   # warm-up

        loss = loss_start + (loss_end - loss_start) * t * smoothing
        loss += rng.gauss(0, noise_scale * (1 - t * 0.5))
        loss = max(0.05, loss)

        acc = acc_start + (acc_end - acc_start) * t * smoothing
        acc += rng.gauss(0, noise_scale * 0.5 * (1 - t * 0.5))
        acc = max(0.50, min(1.0, acc))

        history.append({
            "epoch": epoch,
            "loss": round(loss, 5),
            "accuracy": round(acc, 4),
        })

    return history


def _simulate_kernel_matrix(
    n_qubits: int,
    seed: Optional[int],
    size: int = 5,
) -> List[List[float]]:
    """
    Compute a simulated 5×5 Gram matrix using |<phi(x)|phi(y)>|^2
    where phi is angle encoding. Diagonal entries are exactly 1.
    """
    rng = random.Random(seed)

    # Sample random data points in [-pi, pi]^n_qubits
    points = [[rng.uniform(-math.pi, math.pi) for _ in range(n_qubits)] for _ in range(size)]

    matrix: List[List[float]] = []
    for i in range(size):
        row: List[float] = []
        for j in range(size):
            if i == j:
                row.append(1.0)
            else:
                # Angle encoding inner product: prod cos((xi - xj)/2)
                prod = 1.0
                for k in range(n_qubits):
                    prod *= math.cos((points[i][k] - points[j][k]) / 2.0)
                kernel_val = prod ** 2
                # Add small measurement noise
                kernel_val += rng.gauss(0, 0.005)
                kernel_val = max(0.0, min(1.0, kernel_val))
                row.append(round(kernel_val, 6))
        matrix.append(row)

    # Ensure symmetry
    for i in range(size):
        for j in range(size):
            if i != j:
                val = (matrix[i][j] + matrix[j][i]) / 2.0
                matrix[i][j] = round(val, 6)
                matrix[j][i] = round(val, 6)

    return matrix


def _circuit_properties(n_qubits: int, n_layers: int, encoding: str) -> Dict[str, int]:
    """Estimate CX gates per evaluation and circuit depth."""
    # Encoding overhead
    enc_depth = {"angle": n_qubits, "amplitude": 2 * n_qubits, "iqp": 2 * n_qubits}.get(encoding, n_qubits)
    # Entangling layer: linear chain of CX gates
    cx_per_layer = n_qubits - 1
    # Parameterized layer: Ry + Rz per qubit
    param_depth_per_layer = 2

    n_cx = n_layers * cx_per_layer
    depth = enc_depth + n_layers * (param_depth_per_layer + 1) + 1  # +1 measure
    return {"n_cx_gates_per_eval": n_cx, "circuit_depth": depth}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("")
def run_qml(req: QMLRequest, db: Session = Depends(get_db)) -> Dict[str, Any]:
    ds = req.dataset if req.dataset in _DATASETS else "moons"
    ds_info = _DATASETS[ds]
    n_parameters = req.n_layers * req.n_qubits * 2   # Ry + Rz per qubit per layer

    history: List[Dict[str, Any]] = []
    kernel_matrix: List[List[float]] = []

    if req.task == "classification":
        history = _simulate_training(
            req.n_qubits, req.n_layers, req.n_epochs, req.optimizer, req.seed
        )
        final_train = history[-1]
        # Test slightly worse than train
        rng = random.Random(req.seed)
        test_loss_delta = rng.uniform(0.02, 0.06)
        test_acc_delta  = rng.uniform(0.01, 0.05)
        final_test_loss = round(min(final_train["loss"] + test_loss_delta, 0.9), 5)
        final_test_acc  = round(max(final_train["accuracy"] - test_acc_delta, 0.50), 4)

    elif req.task == "kernel":
        # No epoch-by-epoch training for kernel
        history = []
        final_train = {"loss": 0.0, "accuracy": 0.0}
        final_test_loss = 0.0
        final_test_acc  = 0.0
        kernel_matrix = _simulate_kernel_matrix(req.n_qubits, req.seed)
        # Kernel SVM accuracy estimate
        rng = random.Random(req.seed)
        final_test_acc = round(rng.uniform(0.80, 0.93), 4)
        final_train["accuracy"] = round(rng.uniform(0.85, 0.97), 4)
    else:
        history = _simulate_training(
            req.n_qubits, req.n_layers, req.n_epochs, req.optimizer, req.seed
        )
        final_train = history[-1]
        rng = random.Random(req.seed)
        final_test_loss = round(final_train["loss"] + rng.uniform(0.02, 0.06), 5)
        final_test_acc  = round(final_train["accuracy"] - rng.uniform(0.01, 0.05), 4)

    props = _circuit_properties(req.n_qubits, req.n_layers, req.encoding)

    # Classical baseline ~73% for these datasets; quantum gap
    rng2 = random.Random((req.seed or 0) + 1)
    classical_acc = round(rng2.uniform(0.70, 0.78), 4)
    qa_gap = round(final_test_acc - classical_acc, 4)

    qml_id = str(uuid.uuid4())
    result = {
        "qml_id": qml_id,
        "task": req.task,
        "dataset": ds,
        "encoding": req.encoding if req.encoding in _ENCODINGS else "angle",
        "n_qubits": req.n_qubits,
        "n_layers": req.n_layers,
        "optimizer": req.optimizer,
        "n_parameters": n_parameters,
        "n_training_samples": ds_info["n_train"],
        "n_test_samples": ds_info["n_test"],
        "training_history": history,
        "final_train_loss": round(final_train["loss"], 5),
        "final_train_accuracy": round(final_train["accuracy"], 4),
        "final_test_loss": final_test_loss,
        "final_test_accuracy": final_test_acc,
        "kernel_matrix": kernel_matrix,
        "n_cx_gates_per_eval": props["n_cx_gates_per_eval"],
        "circuit_depth": props["circuit_depth"],
        "quantum_vs_classical_accuracy_gap": qa_gap,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, NS_RESULTS, qml_id, result)
    return result


@router.get("/datasets")
def list_datasets() -> Dict[str, Any]:
    return {
        "datasets": [
            {"name": k, "n_train": v["n_train"], "n_test": v["n_test"], "classes": v["classes"]}
            for k, v in _DATASETS.items()
        ],
        "encodings": _ENCODINGS,
        "optimizers": _OPTIMIZERS,
        "tasks": ["classification", "kernel"],
    }
