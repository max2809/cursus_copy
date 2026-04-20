"""courses: add status column (taking / taken / hidden).

Revision ID: 0003_course_status
Revises: 0002_rag_chat
Create Date: 2026-04-20
"""
from alembic import op
import sqlalchemy as sa


revision = "0003_course_status"
down_revision = "0002_rag_chat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing rows default to "taking" so the sidebar keeps showing them until
    # the user archives or hides them via the UI.
    op.add_column(
        "courses",
        sa.Column(
            "status",
            sa.Text(),
            nullable=False,
            server_default="taking",
        ),
    )


def downgrade() -> None:
    op.drop_column("courses", "status")
