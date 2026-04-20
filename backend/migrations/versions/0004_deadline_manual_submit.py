"""deadlines: add manually_submitted column for user-overridable submission state.

Revision ID: 0004_deadline_manual_submit
Revises: 0003_course_status
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa


revision = "0004_deadline_manual_submit"
down_revision = "0003_course_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "deadlines",
        sa.Column(
            "manually_submitted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("deadlines", "manually_submitted")
