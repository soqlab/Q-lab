"""Webhooks get an owner

Revision ID: 002_webhook_owner
Revises: 001
Create Date: 2026-11-07 00:00:00.000000

Without an organisation, a webhook belonged to nobody: every signed-in user could list, change
and delete it, and it received the events of every user's runs. created_by_user_id records who
made it. Idempotent, like 001: init_db() may already have added the column.
"""
from alembic import op
import sqlalchemy as sa

revision = "002_webhook_owner"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("webhooks")}
    if "created_by_user_id" not in columns:
        op.add_column("webhooks", sa.Column("created_by_user_id", sa.Integer(), nullable=True))
    indexes = {i["name"] for i in inspector.get_indexes("webhooks")}
    if "ix_webhooks_created_by_user_id" not in indexes:
        op.create_index("ix_webhooks_created_by_user_id", "webhooks", ["created_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_webhooks_created_by_user_id", table_name="webhooks")
    with op.batch_alter_table("webhooks") as batch:
        batch.drop_column("created_by_user_id")
