"""Background tasks: webhook delivery."""
import hashlib
import hmac
import ipaddress
import json
import socket
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx

_PRIVATE_NETS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]


def _is_safe_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        host = parsed.hostname or ""
        addrs = socket.getaddrinfo(host, None)
        for *_, sockaddr in addrs:
            ip = ipaddress.ip_address(sockaddr[0])
            if any(ip in net for net in _PRIVATE_NETS):
                return False
        return True
    except Exception:
        return False


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
        if not _is_safe_url(wh.url):
            wh.last_status_code = 0
        else:
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
