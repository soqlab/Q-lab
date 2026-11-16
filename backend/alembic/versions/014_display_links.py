"""Display links: read-only tokens for Wall mode on an office display

Revision ID: 014_display_links
Revises: 013_api_key_scope
Create Date: 2026-11-16 12:00:00.000000

Idempotent, like 001: init_db() may already have created the table from the models.
"""
from alembic import op
import sqlalchemy as sa

revision = "014_display_links"
down_revision = "013_api_key_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "display_links" in set(inspector.get_table_names()):
        return
    op.create_table(
        "display_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("metric", sa.String(32), nullable=False, server_default="last_run"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_display_links_token_hash", "display_links", ["token_hash"], unique=True)
    op.create_index("ix_display_links_org_id", "display_links", ["org_id"])
    op.create_index("ix_display_links_created_by_user_id", "display_links", ["created_by_user_id"])


def downgrade() -> None:
    op.drop_table("display_links")
