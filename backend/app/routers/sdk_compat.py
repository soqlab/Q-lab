"""SDK compatibility info endpoints.

Provides lightweight, read-only endpoints that tell SDK consumers which
quantum frameworks Q-Lab supports and what version constraints apply.

Routes
------
GET /api/v1/sdk/frameworks   — list of supported frameworks with install hints
GET /api/v1/sdk/version      — current SDK version and compatible framework versions
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/sdk", tags=["sdk_compat"])

# ---------------------------------------------------------------------------
# Static data — update these as framework support evolves.
# ---------------------------------------------------------------------------

_SDK_VERSION = "0.2.0"

_FRAMEWORKS: list[dict] = [
    {
        "name": "qiskit",
        "display_name": "Qiskit",
        "status": "native",
        "description": (
            "Auto-capture via monkey-patching of Qiskit backends and "
            "IBM Runtime primitives. Call qlab.init() to activate."
        ),
        "install": "pip install qiskit qiskit-ibm-runtime",
        "import_path": "qlab",
        "min_version": "1.0.0",
        "docs_url": "https://docs.quantum.ibm.com/",
    },
    {
        "name": "pennylane",
        "display_name": "PennyLane",
        "status": "adapter",
        "description": (
            "Adapter class that wraps QNode execution and submits runs to Q-Lab. "
            "Captures qubit count, gate count, circuit depth, shots, and "
            "success probability of the |0...0⟩ state."
        ),
        "install": "pip install pennylane",
        "import_path": "qlab.adapters.pennylane_adapter",
        "example": (
            "from qlab.adapters.pennylane_adapter import QLab\n"
            "qlb = QLab(device=dev, api_url='http://localhost:8000')\n"
            "result = qlb.run(circuit, shots=1024, name='Bell State')"
        ),
        "min_version": "0.36.0",
        "docs_url": "https://pennylane.ai/",
    },
    {
        "name": "cirq",
        "display_name": "Cirq",
        "status": "adapter",
        "description": (
            "Adapter class that wraps cirq.Simulator.run() and submits runs to Q-Lab. "
            "Captures qubit count, gate count, circuit depth, shots, and "
            "measurement histogram."
        ),
        "install": "pip install cirq",
        "import_path": "qlab.adapters.cirq_adapter",
        "example": (
            "from qlab.adapters.cirq_adapter import QLab\n"
            "qlb = QLab(simulator=cirq.Simulator(), api_url='http://localhost:8000')\n"
            "result = qlb.run(circuit, repetitions=1024, name='Bell State')"
        ),
        "min_version": "1.3.0",
        "docs_url": "https://quantumai.google/cirq",
    },
    {
        "name": "qsharp",
        "display_name": "Q#",
        "status": "manual",
        "description": (
            "Manual submit helper for Q# operations called via the Python qsharp package. "
            "Because Q# execution is compiled, auto-interception is not possible. "
            "Call submit_qsharp_run() after your operation returns."
        ),
        "install": "pip install qsharp",
        "import_path": "qlab.adapters.qsharp_adapter",
        "example": (
            "from qlab.adapters.qsharp_adapter import submit_qsharp_run\n"
            "submit_qsharp_run(\n"
            "    operation_name='BellState',\n"
            "    n_qubits=2,\n"
            "    shots=1024,\n"
            "    result={'success_prob': 0.87, 'counts': {'0': 450, '1': 574}},\n"
            "    api_url='http://localhost:8000',\n"
            ")"
        ),
        "min_version": "1.9.0",
        "docs_url": "https://learn.microsoft.com/azure/quantum/",
    },
]

_COMPATIBLE_VERSIONS: dict[str, str] = {
    "qiskit": ">=1.0.0",
    "qiskit-ibm-runtime": ">=0.20.0",
    "pennylane": ">=0.36.0",
    "cirq": ">=1.3.0",
    "qsharp": ">=1.9.0",
}

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/frameworks",
    summary="List supported quantum frameworks",
    response_description="Array of framework descriptors with install instructions",
)
def list_frameworks() -> dict:
    """Return all quantum frameworks supported by the Q-Lab SDK.

    Each entry includes:
    - ``name`` — machine-readable identifier
    - ``display_name`` — human-readable label
    - ``status`` — one of ``native`` | ``adapter`` | ``manual``
    - ``description`` — how the integration works
    - ``install`` — pip install command
    - ``import_path`` — Python import path for the adapter
    - ``min_version`` — minimum tested framework version
    - ``docs_url`` — upstream documentation
    """
    return {
        "frameworks": _FRAMEWORKS,
        "total": len(_FRAMEWORKS),
    }


@router.get(
    "/version",
    summary="SDK version and compatible framework versions",
    response_description="SDK version string and per-framework version constraints",
)
def sdk_version() -> dict:
    """Return the current Q-Lab SDK version and compatible framework version ranges.

    Use this endpoint to check whether your installed framework versions are
    expected to work with the current SDK.
    """
    return {
        "sdk_version": _SDK_VERSION,
        "compatible_frameworks": _COMPATIBLE_VERSIONS,
        "python_min": "3.9",
    }
