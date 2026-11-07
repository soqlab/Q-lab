"""Notification channels get an owner

Revision ID: 003_notification_channel_owner
Revises: 002_webhook_owner
Create Date: 2026-11-07 00:00:00.000000

Like webhooks (002): without an organisation a channel belonged to nobody, so every user could
list, change, fire and delete it. created_by_user_id records who made it. Idempotent: init_db()
may already have added the column.
"""
from alembic import op
import sqlalchemy as sa

revision = "003_notification_channel_owner"
down_revision = "002_webhook_owner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "notification_channels" not in inspector.get_table_names():
        return  # created later by init_db() with the column
    columns = {c["name"] for c in inspector.get_columns("notification_channels")}
    if "created_by_user_id" not in columns:
        op.add_column("notification_channels", sa.Column("created_by_user_id", sa.Integer(), nullable=True))
    indexes = {i["name"] for i in inspector.get_indexes("notification_channels")}
    if "ix_notification_channels_created_by_user_id" not in indexes:
        op.create_index("ix_notification_channels_created_by_user_id", "notification_channels",
                        ["created_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_channels_created_by_user_id", table_name="notification_channels")
    with op.batch_alter_table("notification_channels") as batch:
        batch.drop_column("created_by_user_id")
