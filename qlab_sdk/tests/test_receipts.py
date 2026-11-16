"""qlab.receipt() and qlab.verify(). The server is faked; verification is the real library."""

import json
from pathlib import Path

import httpx
import pytest

import qlab
from qlab import qiskit_hooks, receipts

try:
    import witness
except ImportError:  # soqlab-witness is optional (and not on PyPI yet)
    witness = None

needs_witness = pytest.mark.skipif(witness is None, reason="soqlab-witness is not installed")

API = "http://qlab.test"


class FakeClient:
    api_url = API
    api_key = "key-123"

    def flush(self, timeout: float = 5.0) -> None:
        self.flushed = True


@pytest.fixture
def key():
    if witness is None:
        pytest.skip("soqlab-witness is not installed")
    return witness.SigningKey.generate("qlab.test", "2026-01-01T00:00:00Z")


@pytest.fixture
def signed(key):
    subject = witness.qlab_run_subject(backend="aer", results=witness.digest_counts({"0": 3}))
    return witness.seal("qlab.run", subject, key)


@pytest.fixture
def document(key):
    return witness.KeysDocument("qlab.test", (key.public(),))


@pytest.fixture(autouse=True)
def client(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(qiskit_hooks, "_CLIENT", fake)
    return fake


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


def test_receipt_fetches_with_credentials(monkeypatch, client):
    signed = {"id": "r-1", "kind": "qlab.run", "subject": {"backend": "aer"}}
    calls = []

    def fake_get(url, headers=None, timeout=None):
        calls.append((url, headers))
        return FakeResponse({"receipt": signed, "status": "verified"})

    monkeypatch.setattr(httpx, "get", fake_get)
    assert qlab.receipt("run-1") == signed
    assert calls == [(f"{API}/api/v1/runs/run-1/receipt", {"X-QLab-API-Key": "key-123"})]
    assert client.flushed
    assert qiskit_hooks.RunContext("run-1").receipt() == signed


@needs_witness
def test_verify_with_server_keys(monkeypatch, signed, document):
    monkeypatch.setattr(httpx, "get", lambda url, timeout=None: FakeResponse(document.to_dict()))
    assert qlab.verify(signed).valid


@needs_witness
def test_verify_offline_from_files_never_touches_the_network(monkeypatch, tmp_path, signed, document):
    def no_network(*_a, **_k):
        raise AssertionError("verification with supplied keys must stay offline")

    monkeypatch.setattr(httpx, "get", no_network)
    receipt_path = tmp_path / "receipt.json"
    receipt_path.write_text(json.dumps(signed))
    keys_path = tmp_path / "keys.json"
    keys_path.write_text(document.dumps())
    results = tmp_path / "results.json"
    results.write_text('{"0": 3}')

    assert qlab.verify(receipt_path, keys=keys_path, data={"results": results}).valid
    assert qlab.verify(signed, keys=document.to_dict()).valid
    assert qlab.verify(signed, keys=document, data={"results": b'{"0": 3}'}).valid

    changed = qlab.verify(signed, keys=document, data={"results": b'{"0": 4}'})
    assert not changed.valid and changed.failed == ["data.results"]


def test_verify_explains_missing_dependency(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name == "witness":
            raise ImportError("no witness")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocked)
    with pytest.raises(ImportError, match="soqlab-witness"):
        receipts.verify({"id": "r-1"})


def test_context_records_dirty_flag(monkeypatch):
    from qlab import context

    monkeypatch.setattr(context, "_safe_command", lambda _c: " M file.py")
    assert context._git_dirty() is True
    monkeypatch.setattr(context, "_safe_command", lambda _c: "")
    assert context._git_dirty() is False
    monkeypatch.setattr(context, "_safe_command", lambda _c: None)
    assert context._git_dirty() is None
    assert Path(context.__file__).exists()
