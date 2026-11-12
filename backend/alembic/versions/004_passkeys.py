"""Passkeys: WebAuthn credentials and their one-time challenges

Revision ID: 004_passkeys
Revises: 003_notification_channel_owner
Create Date: 2026-11-12 00:00:00.000000

Sign-in moves to passkeys. passkey_credentials holds each user's registered authenticators
(public key, sign count, user handle); webauthn_challenges holds the short-lived challenge of a
registration or sign-in in progress, deleted when it is used. No user rows change here: a
password user keeps their password hash until they register their first passkey, and the app
removes it then. Idempotent, like 001: init_db() may already have created the tables.
"""
from alembic import op
import sqlalchemy as sa

revision = "004_passkeys"
down_revision = "003_notification_channel_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "passkey_credentials" not in tables:
        op.create_table(
            "passkey_credentials",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("credential_id", sa.String(512), nullable=False),
            sa.Column("public_key", sa.LargeBinary(), nullable=False),
            sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("user_handle", sa.String(128), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("transports", sa.JSON(), nullable=False),
            sa.Column("aaguid", sa.String(64), nullable=True),
            sa.Column("backed_up", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_passkey_credentials_user_id", "passkey_credentials", ["user_id"])
        op.create_index("ix_passkey_credentials_credential_id", "passkey_credentials", ["credential_id"],
                        unique=True)
        op.create_index("ix_passkey_credentials_user_handle", "passkey_credentials", ["user_handle"])
    if "webauthn_challenges" not in tables:
        op.create_table(
            "webauthn_challenges",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("challenge", sa.String(128), nullable=False),
            sa.Column("purpose", sa.String(16), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("data", sa.JSON(), nullable=False),
            sa.Column("expires_at", sa.Float(), nullable=False),
        )
        op.create_index("ix_webauthn_challenges_expires_at", "webauthn_challenges", ["expires_at"])


def downgrade() -> None:
    op.drop_table("webauthn_challenges")
    op.drop_table("passkey_credentials")
