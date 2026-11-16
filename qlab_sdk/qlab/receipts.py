"""SOQLAB Witness receipts: fetch a run's receipt and verify it on this machine.

qlab.receipt() needs nothing extra. qlab.verify() checks a receipt with no help from the server,
and needs the soqlab-witness package (Python 3.11 or newer), which is not on PyPI yet.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Mapping, Optional, Union

import httpx

_INSTALL_HINT = (
    "qlab.verify() needs the soqlab-witness package (Python 3.11 or newer), which is not on PyPI yet. "
    "Until then, the run's Verify page checks its receipt, and qlab.receipt() gives you the file to keep."
)


def _client():
    from . import qiskit_hooks

    if qiskit_hooks._CLIENT is None:
        qiskit_hooks.init()
    return qiskit_hooks._CLIENT


def _headers(api_key: Optional[str]) -> dict[str, str]:
    return {"X-QLab-API-Key": api_key} if api_key else {}


def receipt(run_id: str, timeout: float = 15.0) -> dict[str, Any]:
    """The newest signed receipt for a run. Raises if the run has none yet."""
    client = _client()
    client.flush()
    response = httpx.get(
        f"{client.api_url}/api/v1/runs/{run_id}/receipt",
        headers=_headers(client.api_key),
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()["receipt"]


def _load_keys(keys: Any, timeout: float):
    from witness import KeysDocument

    if isinstance(keys, KeysDocument):
        return keys
    if isinstance(keys, Mapping):
        return KeysDocument.from_dict(dict(keys))
    if keys is not None:
        return KeysDocument.load(keys)
    response = httpx.get(f"{_client().api_url}/.well-known/witness-keys.json", timeout=timeout)
    response.raise_for_status()
    return KeysDocument.from_dict(response.json())


def verify(
    receipt: Union[Mapping[str, Any], str, Path],
    keys: Any = None,
    prev: Optional[Mapping[str, Any]] = None,
    data: Optional[Mapping[str, Union[bytes, str, Path]]] = None,
    timeout: float = 15.0,
):
    """Check a receipt locally and return a result with `.valid`, `.checks` and `.warnings`.

    `receipt` is a receipt object or a path to one. `keys` is a key document, a path to one, or
    None to fetch the configured server's public keys; pass a saved copy to work offline and
    to avoid trusting the server you are checking. `data` maps field names, such as "results",
    to original file contents or paths.
    """
    try:
        import witness
    except ImportError as exc:
        raise ImportError(_INSTALL_HINT) from exc

    body = json.loads(Path(receipt).read_text("utf-8")) if isinstance(receipt, (str, Path)) else dict(receipt)
    files: dict[str, bytes] = {}
    for name, value in (data or {}).items():
        files[name] = value if isinstance(value, bytes) else Path(value).read_bytes()
    return witness.verify(body, _load_keys(keys, timeout), dict(prev) if prev else None, files)
