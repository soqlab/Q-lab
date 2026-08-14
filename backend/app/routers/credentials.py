"""API Credential Vault — store and manage provider API keys securely.

Keys are XOR-obfuscated with a site secret before storage.  In production
replace _encrypt / _decrypt with Fernet (cryptography package) or AWS KMS.

Supported providers: ibm | ionq | rigetti | braket | custom
"""
from __future__ import annotations

import base64
import hashlib
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, require_auth
from ..models import ApiCredential

router = APIRouter(prefix="/api/v1/credentials", tags=["credentials"])

_SITE_SECRET = os.environ.get("QLAB_SECRET", "qlab-dev-secret-change-in-prod")


# ─────────────────────────────────────────────────────────────────────────────
# Encryption helpers (XOR + base64; replace with Fernet for production)
# ─────────────────────────────────────────────────────────────────────────────

def _derive_key(secret: str, length: int) -> bytes:
    h = hashlib.sha256(secret.encode()).digest()
    return (h * (length // 32 + 1))[:length]


def _encrypt(plaintext: str) -> str:
    raw = plaintext.encode()
    key = _derive_key(_SITE_SECRET, len(raw))
    xored = bytes(a ^ b for a, b in zip(raw, key))
    return base64.b64encode(xored).decode()


def _decrypt(ciphertext: str) -> str:
    xored = base64.b64decode(ciphertext.encode())
    key = _derive_key(_SITE_SECRET, len(xored))
    raw = bytes(a ^ b for a, b in zip(xored, key))
    return raw.decode()


# ─────────────────────────────────────────────────────────────────────────────
# Internal helper — NOT an HTTP endpoint
# ─────────────────────────────────────────────────────────────────────────────

def get_active_key_for_user(db: Session, provider: str, user_id: int) -> Optional[str]:
    """Return the decrypted active API key for a user's provider credential.

    Used internally by calibration_oracle, queue_intel, etc. so they can
    look up a per-user token without going through an unauthenticated HTTP route.
    Returns None if the user has no active credential for that provider.
    """
    c = db.scalar(
        select(ApiCredential)
        .where(
            ApiCredential.provider == provider,
            ApiCredential.is_active == True,
            ApiCredential.created_by_user_id == user_id,
        )
        .order_by(ApiCredential.created_at.desc())
    )
    if c is None:
        return None
    c.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return _decrypt(c.encrypted_key)


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class CredentialCreate(BaseModel):
    provider: str = Field(..., description="ibm | ionq | rigetti | braket | custom")
    label: str
    api_key: str
    expires_at: Optional[str] = None  # ISO datetime string


class CredentialUpdate(BaseModel):
    label: Optional[str] = None
    api_key: Optional[str] = None
    expires_at: Optional[str] = None
    is_active: Optional[bool] = None


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _to_dict(c: ApiCredential) -> dict[str, Any]:
    return {
        "cred_id": c.cred_id,
        "provider": c.provider,
        "label": c.label,
        "key_hint": f"...{c.key_hint}",
        "is_active": c.is_active,
        "last_used_at": c.last_used_at.isoformat() if c.last_used_at else None,
        "expires_at": c.expires_at.isoformat() if c.expires_at else None,
        "created_at": c.created_at.isoformat(),
    }


def _own_cred(cred_id: str, db: Session, identity: Identity) -> ApiCredential:
    """Fetch a credential that belongs to the authenticated user, or raise 404."""
    c = db.scalar(
        select(ApiCredential).where(
            ApiCredential.cred_id == cred_id,
            ApiCredential.created_by_user_id == identity.user_id,
        )
    )
    if c is None:
        raise HTTPException(404, "Credential not found")
    return c


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints (all require authentication)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("")
def create_credential(
    req: CredentialCreate,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    """Store a new API key for a provider."""
    if req.provider not in {"ibm", "ionq", "rigetti", "braket", "custom"}:
        raise HTTPException(422, f"Unknown provider '{req.provider}'")
    expires = None
    if req.expires_at:
        try:
            expires = datetime.fromisoformat(req.expires_at)
        except ValueError:
            raise HTTPException(422, "expires_at must be ISO 8601 datetime")

    cred = ApiCredential(
        cred_id=f"cred-{uuid.uuid4().hex[:12]}",
        org_id=identity.org_id,
        created_by_user_id=identity.user_id,
        provider=req.provider,
        label=req.label,
        encrypted_key=_encrypt(req.api_key),
        key_hint=req.api_key[-4:] if len(req.api_key) >= 4 else req.api_key,
        is_active=True,
        expires_at=expires,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return _to_dict(cred)


@router.get("")
def list_credentials(
    provider: Optional[str] = None,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    """List the authenticated user's stored credentials (keys are masked)."""
    q = (
        select(ApiCredential)
        .where(ApiCredential.created_by_user_id == identity.user_id)
        .order_by(ApiCredential.created_at.desc())
    )
    if provider:
        q = q.where(ApiCredential.provider == provider)
    return [_to_dict(c) for c in db.scalars(q).all()]


@router.get("/{cred_id}")
def get_credential(
    cred_id: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    """Get a specific credential (key is masked)."""
    return _to_dict(_own_cred(cred_id, db, identity))


@router.patch("/{cred_id}")
def update_credential(
    cred_id: str,
    req: CredentialUpdate,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    c = _own_cred(cred_id, db, identity)
    if req.label is not None:
        c.label = req.label
    if req.api_key is not None:
        c.encrypted_key = _encrypt(req.api_key)
        c.key_hint = req.api_key[-4:] if len(req.api_key) >= 4 else req.api_key
    if req.is_active is not None:
        c.is_active = req.is_active
    if req.expires_at is not None:
        c.expires_at = datetime.fromisoformat(req.expires_at)
    db.commit()
    return _to_dict(c)


@router.delete("/{cred_id}", status_code=204)
def delete_credential(
    cred_id: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    c = _own_cred(cred_id, db, identity)
    db.delete(c)
    db.commit()


@router.post("/{cred_id}/test")
def test_credential(
    cred_id: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(require_auth),
):
    """Validate that the stored key can authenticate with the provider."""
    import urllib.request, urllib.error
    c = _own_cred(cred_id, db, identity)
    key = _decrypt(c.encrypted_key)

    result: dict[str, Any] = {"cred_id": cred_id, "provider": c.provider}
    try:
        if c.provider == "ibm":
            req = urllib.request.Request(
                "https://auth.quantum-computing.ibm.com/api/users/loginWithToken",
                data=b'{"apiToken":"' + key.encode() + b'"}',
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=10)
            result["status"] = "valid"
        elif c.provider == "ionq":
            req = urllib.request.Request(
                "https://api.ionq.co/v0.3/backends",
                headers={"Authorization": f"apiKey {key}"},
            )
            urllib.request.urlopen(req, timeout=10)
            result["status"] = "valid"
        elif c.provider == "rigetti":
            req = urllib.request.Request(
                "https://api.qcs.rigetti.com/v1/quantum-processors",
                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            )
            urllib.request.urlopen(req, timeout=10)
            result["status"] = "valid"
        else:
            result["status"] = "untestable"
            result["note"] = f"Automatic testing not supported for provider '{c.provider}'"
    except urllib.error.HTTPError as e:
        result["status"] = "invalid"
        result["http_status"] = e.code
    except Exception as ex:
        result["status"] = "error"
        result["error"] = str(ex)

    c.last_used_at = datetime.now(timezone.utc)
    db.commit()
    return result
