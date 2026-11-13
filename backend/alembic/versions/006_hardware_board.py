"""Hardware board: benchmark jobs on real quantum computers, and when the next one is due

Revision ID: 006_hardware_board
Revises: 005_usernameless_accounts
Create Date: 2026-11-13 00:00:00.000000

hardware_board_jobs holds one row per benchmark job on one machine (written only by the server,
see app/hardware_board.py); hardware_board_state holds a single row with the next due time.
Idempotent, like 001: init_db() may already have created the tables.
"""
from alembic import op
import sqlalchemy as sa

revision = "006_hardware_board"
down_revision = "005_usernameless_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "hardware_board_jobs" not in tables:
        op.create_table(
            "hardware_board_jobs",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("job_id", sa.String(128), nullable=False),
            sa.Column("backend", sa.String(120), nullable=False),
            sa.Column("backend_qubits", sa.Integer(), nullable=True),
            sa.Column("set_version", sa.String(40), nullable=False),
            sa.Column("shots", sa.Integer(), nullable=False),
            sa.Column("simulated", sa.Boolean(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("provider_status", sa.String(40), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("circuits", sa.JSON(), nullable=False),
            sa.Column("results", sa.JSON(), nullable=False),
            sa.Column("versions", sa.JSON(), nullable=False),
        )
        op.create_index("ix_hardware_board_jobs_job_id", "hardware_board_jobs", ["job_id"], unique=True)
        op.create_index("ix_hardware_board_jobs_backend", "hardware_board_jobs", ["backend"])
        op.create_index("ix_hardware_board_jobs_status", "hardware_board_jobs", ["status"])
        op.create_index("ix_hardware_board_jobs_submitted_at", "hardware_board_jobs", ["submitted_at"])
    if "hardware_board_state" not in tables:
        op.create_table(
            "hardware_board_state",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("next_due", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_submitted", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_message", sa.Text(), nullable=True),
        )


def downgrade() -> None:
    op.drop_table("hardware_board_state")
    op.drop_table("hardware_board_jobs")
