"""SOQLAB Witness receipts for runs.

A receipt is sealed whenever a run in a final state is flushed with content that differs from
its latest receipt. The hook sits on the session, so every code path that finishes a run is
covered (SDK uploads, the job executor, provider ingest) and the receipt commits or rolls back
with the run's own state.

A failure to seal is logged and never blocks the run: losing a researcher's data is worse than
a run without a receipt, and the dashboard shows that a run has none.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from sqlalchemy import event, select, text
from sqlalchemy.orm import Session


from .database import DATA_DIR, DATABASE_URL, SessionLocal
from .models import Receipt, Run
from .witness import KeyDirectory, KeysDocument, SigningKey, digest_json, digest_text, seal, verify
from .witness.anchor import anchor_subject, request_token
from .witness.canonical import canonicalize, loads_strict
from .witness.keys import KeyError_
from .witness.receipt import format_time, qlab_run_subject, receipt_digest
from .witness.sign import next_link

log = logging.getLogger("qlab.witness")

FINAL_STATUSES = {"completed", "failed"}
ANCHOR_RUN_ID = "__witness_anchor__"
_COMMIT_RE = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_CHAIN_LOCK = 7351002
_INIT_WAIT_SECONDS = 15

_key: Optional[SigningKey] = None
_keys_document: Optional[KeysDocument] = None
_load_lock = threading.Lock()
_load_failed = False


def key_dir() -> Path:
    return Path(os.getenv("QLAB_WITNESS_KEY_DIR") or DATA_DIR / "witness-keys")


def _issuer_name() -> str:
    configured = os.getenv("QLAB_WITNESS_ISSUER", "").strip()
    if configured:
        return configured
    return urlparse(os.getenv("QLAB_APP_URL", "")).hostname or "localhost"


def _create_once(keys: KeyDirectory) -> None:
    """Create the instance key unless another worker is already doing so."""
    guard = keys.path.with_name(keys.path.name + ".init")
    keys.path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + _INIT_WAIT_SECONDS
    while True:
        try:
            guard.mkdir()
            break
        except FileExistsError:
            if keys.exists():
                return
            if time.monotonic() > deadline:
                raise KeyError_(f"timed out waiting for {guard}; remove it if no worker is starting")
            time.sleep(0.1)
    try:
        if not keys.exists():
            keys.init(_issuer_name(), os.getenv("QLAB_WITNESS_KEY_PASSPHRASE") or None)
            log.info("created a Witness signing key in %s; back this directory up", keys.path)
    finally:
        guard.rmdir()


def _load() -> Optional[SigningKey]:
    global _key, _keys_document, _load_failed
    if _key is not None or _load_failed:
        return _key
    with _load_lock:
        if _key is not None or _load_failed:
            return _key
        try:
            keys = KeyDirectory(key_dir())
            if not keys.exists():
                _create_once(keys)
            _keys_document = keys.document()
            _key = keys.load_active(os.getenv("QLAB_WITNESS_KEY_PASSPHRASE") or None)
        except (OSError, ValueError) as exc:
            _load_failed = True
            log.error("Witness signing is off, runs will have no receipts: %s", exc)
    return _key


def reset_for_tests() -> None:
    global _key, _keys_document, _load_failed
    _key, _keys_document, _load_failed = None, None, False


def initialise() -> None:
    """Create or load the instance key at startup, so a problem is logged right away."""
    _load()
    if os.getenv("QLAB_WITNESS_TSA_URL", "").strip():
        threading.Thread(target=_anchor_loop, name="witness-anchor", daemon=True).start()


def anchor_once() -> Optional[dict[str, Any]]:
    """Timestamp the newest receipt with the configured authority, if it is not already anchored.

    Off unless QLAB_WITNESS_TSA_URL is set. Sends one hash of the chain head and nothing else.
    """
    authority = os.getenv("QLAB_WITNESS_TSA_URL", "").strip()
    key = _load()
    if not authority or key is None:
        return None
    with SessionLocal() as session:
        target = _head(session)
    if target is None or target["kind"] == "witness.anchor":
        return None
    digest = receipt_digest(target)
    token = request_token(digest, authority)  # outside any transaction: this is a network call
    with SessionLocal() as session:
        _take_write_lock(session, _CHAIN_LOCK, "receipts")
        head = _head(session)
        seq, prev = next_link(head)
        receipt = seal(
            "witness.anchor",
            anchor_subject(target, digest, authority, token),
            key,
            seq=seq,
            prev=prev,
            issued_at=max(format_time(), head["issued_at"]),
        )
        session.add(Receipt(id=receipt["id"], run_id=ANCHOR_RUN_ID, seq=seq, prev=prev, body=json.dumps(receipt)))
        session.commit()
    return receipt


def _anchor_loop() -> None:
    hours = float(os.getenv("QLAB_WITNESS_ANCHOR_HOURS", "24") or 24)
    while True:
        try:
            anchor_once()
        except Exception:
            log.exception("could not anchor the chain head; will try again")
        time.sleep(max(hours, 0.1) * 3600)


def keys_document() -> Optional[KeysDocument]:
    _load()
    return _keys_document


def _safe_json(value: Any) -> Any:
    """The value as any JSON reader sees it. Raises ValueError if it has no canonical form."""
    return loads_strict(json.dumps(value))


def _is_counts(value: Any) -> bool:
    if not isinstance(value, dict) or not value:
        return False
    return all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in value.values())


def run_data(run: Run) -> dict[str, bytes]:
    """The exact bytes each digest of a run's receipt covers, by field name."""
    data: dict[str, bytes] = {}

    def add_json(field: str, value: Any) -> None:
        try:
            data[field] = canonicalize(_safe_json(value))
        except ValueError:  # NaN or similar in stored JSON: reported as "not captured"
            log.warning("run %s: %s has no canonical JSON form", run.run_id, field)

    if run.qasm:
        data["circuit"] = run.qasm.encode("utf-8")
    results = run.results or {}
    counts = results.get("counts")
    if _is_counts(counts):
        add_json("results", counts)
        # Everything else in the stored results, so that no byte of them goes uncovered.
        extra = {k: v for k, v in results.items() if k != "counts"}
        if extra:
            add_json("postprocessing.0", extra)
    elif results:
        add_json("results", results)
    if run.calibration:
        add_json("calibration_snapshot", run.calibration)
    versions = (run.context or {}).get("library_versions")
    if isinstance(versions, dict) and versions:
        add_json("environment", {str(k).lower(): v for k, v in versions.items()})
    return data


