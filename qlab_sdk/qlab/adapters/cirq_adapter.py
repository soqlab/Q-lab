"""Cirq adapter for Q-Lab.

Wraps a Cirq simulator run and submits the experiment to Q-Lab automatically.

Usage::

    import cirq
    from qlab.adapters.cirq_adapter import QLab

    q0, q1 = cirq.LineQubit.range(2)
    simulator = cirq.Simulator()
    qlb = QLab(simulator=simulator, api_url="http://localhost:8000", api_key="your_key")

    circuit = cirq.Circuit(cirq.H(q0), cirq.CNOT(q0, q1), cirq.measure(q0, q1))
    result = qlb.run(circuit, repetitions=1024, name="Bell State")
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

try:
    import cirq  # noqa: F401
    _CIRQ_AVAILABLE = True
except ImportError:
    _CIRQ_AVAILABLE = False

from ..client import QLabClient


class QLab:
    """Q-Lab adapter for Cirq circuits.

    Parameters
    ----------
    simulator:
        A Cirq simulator or sampler instance
        (e.g. ``cirq.Simulator()`` or ``cirq.DensityMatrixSimulator()``).
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
        simulator: Any,
        api_url: str = "http://localhost:8000",
        api_key: Optional[str] = None,
        project: Optional[str] = None,
        tags: Optional[list[str]] = None,
    ) -> None:
        if not _CIRQ_AVAILABLE:
            raise ImportError(
                "Cirq is not installed. "
                "Install it with:  pip install cirq"
            )
        self._simulator = simulator
        self._client = QLabClient(api_url=api_url, api_key=api_key)
        self._project = project
        self._tags = tags or []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_histogram(measurements: Any) -> dict[str, int]:
        """Flatten cirq measurement results into a bitstring-count dict."""
        histogram: dict[str, int] = {}
        try:
            import numpy as np  # type: ignore

            for key, arr in measurements.items():
                # arr shape: (repetitions, n_qubits_for_key)
                for row in arr:
                    bitstring = "".join(str(int(b)) for b in row)
                    histogram[bitstring] = histogram.get(bitstring, 0) + 1
        except Exception:
            pass
        return histogram

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        circuit: Any,
        repetitions: int = 1024,
        name: Optional[str] = None,
    ) -> Any:
        """Execute a Cirq circuit and submit the run to Q-Lab.

        Parameters
        ----------
        circuit:
            A ``cirq.Circuit`` to execute.
        repetitions:
            Number of repetitions (shots) to run.
        name:
            Human-readable label stored as ``circuit_name`` in Q-Lab.

        Returns
        -------
        Any
            The raw ``cirq.Result`` returned by the simulator.
        """
        if not _CIRQ_AVAILABLE:
            raise ImportError(
                "Cirq is not installed. "
                "Install it with:  pip install cirq"
            )

        run_id = str(uuid.uuid4())
        submit_time = datetime.now(timezone.utc).isoformat()
        status = "completed"
        result: Any = None
        error_info: dict[str, Any] = {}

        # Gather static circuit metadata before execution
        try:
            n_qubits = len(circuit.all_qubits())
        except Exception:
            n_qubits = 0

        try:
            n_gates = len(list(circuit.all_operations()))
        except Exception:
            n_gates = 0

        try:
            circuit_depth = len(circuit)
        except Exception:
            circuit_depth = 0

        try:
            result = self._simulator.run(circuit, repetitions=repetitions)
        except Exception as exc:
            status = "failed"
            error_info = {
                "error_type": type(exc).__name__,
                "error_message": str(exc),
            }
            raise
        finally:
            histogram: dict[str, int] = {}
            if result is not None:
                try:
                    histogram = self._extract_histogram(result.measurements)
                except Exception:
                    pass

            payload: dict[str, Any] = {
                "run_id": run_id,
                "circuit_name": name or "cirq_circuit",
                "backend": f"cirq:{type(self._simulator).__name__}",
                "parameters": {
                    "repetitions": repetitions,
                    "shots": repetitions,
                },
                "execution": {
                    "n_qubits": n_qubits,
                    "n_gates": n_gates,
                    "circuit_depth": circuit_depth,
                    "shots": repetitions,
                    **error_info,
                },
                "results": {"counts": histogram} if histogram else {},
                "context": {"framework": "cirq"},
                "project": self._project,
                "tags": list(self._tags),
                "status": status,
                "created_at": submit_time,
                "fingerprint": {
                    "num_qubits": n_qubits,
                    "depth": circuit_depth,
                    "size": n_gates,
                },
            }

            self._client.send_run_async(payload)

        return result
