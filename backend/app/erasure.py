"""Erasing an account (GDPR Art. 17) and exporting everything held about it (Art. 15 and 20).

Deleting an account is a request with a grace period:

1. ``schedule()`` locks the account at once (no sign-in session or API key works, public share
   links stop) and records that it is to be erased ``GRACE_DAYS`` days later.
2. Signing in with a passkey (or a password, on accounts that still have one) before then
   cancels it: ``cancel_if_pending()``.
3. ``process_due()`` erases every account whose time has come. The app runs it every hour
   (main.py) and an admin can run it at once (POST /api/v1/gdpr/delete/process).

``erase()`` removes the user's runs and everything that hangs off them, projects nobody else
uses, API keys, passkeys, recovery codes, saved provider keys, webhooks, notification channels,
integration settings they own, their records in the generic store and the JSON side files, and
the user row itself. If they were the last member of an organisation, the organisation and its
data go too. The security log (audit_logs) is kept, because it is how abuse and break-ins are
investigated, but its entries about the user are pseudonymised: the user reference becomes an
opaque code, and the request details that could name them (user agent, free-text metadata) are
dropped.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import pathlib
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from sqlalchemy import Table, or_, select, update
from sqlalchemy.orm import Session

from .database import Base
from .models import (
    APIKey, ApiCredential, AuditLog, GenericRecord, NotificationChannel, NotificationLog, Organization,
    OrgInvite, PasskeyCredential, Project, RecoveryCode, Run, User, Webhook,
)

log = logging.getLogger("qlab.erasure")

GRACE_DAYS = 7
NS_PENDING = "account_erasure"
NS_REQUESTS = "gdpr_requests"   # the GDPR page's request log (app/routers/gdpr.py)
NS_EXPORTS = "gdpr_exports"

# Never copied into an export: secrets and their hashes.
_SECRET_COLUMNS = {
    "password_hash", "key_hash", "code_hash", "public_key", "encrypted_key", "secret", "webhook_secret",
    "challenge", "verify_token", "reset_token",
}
_SECRET_FIELDS = ("token", "secret", "password", "api_key", "apikey", "webhook_url", "private")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def pseudonym(user_id: int) -> str:
    """A stable code for an erased user in the security log. Keyed with the server secret, so the
    code can't be turned back into the user id without that key."""
    key = os.environ.get("QLAB_SECRET_KEY", "").encode()
    return "erased-" + hmac.new(key, f"user:{user_id}".encode(), hashlib.sha256).hexdigest()[:16]


# ── Scheduling ────────────────────────────────────────────────────────────────

def pending(db: Session, user_id: int) -> dict[str, Any] | None:
    row = db.scalar(select(GenericRecord).where(GenericRecord.namespace == NS_PENDING,
                                                GenericRecord.record_id == str(user_id)))
    return dict(row.data) if row else None


def schedule(db: Session, user: User, via: str, requested_at: datetime | None = None) -> datetime:
    """Lock the account now and erase it GRACE_DAYS later. Returns when it will be erased."""
    existing = pending(db, user.id)
    if existing:
        return datetime.fromisoformat(existing["due_at"])
    requested_at = requested_at or _now()
    due = _aware(requested_at) + timedelta(days=GRACE_DAYS)
    user.is_active = False
    # Public share links stop now; cancelling does not bring them back.
    db.execute(update(Run).where(Run.created_by_user_id == user.id).values(share_token=None))
    db.add(GenericRecord(namespace=NS_PENDING, record_id=str(user.id), data={
        "user_id": user.id, "requested_at": _aware(requested_at).isoformat(), "due_at": due.isoformat(), "via": via,
    }))
    db.add(AuditLog(user_id=user.id, org_id=user.org_id, action="account.erasure_scheduled",
                    resource_type="user", resource_id=str(user.id), meta={"due_at": due.isoformat(), "via": via}))
    db.commit()
    return due


def cancel_if_pending(db: Session, user: User | None) -> bool:
    """Called when someone signs in: a scheduled erasure is cancelled and the account unlocked."""
    if user is None:
        return False
    row = db.scalar(select(GenericRecord).where(GenericRecord.namespace == NS_PENDING,
                                                GenericRecord.record_id == str(user.id)))
    if row is None:
        return False
    db.delete(row)
    user.is_active = True
    for req in db.scalars(select(GenericRecord).where(GenericRecord.namespace == NS_REQUESTS)).all():
        data = dict(req.data or {})
        if data.get("user_id") == user.id and data.get("request_type") == "delete" and data.get("status") == "scheduled":
            data["status"] = "cancelled"
            data["completed_at"] = _now().isoformat()
            req.data = data
    db.add(AuditLog(user_id=user.id, org_id=user.org_id, action="account.erasure_cancelled",
                    resource_type="user", resource_id=str(user.id), meta={}))
    db.commit()
    return True


