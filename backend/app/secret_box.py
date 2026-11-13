"""Encryption at rest for integration secrets: webhook signing secrets, CI/CD webhook secrets,
notification channel credentials (Slack incoming-webhook URLs, tokens, secrets), and the Slack,
Teams and GitHub integration settings.

The same Fernet key as the provider key vault (app/routers/credentials.py): SHA-256 of
QLAB_SECRET_KEY. Fernet is AES-128-CBC with an HMAC-SHA256, so a value can't be read or altered
without the key. Encrypted values are stored as "enc:v1:<fernet token>"; anything without that
prefix is a value written before encryption, read as it is and encrypted the next time it is
saved, or at startup by encrypt_existing().

Changing QLAB_SECRET_KEY makes these values (and the vault's keys) unreadable: they read as
empty, and have to be entered again.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import pathlib
from typing import Any, Iterable

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import JSON, String
from sqlalchemy.types import TypeDecorator

log = logging.getLogger("qlab.secret_box")

PREFIX = "enc:v1:"

# Keys inside JSON settings that hold secrets.
CHANNEL_SECRET_KEYS = ("webhook_url", "secret", "token")
SLACK_SECRET_KEYS = ("slack_bot_token", "slack_signing_secret", "teams_webhook_url")
GITHUB_SECRET_KEYS = ("github_token",)
ALERT_SECRET_KEYS = ("webhook_url",)

_fernet: Fernet | None = None


def fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        raw = os.environ.get("QLAB_SECRET_KEY", "")
        if not raw:
            raise RuntimeError("QLAB_SECRET_KEY must be set to encrypt secrets")
        _fernet = Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest()))
    return _fernet


def is_sealed(value: Any) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def seal(value: Any) -> Any:
    """Encrypt a string (empty values and ones already encrypted are left alone)."""
    if not isinstance(value, str) or not value or is_sealed(value):
        return value
    return PREFIX + fernet().encrypt(value.encode()).decode()


def unseal(value: Any) -> Any:
    """Decrypt a value from seal(); a value written before encryption comes back unchanged."""
    if not is_sealed(value):
        return value
    try:
        return fernet().decrypt(value[len(PREFIX):].encode()).decode()
    except InvalidToken:
        log.error("A stored secret could not be decrypted (was QLAB_SECRET_KEY changed?)")
        return None


def seal_fields(data: Any, keys: Iterable[str]) -> Any:
    if not isinstance(data, dict):
        return data
    return {k: (seal(v) if k in keys else v) for k, v in data.items()}


def unseal_fields(data: Any, keys: Iterable[str]) -> Any:
    if not isinstance(data, dict):
        return data
    return {k: (unseal(v) if k in keys else v) for k, v in data.items()}


class SealedString(TypeDecorator):
    """A string column stored encrypted; reads give the plain value."""
    impl = String
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        return seal(value)

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        return unseal(value)


class SealedJSON(TypeDecorator):
    """A JSON object column whose secret keys are stored encrypted; reads give plain values."""
    impl = JSON
    cache_ok = True

    def __init__(self, keys: tuple[str, ...], *args: Any, **kwargs: Any) -> None:
        self.keys = keys
        super().__init__(*args, **kwargs)

    def process_bind_param(self, value: Any, dialect: Any) -> Any:
        return seal_fields(value, self.keys)

    def process_result_value(self, value: Any, dialect: Any) -> Any:
        return unseal_fields(value, self.keys)


def encrypt_existing(conn: Any) -> int:
    """Encrypt secrets stored before encryption existed, on an open connection (the caller
    commits). Idempotent; returns how many rows changed. Run at startup (app/database.py) and by
    Alembic migration 008."""
    from sqlalchemy import select, update

    from .models import CICDIntegration, GenericRecord, NotificationChannel, Webhook

    changed = 0
    for model, column in ((Webhook, "secret"), (CICDIntegration, "webhook_secret")):
        table = model.__table__
        for row_id, value in conn.execute(select(table.c.id, _raw(table.c[column]))).all():
            if isinstance(value, str) and value and not is_sealed(value):
                conn.execute(update(table).where(table.c.id == row_id).values({column: value}))
                changed += 1
    table = NotificationChannel.__table__
    for row_id, config in conn.execute(select(table.c.id, _raw(table.c.config))).all():
        config = _as_dict(config)
        if any(isinstance(config.get(k), str) and config.get(k) and not is_sealed(config.get(k))
               for k in CHANNEL_SECRET_KEYS):
            conn.execute(update(table).where(table.c.id == row_id).values(config=config))
            changed += 1
    table = GenericRecord.__table__
    for namespace, keys in (("slack_configs", SLACK_SECRET_KEYS), ("github_configs", GITHUB_SECRET_KEYS)):
        for row_id, data in conn.execute(select(table.c.id, table.c.data).where(table.c.namespace == namespace)).all():
            data = _as_dict(data)
            sealed = seal_fields(data, keys)
            if sealed != data:
                conn.execute(update(table).where(table.c.id == row_id).values(data=sealed))
                changed += 1
    return changed + _encrypt_alert_rules()


def _encrypt_alert_rules() -> int:
    path = pathlib.Path(os.getenv("QLAB_DATA_DIR", "data")) / "alert_rules.json"
    try:
        if not path.exists():
            return 0
        rules = json.loads(path.read_text())
        sealed = [seal_fields(r, ALERT_SECRET_KEYS) for r in rules]
        if sealed != rules:
            path.write_text(json.dumps(sealed, indent=2))
            return sum(1 for a, b in zip(rules, sealed) if a != b)
    except Exception as exc:
        log.error("Could not encrypt the alert rules' webhook URLs: %s", exc)
    return 0


def _raw(column: Any) -> Any:
    """The column read as stored, without decrypting."""
    from sqlalchemy import type_coerce
    return type_coerce(column, column.type.impl if isinstance(column.type, TypeDecorator) else column.type)


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return dict(value) if isinstance(value, dict) else {}
