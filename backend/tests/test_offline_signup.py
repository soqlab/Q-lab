"""Sign-up on a self-hosted install with no mail server (e.g. a company network with no internet)."""
import uuid

from fastapi.testclient import TestClient

from app.main import app


def _register(client, email):
    return client.post("/auth/register", json={"email": email, "password": "Offline-Pass-2026", "name": "Ada"})


def test_without_mail_new_accounts_can_sign_in_again(monkeypatch):
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    client = TestClient(app)
    email = f"offline-{uuid.uuid4().hex[:8]}@corp.example"
    assert _register(client, email).status_code in (200, 201)
    login = client.post("/auth/login", json={"email": email, "password": "Offline-Pass-2026"})
    assert login.status_code == 200, login.text


def test_with_mail_the_email_must_be_confirmed_first(monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.setenv("SMTP_HOST", "mail.invalid")
    import app.routers.auth_routes as auth_routes
    monkeypatch.setattr(auth_routes, "send_verification_email", lambda **kw: None)
    client = TestClient(app)
    email = f"online-{uuid.uuid4().hex[:8]}@corp.example"
    assert _register(client, email).status_code in (200, 201)
    login = client.post("/auth/login", json={"email": email, "password": "Offline-Pass-2026"})
    assert login.status_code == 403 and login.json()["detail"] == "email_not_verified"
