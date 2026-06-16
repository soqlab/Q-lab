"""Notification Delivery System.

Channels: email (SMTP) | slack (webhook) | generic webhook (POST)

Events dispatched:
  job.completed   — job finished (success or failure)
  job.failed      — job terminal failure
  budget.alert    — spending threshold crossed
  health.drop     — backend health score fell below threshold
  decoherence.alert — T1/T2 dropped below threshold

All delivery is best-effort; failures are logged but don't raise exceptions.
"""
from __future__ import annotations

import json
import os
import smtplib
import urllib.request
import uuid
from datetime import datetime, timezone
from email.mime.text import MIMEText
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import NotificationChannel, NotificationLog
from ..store import store_get, store_put, store_list
from ..email_service import is_email_configured, send_email, run_complete_email

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "qlab@example.com")


# ─────────────────────────────────────────────────────────────────────────────
# Delivery helpers
# ─────────────────────────────────────────────────────────────────────────────

def _send_slack(webhook_url: str, event: str, payload: dict) -> None:
    text = f"*Q-Lab event: `{event}`*\n```{json.dumps(payload, indent=2)[:1200]}```"
    body = json.dumps({"text": text}).encode()
    req = urllib.request.Request(webhook_url, data=body, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req, timeout=10)


def _send_webhook(url: str, event: str, payload: dict, secret: str = "") -> None:
    body = json.dumps({"event": event, "data": payload, "ts": datetime.now(timezone.utc).isoformat()}).encode()
    headers: dict[str, str] = {"Content-Type": "application/json", "X-Qlab-Event": event}
    if secret:
        import hmac, hashlib
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-Qlab-Signature"] = f"sha256={sig}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    urllib.request.urlopen(req, timeout=10)


def _send_email(to: str, event: str, payload: dict) -> None:
    if not SMTP_HOST:
        raise RuntimeError("SMTP_HOST not configured")
    subject = f"[Q-Lab] {event}"
    body = f"Event: {event}\n\n{json.dumps(payload, indent=2)}"
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
        smtp.starttls()
        if SMTP_USER:
            smtp.login(SMTP_USER, SMTP_PASS)
        smtp.sendmail(SMTP_FROM, to, msg.as_string())


def dispatch_event(event: str, payload: dict, db: Session | None = None) -> None:
    """Called from other routers to fire notifications for an event."""
    close_db = db is None
    if db is None:
        db = SessionLocal()
    try:
        channels = db.scalars(
            select(NotificationChannel)
            .where(NotificationChannel.is_active == True)
        ).all()
        for ch in channels:
            if event not in (ch.events or []):
                continue
            status, error = "sent", None
            try:
                cfg = ch.config or {}
                if ch.channel_type == "slack":
                    _send_slack(cfg.get("webhook_url", ""), event, payload)
                elif ch.channel_type == "webhook":
                    _send_webhook(cfg.get("url", ""), event, payload, cfg.get("secret", ""))
                elif ch.channel_type == "email":
                    _send_email(cfg.get("to", ""), event, payload)
            except Exception as ex:
                status, error = "failed", str(ex)
            log = NotificationLog(channel_id=ch.channel_id, event=event, payload=payload, status=status, error=error)
            db.add(log)
            ch.last_triggered_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        if close_db:
            db.close()


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

ALL_EVENTS = [
    "job.completed", "job.failed", "budget.alert",
    "health.drop", "decoherence.alert", "run.created",
]


class ChannelCreate(BaseModel):
    name: str
    channel_type: str = Field(..., description="email | slack | webhook")
    config: dict[str, Any] = Field(default_factory=dict)
    events: list[str] = Field(default_factory=lambda: ALL_EVENTS[:])


class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict[str, Any]] = None
    events: Optional[list[str]] = None
    is_active: Optional[bool] = None


class TestPayload(BaseModel):
    event: str = "test.ping"
    message: str = "Test notification from Q-Lab"


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

def _ch_to_dict(ch: NotificationChannel) -> dict:
    cfg = dict(ch.config or {})
    # Mask secrets
    for k in ("webhook_url", "url", "token"):
        if k in cfg:
            v = str(cfg[k])
            cfg[k] = v[:8] + "..." if len(v) > 8 else "***"
    return {
        "channel_id": ch.channel_id,
        "name": ch.name,
        "channel_type": ch.channel_type,
        "config": cfg,
        "events": ch.events,
        "is_active": ch.is_active,
        "last_triggered_at": ch.last_triggered_at.isoformat() if ch.last_triggered_at else None,
        "created_at": ch.created_at.isoformat(),
    }


