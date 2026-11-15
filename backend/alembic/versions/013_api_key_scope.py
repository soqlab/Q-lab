"""API keys get a scope: "full" (as before) or "read" (GET only, for an AI assistant over MCP)

Revision ID: 013_api_key_scope
Revises: 012_soqlab_id
Create Date: 2026-11-15 18:00:00.000000

Every existing key keeps working exactly as before ("full"). Idempotent, like 001: init_db()
may already have added the column (app/database.py, _ensure_compat_columns).
"""
from alembic import op
import sqlalchemy as sa

revision = "013_api_key_scope"
down_revision = "012_soqlab_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "api_keys" not in set(inspector.get_table_names()):
        return
    if "scope" not in {c["name"] for c in inspector.get_columns("api_keys")}:
        op.add_column("api_keys", sa.Column("scope", sa.String(16), nullable=False, server_default="full"))


def downgrade() -> None:
    op.drop_column("api_keys", "scope")
