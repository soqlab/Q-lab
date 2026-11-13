"""Integration secrets are stored encrypted, read back transparently, and old plain rows get encrypted.

Regression: Slack/Teams/GitHub tokens, webhook signing secrets and notification channel webhook
URLs sat in the database in plain text; only the provider key vault was encrypted.
"""
import uuid

from sqlalchemy import select, text

from app import secret_box
from app.database import SessionLocal, engine
from app.models import GenericRecord, NotificationChannel, Webhook
from tests.helpers import client, make_user


def _raw(sql: str, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def test_seal_round_trip_and_plain_values_pass_through():
    sealed = secret_box.seal("xoxb-secret")
    assert sealed.startswith("enc:v1:") and "xoxb-secret" not in sealed
    assert secret_box.unseal(sealed) == "xoxb-secret"
    assert secret_box.seal(sealed) == sealed  # not encrypted twice
    assert secret_box.unseal("legacy-plain") == "legacy-plain"
    assert secret_box.seal("") == "" and secret_box.seal(None) is None
    assert secret_box.unseal("enc:v1:not-a-token") is None


def test_webhook_secret_is_encrypted_at_rest():
    alice = make_user(prefix="sbw")
    r = client.post("/api/v1/webhooks", headers=alice, json={"name": "h", "url": "https://hooks.example.com/x"})
    assert r.status_code in (200, 201), r.text
    secret = r.json()["secret"]
    stored = _raw("SELECT secret FROM webhooks WHERE id = :i", i=r.json()["id"])
    assert stored.startswith("enc:v1:") and secret not in stored
    with SessionLocal() as db:
        assert db.get(Webhook, r.json()["id"]).secret == secret


def test_channel_secrets_are_encrypted_at_rest():
    alice = make_user(prefix="sbc")
    url = f"https://hooks.slack.com/services/T0/B0/{uuid.uuid4().hex}"
    ch = client.post("/api/v1/notifications/channels", headers=alice, json={
        "name": "s", "channel_type": "slack", "config": {"webhook_url": url, "channel": "#lab"}}).json()
    stored = _raw("SELECT config FROM notification_channels WHERE channel_id = :c", c=ch["channel_id"])
    assert url not in str(stored) and "enc:v1:" in str(stored) and "#lab" in str(stored)
    with SessionLocal() as db:
        row = db.scalar(select(NotificationChannel).where(NotificationChannel.channel_id == ch["channel_id"]))
        assert row.config["webhook_url"] == url


def test_slack_and_github_settings_are_encrypted_at_rest():
    from app.routers import github_integration, slack_bot

    with SessionLocal() as db:
        from app.store import store_put
        store_put(db, "slack_configs", "default", secret_box.seal_fields(
            {"slack_bot_token": "xoxb-abc", "slack_signing_secret": "sig", "teams_webhook_url": None},
            secret_box.SLACK_SECRET_KEYS))
        store_put(db, "github_configs", "default", secret_box.seal_fields(
            {"github_token": "ghp_abc", "repo_owner": "o", "repo_name": "r"}, secret_box.GITHUB_SECRET_KEYS))
        assert slack_bot._get_config(db)["slack_bot_token"] == "xoxb-abc"
        assert github_integration._get_config(db)["github_token"] == "ghp_abc"
        raw = str(db.scalar(select(GenericRecord.data).where(GenericRecord.namespace == "slack_configs")))
    _forget_integration_settings()
    assert "xoxb-abc" not in raw


def test_rows_saved_before_encryption_are_encrypted():
    alice = make_user(prefix="sbm")
    r = client.post("/api/v1/webhooks", headers=alice, json={"name": "h", "url": "https://hooks.example.com/y"})
    hook_id = r.json()["id"]
    channel_id = f"nc-{uuid.uuid4().hex[:12]}"
    with engine.begin() as conn:  # as an older version stored them
        conn.execute(text("UPDATE webhooks SET secret = 'plain-legacy-secret' WHERE id = :i"), {"i": hook_id})
        conn.execute(text("INSERT INTO notification_channels (channel_id, name, channel_type, config, events, "
                          "is_active, created_at) VALUES (:c, 'old', 'webhook', :cfg, '[]', 1, CURRENT_TIMESTAMP)"),
                     {"c": channel_id, "cfg": '{"url": "https://h.example.com", "secret": "plain-channel-secret"}'})
        conn.execute(text("DELETE FROM generic_records WHERE namespace = 'github_configs'"))
        conn.execute(text("INSERT INTO generic_records (namespace, record_id, data, created_at) VALUES "
                          "('github_configs', 'default', :d, CURRENT_TIMESTAMP)"),
                     {"d": '{"github_token": "ghp_plain_legacy", "repo_owner": "o"}'})
    with SessionLocal() as db:  # plain values still read
        assert db.get(Webhook, hook_id).secret == "plain-legacy-secret"

    with engine.begin() as conn:
        assert secret_box.encrypt_existing(conn) >= 3
    with engine.begin() as conn:
        assert secret_box.encrypt_existing(conn) == 0  # idempotent

    assert _raw("SELECT secret FROM webhooks WHERE id = :i", i=hook_id).startswith("enc:v1:")
    cfg = str(_raw("SELECT config FROM notification_channels WHERE channel_id = :c", c=channel_id))
    assert "plain-channel-secret" not in cfg and "https://h.example.com" in cfg
    assert "ghp_plain_legacy" not in str(_raw("SELECT data FROM generic_records WHERE namespace = 'github_configs'"))
    with SessionLocal() as db:
        assert db.get(Webhook, hook_id).secret == "plain-legacy-secret"
        row = db.scalar(select(NotificationChannel).where(NotificationChannel.channel_id == channel_id))
        assert row.config["secret"] == "plain-channel-secret"
    _forget_integration_settings()


def test_migration_008_follows_007():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "alembic" / "versions" / "008_encrypt_integration_secrets.py").read_text()
    assert 'down_revision = "007_reproductions"' in src and "encrypt_existing(op.get_bind())" in src


def _forget_integration_settings():
    """These tests' Slack/GitHub settings must not leak into other tests."""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM generic_records WHERE namespace IN ('slack_configs', 'github_configs')"))
