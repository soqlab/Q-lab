"""Rewind: an index of the calibration snapshots kept for each quantum computer

Revision ID: 009_rewind_snapshots
Revises: 008_encrypt_integration_secrets
Create Date: 2026-11-14 00:00:00.000000

machine_snapshots holds one row per stored calibration (provider, machine, calibrated_at unique);
the calibration itself is a gzip file under QLAB_REWIND_DIR (see app/rewind/). Idempotent, like
001: init_db() may already have created the table.
"""
from alembic import op
import sqlalchemy as sa

revision = "009_rewind_snapshots"
down_revision = "008_encrypt_integration_secrets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "machine_snapshots" in tables:
        return
    op.create_table(
        "machine_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("machine", sa.String(120), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("calibrated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("storage_path", sa.String(500), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sdk_versions", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.UniqueConstraint("provider", "machine", "calibrated_at", name="uq_machine_snapshots_calibration"),
        sa.UniqueConstraint("storage_path", name="uq_machine_snapshots_storage_path"),
    )
    op.create_index("ix_machine_snapshots_provider", "machine_snapshots", ["provider"])
    op.create_index("ix_machine_snapshots_machine", "machine_snapshots", ["machine"])
    op.create_index("ix_machine_snapshots_captured_at", "machine_snapshots", ["captured_at"])
    op.create_index("ix_machine_snapshots_calibrated_at", "machine_snapshots", ["calibrated_at"])
    op.create_index("ix_machine_snapshots_source", "machine_snapshots", ["source"])


def downgrade() -> None:
    op.drop_table("machine_snapshots")
