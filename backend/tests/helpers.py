"""Shared helpers for API tests: a TestClient, signed-in users and uploaded runs.

Everything goes through the real app and the real (in-memory SQLite) database.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import engine, init_db
from app.main import app

init_db()
client = TestClient(app, raise_server_exceptions=False)
PASSWORD = "Helper-Password-1!"

BELL = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;'
GHZ3 = ('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\ncreg c[3];\nh q[0];\ncx q[0],q[1];\n'
        'cx q[1],q[2];\nmeasure q -> c;')


def make_user(role: str | None = None, prefix: str = "t") -> dict[str, str]:
    """Register, verify and sign in a new user; returns Authorization headers.

    role="admin" promotes the user in the database (there is no API for that, by design).
    """
    email = f"{prefix}_{uuid.uuid4().hex[:10]}@example.com"
    r = client.post("/auth/register", json={"email": email, "password": PASSWORD, "name": prefix})
    assert r.status_code in (200, 201), r.text
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET email_verified = 1 WHERE email = :e"), {"e": email})
        if role:
            conn.execute(text("UPDATE users SET role = :r WHERE email = :e"), {"r": role, "e": email})
    login = client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def user_id(headers: dict[str, str]) -> int:
    return client.get("/auth/me", headers=headers).json()["user_id"]


def run_payload(run_id: str | None = None, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "run_id": run_id or f"t-{uuid.uuid4().hex[:12]}",
        "circuit_name": "bell",
        "backend": "aer_simulator",
        "qasm": BELL,
        "fingerprint": {"num_qubits": 2, "depth": 3, "size": 4, "gate_counts": {"h": 1, "cx": 1, "measure": 2}},
        "parameters": {},
        "execution": {"shots": 1000},
        "results": {"counts": {"00": 500, "11": 500}},
        "project": "tests",
        "tags": [],
        "status": "completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    body.update(overrides)
    return body


def push_run(headers: dict[str, str] | None = None, **overrides: Any) -> str:
    """Upload a run through POST /api/v1/runs and return its run_id."""
    body = run_payload(**overrides)
    r = client.post("/api/v1/runs", headers=headers or {}, json=body)
    assert r.status_code == 200, r.text
    return body["run_id"]
