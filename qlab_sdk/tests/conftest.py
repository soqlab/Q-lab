"""A local Q-Lab stand-in: a real HTTP server on 127.0.0.1 that records what the SDK sends.

Tests that use it exercise the SDK's real upload code (httpx / urllib over a socket) instead of
replacing the client's methods, so headers, paths and JSON bodies are checked as sent.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


class FakeQLab:
    def __init__(self):
        self.requests: list[dict] = []
        self.routes: dict[tuple[str, str], tuple[int, object]] = {}
        self.default_status = 200
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.url = f"http://127.0.0.1:{self._server.server_address[1]}"
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def respond(self, method: str, path: str, body: object = None, status: int = 200) -> None:
        self.routes[(method, path)] = (status, body)

    def received(self, method: str | None = None, path: str | None = None) -> list[dict]:
        return [r for r in self.requests
                if (method is None or r["method"] == method) and (path is None or r["path"] == path)]

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _serve(self):
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw) if raw else None
                except ValueError:
                    body = raw.decode("utf-8", "replace")
                fake.requests.append({
                    "method": self.command,
                    "path": self.path,
                    "headers": {k.lower(): v for k, v in self.headers.items()},
                    "json": body,
                })
                status, reply = fake.routes.get((self.command, self.path), (fake.default_status, {}))
                data = json.dumps(reply if reply is not None else {}).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = _serve

        return Handler


@pytest.fixture
def fake_qlab():
    server = FakeQLab()
    yield server
    server.close()
