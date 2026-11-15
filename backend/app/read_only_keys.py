"""Read-only API keys, and the rules for AI assistants that connect over MCP (qlab_sdk/qlab/mcp_server.py).

A key has a scope: "full" (the SDK uploads runs with it) or "read". This middleware runs before
routing, so no endpoint can forget the rule:

* A read-only key can only read: any request with it other than GET/HEAD/OPTIONS is refused (403).
* A request marked `X-Client: mcp/<tool>` (what qlab-mcp sends) must carry a valid read-only key,
  with no sign-in token beside it, and must be a GET or HEAD. A full key, a sign-in token, the
  legacy shared keys or no key at all are refused with a message saying how to make a read-only key.
* Every MCP-marked request whose key is valid is written to the audit log (action "mcp.tool_call"):
  the tool name, the key's id and prefix, the method, the path (without the query string) and the
  status code. Never the key itself and never the response.

It reads one indexed row per request that carries a qlab_ key, in a worker thread.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers
from starlette.responses import JSONResponse

READ_SCOPE = "read"
FULL_SCOPE = "full"
SCOPES = (FULL_SCOPE, READ_SCOPE)
MCP_PREFIX = "mcp/"
_TOOL_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_SAFE = frozenset({"GET", "HEAD", "OPTIONS"})
_MCP_METHODS = frozenset({"GET", "HEAD"})

READ_ONLY_REFUSED = "This is a read-only API key: it can look at runs but not change anything."
MCP_WRITE_REFUSED = "Your assistant can only read from Q-Lab. This request would change something, so it was refused."
MCP_NEEDS_READ_KEY = ("Q-Lab only answers an AI assistant that uses a read-only API key. Create one in "
                      "Settings, API keys (tick \"Read-only\"), and put it in your assistant's MCP settings "
                      "as QLAB_API_KEY.")
MCP_BROAD_KEY = ("This API key can change things, so Q-Lab won't let an AI assistant use it. Create a "
                 "read-only key in Settings, API keys (tick \"Read-only\"), and use that one instead.")
MCP_BAD_KEY = "That API key isn't valid on this server (wrong, revoked or expired)."


@dataclass(frozen=True)
class KeyInfo:
    id: int
    user_id: int
    org_id: Optional[int]
    prefix: str
    scope: str


def tool_name(x_client: str) -> Optional[str]:
    """The tool named by `X-Client: mcp/<tool>`, "unknown" if it isn't a plain name, None if not MCP."""
    if not x_client.lower().startswith(MCP_PREFIX):
        return None
    name = x_client[len(MCP_PREFIX):].strip()
    return name if _TOOL_RE.match(name) else "unknown"


def _lookup(raw_key: str) -> Optional[KeyInfo]:
    """The active, unexpired key of an active user, or None."""
    from sqlalchemy import select

    from .auth import hash_api_key
    from .database import SessionLocal
    from .models import APIKey, User

    with SessionLocal() as db:
        row = db.scalar(select(APIKey).where(APIKey.key_hash == hash_api_key(raw_key), APIKey.is_active.is_(True)))
        if row is None:
            return None
        expires_at = row.expires_at
        if expires_at and expires_at.tzinfo is None:  # SQLite returns naive UTC datetimes
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at and expires_at < datetime.now(timezone.utc):
            return None
        user = db.get(User, row.user_id)
        if user is None or not user.is_active:
            return None
        return KeyInfo(id=row.id, user_id=row.user_id, org_id=row.org_id or user.org_id,
                       prefix=row.key_prefix, scope=row.scope or FULL_SCOPE)


def _record(key: KeyInfo, tool: str, method: str, path: str, status: int, ip: Optional[str],
            user_agent: Optional[str]) -> None:
    from .database import SessionLocal
    from .models import AuditLog

    with SessionLocal() as db:
        db.add(AuditLog(org_id=key.org_id, user_id=key.user_id, action="mcp.tool_call", resource_type="mcp_tool",
                        resource_id=tool, ip_address=(ip or None) and ip[:64],
                        user_agent=(user_agent or None) and user_agent[:500],
                        meta={"tool": tool, "api_key_id": key.id, "api_key_prefix": key.prefix,
                              "method": method, "path": path[:300], "status": status, "client": "mcp"}))
        db.commit()


def refusal(method: str, tool: Optional[str], key: Optional[KeyInfo], key_given: bool, bearer: bool) -> Optional[str]:
    """Why this request is refused before it reaches any endpoint, or None to let it through."""
    if tool is not None:
        if bearer or not key_given:
            return MCP_NEEDS_READ_KEY
        if key is None:
            return MCP_BAD_KEY
        if key.scope != READ_SCOPE:
            return MCP_BROAD_KEY
        if method not in _MCP_METHODS:
            return MCP_WRITE_REFUSED
        return None
    if key is not None and key.scope == READ_SCOPE and method not in _SAFE:
        return READ_ONLY_REFUSED
    return None


class ReadOnlyKeys:
    """ASGI middleware applying the rules in this module's docstring."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        tool = tool_name(headers.get("x-client", ""))
        raw_key = (headers.get("x-qlab-api-key") or "").strip()
        has_qlab_key = raw_key.startswith("qlab_")
        if tool is None and not has_qlab_key:
            return await self.app(scope, receive, send)

        key = await run_in_threadpool(_lookup, raw_key) if has_qlab_key else None
        method = scope["method"].upper()
        bearer = (headers.get("authorization") or "").lower().startswith("bearer ")
        why = refusal(method, tool, key, bool(raw_key), bearer)
        status = {"code": 403}
        if why is not None:
            code = 401 if why == MCP_BAD_KEY else 403
            status["code"] = code
            await JSONResponse({"detail": why}, status_code=code)(scope, receive, send)
        else:
            async def send_and_note(message):
                if message["type"] == "http.response.start":
                    status["code"] = message["status"]
                await send(message)

            await self.app(scope, receive, send_and_note)

        if tool is not None and key is not None:
            client = scope.get("client")
            try:
                await run_in_threadpool(_record, key, tool, method, scope.get("path", ""), status["code"],
                                        client[0] if client else None, headers.get("user-agent"))
            except Exception:  # the audit log never breaks a response that has already been sent
                pass


__all__ = ["ReadOnlyKeys", "READ_SCOPE", "FULL_SCOPE", "SCOPES", "refusal", "tool_name"]
