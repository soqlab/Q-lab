"""PennyLane adapter for Q-Lab.

Wraps a PennyLane QNode execution and submits the run to Q-Lab automatically.

Usage::

    import pennylane as qml
    from qlab.adapters.pennylane_adapter import QLab

    dev = qml.device("default.qubit", wires=3)
    qlb = QLab(device=dev, api_url="http://localhost:8000", api_key="your_key")

    @qml.qnode(dev)
    def circuit():
        qml.Hadamard(0)
        qml.CNOT([0, 1])
        return qml.probs()

    result = qlb.run(circuit, shots=1024, name="Bell State")
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional

try:
    import pennylane as qml  # noqa: F401
    _PENNYLANE_AVAILABLE = True
except ImportError:
    _PENNYLANE_AVAILABLE = False

from ..client import QLabClient


class QLab:
    """Q-Lab adapter for PennyLane circuits.

    Parameters
    ----------
    device:
        A ``pennylane.Device`` instance (e.g. ``qml.device("default.qubit", wires=3)``).
    api_url:
        Base URL of the Q-Lab backend (default ``http://localhost:8000``).
    api_key:
        Optional API key forwarded as ``X-QLab-API-Key``.
    project:
        Optional project label attached to every run.
    tags:
        Optional list of string tags attached to every run.
    """

    def __init__(
        self,
        device: Any,
        api_url: str = "http://localhost:8000",
        api_key: Optional[str] = None,
        project: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> None:
        if not _PENNYLANE_AVAILABLE:
            raise ImportError(
                "PennyLane is not installed. "
                "Install it with:  pip install pennylane"
            )
        self._device = device
        self._client = QLabClient(api_url=api_url, api_key=api_key)
        self._project = project
        self._tags = tags or []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _n_qubits(self) -> int:
        try:
            return int(self._device.num_wires)
        except Exception:
            return 0

    def _circuit_stats(self, qnode: Any) -> tuple[int, int]:
        """Return (n_gates, circuit_depth) by inspecting the tape if available."""
        n_gates = 0
        depth = 0
        try:
            tape = getattr(qnode, "tape", None)
            if tape is not None:
                ops = list(tape.operations)
                n_gates = len(ops)
                # Depth = number of distinct layers (simple approximation)
                depth = len(ops)
        except Exception:
            pass
        return n_gates, depth

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        qnode: Callable,
        *args: Any,
        shots: int = 1024,
        name: Optional[str] = None,
        **kwargs: Any,
    ) -> Any:
        """Execute a PennyLane QNode and submit the run to Q-Lab.

        Parameters
        ----------
        qnode:
            A ``pennylane.QNode`` (decorated function).
        *args:
            Positional arguments forwarded to the QNode.
        shots:
            Number of shots used for execution (informational; actual shot count
            is set on the device by the caller before passing to this method).
        name:
            Human-readable label stored as ``circuit_name`` in Q-Lab.
        **kwargs:
            Keyword arguments forwarded to the QNode.

        Returns
        -------
        Any
            The raw return value of the QNode (e.g. probability array).
        """
        if not _PENNYLANE_AVAILABLE:
            raise ImportError(
                "PennyLane is not installed. "
                "Install it with:  pip install pennylane"
            )

        run_id = str(uuid.uuid4())
        submit_time = datetime.now(timezone.utc).isoformat()
        status = "completed"
        result: Any = None
        error_info: dict[str, Any] = {}

        try:
            result = qnode(*args, **kwargs)
        except Exception as exc:
            status = "failed"
            error_info = {
                "error_type": type(exc).__name__,
                "error_message": str(exc),
            }
            raise
        finally:
            n_gates, depth = self._circuit_stats(qnode)

            # Best-effort success probability: mean probability of |0...0⟩ state
            success_prob: Optional[float] = None
            try:
                import pennylane.numpy as pnp  # type: ignore
                import numpy as np  # type: ignore

                arr = np.asarray(result)
                if arr.ndim >= 1 and arr.size > 0:
                    success_prob = float(arr.flat[0])
            except Exception:
                pass

            payload: dict[str, Any] = {
                "run_id": run_id,
                "circuit_name": name or getattr(qnode, "__name__", "pennylane_circuit"),
                "backend": f"pennylane:{type(self._device).__name__}",
                "parameters": {
                    "shots": shots,
                    "device_name": getattr(self._device, "name", str(type(self._device).__name__)),
                },
                "execution": {
                    "n_qubits": self._n_qubits(),
                    "n_gates": n_gates,
                    "circuit_depth": depth,
                    "shots": shots,
                    **({"success_probability": success_prob} if success_prob is not None else {}),
                    **error_info,
                },
                "results": (
                    {"success_probability": success_prob}
                    if success_prob is not None
                    else {}
                ),
                "context": {"framework": "pennylane"},
                "project": self._project,
                "tags": list(self._tags),
                "status": status,
                "created_at": submit_time,
                "fingerprint": {
                    "num_qubits": self._n_qubits(),
                    "depth": depth,
                    "size": n_gates,
                },
            }

            self._client.send_run_async(payload)

        return result
