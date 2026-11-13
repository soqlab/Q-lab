"""One-time account recovery codes: the way back in without email.

A set of 10 codes is shown once, when the account is created or when the user asks for a new
set (which cancels the old one). Each code is 16 characters from a 32-letter alphabet with no
look-alikes (80 random bits), written in four groups: 7KQM-2XRD-9VHT-C4PW. Only its SHA-256 is
stored. A code is used up the moment it registers a new passkey, and never works again.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from .models import RecoveryCode

CODES_PER_SET = 10
_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # no 0/O, 1/I
_LENGTH = 16


def normalize(code: str) -> str:
    """What the user typed, as stored: upper case, without spaces or dashes."""
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def hash_code(code: str) -> str:
    return hashlib.sha256(normalize(code).encode()).hexdigest()


def _new_code() -> str:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(_LENGTH))
    return "-".join(raw[i:i + 4] for i in range(0, _LENGTH, 4))


def new_set(db: Session, user_id: int) -> list[str]:
    """Replace the user's codes with a fresh set and return it (the only time it is readable).
    The caller commits."""
    db.execute(delete(RecoveryCode).where(RecoveryCode.user_id == user_id))
    codes = [_new_code() for _ in range(CODES_PER_SET)]
    for code in codes:
        db.add(RecoveryCode(user_id=user_id, code_hash=hash_code(code)))
    return codes


def remaining(db: Session, user_id: int) -> int:
    return db.scalar(select(func.count()).select_from(RecoveryCode)
                     .where(RecoveryCode.user_id == user_id, RecoveryCode.used_at.is_(None))) or 0


def status(db: Session, user_id: int) -> dict:
    created = db.scalar(select(func.min(RecoveryCode.created_at)).where(RecoveryCode.user_id == user_id))
    return {
        "remaining": remaining(db, user_id),
        "total": db.scalar(select(func.count()).select_from(RecoveryCode)
                           .where(RecoveryCode.user_id == user_id)) or 0,
        "created_at": created.isoformat() if created else None,
    }


def find_unused(db: Session, code: str) -> RecoveryCode | None:
    """The unused code row matching what was typed, if any."""
    if len(normalize(code)) != _LENGTH:
        return None
    digest = hash_code(code)
    row = db.scalar(select(RecoveryCode).where(RecoveryCode.code_hash == digest, RecoveryCode.used_at.is_(None)))
    if row is None or not hmac.compare_digest(row.code_hash, digest):
        return None
    return row


def use(db: Session, row_id: int, code: str) -> bool:
    """Mark the code used, only if it still matches and nobody used it first. The caller commits."""
    done = db.execute(
        update(RecoveryCode)
        .where(RecoveryCode.id == row_id, RecoveryCode.code_hash == hash_code(code), RecoveryCode.used_at.is_(None))
        .values(used_at=datetime.now(timezone.utc))
    ).rowcount
    return done == 1