def process_due(db: Session, now: datetime | None = None) -> list[str]:
    """Erase every account whose grace period is over. Returns the pseudonyms of those erased.

    Deletion requests made on the GDPR page before erasure was automatic ("pending" in the
    request log) are scheduled here too, counted from when they were made.
    """
    now = now or _now()
    for req in db.scalars(select(GenericRecord).where(GenericRecord.namespace == NS_REQUESTS)).all():
        data = dict(req.data or {})
        if data.get("request_type") != "delete" or data.get("status") not in ("pending_confirmation", "pending"):
            continue
        user = db.get(User, data.get("user_id")) if isinstance(data.get("user_id"), int) else None
        if user is None:
            data["status"] = "completed"
        else:
            try:
                requested = datetime.fromisoformat(data.get("requested_at") or "")
            except ValueError:
                requested = now
            schedule(db, user, via="gdpr_request", requested_at=requested)
            data["status"] = "scheduled"
        req.data = data
        db.commit()

    erased = []
    for row in db.scalars(select(GenericRecord).where(GenericRecord.namespace == NS_PENDING)).all():
        try:
            due = _aware(datetime.fromisoformat(row.data["due_at"]))
        except (KeyError, ValueError, TypeError):
            continue
        if due <= now:
            erased.append(erase(db, int(row.data["user_id"])))
    return [e for e in erased if e]


# ── Erasure ───────────────────────────────────────────────────────────────────

def _tables_with(column: str, skip: Iterable[str] = ()) -> list[Table]:
    return [t for t in reversed(Base.metadata.sorted_tables) if column in t.c and t.name not in set(skip)]


def _chunks(items: list[Any], n: int = 500) -> Iterable[list[Any]]:
    for i in range(0, len(items), n):
        yield items[i:i + n]


def _delete_runs(db: Session, run_ids: list[str]) -> None:
    """Runs and every row that refers to them by run_id."""
    for chunk in _chunks(run_ids):
        for table in _tables_with("run_id", skip={"runs"}):
            db.execute(table.delete().where(table.c.run_id.in_(chunk)))
        db.execute(Run.__table__.delete().where(Run.run_id.in_(chunk)))


def _record_is_theirs(record: GenericRecord, user_id: int, owners: set[str], run_ids: set[str],
                      email: str | None) -> bool:
    data = record.data if isinstance(record.data, dict) else {}
    if record.namespace == NS_PENDING:
        return False  # removed last, by erase() itself
    if record.namespace == NS_REQUESTS:
        return False  # kept, pseudonymised: it is the record that the request was carried out
    if record.record_id in (f"user_{user_id}", f"user:{user_id}"):
        return True
    if data.get("owner") in owners:
        return True
    for key in ("user_id", "owner_user_id", "created_by_user_id"):
        if data.get(key) in (user_id, str(user_id)):
            return True
    if data.get("user_email") in (str(user_id), email) and data.get("user_email"):
        return True
    if record.namespace == NS_EXPORTS and (data.get("user") or {}).get("id") == user_id:
        return True
    run_id = data.get("run_id")
    return isinstance(run_id, str) and run_id in run_ids


def _side_files(owners: set[str], user_id: int) -> None:
    """Records kept in JSON files next to the database (alert rules, dispatch queue)."""
    data_dir = pathlib.Path(os.getenv("QLAB_DATA_DIR", "data"))
    for name in ("alert_rules.json", "dispatch_queue.json"):
        path = data_dir / name
        try:
            if not path.exists():
                continue
            entries = json.loads(path.read_text())
            kept = [e for e in entries if not (isinstance(e, dict) and (
                e.get("owner") in owners or e.get("owner_user_id") == user_id))]
            if len(kept) != len(entries):
                path.write_text(json.dumps(kept, indent=2))
        except Exception as exc:  # a broken side file must not stop the erasure
            log.error("erasure: could not clean %s: %s", path, exc)


