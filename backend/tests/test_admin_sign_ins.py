"""The admin security overview counts every way of signing in, not only passwords."""
from __future__ import annotations

from app.database import SessionLocal
from app.models import AuditLog
from app.routers.admin import is_sign_in
from tests.helpers import client, make_user


def test_every_sign_in_method_counts_and_enrol_steps_do_not():
    for action in ("auth.login", "auth.login_passkey", "auth.login_passkey_enrolled", "auth.login_passkey_recovery",
                   "auth.login_passkey_recovery_code", "auth.login_soqlab", "auth.login_soqlab_recovery"):
        assert is_sign_in(action), action
    for action in ("auth.login_password_enrol", "auth.login_oauth_enrol", "auth.register", "auth.passkey_session",
                   "auth.logout", "page.view", None, ""):
        assert not is_sign_in(action), action


def test_passkey_and_soqlab_sign_ins_appear_in_the_security_overview():
    owner = make_user(role="owner", prefix="signins")
    before = client.get("/api/v1/admin/security-stats?days=1", headers=owner).json()["total_logins"]
    with SessionLocal() as db:
        for action in ("auth.login_passkey", "auth.login_soqlab", "auth.login_password_enrol"):
            db.add(AuditLog(action=action, resource_type="user", resource_id="1"))
        db.commit()
    after = client.get("/api/v1/admin/security-stats?days=1", headers=owner).json()["total_logins"]
    assert after - before == 2
