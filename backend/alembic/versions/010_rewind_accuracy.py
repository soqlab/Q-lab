"""Rewind accuracy: shared QPU time accounting and benchmark comparisons with real hardware

Revision ID: 010_rewind_accuracy
Revises: 009_rewind_snapshots
Create Date: 2026-11-14 12:00:00.000000

qpu_usage holds one row per job sent to a real quantum computer by the server (hardware board and
Rewind's benchmark share one budget, see app/qpu_budget.py); rewind_accuracy holds one row per
Rewind benchmark job with its replica comparison (app/rewind/bench.py). Idempotent, like 001:
init_db() may already have created the tables.
"""
from alembic import op
import sqlalchemy as sa

revision = "010_rewind_accuracy"
down_revision = "009_rewind_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "qpu_usage" not in tables:
        op.create_table(
            "qpu_usage",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("source", sa.String(40), nullable=False),
            sa.Column("machine", sa.String(120), nullable=False),
            sa.Column("job_id", sa.String(128), nullable=True),
            sa.Column("simulated", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("estimated_seconds", sa.Float(), nullable=False),
            sa.Column("actual_seconds", sa.Float(), nullable=True),
        )
        op.create_index("ix_qpu_usage_source", "qpu_usage", ["source"])
        op.create_index("ix_qpu_usage_job_id", "qpu_usage", ["job_id"])
        op.create_index("ix_qpu_usage_reserved_at", "qpu_usage", ["reserved_at"])
    if "rewind_accuracy" not in tables:
        op.create_table(
            "rewind_accuracy",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("job_id", sa.String(128), nullable=False),
            sa.Column("machine", sa.String(120), nullable=False),
            sa.Column("bench_version", sa.String(40), nullable=False),
            sa.Column("simulated", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="waiting"),
            sa.Column("executed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("measured_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("shots", sa.Integer(), nullable=False),
            sa.Column("snapshot_sha256", sa.String(64), nullable=True),
            sa.Column("snapshot_calibrated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("snapshot_rule", sa.String(40), nullable=True),
            sa.Column("median", sa.Float(), nullable=True),
            sa.Column("worst", sa.Float(), nullable=True),
            sa.Column("n_circuits", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("circuits", sa.JSON(), nullable=False),
            sa.Column("error", sa.Text(), nullable=True),
        )
        op.create_index("ix_rewind_accuracy_job_id", "rewind_accuracy", ["job_id"], unique=True)
        op.create_index("ix_rewind_accuracy_machine", "rewind_accuracy", ["machine"])
        op.create_index("ix_rewind_accuracy_status", "rewind_accuracy", ["status"])
        op.create_index("ix_rewind_accuracy_executed_at", "rewind_accuracy", ["executed_at"])


def downgrade() -> None:
    op.drop_table("rewind_accuracy")
    op.drop_table("qpu_usage")
