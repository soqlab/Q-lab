"""IBM Quantum, through IBM's own client library and each user's own API key.

Users save their IBM key under Credentials. Q-Lab holds no IBM account of its own: every call
here takes the caller's key, so usage and billing stay on the user's IBM account.

The library tracks IBM's addresses and sign-in, which have changed before: the old
api.quantum-computing.ibm.com hosts Q-Lab used to call directly no longer exist.
"""
from __future__ import annotations

import hashlib
import threading
import time
from collections import OrderedDict
from datetime import datetime
from typing import Any

# Creating a client signs in and looks up the user's IBM instances, which takes seconds.
_CLIENT_TTL_S = 1800
_CLIENT_CACHE_SIZE = 64
_clients: OrderedDict[str, tuple[float, Any]] = OrderedDict()
_lock = threading.Lock()


class InvalidIBMKey(Exception):
    """IBM refused the key."""


def _connect(token: str):
    from qiskit_ibm_runtime import IBMQuantumComputeService
    from qiskit_ibm_runtime.accounts import InvalidAccountError

    try:
        return IBMQuantumComputeService(token=token, channel="ibm_quantum_platform")
    except InvalidAccountError as exc:
        raise InvalidIBMKey(str(exc)) from None


def service(token: str):
    """A signed-in client for this key, reused for a while. The cache is keyed by a hash of the key."""
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    with _lock:
        cached = _clients.get(key)
        if cached and now - cached[0] < _CLIENT_TTL_S:
            _clients.move_to_end(key)
            return cached[1]
    client = _connect(token)
    with _lock:
        _clients[key] = (now, client)
        while len(_clients) > _CLIENT_CACHE_SIZE:
            _clients.popitem(last=False)
    return client


def check_key(token: str) -> None:
    """Raises InvalidIBMKey if IBM refuses the key. Always asks IBM, so a revoked key is noticed."""
    _connect(token)


def calibration(backend_name: str, token: str) -> dict:
    """The backend's latest calibration: {"qubits": [...], "gates": [...], "last_update_date": iso}."""
    data = service(token).backend(backend_name).properties().to_dict()
    updated = data.get("last_update_date")
    if isinstance(updated, datetime):
        data["last_update_date"] = updated.isoformat()
    return data


def list_backends(token: str) -> list[dict]:
    """The backends this key can use, with live status and queue length."""
    backends = []
    for backend in service(token).backends():
        status = backend.status()
        backends.append({
            "name": backend.name,
            "status": status.status_msg,
            "queue_length": status.pending_jobs,
            "operational": status.operational,
            "n_qubits": backend.num_qubits,
            "basis_gates": list(backend.operation_names),
            "provider": "ibm",
        })
    return backends


def submit(qasm: str, backend_name: str, shots: int, token: str) -> str:
    """Submit a circuit and return IBM's job ID."""
    from qiskit import QuantumCircuit, transpile
    from qiskit_ibm_runtime import SamplerV2

    backend = service(token).backend(backend_name)
    # IBM only accepts circuits already written in the backend's own gates and connectivity.
    circuit = transpile(QuantumCircuit.from_qasm_str(qasm), backend=backend, optimization_level=1)
    return SamplerV2(mode=backend).run([circuit], shots=shots).job_id()


def job_state(job_id: str, token: str) -> dict:
    """{status: queued | running | completed | failed | cancelled, counts?, error?}"""
    job = service(token).job(job_id)
    status = str(job.status()).lower()
    if "done" in status or "completed" in status:
        return {"status": "completed", "counts": job.result()[0].join_data().get_counts()}
    if "running" in status:
        return {"status": "running"}
    if "error" in status or "failed" in status:
        try:
            message = job.error_message()
        except Exception:
            message = ""
        return {"status": "failed", "error": message or status}
    if "cancelled" in status:
        return {"status": "cancelled"}
    return {"status": "queued"}


def cancel(job_id: str, token: str) -> None:
    service(token).job(job_id).cancel()
