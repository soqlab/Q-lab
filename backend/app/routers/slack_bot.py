"""Slack slash command handler and Microsoft Teams incoming webhook support.

Router prefix: /api/v1/slack
"""

from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Form, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import Identity, get_identity, require_auth
from ..models import Run
from ..store import store_delete, store_get, store_list, store_put

router = APIRouter(prefix="/api/v1/slack", tags=["slack"])

_NAMESPACE = "slack_configs"
_CONFIG_ID = "default"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SlackConfig(BaseModel):
    config_id: str = _CONFIG_ID
    slack_signing_secret: str
    slack_bot_token: str
    channel_id: Optional[str] = None
    notify_on_run_complete: bool = True
    notify_on_health_below: Optional[int] = None
    teams_webhook_url: Optional[str] = None
    created_at: str = ""


class SlackConfigPayload(BaseModel):
    slack_signing_secret: str
    slack_bot_token: str
    channel_id: Optional[str] = None
    notify_on_run_complete: bool = True
    notify_on_health_below: Optional[int] = None
    teams_webhook_url: Optional[str] = None


class NotifyBody(BaseModel):
    message: str
    channel_id: Optional[str] = None
    run_id: Optional[str] = None


class TeamsNotifyBody(BaseModel):
    title: str
    text: str
    color: Optional[str] = "6366f1"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_config(db: Session) -> Optional[dict]:
    return store_get(db, _NAMESPACE, _CONFIG_ID)


def _make_blocks(title: str, text: str, color: str = "#6366f1") -> dict:
    return {
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": title}},
            {"type": "section", "text": {"type": "mrkdwn", "text": text}},
        ],
        "response_type": "in_channel",
    }


