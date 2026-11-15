"""Read-only API keys and AI assistants over MCP (app/read_only_keys.py).

A read-only key can only read; an MCP-marked request needs one, is GET-only, and is audited with the
tool name and key id (never the key or the response).
"""
from __future__ import annotations

from sqlalchemy import text

from app.database import engine
from app.read_only_keys import (MCP_BAD_KEY, MCP_BROAD_KEY, MCP_NEEDS_READ_KEY, MCP_WRITE_REFUSED,
                                READ_ONLY_REFUSED, tool_name)
from tests.helpers import client, make_user, push_run, run_payload, user_id


def _key(headers: dict[str, str], scope: str | None = None) -> dict:
    body = {"name": f"k-{scope or 'default'}"}
    if scope:
        body["scope"] = scope
    r = client.post("/api/v1/users/me/api-keys", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _audit(uid: int) -> list[dict]:
    with engine.begin() as conn:
        rows = conn.execute(text("SELECT action, resource_id, meta FROM audit_logs WHERE user_id = :u "
                                 "AND action = 'mcp.tool_call' ORDER BY id"), {"u": uid}).all()
    import json
    return [{"action": a, "tool": t, "meta": m if isinstance(m, dict) else json.loads(m)} for a, t, m in rows]


def test_keys_default_to_full_and_can_be_read_only():
    alice = make_user(prefix="scope")
    full = _key(alice)
    read = _key(alice, "read")
    assert full["scope"] == "full" and read["scope"] == "read"
    listed = {k["id"]: k["scope"] for k in client.get("/api/v1/users/me/api-keys", headers=alice).json()}
    assert listed[full["id"]] == "full" and listed[read["id"]] == "read"
    assert set(listed.values()) <= {"full", "read"}  # the account's first key, made at sign-up, is full
    assert client.post("/api/v1/users/me/api-keys", headers=alice, json={"name": "x", "scope": "admin"}).status_code == 422


def test_read_only_key_reads_but_cannot_write():
    alice = make_user(prefix="ro")
    run_id = push_run(alice)
    ro = {"X-QLab-Api-Key": _key(alice, "read")["key"]}
    assert client.get(f"/api/v1/runs/{run_id}", headers=ro).status_code == 200
    assert run_id in [r["run_id"] for r in client.get("/api/v1/runs", headers=ro).json()]
    for method, path, body in [
        ("post", "/api/v1/runs", run_payload()),
        ("patch", f"/api/v1/runs/{run_id}", {"notes": "changed"}),
        ("delete", f"/api/v1/runs/{run_id}", None),
        ("post", f"/api/v1/runs/{run_id}/share", None),
        ("post", "/api/v1/users/me/api-keys", {"name": "escalate"}),
        ("post", "/api/v1/machine-pick", {"run_id": run_id}),
    ]:
        r = client.request(method.upper(), path, headers=ro, json=body)
        assert r.status_code == 403, (method, path, r.status_code)
        assert r.json()["detail"] == READ_ONLY_REFUSED
    assert client.get(f"/api/v1/runs/{run_id}", headers=alice).status_code == 200  # still there


def test_full_key_still_uploads():
    alice = make_user(prefix="full")
    full = {"X-QLab-Api-Key": _key(alice)["key"]}
    assert client.post("/api/v1/runs", headers=full, json=run_payload()).status_code == 200


def test_mcp_refuses_broad_tokens_with_a_clear_message():
    alice = make_user(prefix="broad")
    full = _key(alice)["key"]
    read = _key(alice, "read")["key"]
    mcp = {"X-Client": "mcp/list_recent_runs"}

    r = client.get("/api/v1/runs", headers={**mcp, "X-QLab-Api-Key": full})
    assert r.status_code == 403 and r.json()["detail"] == MCP_BROAD_KEY and "read-only key" in MCP_BROAD_KEY
    r = client.get("/api/v1/runs", headers={**mcp, **alice})  # a sign-in token
    assert r.status_code == 403 and r.json()["detail"] == MCP_NEEDS_READ_KEY
    r = client.get("/api/v1/runs", headers={**mcp, **alice, "X-QLab-Api-Key": read})  # token beside the key
    assert r.status_code == 403 and r.json()["detail"] == MCP_NEEDS_READ_KEY
    r = client.get("/api/v1/public/hardware-board", headers=mcp)  # no key, even for a public page
    assert r.status_code == 403 and r.json()["detail"] == MCP_NEEDS_READ_KEY
    r = client.get("/api/v1/runs", headers={**mcp, "X-QLab-Api-Key": "qlab_not_a_real_key"})
    assert r.status_code == 401 and r.json()["detail"] == MCP_BAD_KEY
    assert client.get("/api/v1/runs", headers={**mcp, "X-QLab-Api-Key": read}).status_code == 200


def test_mcp_cannot_reach_write_endpoints():
    alice = make_user(prefix="mcpw")
    run_id = push_run(alice)
    h = {"X-Client": "mcp/run_summary", "X-QLab-Api-Key": _key(alice, "read")["key"]}
    for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
        r = client.request(method, f"/api/v1/runs/{run_id}", headers=h)
        assert r.status_code == 403 and r.json()["detail"] == MCP_WRITE_REFUSED, method


def test_mcp_calls_are_audited_without_secrets():
    alice = make_user(prefix="audit")
    uid = user_id(alice)
    run_id = push_run(alice)
    created = _key(alice, "read")
    h = {"X-Client": "mcp/run_summary", "X-QLab-Api-Key": created["key"]}
    assert client.get(f"/api/v1/runs/{run_id}/answer?level=standard", headers=h).status_code == 200
    client.post(f"/api/v1/runs/{run_id}/share", headers={**h, "X-Client": "mcp/sneaky"})
    client.get("/api/v1/runs", headers={**h, "X-Client": "mcp/Bad Name;drop"})

    entries = _audit(uid)
    assert [e["tool"] for e in entries] == ["run_summary", "sneaky", "unknown"]
    first = entries[0]["meta"]
    assert first["api_key_id"] == created["id"] and first["api_key_prefix"] == created["prefix"]
    assert first["path"] == f"/api/v1/runs/{run_id}/answer"  # no query string
    assert first["method"] == "GET" and first["status"] == 200
    assert entries[1]["meta"]["status"] == 403 and entries[1]["meta"]["method"] == "POST"
    flat = repr(entries)
    assert created["key"] not in flat and "counts" not in flat  # no secret, no response body


def test_requests_without_mcp_are_not_logged_as_tool_calls():
    alice = make_user(prefix="plain")
    ro = {"X-QLab-Api-Key": _key(alice, "read")["key"]}
    client.get("/api/v1/runs", headers=ro)
    assert _audit(user_id(alice)) == []


def test_tool_name_parsing():
    assert tool_name("") is None
    assert tool_name("qlab-sdk/0.4") is None
    assert tool_name("mcp/why_outcome") == "why_outcome"
    assert tool_name("MCP/why_outcome") == "why_outcome"
    assert tool_name("mcp/../../etc") == "unknown"
    assert tool_name("mcp/" + "a" * 65) == "unknown"
