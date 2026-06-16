"""Generic SQLite-backed key-value store for feature routers.

Usage in any router:
    from fastapi import Depends
    from sqlalchemy.orm import Session
    from ..database import get_db
    from ..store import store_put, store_get, store_list, store_delete, store_seed

Each router picks its own namespace string (e.g. "pulse_schedules") and
uses string record_ids (usually UUIDs).  All data is stored as JSON.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import GenericRecord, utcnow


def store_put(db: Session, namespace: str, record_id: str, data: dict[str, Any]) -> None:
    row = db.execute(
        select(GenericRecord).where(
            GenericRecord.namespace == namespace,
            GenericRecord.record_id == record_id,
        )
    ).scalar_one_or_none()
    if row:
        row.data = data
    else:
        row = GenericRecord(namespace=namespace, record_id=record_id, data=data)
        db.add(row)
    db.commit()


def store_get(db: Session, namespace: str, record_id: str) -> dict[str, Any] | None:
    row = db.execute(
        select(GenericRecord).where(
            GenericRecord.namespace == namespace,
            GenericRecord.record_id == record_id,
        )
    ).scalar_one_or_none()
    return row.data if row else None


def store_list(db: Session, namespace: str) -> list[dict[str, Any]]:
    rows = (
        db.execute(
            select(GenericRecord)
            .where(GenericRecord.namespace == namespace)
            .order_by(GenericRecord.created_at.asc())
        )
        .scalars()
        .all()
    )
    return [r.data for r in rows]


def store_delete(db: Session, namespace: str, record_id: str) -> bool:
    row = db.execute(
        select(GenericRecord).where(
            GenericRecord.namespace == namespace,
            GenericRecord.record_id == record_id,
        )
    ).scalar_one_or_none()
    if row:
        db.delete(row)
        db.commit()
        return True
    return False


def store_count(db: Session, namespace: str) -> int:
    rows = db.execute(
        select(GenericRecord).where(GenericRecord.namespace == namespace)
    ).scalars().all()
    return len(rows)


def store_seed(db: Session, namespace: str, records: list[tuple[str, dict[str, Any]]]) -> None:
    """Insert seed records into namespace if it is empty (idempotent)."""
    existing = db.execute(
        select(GenericRecord).where(GenericRecord.namespace == namespace).limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        return
    for record_id, data in records:
        db.add(GenericRecord(namespace=namespace, record_id=record_id, data=data))
    db.commit()
