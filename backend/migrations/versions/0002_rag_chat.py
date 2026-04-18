"""v2 RAG chat: chunks, chat_sessions, chat_messages; files/deadlines deltas.

Revision ID: 0002_rag_chat
Revises: 0001
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_rag_chat"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- files: relax canvas_file_id, add source + indexing columns ---
    op.alter_column("files", "canvas_file_id", existing_type=sa.Integer(), nullable=True)
    op.add_column("files", sa.Column("source", sa.Text(), nullable=False, server_default="canvas"))
    op.add_column("files", sa.Column("source_url", sa.Text(), nullable=True))
    op.add_column("files", sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("files", sa.Column("indexed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("files", sa.Column("index_version", sa.Integer(), nullable=True))
    op.add_column("files", sa.Column("index_error", sa.Text(), nullable=True))
    op.add_column("files", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))

    # --- deadlines: description_hash for re-index detection ---
    op.add_column("deadlines", sa.Column("description_hash", sa.Text(), nullable=True))

    # --- chunks ---
    # Note: The embedding column is created here as a placeholder (LargeBinary)
    # because pgvector's `vector(512)` type isn't known to stock SQLAlchemy's
    # offline SQL generator. We immediately drop + recreate it as vector(512)
    # via raw SQL below, which IS what actually runs against Postgres.
    op.create_table(
        "chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=True),
        sa.Column("deadline_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("deadlines.id", ondelete="CASCADE"), nullable=True),
        sa.Column("source_kind", sa.Text(), nullable=False),
        sa.Column("content_text", sa.Text(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False),
        sa.Column("page_hint", sa.Integer(), nullable=True),
        sa.Column("heading_path", sa.Text(), nullable=True),
        sa.Column("embedding", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    # Replace the embedding column with a real vector(512) via raw SQL.
    op.execute("ALTER TABLE chunks DROP COLUMN embedding")
    op.execute("ALTER TABLE chunks ADD COLUMN embedding vector(512) NOT NULL")
    op.create_index("ix_chunks_user_course", "chunks", ["user_id", "course_id"])
    op.execute(
        "CREATE INDEX ix_chunks_embedding_hnsw ON chunks "
        "USING hnsw (embedding vector_cosine_ops)"
    )
    op.create_unique_constraint(
        "uq_chunks_file_index", "chunks", ["file_id", "chunk_index"]
    )
    op.create_unique_constraint(
        "uq_chunks_deadline_index", "chunks", ["deadline_id", "chunk_index"]
    )

    # --- chat_sessions ---
    op.create_table(
        "chat_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("course_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_chat_sessions_user_course_updated",
        "chat_sessions",
        ["user_id", "course_id", sa.text("updated_at DESC")],
    )

    # --- chat_messages ---
    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations_json", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_chat_messages_session_created",
        "chat_messages",
        ["session_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_session_created", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chat_sessions_user_course_updated", table_name="chat_sessions")
    op.drop_table("chat_sessions")
    op.drop_constraint("uq_chunks_deadline_index", "chunks", type_="unique")
    op.drop_constraint("uq_chunks_file_index", "chunks", type_="unique")
    op.execute("DROP INDEX IF EXISTS ix_chunks_embedding_hnsw")
    op.drop_index("ix_chunks_user_course", table_name="chunks")
    op.drop_table("chunks")
    op.drop_column("deadlines", "description_hash")
    op.drop_column("files", "deleted_at")
    op.drop_column("files", "index_error")
    op.drop_column("files", "index_version")
    op.drop_column("files", "indexed_at")
    op.drop_column("files", "uploaded_at")
    op.drop_column("files", "source_url")
    op.drop_column("files", "source")
    op.alter_column("files", "canvas_file_id", existing_type=sa.Integer(), nullable=False)