def _verify_slack_signature(body: bytes, timestamp: Optional[str], signature: Optional[str], secret: str) -> bool:
    if not timestamp or not signature:
        return False
    # Reject stale requests > 5 minutes old
    try:
        if abs(time.time() - float(timestamp)) > 300:
            return False
    except (ValueError, TypeError):
        return False
    base = f"v0:{timestamp}:{body.decode('utf-8', errors='replace')}"
    expected = "v0=" + hmac.new(secret.encode(), base.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _run_to_mrkdwn(r: Run) -> str:
    health = (r.results or {}).get("health_score", "N/A")
    if isinstance(health, (int, float)):
        emoji = "🟢" if health >= 75 else "🟡" if health >= 50 else "🔴"
    else:
        emoji = "⚪"
    ts = r.created_at.strftime("%m/%d %H:%M") if r.created_at else "?"
    return (
        f"• `{r.run_id[:12]}` *{r.circuit_name or 'unnamed'}* "
        f"| {r.backend or '?'} | {emoji} {health} | {r.status} | {ts}"
    )


async def _handle_status(db: Session) -> dict:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    q = select(Run).where(Run.created_at >= since).order_by(Run.created_at.desc()).limit(100)
    runs = list(db.scalars(q).all())
    total = len(runs)
    completed = sum(1 for r in runs if r.status == "completed")
    failed = sum(1 for r in runs if r.status == "failed")
    scores = [(r.results or {}).get("health_score", 0) for r in runs if (r.results or {}).get("health_score") is not None]
    avg_h = round(sum(scores) / len(scores), 1) if scores else "N/A"
    emoji = "🟢" if isinstance(avg_h, float) and avg_h >= 75 else "🟡" if isinstance(avg_h, float) and avg_h >= 50 else "🔴"

    text = (
        f"*Q-Lab Status (last 24h)*\n"
        f"Runs: *{total}* | Completed: *{completed}* | Failed: *{failed}*\n"
        f"Avg Health: {emoji} *{avg_h}*"
    )
    return _make_blocks("⚛️ Q-Lab Status", text)


async def _handle_runs(db: Session, n: int = 5) -> dict:
    n = min(max(n, 1), 20)
    q = select(Run).order_by(Run.created_at.desc()).limit(n)
    runs = list(db.scalars(q).all())
    if not runs:
        return _make_blocks("⚛️ Recent Runs", "_No runs found._")
    lines = [_run_to_mrkdwn(r) for r in runs]
    return _make_blocks(f"⚛️ Last {len(runs)} Runs", "\n".join(lines))


async def _handle_run(db: Session, run_id: str) -> dict:
    run = db.scalar(select(Run).where(Run.run_id == run_id))
    if not run:
        return _make_blocks("⚛️ Run Not Found", f"No run with ID `{run_id}`.")
    health = (run.results or {}).get("health_score", "N/A")
    if isinstance(health, (int, float)):
        emoji = "🟢" if health >= 75 else "🟡" if health >= 50 else "🔴"
    else:
        emoji = "⚪"
    text = (
        f"*Run:* `{run.run_id}`\n"
        f"*Circuit:* {run.circuit_name or 'unnamed'}\n"
        f"*Backend:* {run.backend or '?'}\n"
        f"*Status:* {run.status}\n"
        f"*Health:* {emoji} {health}\n"
        f"*Created:* {run.created_at.isoformat() if run.created_at else '?'}\n"
        f"<http://localhost:3000/runs/{run.run_id}|View in Q-Lab>"
    )
    return _make_blocks(f"⚛️ Run Details", text)


async def _handle_health(db: Session, backend: str) -> dict:
    q = select(Run).where(Run.backend == backend).order_by(Run.created_at.desc()).limit(20)
    runs = list(db.scalars(q).all())
    if not runs:
        return _make_blocks("⚛️ Backend Health", f"No runs found for backend `{backend}`.")
    scores = [(r.results or {}).get("health_score") for r in runs if (r.results or {}).get("health_score") is not None]
    avg_h = round(sum(scores) / len(scores), 1) if scores else "N/A"
    emoji = "🟢" if isinstance(avg_h, float) and avg_h >= 75 else "🟡" if isinstance(avg_h, float) and avg_h >= 50 else "🔴"
    completed = sum(1 for r in runs if r.status == "completed")
    text = (
        f"*Backend:* `{backend}`\n"
        f"*Runs (last 20):* {len(runs)} | Completed: {completed}\n"
        f"*Avg Health:* {emoji} {avg_h}"
    )
    return _make_blocks(f"⚛️ Backend: {backend}", text)


def _handle_help() -> dict:
    text = (
        "*/qlab status* — Backend health summary (last 24h)\n"
        "*/qlab runs [N]* — Last N runs (default 5, max 20)\n"
        "*/qlab run <run_id>* — Details about a specific run\n"
        "*/qlab health <backend>* — Backend calibration summary\n"
        "*/qlab help* — Show this help message"
    )
    return _make_blocks("⚛️ Q-Lab Help", text)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/config")
async def save_slack_config(
    payload: SlackConfigPayload,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Save Slack/Teams config, verifying the Slack bot token."""
    bot_name: Optional[str] = None
    team_name: Optional[str] = None
    verified = False

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                "https://slack.com/api/auth.test",
                headers={"Authorization": f"Bearer {payload.slack_bot_token}"},
            )
        data = resp.json()
        if data.get("ok"):
            verified = True
            bot_name = data.get("user") or data.get("bot_id")
            team_name = data.get("team")
    except Exception:
        pass

    config: dict[str, Any] = {
        "config_id": _CONFIG_ID,
        "slack_signing_secret": payload.slack_signing_secret,
        "slack_bot_token": payload.slack_bot_token,
        "channel_id": payload.channel_id,
        "notify_on_run_complete": payload.notify_on_run_complete,
        "notify_on_health_below": payload.notify_on_health_below,
        "teams_webhook_url": payload.teams_webhook_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    store_put(db, _NAMESPACE, _CONFIG_ID, config)

    return {
        **config,
        "slack_bot_token": config["slack_bot_token"][:12] + "***",
        "slack_signing_secret": "***",
        "verified": verified,
        "bot_name": bot_name,
        "team_name": team_name,
    }


@router.get("/config")
def get_slack_config(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Get current Slack/Teams config."""
    config = _get_config(db)
    if not config:
        raise HTTPException(status_code=404, detail="No Slack integration configured")
    return {
        **config,
        "slack_bot_token": config["slack_bot_token"][:12] + "***" if config.get("slack_bot_token") else "",
        "slack_signing_secret": "***",
    }


@router.post("/slash-command")
async def slack_slash_command(
    request: Request,
    x_slack_request_timestamp: Optional[str] = Header(default=None),
    x_slack_signature: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Handle Slack slash command /qlab."""
    body_bytes = await request.body()

    config = _get_config(db)

    # Verify Slack signature if we have a signing secret
    if config and config.get("slack_signing_secret"):
        if not _verify_slack_signature(
            body_bytes,
            x_slack_request_timestamp,
            x_slack_signature,
            config["slack_signing_secret"],
        ):
            # Return friendly error in Slack format (don't expose internals)
            return _make_blocks("⚛️ Q-Lab", "Authentication failed. Check your Slack signing secret configuration.")

    # Parse form-encoded body
    try:
        from urllib.parse import parse_qs
        parsed = parse_qs(body_bytes.decode("utf-8", errors="replace"))
        text = (parsed.get("text", [""])[0] or "").strip()
    except Exception:
        text = ""

    parts = text.split()
    subcommand = parts[0].lower() if parts else "help"

    try:
        if subcommand == "status":
            return await _handle_status(db)

        elif subcommand == "runs":
            n = 5
            if len(parts) > 1:
                try:
                    n = int(parts[1])
                except ValueError:
                    pass
            return await _handle_runs(db, n)

        elif subcommand == "run":
            if len(parts) < 2:
                return _make_blocks("⚛️ Q-Lab", "Usage: `/qlab run <run_id>`")
            return await _handle_run(db, parts[1])

        elif subcommand == "health":
            if len(parts) < 2:
                return _make_blocks("⚛️ Q-Lab", "Usage: `/qlab health <backend>`")
            return await _handle_health(db, parts[1])

        else:  # help or unknown
            return _handle_help()

    except Exception as exc:
        return _make_blocks("⚛️ Q-Lab Error", f"Something went wrong: {exc!s}")


@router.post("/notify")
async def slack_notify(
    body: NotifyBody,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Send a proactive notification to Slack."""
    config = _get_config(db)
    if not config or not config.get("slack_bot_token"):
        raise HTTPException(status_code=400, detail="Slack integration not configured")

    channel = body.channel_id or config.get("channel_id")
    if not channel:
        raise HTTPException(status_code=400, detail="No channel_id provided and no default channel configured")

    payload: dict[str, Any] = {
        "channel": channel,
        "text": body.message,
    }
    if body.run_id:
        payload["blocks"] = [
            {"type": "section", "text": {"type": "mrkdwn", "text": body.message}},
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "View Run"},
                        "url": f"http://localhost:3000/runs/{body.run_id}",
                    }
                ],
            },
        ]

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                "https://slack.com/api/chat.postMessage",
                json=payload,
                headers={"Authorization": f"Bearer {config['slack_bot_token']}"},
            )
        data = resp.json()
        return {"sent": data.get("ok", False), "channel": channel}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to send Slack message: {exc!s}")


