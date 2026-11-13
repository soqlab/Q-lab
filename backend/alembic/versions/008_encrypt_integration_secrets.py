"""Integration secrets are stored encrypted

Revision ID: 008_encrypt_integration_secrets
Revises: 007_reproductions
Create Date: 2026-11-13 00:00:00.000000

webhooks.secret, cicd_integrations.webhook_secret, the webhook_url/secret/token in
notification_channels.config, and the tokens in the Slack/Teams and GitHub settings were stored
in plain text. They are now encrypted with the provider key vault's key (app/secret_box.py,
derived from QLAB_SECRET_KEY); this encrypts the rows already there. No column changes: the
encrypted values fit the existing columns. Idempotent, like init_db(), which does the same at
startup. Needs QLAB_SECRET_KEY.

Downgrade decrypts them again.
"""
from alembic import op

revision = "008_encrypt_integration_secrets"
down_revision = "007_reproductions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.secret_box import encrypt_existing

    encrypt_existing(op.get_bind())


def downgrade() -> None:
    import json

    import sqlalchemy as sa

    from app.secret_box import (
        CHANNEL_SECRET_KEYS, GITHUB_SECRET_KEYS, SLACK_SECRET_KEYS, unseal, unseal_fields,
    )

    conn = op.get_bind()
    for table, column in (("webhooks", "secret"), ("cicd_integrations", "webhook_secret")):
        for row_id, value in conn.execute(sa.text(f"SELECT id, {column} FROM {table}")).all():
            if value != unseal(value):
                conn.execute(sa.text(f"UPDATE {table} SET {column} = :v WHERE id = :i"),
                             {"v": unseal(value), "i": row_id})

    def _plain(table: str, column: str, keys: tuple[str, ...], where: str = "") -> None:
        for row_id, value in conn.execute(sa.text(f"SELECT id, {column} FROM {table} {where}")).all():
            data = json.loads(value) if isinstance(value, str) else (value or {})
            plain = unseal_fields(data, keys)
            if plain != data:
                conn.execute(sa.text(f"UPDATE {table} SET {column} = :v WHERE id = :i"),
                             {"v": json.dumps(plain), "i": row_id})

    _plain("notification_channels", "config", CHANNEL_SECRET_KEYS)
    _plain("generic_records", "data", SLACK_SECRET_KEYS, "WHERE namespace = 'slack_configs'")
    _plain("generic_records", "data", GITHUB_SECRET_KEYS, "WHERE namespace = 'github_configs'")