def erase(db: Session, user_id: int, notify: bool = True) -> str | None:
    """Erase a user now. Returns the pseudonym their security log entries now carry."""
    user = db.get(User, user_id)
    code = pseudonym(user_id)
    if user is None:
        db.execute(GenericRecord.__table__.delete().where(GenericRecord.namespace == NS_PENDING,
                                                          GenericRecord.record_id == str(user_id)))
        db.commit()
        return None
    email, name, org_id = user.email, user.name, user.org_id

    others_in_org = bool(org_id) and db.scalar(
        select(User.id).where(User.org_id == org_id, User.id != user_id).limit(1)) is not None
    last_in_org = bool(org_id) and not others_in_org
    owners = {f"user:{user_id}"} | ({f"org:{org_id}"} if last_in_org else set())

    run_q = select(Run.run_id).where(Run.created_by_user_id == user_id)
    if last_in_org:
        run_q = select(Run.run_id).where((Run.created_by_user_id == user_id) | (Run.org_id == org_id))
    run_ids = list(db.scalars(run_q).all())
    project_ids = set(db.scalars(select(Run.project_id).where(Run.run_id.in_(run_ids))).all()) if run_ids else set()
    _delete_runs(db, run_ids)

    # Notification channels, and their delivery log.
    channel_q = select(NotificationChannel.channel_id).where(NotificationChannel.created_by_user_id == user_id)
    if last_in_org:
        channel_q = select(NotificationChannel.channel_id).where(
            (NotificationChannel.created_by_user_id == user_id) | (NotificationChannel.org_id == org_id))
    channels = list(db.scalars(channel_q).all())
    for chunk in _chunks(channels):
        db.execute(NotificationLog.__table__.delete().where(NotificationLog.channel_id.in_(chunk)))

    # Everything they made, or that is theirs, in any table.
    keep = {"users", "audit_logs", "runs", "projects", "org_invites", "organizations"}
    for table in _tables_with("created_by_user_id", skip=keep):
        db.execute(table.delete().where(table.c.created_by_user_id == user_id))
    for table in _tables_with("user_id", skip=keep):
        db.execute(table.delete().where(table.c.user_id == user_id))

    # Projects: theirs alone go; ones others still use lose the creator.
    candidates = set(db.scalars(select(Project.id).where(Project.created_by_user_id == user_id)).all())
    candidates |= {p for p in project_ids if p is not None}
    for pid in candidates:
        still_used = db.scalar(select(Run.id).where(Run.project_id == pid).limit(1)) is not None
        project = db.get(Project, pid)
        if project is None:
            continue
        if still_used:
            if project.created_by_user_id == user_id:
                project.created_by_user_id = None
        elif project.created_by_user_id in (user_id, None):
            db.delete(project)

    # Invitations they sent keep existing for the organisation; ones sent to them go.
    db.execute(update(OrgInvite).where(OrgInvite.invited_by_user_id == user_id).values(invited_by_user_id=None))
    if email:
        db.execute(OrgInvite.__table__.delete().where(OrgInvite.email == email))

    # Generic store records (one table, many feature namespaces).
    run_id_set = set(run_ids)
    for record in db.scalars(select(GenericRecord)).all():
        if _record_is_theirs(record, user_id, owners, run_id_set, email):
            db.delete(record)
    for req in db.scalars(select(GenericRecord).where(GenericRecord.namespace == NS_REQUESTS)).all():
        data = dict(req.data or {})
        if data.get("user_id") == user_id:
            data.update(user_id=code, reason=None)
            if data.get("request_type") == "delete":
                data.update(status="completed", completed_at=_now().isoformat())
            req.data = data
    _side_files(owners, user_id)

    # The security log stays, pseudonymised.
    db.execute(update(AuditLog).where(AuditLog.user_id == user_id)
               .values(user_id=None, user_agent=None, meta={"subject": code}))
    db.execute(update(AuditLog).where(AuditLog.resource_type == "user", AuditLog.resource_id == str(user_id))
               .values(resource_id=code))

    if last_in_org:
        for table in _tables_with("org_id", skip={"users", "audit_logs", "organizations"}):
            db.execute(table.delete().where(table.c.org_id == org_id))
        db.execute(update(AuditLog).where(AuditLog.org_id == org_id).values(org_id=None))

    db.execute(GenericRecord.__table__.delete().where(GenericRecord.namespace == NS_PENDING,
                                                      GenericRecord.record_id == str(user_id)))
    db.delete(user)
    db.flush()
    if last_in_org:
        org = db.get(Organization, org_id)
        if org is not None:
            db.delete(org)
    db.add(AuditLog(action="account.erased", resource_type="user", resource_id=code,
                    meta={"subject": code, "runs": len(run_ids)}))
    db.commit()

    if notify and email:
        try:
            from .email_service import send_account_erased_email
            send_account_erased_email(to_email=email, user_name=name)
        except Exception:
            log.exception("erasure: could not send the confirmation email")
    return code


# ── Export ────────────────────────────────────────────────────────────────────

def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return None
    return value