@router.post("/teams-notify")
async def teams_notify(
    body: TeamsNotifyBody,
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Send a message to Microsoft Teams via incoming webhook."""
    config = _get_config(db)
    webhook_url = (config or {}).get("teams_webhook_url")
    if not webhook_url:
        raise HTTPException(status_code=400, detail="Teams webhook URL not configured")

    card: dict[str, Any] = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "summary": body.title,
        "themeColor": body.color or "6366f1",
        "title": body.title,
        "text": body.text,
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(webhook_url, json=card)
        return {"sent": resp.status_code < 300, "status_code": resp.status_code}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to send Teams message: {exc!s}")


@router.get("/test")
async def slack_test(
    db: Session = Depends(get_db),
    identity: Optional[Identity] = Depends(get_identity),
):
    """Send a test message to verify Slack configuration."""
    config = _get_config(db)
    if not config or not config.get("slack_bot_token"):
        raise HTTPException(status_code=400, detail="Slack integration not configured")

    channel = config.get("channel_id")
    if not channel:
        raise HTTPException(status_code=400, detail="No default channel configured — set channel_id in config first")

    test_msg = (
        "⚛️ *Q-Lab test message*\n"
        "Slack integration is working correctly! "
        "You'll receive notifications here for run completions and health alerts."
    )
    payload = {"channel": channel, "text": test_msg}

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(
                "https://slack.com/api/chat.postMessage",
                json=payload,
                headers={"Authorization": f"Bearer {config['slack_bot_token']}"},
            )
        data = resp.json()
        if data.get("ok"):
            return {"sent": True, "channel": channel, "message": "Test message sent successfully"}
        return {"sent": False, "channel": channel, "error": data.get("error")}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Test failed: {exc!s}")