@router.post("/channels")
def create_channel(req: ChannelCreate, db: Session = Depends(get_db)):
    if req.channel_type not in {"email", "slack", "webhook"}:
        raise HTTPException(422, f"Unknown channel_type '{req.channel_type}'")
    ch = NotificationChannel(
        channel_id=f"nc-{uuid.uuid4().hex[:12]}",
        name=req.name,
        channel_type=req.channel_type,
        config=req.config,
        events=req.events,
        is_active=True,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return _ch_to_dict(ch)


@router.get("/channels")
def list_channels(db: Session = Depends(get_db)):
    return [_ch_to_dict(ch) for ch in db.scalars(
        select(NotificationChannel).order_by(NotificationChannel.created_at.desc())
    ).all()]


@router.patch("/channels/{channel_id}")
def update_channel(channel_id: str, req: ChannelUpdate, db: Session = Depends(get_db)):
    ch = db.scalar(select(NotificationChannel).where(NotificationChannel.channel_id == channel_id))
    if ch is None:
        raise HTTPException(404, "Channel not found")
    if req.name is not None:
        ch.name = req.name
    if req.config is not None:
        ch.config = req.config
    if req.events is not None:
        ch.events = req.events
    if req.is_active is not None:
        ch.is_active = req.is_active
    db.commit()
    return _ch_to_dict(ch)


@router.delete("/channels/{channel_id}", status_code=204)
def delete_channel(channel_id: str, db: Session = Depends(get_db)):
    ch = db.scalar(select(NotificationChannel).where(NotificationChannel.channel_id == channel_id))
    if ch is None:
        raise HTTPException(404, "Channel not found")
    db.delete(ch)
    db.commit()


@router.post("/channels/{channel_id}/test")
def test_channel(channel_id: str, req: TestPayload, db: Session = Depends(get_db)):
    ch = db.scalar(select(NotificationChannel).where(NotificationChannel.channel_id == channel_id))
    if ch is None:
        raise HTTPException(404, "Channel not found")
    status, error = "sent", None
    try:
        cfg = ch.config or {}
        payload = {"message": req.message, "channel": ch.name}
        if ch.channel_type == "slack":
            _send_slack(cfg.get("webhook_url", ""), req.event, payload)
        elif ch.channel_type == "webhook":
            _send_webhook(cfg.get("url", ""), req.event, payload, cfg.get("secret", ""))
        elif ch.channel_type == "email":
            _send_email(cfg.get("to", ""), req.event, payload)
    except Exception as ex:
        status, error = "failed", str(ex)
    return {"channel_id": channel_id, "status": status, "error": error}


@router.get("/logs")
def get_logs(
    channel_id: Optional[str] = None,
    event: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    q = select(NotificationLog).order_by(NotificationLog.sent_at.desc())
    if channel_id:
        q = q.where(NotificationLog.channel_id == channel_id)
    if event:
        q = q.where(NotificationLog.event == event)
    logs = db.scalars(q.limit(limit)).all()
    return [
        {
            "id": lg.id, "channel_id": lg.channel_id, "event": lg.event,
            "status": lg.status, "error": lg.error,
            "sent_at": lg.sent_at.isoformat(),
        }
        for lg in logs
    ]


@router.get("/events")
def list_events():
    return {"events": ALL_EVENTS}


# ─────────────────────────────────────────────────────────────────────────────
# User notification preferences (GenericRecord store)
# ─────────────────────────────────────────────────────────────────────────────

_PREFS_NS = "notifications_prefs"
_HISTORY_NS = "notifications_history"


class NotificationPreferences(BaseModel):
    email: str
    on_run_complete: bool = True
    on_run_failed: bool = True
    on_alert_triggered: bool = True
    weekly_digest: bool = True
    on_peer_review_request: bool = True
    min_health_score_to_notify: int = 0  # 0 = always notify


def _prefs_key(user_id: str) -> str:
    return f"user_{user_id}"


@router.get("/preferences")
def get_preferences(
    user_id: str = "default",
    db: Session = Depends(get_db),
) -> dict:
    """Get notification preferences for a user (keyed by user_id query param)."""
    data = store_get(db, _PREFS_NS, _prefs_key(user_id))
    if data is None:
        # Return defaults
        return NotificationPreferences(email="").model_dump()
    return data


@router.put("/preferences")
def update_preferences(
    body: NotificationPreferences,
    user_id: str = "default",
    db: Session = Depends(get_db),
) -> dict:
    """Save notification preferences for a user."""
    data = body.model_dump()
    store_put(db, _PREFS_NS, _prefs_key(user_id), data)
    return data


@router.get("/history")
def get_history(
    user_id: str = "default",
    limit: int = 50,
    db: Session = Depends(get_db),
) -> list[dict]:
    """Return the last `limit` notification history entries for a user."""
    all_entries: list[dict[str, Any]] = store_list(db, _HISTORY_NS)
    user_entries = [
        e for e in all_entries
        if e.get("user_email") == user_id or e.get("user_email", "").startswith(user_id)
    ]
    # Sort newest first
    user_entries.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
    return user_entries[:limit]


@router.post("/test")
def send_test_email(
    user_id: str = "default",
    db: Session = Depends(get_db),
) -> dict:
    """Send a test email to verify SMTP configuration."""
    prefs = store_get(db, _PREFS_NS, _prefs_key(user_id))
    to_email: str = (prefs or {}).get("email", "")
    if not to_email:
        raise HTTPException(400, "No notification email configured — set preferences first")

    html_body = run_complete_email(
        run_id="test-run-0000",
        run_name="Test Run (Q-Lab config check)",
        health_score=85,
        backend="ibm_brisbane",
        duration_s=3.14,
    )
    sent = send_email(
        to=to_email,
        subject="[Q-Lab] Test notification — email is working!",
        html=html_body,
    )

    # Log to history
    ts = datetime.now(timezone.utc).isoformat()
    history_key = f"{user_id}_{ts}"
    store_put(db, _HISTORY_NS, history_key, {
        "user_email": user_id,
        "event": "test",
        "run_id": "test-run-0000",
        "subject": "[Q-Lab] Test notification — email is working!",
        "status": "sent" if sent else "failed",
        "timestamp": ts,
        "extra": {"to": to_email},
    })

    return {
        "sent": sent,
        "to": to_email,
        "configured": is_email_configured(),
    }


@router.get("/status")
def email_status() -> dict:
    """Return whether email transport is configured (for frontend display)."""
    smtp_host = os.getenv("SMTP_HOST", "")
    resend_key = os.getenv("RESEND_API_KEY", "")
    transport: str
    if resend_key:
        transport = "resend"
    elif smtp_host:
        transport = "smtp"
    else:
        transport = "none"
    return {
        "configured": is_email_configured(),
        "transport": transport,
        "smtp_host": smtp_host if smtp_host else None,
    }
