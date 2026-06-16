"""WebSocket connection manager for real-time notebook collaboration."""
from __future__ import annotations
import asyncio
from collections import defaultdict
from fastapi import WebSocket

class NotebookWSManager:
    def __init__(self):
        # notebook_id -> set of connected WebSockets
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, notebook_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self._rooms[notebook_id].add(ws)

    def disconnect(self, notebook_id: str, ws: WebSocket) -> None:
        self._rooms[notebook_id].discard(ws)
        if not self._rooms[notebook_id]:
            del self._rooms[notebook_id]

    async def broadcast(self, notebook_id: str, message: dict, exclude: WebSocket | None = None) -> None:
        """Send message to all connected clients in the room except the sender."""
        import json
        dead = set()
        for ws in list(self._rooms.get(notebook_id, [])):
            if ws is exclude:
                continue
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._rooms[notebook_id].discard(ws)

    def room_size(self, notebook_id: str) -> int:
        return len(self._rooms.get(notebook_id, []))

notebook_ws_manager = NotebookWSManager()
