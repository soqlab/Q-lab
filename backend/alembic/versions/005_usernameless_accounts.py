"""Sign-in without email: optional users.email, one-time recovery codes

Revision ID: 005_usernameless_accounts
Revises: 004_passkeys
Create Date: 2026-11-13 00:00:00.000000

Accounts now sign in with a discoverable passkey and nothing typed, and are created with a
passkey and a display name. users.email becomes optional (still unique when set: SQL unique
indexes allow any number of NULLs, on SQLite and Postgres alike). recovery_codes holds the
SHA-256 of each single-use recovery code. Existing rows are not changed: every existing account
keeps its email, its passkeys and its emailed recovery.

Idempotent, like 001 and 004: init_db() may already have made both changes (app/auth_schema.py).

Downgrade: an account created without an email gets a placeholder address,
user-<id>@no-email.invalid (.invalid is reserved and never delivers), so NOT NULL can be put
back; recovery codes are dropped.
"""
from alembic import op
import sqlalchemy as sa

revision = "005_usernameless_accounts"
down_revision = "004_passkeys"
branch_labels = None
depends_on = None


def _email_nullable(bind) -> bool:
    cols = {c["name"]: c for c in sa.inspect(bind).get_columns("users")}
    return bool(cols["email"]["nullable"])


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if not _email_nullable(bind):
        with op.batch_alter_table("users") as batch:
            batch.alter_column("email", existing_type=sa.String(320), nullable=True)
    if "recovery_codes" not in tables:
        op.create_table(
            "recovery_codes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("code_hash", sa.String(64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_recovery_codes_user_id", "recovery_codes", ["user_id"])
        op.create_index("ix_recovery_codes_code_hash", "recovery_codes", ["code_hash"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    if "recovery_codes" in set(sa.inspect(bind).get_table_names()):
        op.drop_table("recovery_codes")
    bind.execute(sa.text("UPDATE users SET email = 'user-' || id || '@no-email.invalid' WHERE email IS NULL"))
    if _email_nullable(bind):
        with op.batch_alter_table("users") as batch:
            batch.alter_column("email", existing_type=sa.String(320), nullable=False)
