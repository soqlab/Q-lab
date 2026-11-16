"""SOQLAB Witness: the append-only receipts table

Revision ID: 015_witness_receipts
Revises: 014_display_links
Create Date: 2026-11-16 18:00:00.000000

Idempotent, like 001: init_db() creates the same table and triggers at startup, so this is safe
to run on a database that has already been started with this version.
"""
from alembic import op
import sqlalchemy as sa

revision = "015_witness_receipts"
down_revision = "014_display_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "receipts" not in inspector.get_table_names():
        op.create_table(
            "receipts",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("run_id", sa.String(64), nullable=False, index=True),
            sa.Column("seq", sa.Integer, nullable=False, unique=True),
            sa.Column("prev", sa.String(80), nullable=True),
            sa.Column("body", sa.Text, nullable=False),
            sa.Column("owner_user_id", sa.Integer, nullable=True),
            sa.Column("org_id", sa.Integer, nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
    from app.database import ensure_witness_schema

    ensure_witness_schema(conn)


def downgrade() -> None:
    # Receipts are permanent records; removing them is never automatic.
    raise NotImplementedError("receipts are append-only and are not dropped by a downgrade")
