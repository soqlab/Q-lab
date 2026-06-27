"""Core tracker — wraps the Q-Lab REST API."""

from __future__ import annotations

import time
import uuid
import warnings
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Generator, List, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import json


_DEFAULT_URL = "https://qlab-backend.onrender.com"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RunContext:
    """Returned by ``QLabTracker.run()`` — accumulate metadata then submit."""

    def __init__(self, tracker: "QLabTracker", run_id: str, circuit_name: Optional[str]):
        self._tracker = tracker
        self.run_id = run_id
        self.circuit_name = circuit_name
        self.qasm: Optional[str] = None
        self.backend: Optional[str] = None
        self.project: Optional[str] = tracker._default_project
        self.tags: List[str] = []
        self.status: str = "submitted"
        self.parameters: Dict[str, Any] = {}
        self.execution: Dict[str, Any] = {}
        self.results: Dict[str, Any] = {}
        self.timing: Dict[str, Any] = {}
        self._start: float = time.monotonic()
        self._created_at: str = _now_iso()

    # ------------------------------------------------------------------
    # Qiskit helpers
    # ------------------------------------------------------------------

    def capture_circuit(self, circuit: Any) -> "RunContext":
        """Extract metadata from a Qiskit ``QuantumCircuit``."""
        try:
            from qiskit.qasm2 import dumps  # type: ignore
            self.qasm = dumps(circuit)
        except Exception:
            try:
                self.qasm = circuit.qasm()
            except Exception:
                pass
        try:
            self.execution.update({
                "n_qubits": circuit.num_qubits,
                "depth": circuit.depth(),
                "n_gates": circuit.size(),
            })
        except Exception:
            pass
        return self

    def capture_job(self, job: Any) -> "RunContext":
        """Extract metadata from a Qiskit ``IBMJob`` or similar result object."""
        try:
            result = job.result()
            counts = result.get_counts()
            if counts:
                self.results["counts"] = (
                    counts if isinstance(counts, dict) else counts[0]
                )
            shots = getattr(result, "results", None)
            if shots:
                try:
                    self.execution["shots"] = shots[0].shots
                except Exception:
                    pass
        except Exception:
            pass
        try:
            self.backend = str(job.backend().name)
        except Exception:
            pass
        try:
            self.timing["queue_time_ms"] = round(job.time_per_step().get("RUNNING", 0) * 1000)
        except Exception:
            pass
        return self

    def log(self, **kwargs: Any) -> "RunContext":
        """Freely attach any key-value data to this run."""
        for key, val in kwargs.items():
            if key == "results":
                self.results.update(val if isinstance(val, dict) else {"raw": val})
            elif key == "parameters":
                self.parameters.update(val if isinstance(val, dict) else {"raw": val})
            elif key == "tags" and isinstance(val, list):
                self.tags.extend(val)
            elif key == "backend":
                self.backend = str(val)
            elif key == "status":
                self.status = str(val)
            elif key == "qasm":
                self.qasm = str(val)
            else:
                self.execution[key] = val
        return self

    def submit(self) -> Dict[str, Any]:
        """Push this run to Q-Lab and return the API response."""
        elapsed_ms = round((time.monotonic() - self._start) * 1000)
        if elapsed_ms and "total_time_ms" not in self.timing:
            self.timing["total_time_ms"] = elapsed_ms

        payload: Dict[str, Any] = {
            "run_id": self.run_id,
            "circuit_name": self.circuit_name,
            "qasm": self.qasm,
            "backend": self.backend,
            "project": self.project,
            "tags": self.tags,
            "status": self.status,
            "parameters": self.parameters,
            "execution": self.execution,
            "results": self.results,
            "timing": self.timing,
            "created_at": self._created_at,
        }
        return self._tracker._post_run(payload)


class QLabTracker:
    """
    Lightweight client for the Q-Lab experiment tracking API.

    Usage::

        from qlab import QLabTracker

        tracker = QLabTracker(api_key="qlab_YOUR_KEY")

        with tracker.run("bell-circuit") as run:
            qc = QuantumCircuit(2)
            qc.h(0); qc.cx(0, 1)
            run.capture_circuit(qc)
            job = backend.run(qc, shots=1024)
            run.capture_job(job)
    """

    def __init__(
        self,
        api_key: str,
        url: str = _DEFAULT_URL,
        default_project: Optional[str] = None,
        timeout: int = 15,
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self._api_key = api_key
        self._base_url = url.rstrip("/")
        self._default_project = default_project
        self._timeout = timeout

    # ------------------------------------------------------------------
    # Context manager interface
    # ------------------------------------------------------------------

    @contextmanager
    def run(
        self,
        circuit_name: Optional[str] = None,
        *,
        run_id: Optional[str] = None,
        project: Optional[str] = None,
        tags: Optional[List[str]] = None,
    ) -> Generator[RunContext, None, None]:
        """
        Context manager that creates a :class:`RunContext`, yields it,
        then automatically submits on exit.  Any exception inside the
        block marks the run as ``failed`` before submitting.
        """
        ctx = RunContext(self, run_id or str(uuid.uuid4()), circuit_name)
        if project:
            ctx.project = project
        if tags:
            ctx.tags.extend(tags)
        try:
            yield ctx
        except Exception as exc:
            ctx.status = "failed"
            ctx.execution["error"] = str(exc)
            raise
        finally:
            try:
                ctx.submit()
            except Exception as submit_err:
                warnings.warn(f"Q-Lab: failed to submit run — {submit_err}", stacklevel=2)

    # ------------------------------------------------------------------
    # Low-level helpers
    # ------------------------------------------------------------------

    def _post_run(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = json.dumps(payload, default=str).encode()
        req = Request(
            f"{self._base_url}/api/v1/runs",
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Qlab-Api-Key": self._api_key,
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=self._timeout) as resp:
                return json.loads(resp.read().decode())
        except HTTPError as exc:
            detail = exc.read().decode()
            raise RuntimeError(f"Q-Lab API error {exc.code}: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Q-Lab connection error: {exc.reason}") from exc

    def log_run(
        self,
        circuit_name: Optional[str] = None,
        *,
        run_id: Optional[str] = None,
        backend: Optional[str] = None,
        project: Optional[str] = None,
        tags: Optional[List[str]] = None,
        qasm: Optional[str] = None,
        parameters: Optional[Dict[str, Any]] = None,
        results: Optional[Dict[str, Any]] = None,
        status: str = "completed",
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """One-shot run submission without a context manager."""
        ctx = RunContext(self, run_id or str(uuid.uuid4()), circuit_name)
        ctx.project = project or self._default_project
        ctx.backend = backend
        ctx.tags = tags or []
        ctx.qasm = qasm
        ctx.parameters = parameters or {}
        ctx.results = results or {}
        ctx.status = status
        ctx.execution.update(kwargs)
        return ctx.submit()
