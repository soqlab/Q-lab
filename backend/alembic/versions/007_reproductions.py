"""Runs record which earlier run they reproduce

Revision ID: 007_reproductions
Revises: 006_hardware_board
Create Date: 2026-11-13 00:00:00.000000

runs.reproduction_of holds the run id an upload re-ran (the SDK tags it with
qlab.init(reproduces=...)); a run's page lists its reproductions and whether each agreed.
Idempotent, like 001: init_db() may already have added the column.
"""
from alembic import op
import sqlalchemy as sa

revision = "007_reproductions"
down_revision = "006_hardware_board"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("runs")}
    if "reproduction_of" not in columns:
        op.add_column("runs", sa.Column("reproduction_of", sa.String(64), nullable=True))
    indexes = {i["name"] for i in inspector.get_indexes("runs")}
    if "ix_runs_reproduction_of" not in indexes:
        op.create_index("ix_runs_reproduction_of", "runs", ["reproduction_of"])


def downgrade() -> None:
    op.drop_index("ix_runs_reproduction_of", table_name="runs")
    with op.batch_alter_table("runs") as batch:
        batch.drop_column("reproduction_of")