def _timestamp(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return format_time(parsed)


def run_subject(run: Run) -> dict[str, Any]:
    """The qlab.run subject for the current state of a run."""
    data = run_data(run)
    context = run.context or {}
    execution = run.execution or {}
    commit = context.get("git_commit")
    commit = commit if isinstance(commit, str) and _COMMIT_RE.fullmatch(commit) else None
    dirty = context.get("git_dirty")
    provider = context.get("provider") or execution.get("provider")

    def json_digest(field: str) -> Optional[str]:
        return digest_json(loads_strict(data[field])) if field in data else None

    return qlab_run_subject(
        backend=run.backend or "unknown",
        provider=provider if isinstance(provider, str) else None,
        circuit=digest_text(data["circuit"]) if "circuit" in data else None,
        compiled_circuit=None,  # Q-Lab does not store the transpiled circuit yet
        calibration_digest=json_digest("calibration_snapshot"),
        calibration_captured_at=_timestamp((run.calibration or {}).get("snapshot_time")),
        results=json_digest("results"),
        postprocessing=[json_digest("postprocessing.0")] if "postprocessing.0" in data else [],
        commit=commit,
        dirty=dirty if isinstance(dirty, bool) else None,
        environment=json_digest("environment"),
        shots=run.shots if run.shots is not None and run.shots >= 0 else None,
    )


def _take_write_lock(session: Session, key: int, table: str) -> None:
    """Hold the chain for this transaction, so that two writers cannot pick the same seq.

    SQLite has no row or advisory lock, but any write statement takes its one writer lock
    until commit, even one that matches no rows.
    """
    if DATABASE_URL.startswith("sqlite"):
        session.connection().exec_driver_sql(f"DELETE FROM {table} WHERE 0")  # noqa: S608
    else:
        session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


def _latest_receipt_body(session: Session, run_id: str) -> Optional[dict[str, Any]]:
    body = session.scalar(
        select(Receipt.body).where(Receipt.run_id == run_id).order_by(Receipt.seq.desc()).limit(1)
    )
    return json.loads(body) if body else None


def _head(session: Session) -> Optional[dict[str, Any]]:
    body = session.scalar(select(Receipt.body).order_by(Receipt.seq.desc()).limit(1))
    return json.loads(body) if body else None


def _needs_receipt(session: Session, obj: Any) -> bool:
    return (
        isinstance(obj, Run)
        and obj.status in FINAL_STATUSES
        and (obj in session.new or session.is_modified(obj))
    )


def _seal_finished_runs(session: Session, _flush_context: Any, _instances: Any) -> None:
    runs = [obj for obj in (*session.new, *session.dirty) if _needs_receipt(session, obj)]
    if not runs:
        return
    key = _load()
    if key is None:
        return
    sealed: list[Receipt] = []
    try:
        with session.no_autoflush:
            head: Any = None
            locked = False
            for run in runs:
                subject = run_subject(run)
                latest = _latest_receipt_body(session, run.run_id)
                if latest is not None and latest["subject"] == subject:
                    continue
                if not locked:
                    _take_write_lock(session, _CHAIN_LOCK, "receipts")
                    head = _head(session)
                    locked = True
                seq, prev = next_link(head)
                # A clock that stepped back must not make the chain look rolled back.
                now = format_time()
                issued_at = max(now, head["issued_at"]) if head else now
                receipt = seal("qlab.run", subject, key, seq=seq, prev=prev, issued_at=issued_at)
                sealed.append(
                    Receipt(
                        id=receipt["id"],
                        run_id=run.run_id,
                        seq=seq,
                        prev=prev,
                        body=json.dumps(receipt),
                        owner_user_id=run.created_by_user_id,
                        org_id=run.org_id,
                    )
                )
                head = receipt
    except Exception:
        log.exception("could not seal a receipt; the run is saved without one")
        return
    session.add_all(sealed)


event.listen(Session, "before_flush", _seal_finished_runs)


def receipt_status(session: Session, row: Receipt, run: Optional[Run]) -> dict[str, Any]:
    """Check a stored receipt against the keys, the chain and the run's stored data.

    `status` is verified, modified (the signature is fine but stored data no longer matches),
    run_deleted, or invalid.
    """
    receipt = json.loads(row.body)
    previous = None
    if row.seq > 1:
        body = session.scalar(select(Receipt.body).where(Receipt.seq == row.seq - 1))
        previous = json.loads(body) if body else None
    data = run_data(run) if run is not None else None
    usable = {k: v for k, v in (data or {}).items() if _digest_recorded(receipt, k)}
    result = verify(receipt, keys_document(), previous, usable)

    changed: list[str] = []
    if run is not None:
        current = run_subject(run)
        changed = [k for k in sorted(current) if current[k] != receipt["subject"].get(k)]
    signature_checks = {"schema", "issuer", "key", "key_validity", "sig.ml-dsa-65", "sig.ed25519", "chain"}
    signature_ok = not (signature_checks & set(result.failed))

    if not signature_ok:
        status = "invalid"
    elif changed or not result.valid:
        status = "modified"
    elif run is None:
        status = "run_deleted"
    else:
        status = "verified"
    return {
        "status": status,
        "receipt": receipt,
        "digest": receipt_digest(receipt),
        "changed_fields": changed,
        **result.to_dict(),
    }


def _digest_recorded(receipt: dict[str, Any], field: str) -> bool:
    subject = receipt["subject"]
    if field == "postprocessing.0":
        return bool(subject.get("postprocessing"))
    return subject.get(field) is not None


__all__ = [
    "anchor_once",
    "initialise",
    "keys_document",
    "receipt_status",
    "run_data",
    "run_subject",
]
