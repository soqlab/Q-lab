"""
In-process SSE pub/sub. Synchronous handlers call publish_sync();
the async SSE endpoint yields from event_stream().
"""
import asyncio
import json
from typing import Any, AsyncGenerator

from .run_scope import visible

_event_loop: asyncio.AbstractEventLoop | None = None
_subscribers: list[asyncio.Queue] = []


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _event_loop
    _event_loop = loop


def publish_sync(event_type: str, data: dict) -> None:
    if _event_loop is None or _event_loop.is_closed():
        return
    try:
        _event_loop.call_soon_threadsafe(_dispatch, {"type": event_type, "data": data})
    except Exception:
        pass


def _dispatch(event: dict) -> None:
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


async def event_stream(
    filter_project: str | None = None,
    filter_org_id: int | None = None,
    scope: Any = None,
) -> AsyncGenerator[str, None]:
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _subscribers.append(q)
    try:
        yield 'data: {"type":"connected"}\n\n'
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=25.0)
                data = event.get("data") or {}
                if filter_project:
                    run_project = data.get("project")
                    if run_project and run_project != filter_project:
                        continue
                if scope is not None and event.get("type") != "run.deleted" and not visible(
                        data.get("created_by_user_id"), data.get("org_id"), scope):
                    continue
                if filter_org_id is not None:
                    run_org = data.get("org_id")
                    if run_org is not None and run_org != filter_org_id:
                        continue
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
    finally:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass
