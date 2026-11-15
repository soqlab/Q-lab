"""SOQLAB ID: accounts linked to a SOQLAB passkey, and the sign-in round trips in flight

Revision ID: 012_soqlab_id
Revises: 010_rewind_accuracy
Create Date: 2026-11-15 12:00:00.000000

011 is reserved for Witness. soqlab_identities maps the pairwise subject id.soqlab.com gives Q-Lab
to a Q-Lab account; soqlab_flows holds one row per sign-in or link round trip (10 minutes, single
use). Idempotent, like 001: init_db() may already have created the tables.
"""
from alembic import op
import sqlalchemy as sa

revision = "012_soqlab_id"
down_revision = "010_rewind_accuracy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "soqlab_identities" not in tables:
        op.create_table(
            "soqlab_identities",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("issuer", sa.String(255), nullable=False),
            sa.Column("subject", sa.String(255), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.UniqueConstraint("issuer", "subject", name="uq_soqlab_identities_issuer_subject"),
        )
        op.create_index("ix_soqlab_identities_user_id", "soqlab_identities", ["user_id"], unique=True)
    if "soqlab_flows" not in tables:
        op.create_table(
            "soqlab_flows",
            sa.Column("state_hash", sa.String(64), primary_key=True),
            sa.Column("binding_hash", sa.String(64), nullable=False),
            sa.Column("purpose", sa.String(16), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=True),
            sa.Column("nonce", sa.String(64), nullable=False),
            sa.Column("code_verifier", sa.String(128), nullable=False),
            sa.Column("jti", sa.String(64), nullable=True),
            sa.Column("data", sa.JSON(), nullable=False),
            sa.Column("expires_at", sa.Float(), nullable=False),
            sa.Column("used_at", sa.Float(), nullable=True),
        )
        op.create_index("ix_soqlab_flows_expires_at", "soqlab_flows", ["expires_at"])


def downgrade() -> None:
    op.drop_table("soqlab_flows")
    op.drop_table("soqlab_identities")