def _is_secret_field(key: Any) -> bool:
    name = str(key).lower()
    return not name.startswith("has_") and name != "share_token" and any(s in name for s in _SECRET_FIELDS)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("[not exported: secret]" if _is_secret_field(k) and v else _redact(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact(v) for v in value]
    return value


def _row(obj: Any, table: Table | None = None) -> dict[str, Any]:
    table = table if table is not None else obj.__table__
    out = {}
    for col in table.c:
        if col.name in _SECRET_COLUMNS:
            if col.name in ("secret", "webhook_secret", "encrypted_key"):
                out["has_" + col.name] = bool(getattr(obj, col.key, None))
            continue
        out[col.name] = _jsonable(getattr(obj, col.key, None))
    return out


def export(db: Session, user: User) -> dict[str, Any]:
    """Everything Q-Lab holds about this user, without secrets (key hashes, passkey public keys,
    saved provider keys, webhook signing secrets and integration tokens are listed, not copied)."""
    uid = user.id
    owners = {f"user:{uid}"}
    runs = db.scalars(select(Run).where(Run.created_by_user_id == uid).order_by(Run.created_at)).all()
    run_ids = {r.run_id for r in runs}
    org = db.get(Organization, user.org_id) if user.org_id else None

    project_ids = {r.project_id for r in runs if r.project_id}
    projects = db.scalars(select(Project).where(
        (Project.created_by_user_id == uid) | (Project.id.in_(project_ids or {-1})))).all()

    other_tables: dict[str, list[dict[str, Any]]] = {}
    covered = {"users", "runs", "projects", "audit_logs", "api_keys", "passkey_credentials", "recovery_codes",
               "api_credentials", "webhooks", "notification_channels", "organizations", "generic_records"}
    for table in Base.metadata.sorted_tables:
        if table.name in covered:
            continue
        conds = []
        for col in ("created_by_user_id", "user_id", "invited_by_user_id"):
            if col in table.c:
                conds.append(table.c[col] == uid)
        if "run_id" in table.c and run_ids:
            conds.append(table.c.run_id.in_(run_ids))
        if "email" in table.c and user.email:
            conds.append(table.c.email == user.email)
        if not conds:
            continue
        rows = db.execute(select(table).where(or_(*conds))).all()
        if rows:
            other_tables[table.name] = [_redact({c.name: _jsonable(v) for c, v in zip(table.c, r)
                                                 if c.name not in _SECRET_COLUMNS}) for r in rows]

    store = []
    for record in db.scalars(select(GenericRecord)).all():
        if record.namespace in (NS_EXPORTS, NS_PENDING):
            continue
        if _record_is_theirs(record, uid, owners, run_ids, user.email) or (
                record.namespace == NS_REQUESTS and (record.data or {}).get("user_id") == uid):
            store.append({"namespace": record.namespace, "record_id": record.record_id,
                          "data": _redact(record.data), "created_at": _jsonable(record.created_at)})

    channels = db.scalars(select(NotificationChannel).where(NotificationChannel.created_by_user_id == uid)).all()
    erasure = pending(db, uid)
    return {
        "export_format": "qlab-account-export/1",
        "exported_at": _now().isoformat(),
        "profile": {
            "id": uid, "name": user.name, "email": user.email, "email_verified": user.email_verified,
            "role": user.role, "is_active": user.is_active, "has_password": bool(user.password_hash),
            "created_at": _jsonable(user.created_at), "last_login_at": _jsonable(user.last_login_at),
            "login_count": user.login_count,
            "organization": {"id": org.id, "slug": org.slug, "name": org.name} if org else None,
            "scheduled_erasure": erasure,
        },
        "runs": [_row(r) for r in runs],
        "shares": [{"run_id": r.run_id, "share_token": r.share_token} for r in runs if r.share_token],
        "projects": [_row(p) for p in projects],
        "api_keys": [_row(k) for k in db.scalars(select(APIKey).where(APIKey.user_id == uid)).all()],
        "passkeys": [_row(p) for p in db.scalars(select(PasskeyCredential).where(PasskeyCredential.user_id == uid)).all()],
        "recovery_codes": [_row(c) for c in db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == uid)).all()],
        "provider_keys": [_row(c) for c in db.scalars(select(ApiCredential).where(ApiCredential.created_by_user_id == uid)).all()],
        "webhooks": [_redact(_row(w)) for w in db.scalars(select(Webhook).where(Webhook.created_by_user_id == uid)).all()],
        "notification_channels": [_redact(_row(c)) for c in channels],
        "security_log": [_row(e) for e in db.scalars(
            select(AuditLog).where((AuditLog.user_id == uid) | (
                (AuditLog.resource_type == "user") & (AuditLog.resource_id == str(uid)))).order_by(AuditLog.created_at)).all()],
        "other_records": other_tables,
        "stored_records": store,
    }
