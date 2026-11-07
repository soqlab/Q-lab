"""Who owns a record kept in the generic store (app/store.py) or a JSON sidecar file.

The same rule as runs (app/run_scope.py): members of an organisation share its records; a user
without an organisation sees only their own. Routers stamp new records with owner_key() and
filter with owned_by().
"""
from __future__ import annotations

from typing import Any

from .deps import Identity


def owner_key(identity: Identity) -> str:
    if identity.org_id:
        return f"org:{identity.org_id}"
    if identity.user_id:
        return f"user:{identity.user_id}"
    return "shared-key"  # a legacy shared API key (QLAB_API_KEYS) has no user


def owned_by(record: dict[str, Any] | None, identity: Identity) -> bool:
    return bool(record) and record.get("owner") == owner_key(identity)


def mine(records: list[dict[str, Any]], identity: Identity) -> list[dict[str, Any]]:
    key = owner_key(identity)
    return [r for r in records if r.get("owner") == key]


def public_view(record: dict[str, Any]) -> dict[str, Any]:
    """A record without its owner key, for responses."""
    return {k: v for k, v in record.items() if k != "owner"}
