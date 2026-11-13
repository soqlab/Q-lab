"""Build commit readout, deploy log and the end of page-view tracking."""
from __future__ import annotations

import httpx
import pytest

from app.routers import build_info
from tests.helpers import client, make_user

SHA = "0123456789abcdef0123456789abcdef01234567"


def test_build_reports_the_render_commit(monkeypatch):
    monkeypatch.setenv("RENDER_GIT_COMMIT", SHA.upper())
    body = client.get("/api/v1/build").json()
    assert body["commit"] == SHA
    assert body["source"] == "https://github.com/soqlab/Q-lab"
    assert body["version"]


def test_build_never_guesses_a_commit(monkeypatch):
    monkeypatch.delenv("RENDER_GIT_COMMIT", raising=False)
    monkeypatch.setenv("QLAB_COMMIT", "not-a-sha")
    assert client.get("/api/v1/build").json()["commit"] is None
    monkeypatch.setenv("QLAB_COMMIT", SHA)
    assert client.get("/api/v1/build").json()["commit"] == SHA


class _Res:
    def __init__(self, status_code, text=""):
        self.status_code, self.text = status_code, text


@pytest.fixture(autouse=True)
def _no_cache():
    build_info._cache.update(at=0.0, value=None)
    yield
    build_info._cache.update(at=0.0, value=None)


def test_deploys_parse_newest_first_and_skip_junk(monkeypatch):
    lines = "\n".join([
        '{"commit": "%s", "time": "2026-11-01T00:00:00Z"}' % SHA,
        "not json",
        '{"commit": "short", "time": "2026-11-03T00:00:00Z"}',
        '{"commit": "%s", "time": "2026-11-02T00:00:00Z", "run_url": "https://github.com/x"}' % ("f" * 40),
    ])
    calls = []
    monkeypatch.setattr(build_info.httpx, "get", lambda url, **kw: calls.append(url) or _Res(200, lines))
    body = client.get("/api/v1/public/deploys").json()
    assert body["available"] is True and body["fetched_by"] == "server"
    assert [e["commit"] for e in body["entries"]] == ["f" * 40, SHA]
    client.get("/api/v1/public/deploys")
    assert calls == [build_info.LOG_URL]  # cached


def test_deploys_honest_when_log_missing(monkeypatch):
    monkeypatch.setattr(build_info.httpx, "get", lambda url, **kw: _Res(404))
    body = client.get("/api/v1/public/deploys").json()
    assert body["available"] is False and "entries" not in body


def test_deploys_honest_when_github_unreachable(monkeypatch):
    def boom(url, **kw):
        raise httpx.ConnectError("no network")
    monkeypatch.setattr(build_info.httpx, "get", boom)
    assert client.get("/api/v1/public/deploys").json()["available"] is False


def test_page_views_are_not_recorded():
    alice = make_user(prefix="trust")
    action = "page.view"
    body = client.post("/api/v1/events", headers=alice, json={"event": action, "page": "/runs"}).json()
    assert body == {"ok": True, "recorded": False}
    admin = make_user(role="admin", prefix="trustadm")
    assert client.get("/api/v1/admin/audit-logs?action=page.view", headers=admin).json()["total"] == 0
