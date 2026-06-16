"""Q# adapter for Q-Lab.

Because Q# operations are compiled and called from Python via the ``qsharp``
package, auto-interception is not practical.  This module provides a lightweight
manual helper that researchers call after their Q# operation returns.

Usage::

    from qlab.adapters.qsharp_adapter import submit_qsharp_run

    result = {          # dict produced by your Q# operation
        "success_prob": 0.87,
        "counts": {"0": 450, "1": 574},
    }

    submit_qsharp_run(
        operation_name="BellState",
        n_qubits=2,
        shots=1024,
        result=result,
        api_url="http://localhost:8000",
        api_key="your_key",
    )
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from ..client import QLabClient

# Q# (qsharp package) is optional — we check lazily so that importing this
# module never fails even when the package is absent.
try:
    import qsharp as _qsharp_pkg  # noqa: F401
    _QSHARP_AVAILABLE = True
except ImportError:
    _QSHARP_AVAILABLE = False


def submit_qsharp_run(
    operation_name: str,
    n_qubits: int,
    shots: int,
    result: dict[str, Any],
    *,
    api_url: str = "http://localhost:8000",
    api_key: Optional[str] = None,
    project: Optional[str] = None,
    tags: Optional[list[str]] = None,
    namespace: Optional[str] = None,
) -> str:
    """Submit a Q# operation result to Q-Lab.

    Parameters
    ----------
    operation_name:
        Name of the Q# operation (used as ``circuit_name``).
    n_qubits:
        Number of qubits the operation acted on.
    shots:
        Number of shots (repetitions) used during the run.
    result:
        A dict containing the operation output. Recognised keys:

        * ``success_prob`` / ``success_probability`` — float in [0, 1].
        * ``counts`` — dict mapping bitstring → count.
        * Any other keys are forwarded verbatim as result metadata.
    api_url:
        Base URL of the Q-Lab backend (default ``http://localhost:8000``).
    api_key:
        Optional API key forwarded as ``X-QLab-API-Key``.
    project:
        Optional project label.
    tags:
        Optional list of string tags.
    namespace:
        Optional Q# namespace that contains the operation.

    Returns
    -------
    str
        The ``run_id`` (UUID) assigned to this run.
    """
    run_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()

    # Normalise success probability field name
    success_prob: Optional[float] = None
    for key in ("success_prob", "success_probability"):
        if key in result:
            try:
                success_prob = float(result[key])
            except (TypeError, ValueError):
                pass
            break

    counts: dict[str, int] = {}
    if "counts" in result and isinstance(result["counts"], dict):
        counts = {str(k): int(v) for k, v in result["counts"].items()}

    # Build results payload — include everything the caller gave us
    results_payload: dict[str, Any] = dict(result)
    if success_prob is not None:
        results_payload["success_probability"] = success_prob
    if counts:
        results_payload["counts"] = counts

    payload: dict[str, Any] = {
        "run_id": run_id,
        "circuit_name": operation_name,
        "backend": "qsharp",
        "parameters": {
            "shots": shots,
            **({"namespace": namespace} if namespace else {}),
        },
        "execution": {
            "n_qubits": n_qubits,
            "shots": shots,
            **({"success_probability": success_prob} if success_prob is not None else {}),
        },
        "results": results_payload,
        "context": {
            "framework": "qsharp",
            "qsharp_available": _QSHARP_AVAILABLE,
        },
        "project": project,
        "tags": list(tags or []),
        "status": "completed",
        "created_at": created_at,
        "fingerprint": {
            "num_qubits": n_qubits,
        },
    }

    client = QLabClient(api_url=api_url, api_key=api_key)
    client.send_run_async(payload)
    return run_id
