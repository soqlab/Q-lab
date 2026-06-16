"""Background tasks: webhook delivery."""
import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any

import httpx


def deliver_webhooks(run_dict: dict[str, Any], event: str) -> None:
    from .database import SessionLocal
    from .models import Webhook
    from sqlalchemy import select

    try:
        with SessionLocal() as db:
            hooks = db.scalars(select(Webhook).where(Webhook.is_active.is_(True))).all()
            for wh in hooks:
                if wh.events and event not in wh.events:
                    continue
                if wh.project_slug and wh.project_slug != run_dict.get("project"):
                    continue
                _post_webhook(wh, event, run_dict, db)
    except Exception:
        pass


def _post_webhook(wh: Any, event: str, data: dict, db: Any) -> None:
    payload_str = json.dumps({"event": event, "data": data, "timestamp": datetime.now(timezone.utc).isoformat()})
    headers = {"Content-Type": "application/json", "X-QLab-Event": event}

    if wh.secret:
        sig = hmac.new(wh.secret.encode(), payload_str.encode(), hashlib.sha256).hexdigest()
        headers["X-QLab-Signature"] = f"sha256={sig}"

    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.post(wh.url, content=payload_str, headers=headers)
        wh.last_status_code = resp.status_code
    except Exception:
        wh.last_status_code = 0

    wh.last_triggered_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except Exception:
        pass
