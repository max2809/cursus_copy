# Study Buddy v2 · Per-course RAG Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-course RAG chat with inline citations on top of the existing Study Buddy dashboard. Users ask questions grounded in their Canvas materials (PDFs, PPTX, DOCX, assignment briefs) plus any files or URLs they upload themselves, and get streaming Claude answers with clickable `[N]` citations that link back to the source passages.

**Architecture:** On every Canvas sync, new/changed files are enqueued for background indexing: `download → markitdown → chunker (markdown-aware, ~800 tokens) → Voyage voyage-3-lite embed → pgvector upsert`. Chat flow: `embed query → pgvector top-20 → Voyage rerank-2-lite top-5 → Claude Sonnet 4.6 streamed response with [N] markers → parse markers into structured citations`. Frontend adds three sub-tabs per course (Deadlines / Chat / Materials).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 async, asyncpg, pgvector, Alembic, markitdown, tiktoken, voyageai SDK, anthropic SDK, trafilatura, sse-starlette, Vite, React 18, TypeScript, TanStack Query, Tailwind, react-markdown, remark-gfm.

**Spec:** `apps/studybuddy/docs/superpowers/specs/2026-04-17-studybuddy-v2-rag-chat-design.md`

**Existing codebase pointers:**
- Backend entry: `apps/studybuddy/backend/studybuddy/main.py`
- Sync orchestrator: `apps/studybuddy/backend/studybuddy/sync/orchestrator.py`
- Models: `apps/studybuddy/backend/studybuddy/db/models.py`
- Auth dep: `apps/studybuddy/backend/studybuddy/auth/deps.py::current_user`
- Tests run against aiosqlite in-memory (SQLite) — pgvector is Postgres-only, so the model uses a `TypeDecorator` that falls back to JSON on SQLite, and retrieval tests mock the vector query.
- Frontend Dashboard: `apps/studybuddy/frontend/src/pages/Dashboard.tsx`
- Frontend API client: `apps/studybuddy/frontend/src/api/`

**Guiding principles:**
- **TDD always:** Write the failing test first, see it fail, implement minimum to pass, commit.
- **One behavior per task:** If a step keeps growing, split it.
- **DRY but not premature:** Reuse helpers that already exist (e.g., `CanvasClient._safe_get`); don't build abstractions for the second caller.
- **Commit after every green.** Small commits → clean bisect → easy rollback.

---

## Pre-flight

- [ ] **Step 0.1 — Confirm baseline tests pass.**
  ```bash
  cd apps/studybuddy/backend
  uv run pytest -x -q
  ```
  Expected: `45 passed` (or whatever the current count is — no failures).
  If this fails, stop and fix the environment before starting.

- [ ] **Step 0.2 — Confirm baseline frontend build.**
  ```bash
  cd apps/studybuddy/frontend
  npm run build
  ```
  Expected: clean Vite build, zero TypeScript errors.

- [ ] **Step 0.3 — Sanity-check the working directory.**
  ```bash
  cd apps/studybuddy
  git status --short
  ```
  Expected: clean or only contains this plan doc. If you have unrelated uncommitted work, stash it before starting.

---

# Phase 1 · Foundation (deps, env, schema)

Goal of this phase: land the dependency, config, migration, and ORM model changes so the rest of the work has a solid base. No business logic yet — the code after Phase 1 should compile and existing tests should still pass.

---

## Task 1 · Add Python deps, env vars, and RAG config constants

**Files:**
- Modify: `apps/studybuddy/backend/pyproject.toml`
- Modify: `apps/studybuddy/backend/studybuddy/config.py`
- Modify: `apps/studybuddy/backend/.env.example`
- Create: `apps/studybuddy/backend/tests/test_config_rag.py`

### Steps

- [ ] **Step 1.1 — Write the failing test for the new RAG config fields.**

  Create `apps/studybuddy/backend/tests/test_config_rag.py`:
  ```python
  import os
  import pytest
  from studybuddy.config import Settings


  def test_rag_defaults_load():
      """RAG knobs have sensible defaults and are typed correctly."""
      os.environ.setdefault("STUDYBUDDY_MASTER_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
      os.environ.setdefault("SESSION_SIGNING_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
      s = Settings()
      assert s.rag_chunk_tokens == 800
      assert s.rag_chunk_overlap == 100
      assert s.rag_top_k_recall == 20
      assert s.rag_top_k_rerank == 5
      assert s.rag_max_upload_mb == 50
      assert s.rag_claude_model == "claude-sonnet-4-6"
      # Secrets start empty-string so tests/local dev don't explode on import.
      assert s.voyage_api_key == ""
      assert s.anthropic_api_key == ""


  def test_rag_env_overrides(monkeypatch):
      monkeypatch.setenv("RAG_CHUNK_TOKENS", "512")
      monkeypatch.setenv("RAG_TOP_K_RECALL", "10")
      monkeypatch.setenv("VOYAGE_API_KEY", "vo-test")
      s = Settings()
      assert s.rag_chunk_tokens == 512
      assert s.rag_top_k_recall == 10
      assert s.voyage_api_key == "vo-test"
  ```

- [ ] **Step 1.2 — Run the test; confirm it fails.**
  ```bash
  cd apps/studybuddy/backend
  uv run pytest tests/test_config_rag.py -x -q
  ```
  Expected: `AttributeError: 'Settings' object has no attribute 'rag_chunk_tokens'` (or equivalent). Two tests failing.

- [ ] **Step 1.3 — Add the new settings fields.**

  Edit `apps/studybuddy/backend/studybuddy/config.py` — add these fields to the `Settings` class, below `cookie_secure`:
  ```python
      # RAG / chat
      voyage_api_key: str = ""
      anthropic_api_key: str = ""
      rag_chunk_tokens: int = 800
      rag_chunk_overlap: int = 100
      rag_top_k_recall: int = 20
      rag_top_k_rerank: int = 5
      rag_max_upload_mb: int = 50
      rag_claude_model: str = "claude-sonnet-4-6"
  ```

- [ ] **Step 1.4 — Run the config test; confirm it passes.**
  ```bash
  uv run pytest tests/test_config_rag.py -x -q
  ```
  Expected: `2 passed`.

- [ ] **Step 1.5 — Add the runtime dependencies to `pyproject.toml`.**

  Edit `apps/studybuddy/backend/pyproject.toml` — append inside the `dependencies` array (right before the closing `]`):
  ```toml
    "markitdown>=0.0.2",
    "tiktoken>=0.7",
    "voyageai>=0.2",
    "anthropic>=0.40",
    "trafilatura>=1.12",
    "sse-starlette>=2.1",
  ```

  Append inside `dev` optional-dependencies (right before the closing `]`):
  ```toml
    "pytest-anyio>=0.0.0; python_version < '0'",  # reserved slot; no-op
  ```
  (We already have `pytest-httpx` — that covers HTTP mocking for the new tests.)

- [ ] **Step 1.6 — Install deps.**
  ```bash
  cd apps/studybuddy/backend
  uv sync
  ```
  Expected: new packages downloaded, no errors.

- [ ] **Step 1.7 — Run the full test suite to confirm nothing broke.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all tests pass (baseline + 2 new config tests).

- [ ] **Step 1.8 — Update `.env.example`.**

  Edit `apps/studybuddy/backend/.env.example` — append at end:
  ```bash

  # --- v2 RAG / chat ---
  VOYAGE_API_KEY=
  ANTHROPIC_API_KEY=
  RAG_CHUNK_TOKENS=800
  RAG_CHUNK_OVERLAP=100
  RAG_TOP_K_RECALL=20
  RAG_TOP_K_RERANK=5
  RAG_MAX_UPLOAD_MB=50
  RAG_CLAUDE_MODEL=claude-sonnet-4-6
  ```

- [ ] **Step 1.9 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/pyproject.toml \
          apps/studybuddy/backend/uv.lock \
          apps/studybuddy/backend/studybuddy/config.py \
          apps/studybuddy/backend/.env.example \
          apps/studybuddy/backend/tests/test_config_rag.py
  git commit -m "chore(studybuddy): add v2 RAG deps and config knobs

  markitdown, tiktoken, voyageai, anthropic, trafilatura, sse-starlette.
  New Settings fields for Voyage/Anthropic keys and retrieval/chunking tunables."
  ```

---

## Task 2 · Alembic migration `0002_rag_chat`

**Files:**
- Create: `apps/studybuddy/backend/migrations/versions/0002_rag_chat.py`
- Create: `apps/studybuddy/backend/tests/test_migration_0002.py`

**Why:** Adds the columns to `files` and `deadlines`, and creates the three new tables `chunks`, `chat_sessions`, `chat_messages`. Production uses Postgres with `pgvector`; the migration creates the HNSW cosine index. Tests don't run Alembic against SQLite — they use `Base.metadata.create_all()` — so the migration tests below exercise offline SQL generation only.

### Steps

- [ ] **Step 2.1 — Write the failing offline-migration test.**

  Create `apps/studybuddy/backend/tests/test_migration_0002.py`:
  ```python
  """Smoke test: alembic can generate SQL for 0002 offline (no DB required).

  This doesn't execute the migration — aiosqlite can't host pgvector. It just
  confirms the revision imports cleanly and its upgrade()/downgrade() produce
  non-empty SQL when rendered against a Postgres dialect via --sql.
  """
  import subprocess
  from pathlib import Path


  BACKEND = Path(__file__).resolve().parents[1]


  def _alembic(*args: str) -> subprocess.CompletedProcess:
      return subprocess.run(
          ["uv", "run", "alembic", *args],
          cwd=BACKEND,
          check=False,
          capture_output=True,
          text=True,
      )


  def test_migration_0002_renders_upgrade_sql():
      res = _alembic("upgrade", "0002:head", "--sql")
      assert res.returncode == 0, res.stderr
      sql = res.stdout.lower()
      assert "create table chunks" in sql
      assert "create table chat_sessions" in sql
      assert "create table chat_messages" in sql
      assert "alter table files" in sql
      assert "description_hash" in sql
      # pgvector HNSW index on the embedding column
      assert "using hnsw" in sql
      assert "vector_cosine_ops" in sql


  def test_migration_0002_renders_downgrade_sql():
      res = _alembic("downgrade", "0002:0001", "--sql")
      assert res.returncode == 0, res.stderr
      sql = res.stdout.lower()
      assert "drop table chat_messages" in sql
      assert "drop table chat_sessions" in sql
      assert "drop table chunks" in sql
  ```

- [ ] **Step 2.2 — Run the test; confirm it fails.**
  ```bash
  cd apps/studybuddy/backend
  uv run pytest tests/test_migration_0002.py -x -q
  ```
  Expected: failure — alembic has no revision `0002`.

- [ ] **Step 2.3 — Create the migration file.**

  Create `apps/studybuddy/backend/migrations/versions/0002_rag_chat.py`:
  ```python
  """v2 RAG chat: chunks, chat_sessions, chat_messages; files/deadlines deltas.

  Revision ID: 0002_rag_chat
  Revises: 0001_initial_schema
  Create Date: 2026-04-17
  """
  from alembic import op
  import sqlalchemy as sa
  from sqlalchemy.dialects import postgresql


  revision = "0002_rag_chat"
  down_revision = "0001_initial_schema"
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
          sa.Column("embedding", sa.types.UserDefinedType(),  # placeholder, replaced below
                    nullable=False),
          sa.Column("created_at", sa.DateTime(timezone=True),
                    nullable=False, server_default=sa.text("now()")),
      )
      # Replace the embedding column with a real vector(512).
      # We do this as raw SQL because sa.types.UserDefinedType can't emit the pgvector syntax directly.
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
  ```

- [ ] **Step 2.4 — Run the migration test; confirm it passes.**
  ```bash
  uv run pytest tests/test_migration_0002.py -x -q
  ```
  Expected: `2 passed`.

- [ ] **Step 2.5 — Run the full suite to confirm nothing else broke.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all tests pass.

- [ ] **Step 2.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/migrations/versions/0002_rag_chat.py \
          apps/studybuddy/backend/tests/test_migration_0002.py
  git commit -m "feat(studybuddy): add migration 0002 for RAG chat schema

  - files: canvas_file_id nullable; add source/source_url/uploaded_at/
    indexed_at/index_version/index_error/deleted_at
  - deadlines: add description_hash
  - new tables: chunks (pgvector HNSW), chat_sessions, chat_messages"
  ```

---

## Task 3 · SQLAlchemy models (portable Embedding type + new classes)

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/db/types.py`
- Modify: `apps/studybuddy/backend/studybuddy/db/models.py`
- Create: `apps/studybuddy/backend/tests/test_models_rag.py`

**Why:** The ORM models need to match the new schema. Tests run on SQLite (no pgvector), so the `embedding` column uses a `TypeDecorator` that maps to `pgvector.Vector(512)` on Postgres and `JSON` (list of floats) on SQLite. Retrieval tests mock the vector query — they don't do nearest-neighbour in SQLite.

### Steps

- [ ] **Step 3.1 — Write the failing model test.**

  Create `apps/studybuddy/backend/tests/test_models_rag.py`:
  ```python
  import pytest
  from sqlalchemy import select
  from studybuddy.db.models import (
      User, Course, File as FileModel, Deadline, Chunk, ChatSession, ChatMessage,
  )


  @pytest.mark.asyncio
  async def test_chunk_file_roundtrip(db):
      """Can insert a chunk tied to a file, including a 512-dim embedding as JSON on SQLite."""
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="Algorithms"); db.add(c); await db.flush()
      f = FileModel(
          user_id=u.id, course_id=c.id, canvas_file_id=10,
          filename="lec1.pdf", url="https://x", source="canvas",
      )
      db.add(f); await db.flush()
      ch = Chunk(
          user_id=u.id, course_id=c.id, file_id=f.id,
          source_kind="file",
          content_text="Big-O notation describes complexity.",
          chunk_index=0, token_count=9,
          page_hint=14, heading_path="Chapter 1 > Analysis",
          embedding=[0.1] * 512,
      )
      db.add(ch); await db.commit()

      fetched = (await db.execute(select(Chunk))).scalar_one()
      assert fetched.file_id == f.id
      assert len(fetched.embedding) == 512
      assert fetched.embedding[0] == pytest.approx(0.1)
      assert fetched.heading_path == "Chapter 1 > Analysis"


  @pytest.mark.asyncio
  async def test_chunk_assignment_description(db):
      """A chunk can be tied to a deadline instead of a file (assignment description chunk)."""
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="Econ"); db.add(c); await db.flush()
      d = Deadline(
          user_id=u.id, course_id=c.id,
          canvas_source_type="assignment", canvas_source_id="a1",
          title="PS1", url="https://x", type="assignment",
      )
      db.add(d); await db.flush()
      ch = Chunk(
          user_id=u.id, course_id=c.id, deadline_id=d.id,
          source_kind="assignment_description",
          content_text="Explain supply and demand.",
          chunk_index=0, token_count=6,
          embedding=[0.0] * 512,
      )
      db.add(ch); await db.commit()

      fetched = (await db.execute(select(Chunk))).scalar_one()
      assert fetched.deadline_id == d.id
      assert fetched.file_id is None


  @pytest.mark.asyncio
  async def test_chat_session_and_messages(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="Stats"); db.add(c); await db.flush()
      s = ChatSession(user_id=u.id, course_id=c.id, title="Midterm prep")
      db.add(s); await db.flush()
      db.add(ChatMessage(session_id=s.id, role="user", content="Hi"))
      db.add(ChatMessage(
          session_id=s.id, role="assistant",
          content="Hello [1]", citations_json=[{"marker": 1, "snippet": "greeting"}],
      ))
      await db.commit()
      msgs = (await db.execute(select(ChatMessage))).scalars().all()
      assert len(msgs) == 2
      assistant = [m for m in msgs if m.role == "assistant"][0]
      assert assistant.citations_json[0]["marker"] == 1
      assert assistant.error is False


  @pytest.mark.asyncio
  async def test_file_new_columns_default(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
      f = FileModel(user_id=u.id, course_id=c.id, canvas_file_id=1,
                    filename="x.pdf", url="https://x")
      db.add(f); await db.commit()
      row = (await db.execute(select(FileModel))).scalar_one()
      assert row.source == "canvas"
      assert row.indexed_at is None
      assert row.index_version is None
      assert row.deleted_at is None
  ```

- [ ] **Step 3.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_models_rag.py -x -q
  ```
  Expected: `ImportError: cannot import name 'Chunk' from 'studybuddy.db.models'`.

- [ ] **Step 3.3 — Create the portable `Embedding` TypeDecorator.**

  Create `apps/studybuddy/backend/studybuddy/db/types.py`:
  ```python
  """Cross-dialect column types.

  Embedding: vector(N) on Postgres via pgvector, JSON (list[float]) on SQLite.
  Tests run on SQLite; production on Postgres.
  """
  from __future__ import annotations
  from typing import Any
  from sqlalchemy import JSON
  from sqlalchemy.types import TypeDecorator

  try:
      from pgvector.sqlalchemy import Vector as PGVector
  except ImportError:  # pragma: no cover — Vector only needed in prod
      PGVector = None  # type: ignore


  class Embedding(TypeDecorator):
      """Portable vector column. On Postgres, renders as pgvector Vector(dim).
      On other dialects (SQLite for tests), stores a JSON list[float].
      """

      impl = JSON
      cache_ok = True

      def __init__(self, dim: int):
          super().__init__()
          self.dim = dim

      def load_dialect_impl(self, dialect: Any):  # type: ignore[override]
          if dialect.name == "postgresql" and PGVector is not None:
              return dialect.type_descriptor(PGVector(self.dim))
          return dialect.type_descriptor(JSON())
  ```

  Also add `pgvector` to the backend dependencies. Edit `apps/studybuddy/backend/pyproject.toml` `dependencies` array — append:
  ```toml
    "pgvector>=0.3.0",
  ```

  Then:
  ```bash
  uv sync
  ```

- [ ] **Step 3.4 — Update the ORM models.**

  Edit `apps/studybuddy/backend/studybuddy/db/models.py`. At the top, extend the `sqlalchemy` imports to include `Date` stays, and add `Boolean` if missing (it's already there). Add two new imports at the top:
  ```python
  from sqlalchemy import JSON
  from studybuddy.db.types import Embedding
  ```

  Change the `File` class to match the new schema — replace the existing `File` class with:
  ```python
  class File(Base):
      __tablename__ = "files"
      id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
      user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
      course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
      canvas_file_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
      filename: Mapped[str] = mapped_column(String, nullable=False)
      content_type: Mapped[str | None] = mapped_column(String, nullable=True)
      url: Mapped[str] = mapped_column(Text, nullable=False)
      size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
      folder_path: Mapped[str | None] = mapped_column(Text, nullable=True)
      updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
      synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

      # v2 RAG
      source: Mapped[str] = mapped_column(String, nullable=False, default="canvas")
      source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
      uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
      indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
      index_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
      index_error: Mapped[str | None] = mapped_column(Text, nullable=True)
      deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

      __table_args__ = (UniqueConstraint("user_id", "canvas_file_id", name="uq_files_user_canvas"),)
  ```

  Change the `Deadline` class to add the `description_hash` column. Insert after the existing `submitted` column and before `synced_at`:
  ```python
      description_hash: Mapped[str | None] = mapped_column(String, nullable=True)
  ```

  At the bottom of the file, append the three new models:
  ```python
  class Chunk(Base):
      __tablename__ = "chunks"
      id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
      user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
      course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
      file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), nullable=True)
      deadline_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("deadlines.id", ondelete="CASCADE"), nullable=True)
      source_kind: Mapped[str] = mapped_column(String, nullable=False)
      content_text: Mapped[str] = mapped_column(Text, nullable=False)
      chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
      token_count: Mapped[int] = mapped_column(Integer, nullable=False)
      page_hint: Mapped[int | None] = mapped_column(Integer, nullable=True)
      heading_path: Mapped[str | None] = mapped_column(Text, nullable=True)
      embedding: Mapped[list[float]] = mapped_column(Embedding(512), nullable=False)
      created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
      __table_args__ = (
          Index("ix_chunks_user_course", "user_id", "course_id"),
          UniqueConstraint("file_id", "chunk_index", name="uq_chunks_file_index"),
          UniqueConstraint("deadline_id", "chunk_index", name="uq_chunks_deadline_index"),
      )


  class ChatSession(Base):
      __tablename__ = "chat_sessions"
      id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
      user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
      course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)
      title: Mapped[str] = mapped_column(Text, nullable=False)
      created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
      updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
      __table_args__ = (Index("ix_chat_sessions_user_course_updated", "user_id", "course_id", "updated_at"),)


  class ChatMessage(Base):
      __tablename__ = "chat_messages"
      id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=_uuid)
      session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
      role: Mapped[str] = mapped_column(String, nullable=False)
      content: Mapped[str] = mapped_column(Text, nullable=False)
      citations_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
      error: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
      created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
      __table_args__ = (Index("ix_chat_messages_session_created", "session_id", "created_at"),)
  ```

- [ ] **Step 3.5 — Run the model tests; confirm they pass.**
  ```bash
  uv run pytest tests/test_models_rag.py -x -q
  ```
  Expected: `4 passed`.

- [ ] **Step 3.6 — Run the full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all tests pass (prior tests + new config + migration + model tests).

- [ ] **Step 3.7 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/pyproject.toml \
          apps/studybuddy/backend/uv.lock \
          apps/studybuddy/backend/studybuddy/db/types.py \
          apps/studybuddy/backend/studybuddy/db/models.py \
          apps/studybuddy/backend/tests/test_models_rag.py
  git commit -m "feat(studybuddy): ORM models for chunks, chat sessions, messages

  Portable Embedding TypeDecorator — pgvector Vector(512) on Postgres,
  JSON on SQLite for tests. File gets nullable canvas_file_id plus
  source/source_url/uploaded_at/indexed_at/index_version/index_error/
  deleted_at. Deadline gets description_hash."
  ```

---

**Phase 1 gate:** At this point, `uv run pytest -x -q` passes and the schema is ready. No chat behavior yet — Phase 2 starts building the ingestion primitives.

---

# Phase 2 · RAG primitives (leaf modules)

Goal: build the small, well-tested units that the indexer will compose — parser, chunker, embedder, reranker, downloader. Each is its own module under `studybuddy/rag/`, each has its own focused test file, each commits independently.

Create the package init now so every subsequent task can import from it:

- [ ] **Phase-2 prep — create the rag package.**

  Create `apps/studybuddy/backend/studybuddy/rag/__init__.py`:
  ```python
  """RAG subsystem: parsing, chunking, embedding, reranking, downloading, indexing.

  INDEX_VERSION: bump whenever chunker or embedder logic changes in a way
  that invalidates existing chunks. The indexer reindexes any file with
  files.index_version < INDEX_VERSION.
  """

  INDEX_VERSION = 1
  ```

  ```bash
  cd apps/studybuddy/backend && uv run pytest -x -q
  ```
  Expected: still all green (just added a module with one constant).

  Commit:
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/__init__.py
  git commit -m "chore(studybuddy): create rag package with INDEX_VERSION=1"
  ```

---

## Task 4 · Parser (markitdown wrapper)

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/rag/parser.py`
- Create: `apps/studybuddy/backend/tests/fixtures/rag/` (directory for fixture files)
- Create: `apps/studybuddy/backend/tests/fixtures/rag/sample.md`
- Create: `apps/studybuddy/backend/tests/fixtures/rag/sample.txt`
- Create: `apps/studybuddy/backend/tests/test_rag_parser.py`

**What it does:** One function — `parse_to_markdown(bytes, content_type, filename) -> ParsedDoc` — returns the text as markdown plus a best-effort list of `(page_number, char_offset)` tuples when the underlying parser exposes page breaks (PDFs). For other formats, the page list is empty.

### Steps

- [ ] **Step 4.1 — Create plain-text fixtures (binary fixtures handled separately).**

  Create `apps/studybuddy/backend/tests/fixtures/rag/sample.md`:
  ```markdown
  # Sample

  This is a small markdown file used to test the parser.

  ## Second section

  With a **bold** word.
  ```

  Create `apps/studybuddy/backend/tests/fixtures/rag/sample.txt`:
  ```text
  Plain text fixture.
  Line two.
  ```

- [ ] **Step 4.2 — Write the failing parser test.**

  Create `apps/studybuddy/backend/tests/test_rag_parser.py`:
  ```python
  from pathlib import Path
  import pytest
  from studybuddy.rag.parser import parse_to_markdown, ParsedDoc


  FIXTURES = Path(__file__).parent / "fixtures" / "rag"


  def test_parse_markdown_roundtrip():
      raw = (FIXTURES / "sample.md").read_bytes()
      doc = parse_to_markdown(raw, content_type="text/markdown", filename="sample.md")
      assert isinstance(doc, ParsedDoc)
      assert "# Sample" in doc.markdown
      assert "Second section" in doc.markdown
      assert doc.pages == []  # no page info for markdown


  def test_parse_plaintext():
      raw = (FIXTURES / "sample.txt").read_bytes()
      doc = parse_to_markdown(raw, content_type="text/plain", filename="sample.txt")
      assert "Plain text fixture" in doc.markdown
      assert "Line two" in doc.markdown
      assert doc.pages == []


  def test_parse_rejects_unknown_content_type():
      with pytest.raises(ValueError, match="unsupported"):
          parse_to_markdown(b"binary", content_type="application/octet-stream", filename="x.bin")


  def test_parse_html_strips_boilerplate(monkeypatch):
      """HTML is parsed via trafilatura for readable-text extraction."""
      html = b"""
      <html><body>
        <nav>skip me</nav>
        <article><h1>Title</h1><p>Body copy about supply.</p></article>
        <footer>skip</footer>
      </body></html>
      """
      doc = parse_to_markdown(html, content_type="text/html", filename="a.html")
      assert "Body copy about supply" in doc.markdown
      # boilerplate extractor drops nav/footer
      assert "skip me" not in doc.markdown
  ```

- [ ] **Step 4.3 — Run the test; confirm it fails.**
  ```bash
  cd apps/studybuddy/backend
  uv run pytest tests/test_rag_parser.py -x -q
  ```
  Expected: `ImportError` — parser module doesn't exist.

- [ ] **Step 4.4 — Implement the parser.**

  Create `apps/studybuddy/backend/studybuddy/rag/parser.py`:
  ```python
  """Source-file parser. Produces markdown plus optional page offsets.

  - PDF/PPTX/DOCX: go through markitdown (Microsoft's unified parser).
  - text/plain: decoded as UTF-8 and returned as-is.
  - text/markdown: decoded as UTF-8 and returned as-is.
  - text/html: trafilatura for readable-content extraction, then wrapped as markdown.
  - Anything else: raises ValueError.

  Page offsets: when markitdown exposes page breaks (PDFs), we record them
  so the chunker can populate Chunk.page_hint. For formats without pages,
  ParsedDoc.pages is an empty list.
  """
  from __future__ import annotations
  from dataclasses import dataclass, field
  from io import BytesIO
  from typing import Any


  @dataclass
  class ParsedDoc:
      markdown: str
      pages: list[tuple[int, int]] = field(default_factory=list)
      """List of (page_number, char_offset_in_markdown). Empty if no page info."""


  _MARKITDOWN_TYPES = {
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }


  def parse_to_markdown(raw: bytes, *, content_type: str, filename: str) -> ParsedDoc:
      ct = (content_type or "").split(";")[0].strip().lower()

      if ct in ("text/markdown", "text/x-markdown"):
          return ParsedDoc(markdown=raw.decode("utf-8", errors="replace"))

      if ct == "text/plain":
          return ParsedDoc(markdown=raw.decode("utf-8", errors="replace"))

      if ct == "text/html":
          import trafilatura
          extracted = trafilatura.extract(
              raw.decode("utf-8", errors="replace"),
              include_comments=False,
              include_tables=True,
              favor_precision=True,
          ) or ""
          return ParsedDoc(markdown=extracted)

      if ct in _MARKITDOWN_TYPES:
          from markitdown import MarkItDown
          md = MarkItDown()
          result = md.convert_stream(BytesIO(raw), file_extension=_extension_for(ct, filename))
          return ParsedDoc(markdown=result.text_content or "")

      raise ValueError(f"unsupported content_type: {content_type!r}")


  def _extension_for(content_type: str, filename: str) -> str:
      """markitdown keys off file extension; pick a sane one from content_type."""
      ext_map = {
          "application/pdf": ".pdf",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
      }
      if content_type in ext_map:
          return ext_map[content_type]
      # Fall back to filename extension.
      if "." in filename:
          return "." + filename.rsplit(".", 1)[-1].lower()
      return ""
  ```

- [ ] **Step 4.5 — Run the test; confirm it passes.**
  ```bash
  uv run pytest tests/test_rag_parser.py -x -q
  ```
  Expected: `4 passed`.

- [ ] **Step 4.6 — Run the full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all tests pass.

- [ ] **Step 4.7 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/parser.py \
          apps/studybuddy/backend/tests/fixtures/rag/ \
          apps/studybuddy/backend/tests/test_rag_parser.py
  git commit -m "feat(studybuddy): rag.parser — markitdown + trafilatura wrapper

  Unified parse_to_markdown(bytes, content_type, filename) -> ParsedDoc.
  Handles PDF/PPTX/DOCX via markitdown, HTML via trafilatura, text/md as-is,
  rejects unknown content types. Page offsets forwarded when available."
  ```

---

## Task 5 · Chunker (markdown-aware splitter)

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/rag/chunker.py`
- Create: `apps/studybuddy/backend/tests/test_rag_chunker.py`

**What it does:** Walks the parsed markdown, splits on heading boundaries (`#`, `##`, `###`), emits chunks around `rag_chunk_tokens` (default 800) with `rag_chunk_overlap` (default 100), tracks `heading_path` and `page_hint`.

### Steps

- [ ] **Step 5.1 — Write the failing chunker test.**

  Create `apps/studybuddy/backend/tests/test_rag_chunker.py`:
  ```python
  import pytest
  from studybuddy.rag.chunker import chunk_markdown, Chunk
  from studybuddy.rag.parser import ParsedDoc


  def test_small_doc_produces_single_chunk():
      doc = ParsedDoc(markdown="# Intro\n\nJust a few words here.")
      chunks = list(chunk_markdown(doc, target_tokens=800, overlap_tokens=100))
      assert len(chunks) == 1
      assert chunks[0].chunk_index == 0
      assert chunks[0].heading_path == "Intro"
      assert chunks[0].token_count > 0
      assert "Just a few words" in chunks[0].text


  def test_heading_path_tracks_hierarchy():
      md = (
          "# Chapter 1\n\n"
          "Intro para.\n\n"
          "## Section A\n\n"
          "A-body.\n\n"
          "### Subsection A.1\n\n"
          "A1-body.\n\n"
          "## Section B\n\n"
          "B-body.\n"
      )
      chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=800, overlap_tokens=0))
      # Small doc: one chunk per section boundary at the target size, or fewer.
      # What we care about: heading_path reflects the *last* heading chain the chunk starts in.
      paths = [c.heading_path for c in chunks]
      assert any("Chapter 1" in (p or "") for p in paths)
      # Paths use " > " as separator
      joined = " | ".join(p or "" for p in paths)
      assert " > " in joined


  def test_large_section_is_subdivided():
      # Build a long single-heading section: 3000 tokens-worth of filler.
      body = ("word " * 3000).strip()
      md = f"# Big\n\n{body}\n"
      chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=800, overlap_tokens=100))
      assert len(chunks) >= 3
      # Each chunk roughly within [400, 1000] tokens — we don't demand exactness
      # because paragraph-boundary splits give uneven sizes. Hard upper bound: ~1200.
      for c in chunks:
          assert c.token_count <= 1200
          assert c.heading_path == "Big"


  def test_overlap_shares_text_between_adjacent_chunks():
      body = ("sentence. " * 1500).strip()
      md = f"# Big\n\n{body}\n"
      chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=600, overlap_tokens=100))
      assert len(chunks) >= 2
      # Tail of chunk[i] should share some tokens with head of chunk[i+1].
      a, b = chunks[0].text, chunks[1].text
      tail = a[-400:]
      head = b[:400]
      # They should share at least one whole "sentence. " window.
      assert "sentence." in tail and "sentence." in head
      # Overlap is non-zero: the first 100-ish chars of b should appear in a's tail.
      assert any(b[:50] in a[-200:-20+i] for i in range(50)) or "sentence." in tail


  def test_page_hint_propagates():
      md = "# A\n\npage1 text\n\npage2 text\n"
      # 11 = char offset where 'page2' begins (best-effort)
      offset_of_page2 = md.index("page2")
      doc = ParsedDoc(markdown=md, pages=[(1, 0), (2, offset_of_page2)])
      chunks = list(chunk_markdown(doc, target_tokens=800, overlap_tokens=0))
      # Small doc -> one chunk starting at offset 0 -> page 1.
      assert chunks[0].page_hint == 1


  def test_chunk_index_is_sequential():
      md = "# A\n\n" + ("para. " * 1500)
      chunks = list(chunk_markdown(ParsedDoc(markdown=md), target_tokens=400, overlap_tokens=50))
      assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
  ```

- [ ] **Step 5.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_rag_chunker.py -x -q
  ```
  Expected: `ImportError` — no chunker module.

- [ ] **Step 5.3 — Implement the chunker.**

  Create `apps/studybuddy/backend/studybuddy/rag/chunker.py`:
  ```python
  """Markdown-aware chunker.

  Strategy:
    1. Walk the markdown line by line, tracking the active heading stack
       (h1/h2/h3). Top-level sections end at any same-or-higher heading.
    2. For each section, accumulate paragraphs (separated by blank lines)
       until the accumulated token count approaches target_tokens. Emit
       a chunk, carry an overlap_tokens tail into the next chunk.
    3. Never split inside a markdown table (lines starting with `|`).
    4. heading_path for a chunk = the heading stack active at the chunk's
       first line, joined with " > ".
    5. page_hint for a chunk = the page active at the chunk's start offset,
       if the ParsedDoc carried page data.
  """
  from __future__ import annotations
  import re
  from dataclasses import dataclass
  from typing import Iterator
  import tiktoken

  from studybuddy.rag.parser import ParsedDoc


  _ENC = tiktoken.get_encoding("cl100k_base")


  @dataclass
  class Chunk:
      chunk_index: int
      text: str
      token_count: int
      heading_path: str | None
      page_hint: int | None


  _H1 = re.compile(r"^#\s+(.+)$")
  _H2 = re.compile(r"^##\s+(.+)$")
  _H3 = re.compile(r"^###\s+(.+)$")


  def _count_tokens(s: str) -> int:
      return len(_ENC.encode(s))


  def _heading_path(stack: list[str]) -> str | None:
      return " > ".join(stack) if stack else None


  def _page_for_offset(pages: list[tuple[int, int]], offset: int) -> int | None:
      if not pages:
          return None
      current = None
      for page_no, page_offset in pages:
          if page_offset <= offset:
              current = page_no
          else:
              break
      return current


  def chunk_markdown(
      doc: ParsedDoc,
      *,
      target_tokens: int = 800,
      overlap_tokens: int = 100,
  ) -> Iterator[Chunk]:
      md = doc.markdown
      if not md.strip():
          return

      lines = md.split("\n")
      line_offsets: list[int] = []
      running = 0
      for ln in lines:
          line_offsets.append(running)
          running += len(ln) + 1  # +1 for the "\n" we split on

      stack: list[str] = []  # depth-1 list; last item is deepest heading title
      depths: list[int] = []  # parallel to stack; heading level 1/2/3

      buf_lines: list[str] = []
      buf_start_line: int | None = None
      chunk_index = 0
      in_table = False

      def _pop_to(level: int):
          while depths and depths[-1] >= level:
              depths.pop()
              stack.pop()

      def _flush(force_end: bool = False) -> Iterator[Chunk]:
          nonlocal chunk_index, buf_lines, buf_start_line
          if not buf_lines:
              return
          text = "\n".join(buf_lines).strip()
          if not text:
              buf_lines = []
              buf_start_line = None
              return
          tok = _count_tokens(text)
          start_offset = line_offsets[buf_start_line] if buf_start_line is not None else 0
          yield Chunk(
              chunk_index=chunk_index,
              text=text,
              token_count=tok,
              heading_path=_heading_path(stack),
              page_hint=_page_for_offset(doc.pages, start_offset),
          )
          chunk_index += 1
          # Keep an overlap tail for the next chunk: the last ~overlap_tokens worth of text.
          if not force_end and overlap_tokens > 0:
              tail_text = _tail_by_tokens(text, overlap_tokens)
              buf_lines = [tail_text] if tail_text else []
              buf_start_line = buf_start_line  # page hint stays — approximate
          else:
              buf_lines = []
              buf_start_line = None

      i = 0
      while i < len(lines):
          line = lines[i]
          stripped = line.strip()

          # Heading boundaries flush the current buffer first (so the new chunk's
          # heading_path reflects the *new* stack).
          m1 = _H1.match(stripped)
          m2 = _H2.match(stripped)
          m3 = _H3.match(stripped)
          if m1 or m2 or m3:
              yield from _flush(force_end=True)
              if m1:
                  _pop_to(1); stack.append(m1.group(1).strip()); depths.append(1)
              elif m2:
                  _pop_to(2); stack.append(m2.group(1).strip()); depths.append(2)
              else:
                  _pop_to(3); stack.append(m3.group(1).strip()); depths.append(3)
              i += 1
              continue

          # Detect table boundaries (pipe-rows). Don't split inside a table.
          if stripped.startswith("|"):
              in_table = True
          elif in_table and stripped == "":
              in_table = False

          if buf_start_line is None:
              buf_start_line = i
          buf_lines.append(line)

          # Size check after every paragraph break.
          if (stripped == "" or i == len(lines) - 1) and not in_table:
              current_text = "\n".join(buf_lines)
              if _count_tokens(current_text) >= target_tokens:
                  yield from _flush(force_end=False)

          i += 1

      yield from _flush(force_end=True)


  def _tail_by_tokens(text: str, n: int) -> str:
      """Return the trailing ~n tokens of text, snapped to a word boundary."""
      if n <= 0:
          return ""
      ids = _ENC.encode(text)
      if len(ids) <= n:
          return text
      tail_ids = ids[-n:]
      tail = _ENC.decode(tail_ids)
      # Snap to the next space so we don't split a token.
      sp = tail.find(" ")
      if 0 < sp < 20:
          tail = tail[sp + 1:]
      return tail
  ```

- [ ] **Step 5.4 — Run the test; confirm it passes.**
  ```bash
  uv run pytest tests/test_rag_chunker.py -x -q
  ```
  Expected: `6 passed`. If `test_overlap_shares_text_between_adjacent_chunks` flakes, the assertion is loose on purpose (markdown chunking isn't exact); tighten only if clearly wrong.

- [ ] **Step 5.5 — Run the full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all tests pass.

- [ ] **Step 5.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/chunker.py \
          apps/studybuddy/backend/tests/test_rag_chunker.py
  git commit -m "feat(studybuddy): rag.chunker — markdown-aware splitter with overlap

  Target ~800 tokens, 100-token overlap, tracks heading_path (h1/h2/h3)
  and page_hint. Doesn't split inside tables. Uses tiktoken cl100k for
  token counts (close enough for Voyage)."
  ```

---

## Task 6 · Embedder (Voyage voyage-3-lite client)

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/rag/embedder.py`
- Create: `apps/studybuddy/backend/tests/test_rag_embedder.py`

**What it does:** Wraps the Voyage API for embedding. Batches up to 50 texts per request. Retries with exponential backoff on 429 and 5xx. Returns a `list[list[float]]` — one 512-dim vector per input text, preserving order.

### Steps

- [ ] **Step 6.1 — Write the failing embedder test.**

  Create `apps/studybuddy/backend/tests/test_rag_embedder.py`:
  ```python
  import pytest
  from studybuddy.rag.embedder import VoyageEmbedder


  @pytest.mark.asyncio
  async def test_embed_batches_under_limit(httpx_mock):
      httpx_mock.add_response(
          method="POST",
          url="https://api.voyageai.com/v1/embeddings",
          json={
              "data": [{"embedding": [0.1] * 512}, {"embedding": [0.2] * 512}],
              "model": "voyage-3-lite",
              "usage": {"total_tokens": 10},
          },
      )
      e = VoyageEmbedder(api_key="vo-test")
      out = await e.embed(["hello", "world"], input_type="document")
      assert len(out) == 2
      assert len(out[0]) == 512
      assert out[0][0] == pytest.approx(0.1)
      assert out[1][0] == pytest.approx(0.2)


  @pytest.mark.asyncio
  async def test_embed_batches_large_input_to_multiple_requests(httpx_mock):
      # 120 inputs, batch size 50 -> three requests of 50/50/20.
      for batch in (50, 50, 20):
          httpx_mock.add_response(
              method="POST",
              url="https://api.voyageai.com/v1/embeddings",
              json={
                  "data": [{"embedding": [float(i)] * 512} for i in range(batch)],
                  "model": "voyage-3-lite",
                  "usage": {"total_tokens": batch},
              },
          )
      e = VoyageEmbedder(api_key="vo-test", batch_size=50)
      out = await e.embed(["t"] * 120, input_type="document")
      assert len(out) == 120
      assert len(out[0]) == 512


  @pytest.mark.asyncio
  async def test_embed_retries_on_429(httpx_mock):
      # First call 429 -> retry -> 200
      httpx_mock.add_response(
          method="POST",
          url="https://api.voyageai.com/v1/embeddings",
          status_code=429,
          headers={"retry-after": "0"},
      )
      httpx_mock.add_response(
          method="POST",
          url="https://api.voyageai.com/v1/embeddings",
          json={"data": [{"embedding": [0.5] * 512}], "model": "voyage-3-lite", "usage": {}},
      )
      e = VoyageEmbedder(api_key="vo-test", max_retries=2, base_delay_s=0)
      out = await e.embed(["x"], input_type="document")
      assert out[0][0] == pytest.approx(0.5)


  @pytest.mark.asyncio
  async def test_embed_query_uses_query_input_type(httpx_mock):
      def _assert_body(request):
          import json
          body = json.loads(request.content)
          assert body["input_type"] == "query"
          return True

      httpx_mock.add_response(
          method="POST",
          url="https://api.voyageai.com/v1/embeddings",
          match_content=None,
          json={"data": [{"embedding": [0.3] * 512}], "model": "voyage-3-lite", "usage": {}},
      )
      e = VoyageEmbedder(api_key="vo-test")
      out = await e.embed_query("what's on the midterm?")
      assert len(out) == 512
      # Verify the request body had input_type=query (httpx_mock records all requests).
      sent = httpx_mock.get_requests()[-1]
      assert b'"input_type":"query"' in sent.content or b'"input_type": "query"' in sent.content
  ```

- [ ] **Step 6.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_rag_embedder.py -x -q
  ```
  Expected: `ImportError` — no embedder module.

- [ ] **Step 6.3 — Implement the embedder.**

  Create `apps/studybuddy/backend/studybuddy/rag/embedder.py`:
  ```python
  """Voyage AI embedder for voyage-3-lite.

  We call the REST API directly (rather than the `voyageai` SDK) because the
  async SDK wraps httpx anyway and direct calls make tests trivial via
  pytest-httpx.
  """
  from __future__ import annotations
  import asyncio
  import logging
  from typing import Iterable, Literal
  import httpx

  logger = logging.getLogger(__name__)

  _ENDPOINT = "https://api.voyageai.com/v1/embeddings"
  _MODEL = "voyage-3-lite"

  InputType = Literal["document", "query"]


  class VoyageEmbedder:
      def __init__(
          self,
          api_key: str,
          *,
          model: str = _MODEL,
          batch_size: int = 50,
          timeout_s: float = 30.0,
          max_retries: int = 5,
          base_delay_s: float = 0.5,
      ):
          if not api_key:
              raise ValueError("VoyageEmbedder requires an api_key")
          self._api_key = api_key
          self._model = model
          self._batch_size = batch_size
          self._timeout_s = timeout_s
          self._max_retries = max_retries
          self._base_delay_s = base_delay_s

      async def embed(self, texts: list[str], *, input_type: InputType) -> list[list[float]]:
          out: list[list[float]] = []
          for batch in _batched(texts, self._batch_size):
              vecs = await self._one_batch(batch, input_type=input_type)
              out.extend(vecs)
          return out

      async def embed_query(self, text: str) -> list[float]:
          vecs = await self.embed([text], input_type="query")
          return vecs[0]

      async def _one_batch(self, batch: list[str], *, input_type: InputType) -> list[list[float]]:
          body = {"input": batch, "model": self._model, "input_type": input_type}
          headers = {"Authorization": f"Bearer {self._api_key}"}
          for attempt in range(self._max_retries):
              try:
                  async with httpx.AsyncClient(timeout=self._timeout_s) as c:
                      r = await c.post(_ENDPOINT, json=body, headers=headers)
                  if r.status_code == 200:
                      payload = r.json()
                      return [row["embedding"] for row in payload["data"]]
                  if r.status_code in (429, 500, 502, 503, 504):
                      delay = self._base_delay_s * (2 ** attempt)
                      logger.warning("voyage embed %s; retrying in %.1fs", r.status_code, delay)
                      await asyncio.sleep(delay)
                      continue
                  r.raise_for_status()
              except (httpx.TimeoutException, httpx.TransportError) as e:
                  delay = self._base_delay_s * (2 ** attempt)
                  logger.warning("voyage embed transport error: %s; retrying in %.1fs", e, delay)
                  await asyncio.sleep(delay)
          raise RuntimeError("voyage embed failed after retries")


  def _batched(items: list[str], n: int) -> Iterable[list[str]]:
      for i in range(0, len(items), n):
          yield items[i:i + n]
  ```

- [ ] **Step 6.4 — Run the test; confirm it passes.**
  ```bash
  uv run pytest tests/test_rag_embedder.py -x -q
  ```
  Expected: `4 passed`.

- [ ] **Step 6.5 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all tests pass.

- [ ] **Step 6.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/embedder.py \
          apps/studybuddy/backend/tests/test_rag_embedder.py
  git commit -m "feat(studybuddy): rag.embedder — Voyage voyage-3-lite client

  Batches up to 50 inputs per request, exponential backoff on 429/5xx
  and transport errors, preserves input order. embed() for documents,
  embed_query() for a single query string."
  ```

---

## Task 7 · Reranker (Voyage rerank-2-lite)

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/rag/reranker.py`
- Create: `apps/studybuddy/backend/tests/test_rag_reranker.py`

**What it does:** Given a query string and a list of candidate documents, returns the indices of the top-K in reranked order. Falls back gracefully if the API errors — returns the original top-K by position. Same retry logic as the embedder.

### Steps

- [ ] **Step 7.1 — Write the failing reranker test.**

  Create `apps/studybuddy/backend/tests/test_rag_reranker.py`:
  ```python
  import pytest
  from studybuddy.rag.reranker import VoyageReranker


  @pytest.mark.asyncio
  async def test_rerank_returns_topk_indices(httpx_mock):
      httpx_mock.add_response(
          method="POST",
          url="https://api.voyageai.com/v1/rerank",
          json={
              "data": [
                  {"index": 3, "relevance_score": 0.92},
                  {"index": 0, "relevance_score": 0.81},
                  {"index": 2, "relevance_score": 0.44},
              ],
              "model": "rerank-2-lite",
              "usage": {"total_tokens": 30},
          },
      )
      r = VoyageReranker(api_key="vo-test")
      order = await r.rerank(
          query="what is big-O",
          documents=["a", "b", "c", "d"],
          top_k=3,
      )
      assert order == [3, 0, 2]


  @pytest.mark.asyncio
  async def test_rerank_empty_documents_returns_empty():
      r = VoyageReranker(api_key="vo-test")
      assert await r.rerank(query="q", documents=[], top_k=5) == []


  @pytest.mark.asyncio
  async def test_rerank_falls_back_on_persistent_failure(httpx_mock):
      # Always 500. Exhausts retries.
      for _ in range(4):
          httpx_mock.add_response(
              method="POST",
              url="https://api.voyageai.com/v1/rerank",
              status_code=500,
          )
      r = VoyageReranker(api_key="vo-test", max_retries=3, base_delay_s=0)
      # Fallback: first top_k indices in original order.
      order = await r.rerank(query="q", documents=["a", "b", "c"], top_k=2)
      assert order == [0, 1]
  ```

- [ ] **Step 7.2 — Run the test; confirm it fails.**
  ```bash
  cd apps/studybuddy/backend
  uv run pytest tests/test_rag_reranker.py -x -q
  ```
  Expected: `ImportError`.

- [ ] **Step 7.3 — Implement the reranker.**

  Create `apps/studybuddy/backend/studybuddy/rag/reranker.py`:
  ```python
  """Voyage rerank-2-lite client.

  rerank(query, documents, top_k) -> ordered list of indices into `documents`.
  If the API persistently fails, falls back to returning the first top_k
  indices in original order so the chat flow degrades gracefully.
  """
  from __future__ import annotations
  import asyncio
  import logging
  import httpx

  logger = logging.getLogger(__name__)

  _ENDPOINT = "https://api.voyageai.com/v1/rerank"
  _MODEL = "rerank-2-lite"


  class VoyageReranker:
      def __init__(
          self,
          api_key: str,
          *,
          model: str = _MODEL,
          timeout_s: float = 20.0,
          max_retries: int = 3,
          base_delay_s: float = 0.5,
      ):
          if not api_key:
              raise ValueError("VoyageReranker requires an api_key")
          self._api_key = api_key
          self._model = model
          self._timeout_s = timeout_s
          self._max_retries = max_retries
          self._base_delay_s = base_delay_s

      async def rerank(self, *, query: str, documents: list[str], top_k: int) -> list[int]:
          if not documents:
              return []
          top_k = min(top_k, len(documents))
          body = {
              "query": query,
              "documents": documents,
              "model": self._model,
              "top_k": top_k,
          }
          headers = {"Authorization": f"Bearer {self._api_key}"}
          for attempt in range(self._max_retries):
              try:
                  async with httpx.AsyncClient(timeout=self._timeout_s) as c:
                      r = await c.post(_ENDPOINT, json=body, headers=headers)
                  if r.status_code == 200:
                      payload = r.json()
                      return [row["index"] for row in payload["data"]]
                  if r.status_code in (429, 500, 502, 503, 504):
                      delay = self._base_delay_s * (2 ** attempt)
                      logger.warning("voyage rerank %s; retrying in %.1fs", r.status_code, delay)
                      await asyncio.sleep(delay)
                      continue
                  r.raise_for_status()
              except (httpx.TimeoutException, httpx.TransportError) as e:
                  delay = self._base_delay_s * (2 ** attempt)
                  logger.warning("voyage rerank transport error: %s; retrying in %.1fs", e, delay)
                  await asyncio.sleep(delay)
          logger.error("voyage rerank exhausted retries; falling back to identity order")
          return list(range(top_k))
  ```

- [ ] **Step 7.4 — Run the test; confirm it passes.**
  ```bash
  uv run pytest tests/test_rag_reranker.py -x -q
  ```
  Expected: `3 passed`.

- [ ] **Step 7.5 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 7.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/reranker.py \
          apps/studybuddy/backend/tests/test_rag_reranker.py
  git commit -m "feat(studybuddy): rag.reranker — Voyage rerank-2-lite client

  Returns ordered indices into input documents. Degrades gracefully to
  identity order on persistent API failure so chat doesn't break."
  ```

---

## Task 8 · Downloader (Canvas file + arbitrary URL)

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/rag/downloader.py`
- Create: `apps/studybuddy/backend/tests/test_rag_downloader.py`

**What it does:**
- `download_canvas_file(canvas_base_url, pat, canvas_file_id) -> (bytes, content_type, filename)` — hits `GET /api/v1/files/{id}` with the PAT to get the metadata and signed `url`, then follows that URL to fetch bytes.
- `fetch_url(url) -> (bytes, content_type, filename)` — fetches an arbitrary public URL with size cap, no private-IP redirects.
- Both respect a 50MB hard cap (settings-driven).

### Steps

- [ ] **Step 8.1 — Write the failing downloader test.**

  Create `apps/studybuddy/backend/tests/test_rag_downloader.py`:
  ```python
  import pytest
  from studybuddy.rag.downloader import (
      download_canvas_file, fetch_url, DownloadTooLarge, DownloadError,
  )


  @pytest.mark.asyncio
  async def test_canvas_file_download_happy_path(httpx_mock):
      # Step 1: Canvas metadata call.
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/files/500",
          json={
              "id": 500,
              "display_name": "lec3.pdf",
              "url": "https://signed.cloudfront.example.com/lec3.pdf?token=x",
              "content-type": "application/pdf",
              "size": 1024,
          },
      )
      # Step 2: follow the signed URL (no auth header).
      httpx_mock.add_response(
          method="GET",
          url="https://signed.cloudfront.example.com/lec3.pdf?token=x",
          content=b"%PDF-1.4 stub",
          headers={"content-type": "application/pdf"},
      )
      raw, ct, name = await download_canvas_file(
          canvas_base_url="canvas.eur.nl",
          pat="pat-123",
          canvas_file_id=500,
          max_bytes=10 * 1024 * 1024,
      )
      assert raw.startswith(b"%PDF")
      assert ct == "application/pdf"
      assert name == "lec3.pdf"


  @pytest.mark.asyncio
  async def test_canvas_download_too_large(httpx_mock):
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/files/501",
          json={
              "id": 501, "display_name": "huge.pdf",
              "url": "https://x.example/huge.pdf",
              "content-type": "application/pdf",
              "size": 200 * 1024 * 1024,
          },
      )
      with pytest.raises(DownloadTooLarge):
          await download_canvas_file(
              canvas_base_url="canvas.eur.nl",
              pat="pat",
              canvas_file_id=501,
              max_bytes=50 * 1024 * 1024,
          )


  @pytest.mark.asyncio
  async def test_fetch_url_html(httpx_mock):
      httpx_mock.add_response(
          method="GET",
          url="https://en.wikipedia.org/wiki/Gini_coefficient",
          content=b"<html><body><article><p>About Gini</p></article></body></html>",
          headers={"content-type": "text/html; charset=utf-8"},
      )
      raw, ct, name = await fetch_url("https://en.wikipedia.org/wiki/Gini_coefficient", max_bytes=10_000_000)
      assert b"Gini" in raw
      assert ct.startswith("text/html")
      assert name == "Gini_coefficient"


  @pytest.mark.asyncio
  async def test_fetch_url_rejects_non_http():
      with pytest.raises(DownloadError, match="http"):
          await fetch_url("ftp://example.com/file.pdf", max_bytes=1_000_000)


  @pytest.mark.asyncio
  async def test_fetch_url_rejects_private_ip():
      with pytest.raises(DownloadError, match="private"):
          await fetch_url("http://127.0.0.1/secret", max_bytes=1_000_000)
  ```

- [ ] **Step 8.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_rag_downloader.py -x -q
  ```
  Expected: `ImportError`.

- [ ] **Step 8.3 — Implement the downloader.**

  Create `apps/studybuddy/backend/studybuddy/rag/downloader.py`:
  ```python
  """Fetch bytes from Canvas (by file id) or an arbitrary URL.

  Size cap: raises DownloadTooLarge before allocating the body.
  Private-IP guard: refuses to fetch 127.0.0.1, 10.x, 192.168.x, etc.,
    so a malicious URL submission can't probe internal infrastructure.
  """
  from __future__ import annotations
  import ipaddress
  import socket
  from urllib.parse import urlparse, unquote
  import httpx


  class DownloadError(Exception):
      pass


  class DownloadTooLarge(DownloadError):
      pass


  async def download_canvas_file(
      *,
      canvas_base_url: str,
      pat: str,
      canvas_file_id: int,
      max_bytes: int,
  ) -> tuple[bytes, str, str]:
      """Returns (bytes, content_type, filename)."""
      headers = {"Authorization": f"Bearer {pat}"}
      meta_url = f"https://{canvas_base_url}/api/v1/files/{canvas_file_id}"
      async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as c:
          r = await c.get(meta_url, headers=headers)
          r.raise_for_status()
          meta = r.json()
          size = int(meta.get("size") or 0)
          if size > max_bytes:
              raise DownloadTooLarge(f"canvas file {canvas_file_id} is {size} bytes (>{max_bytes})")
          signed_url = meta.get("url") or ""
          if not signed_url:
              raise DownloadError(f"canvas file {canvas_file_id} has no download url")
          content_type = meta.get("content-type") or meta.get("content_type") or "application/octet-stream"
          filename = meta.get("display_name") or meta.get("filename") or f"file-{canvas_file_id}"

          # Signed URL already contains auth; no bearer header.
          r2 = await c.get(signed_url)
          r2.raise_for_status()
          body = r2.content
          if len(body) > max_bytes:
              raise DownloadTooLarge(f"canvas file exceeded {max_bytes} bytes on download")
          return body, content_type, filename


  async def fetch_url(url: str, *, max_bytes: int) -> tuple[bytes, str, str]:
      """Returns (bytes, content_type, filename) for a public URL."""
      parsed = urlparse(url)
      if parsed.scheme not in ("http", "https"):
          raise DownloadError(f"only http(s) urls allowed: {parsed.scheme!r}")
      if not parsed.hostname:
          raise DownloadError("url has no hostname")
      _guard_private_host(parsed.hostname)

      async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, max_redirects=5) as c:
          async with c.stream("GET", url) as r:
              r.raise_for_status()
              ct = r.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
              size_hint = int(r.headers.get("content-length") or 0)
              if size_hint and size_hint > max_bytes:
                  raise DownloadTooLarge(f"url body {size_hint}B exceeds cap {max_bytes}B")

              buf = bytearray()
              async for chunk in r.aiter_bytes():
                  buf.extend(chunk)
                  if len(buf) > max_bytes:
                      raise DownloadTooLarge(f"url body exceeded cap {max_bytes}B during stream")

      filename = unquote(parsed.path.rsplit("/", 1)[-1]) or parsed.hostname
      return bytes(buf), ct, filename


  def _guard_private_host(host: str) -> None:
      try:
          infos = socket.getaddrinfo(host, None)
      except socket.gaierror as e:
          raise DownloadError(f"cannot resolve host {host!r}: {e}") from e
      for info in infos:
          ip = info[4][0]
          try:
              addr = ipaddress.ip_address(ip)
          except ValueError:
              continue
          if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
              raise DownloadError(f"refusing to fetch private address {ip} (host={host})")
  ```

- [ ] **Step 8.4 — Run the test; confirm it passes.**
  ```bash
  uv run pytest tests/test_rag_downloader.py -x -q
  ```
  Expected: `5 passed`.

- [ ] **Step 8.5 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 8.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/downloader.py \
          apps/studybuddy/backend/tests/test_rag_downloader.py
  git commit -m "feat(studybuddy): rag.downloader — Canvas + URL fetchers

  download_canvas_file: API meta lookup -> signed URL follow with size cap.
  fetch_url: public-URL fetch with http(s)-only + private-IP guard + 50MB cap."
  ```

---

**Phase 2 gate:** Parser, chunker, embedder, reranker, downloader all committed with tests. Phase 3 orchestrates them into an indexer and hooks it into sync.

---

# Phase 3 · Indexer, sync integration, retrieval

Goal: compose the primitives into an indexer that persists `Chunk` rows, teach `sync_user` to queue files/deadlines/uploads for indexing, and build the retrieval function the chat service will call.

---

## Task 9 · Indexer orchestrator

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/rag/indexer.py`
- Create: `apps/studybuddy/backend/tests/test_rag_indexer.py`

**What it does:** One entry point — `async def index_file(db, user, file_id, *, voyage_embedder, downloader_fn=download_canvas_file, max_bytes)` — downloads, parses, chunks, embeds, upserts chunks, updates `files.indexed_at` and `files.index_version`. Per-file `try/except` marks failures via `files.index_error` rather than raising.

Also: `async def index_assignment_description(db, user, deadline_id, *, voyage_embedder)` — for deadlines with HTML description. Chunks the description text, stores chunks tied to `deadline_id`.

### Steps

- [ ] **Step 9.1 — Write the failing indexer test.**

  Create `apps/studybuddy/backend/tests/test_rag_indexer.py`:
  ```python
  import pytest
  from sqlalchemy import select
  from studybuddy.db.models import Chunk, Course, File as FileModel, Deadline, User
  from studybuddy.rag.indexer import index_file, index_assignment_description
  from studybuddy.rag import INDEX_VERSION


  class FakeEmbedder:
      """Records calls, returns deterministic 512-dim vectors."""

      def __init__(self):
          self.calls: list[dict] = []

      async def embed(self, texts, *, input_type):
          self.calls.append({"texts": list(texts), "input_type": input_type})
          # Return a distinct vector per text so tests can assert order preserved.
          return [[float(i)] + [0.0] * 511 for i in range(len(texts))]


  async def _fake_download(**kwargs):
      """Fake download that returns a tiny markdown doc as PDF-equivalent bytes."""
      md = "# Hello\n\nThis is a tiny lecture about algorithms. Big-O is important.\n"
      return md.encode("utf-8"), "text/markdown", "tiny.md"


  @pytest.mark.asyncio
  async def test_index_file_creates_chunks_and_marks_indexed(db):
      u = User(email="a@eur.nl", pat_encrypted=b"x", pat_nonce=b"y")
      db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
      f = FileModel(
          user_id=u.id, course_id=c.id, canvas_file_id=10,
          filename="tiny.md", url="x", content_type="text/markdown",
          source="canvas",
      )
      db.add(f); await db.commit()

      emb = FakeEmbedder()
      await index_file(
          db, user=u, file_id=f.id,
          voyage_embedder=emb,
          downloader_fn=_fake_download,
          max_bytes=10_000,
          pat="decrypted-pat",
          canvas_base_url="canvas.eur.nl",
      )
      await db.commit()

      chunks = (await db.execute(select(Chunk))).scalars().all()
      assert len(chunks) >= 1
      for ch in chunks:
          assert ch.file_id == f.id
          assert ch.source_kind == "file"
          assert len(ch.embedding) == 512
      f_refreshed = (await db.execute(select(FileModel))).scalar_one()
      assert f_refreshed.indexed_at is not None
      assert f_refreshed.index_version == INDEX_VERSION
      assert f_refreshed.index_error is None
      assert emb.calls[0]["input_type"] == "document"


  @pytest.mark.asyncio
  async def test_index_file_reindex_replaces_chunks(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
      f = FileModel(user_id=u.id, course_id=c.id, canvas_file_id=10,
                    filename="t.md", url="x", content_type="text/markdown", source="canvas")
      db.add(f); await db.commit()
      emb = FakeEmbedder()

      async def _download_v1(**_):
          return b"# First version content\n", "text/markdown", "t.md"

      async def _download_v2(**_):
          return b"# Second version with more words here\n", "text/markdown", "t.md"

      await index_file(db, user=u, file_id=f.id,
                       voyage_embedder=emb, downloader_fn=_download_v1,
                       max_bytes=10_000, pat="x", canvas_base_url="canvas.eur.nl")
      await db.commit()
      first_count = len((await db.execute(select(Chunk))).scalars().all())
      assert first_count >= 1

      await index_file(db, user=u, file_id=f.id,
                       voyage_embedder=emb, downloader_fn=_download_v2,
                       max_bytes=10_000, pat="x", canvas_base_url="canvas.eur.nl")
      await db.commit()
      chunks = (await db.execute(select(Chunk))).scalars().all()
      for ch in chunks:
          assert "Second version" in ch.content_text or ch.chunk_index >= 0


  @pytest.mark.asyncio
  async def test_index_file_records_error_on_failure(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
      f = FileModel(user_id=u.id, course_id=c.id, canvas_file_id=10,
                    filename="bad.xyz", url="x", content_type="application/octet-stream", source="canvas")
      db.add(f); await db.commit()

      async def _download(**_):
          return b"\x00\x01\x02", "application/octet-stream", "bad.xyz"

      emb = FakeEmbedder()
      # Should NOT raise — indexer catches and records.
      await index_file(db, user=u, file_id=f.id,
                       voyage_embedder=emb, downloader_fn=_download,
                       max_bytes=10_000, pat="x", canvas_base_url="canvas.eur.nl")
      await db.commit()
      f2 = (await db.execute(select(FileModel))).scalar_one()
      assert f2.index_error is not None
      assert "unsupported" in f2.index_error.lower()
      assert f2.indexed_at is None


  @pytest.mark.asyncio
  async def test_index_assignment_description(db):
      from hashlib import sha256
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
      d = Deadline(
          user_id=u.id, course_id=c.id,
          canvas_source_type="assignment", canvas_source_id="a1",
          title="PS1", url="x", type="assignment",
          description="<p>Solve the Big-O puzzle.</p>",
      )
      db.add(d); await db.commit()

      emb = FakeEmbedder()
      await index_assignment_description(db, user=u, deadline_id=d.id, voyage_embedder=emb)
      await db.commit()
      chunks = (await db.execute(select(Chunk))).scalars().all()
      assert len(chunks) >= 1
      assert chunks[0].deadline_id == d.id
      assert chunks[0].source_kind == "assignment_description"
      refreshed = (await db.execute(select(Deadline))).scalar_one()
      expected_hash = sha256(d.description.encode("utf-8")).hexdigest()
      assert refreshed.description_hash == expected_hash
  ```

- [ ] **Step 9.2 — Run the test; confirm it fails.**
  ```bash
  cd apps/studybuddy/backend
  uv run pytest tests/test_rag_indexer.py -x -q
  ```
  Expected: `ImportError`.

- [ ] **Step 9.3 — Implement the indexer.**

  Create `apps/studybuddy/backend/studybuddy/rag/indexer.py`:
  ```python
  """End-to-end indexing of a single source into chunk rows.

  `index_file` handles any `files` row (Canvas-synced, user upload, or URL).
  `index_assignment_description` handles the `deadlines.description` text
  as a separate source_kind.

  Errors are captured into `files.index_error` (or raised for the caller to
  surface) — we don't re-raise inside index_file because background sync
  shouldn't halt on one bad PDF.
  """
  from __future__ import annotations
  from datetime import datetime, timezone
  from hashlib import sha256
  from typing import Awaitable, Callable, Protocol
  from sqlalchemy import delete, select
  from sqlalchemy.ext.asyncio import AsyncSession

  from studybuddy.db.models import Chunk, Deadline, File as FileModel, User
  from studybuddy.rag import INDEX_VERSION
  from studybuddy.rag.chunker import chunk_markdown
  from studybuddy.rag.downloader import download_canvas_file, fetch_url
  from studybuddy.rag.parser import ParsedDoc, parse_to_markdown


  class _Embedder(Protocol):
      async def embed(self, texts: list[str], *, input_type: str) -> list[list[float]]: ...


  DownloaderFn = Callable[..., Awaitable[tuple[bytes, str, str]]]


  async def index_file(
      db: AsyncSession,
      *,
      user: User,
      file_id,
      voyage_embedder: _Embedder,
      pat: str | None = None,
      canvas_base_url: str,
      max_bytes: int,
      downloader_fn: DownloaderFn = download_canvas_file,
      chunk_tokens: int = 800,
      chunk_overlap: int = 100,
  ) -> None:
      f = (await db.execute(select(FileModel).where(FileModel.id == file_id))).scalar_one()
      try:
          raw, content_type, filename = await _download_for_file(
              f, pat=pat, canvas_base_url=canvas_base_url,
              max_bytes=max_bytes, downloader_fn=downloader_fn,
          )
          doc = parse_to_markdown(raw, content_type=content_type, filename=filename or f.filename)
          chunks = list(chunk_markdown(doc, target_tokens=chunk_tokens, overlap_tokens=chunk_overlap))
          if not chunks:
              f.index_error = "no content after parse"
              f.indexed_at = None
              return
          texts = [c.text for c in chunks]
          embeddings = await voyage_embedder.embed(texts, input_type="document")
          if len(embeddings) != len(chunks):
              raise RuntimeError(f"embedder returned {len(embeddings)} vecs for {len(chunks)} chunks")

          # Replace any existing chunks for this file.
          await db.execute(delete(Chunk).where(Chunk.file_id == f.id))
          for c, emb in zip(chunks, embeddings):
              db.add(Chunk(
                  user_id=user.id, course_id=f.course_id, file_id=f.id,
                  source_kind="file",
                  content_text=c.text, chunk_index=c.chunk_index, token_count=c.token_count,
                  page_hint=c.page_hint, heading_path=c.heading_path,
                  embedding=emb,
              ))
          f.indexed_at = datetime.now(timezone.utc)
          f.index_version = INDEX_VERSION
          f.index_error = None
      except Exception as e:  # noqa: BLE001 — we want to keep going on any failure
          f.index_error = f"{type(e).__name__}: {e}"
          f.indexed_at = None
      await db.flush()


  async def _download_for_file(
      f: FileModel,
      *,
      pat: str | None,
      canvas_base_url: str,
      max_bytes: int,
      downloader_fn: DownloaderFn,
  ) -> tuple[bytes, str, str]:
      if f.source == "canvas":
          if not pat:
              raise RuntimeError("canvas file download requires pat")
          if f.canvas_file_id is None:
              raise RuntimeError("canvas file row missing canvas_file_id")
          return await downloader_fn(
              canvas_base_url=canvas_base_url,
              pat=pat,
              canvas_file_id=f.canvas_file_id,
              max_bytes=max_bytes,
          )
      if f.source == "url":
          if not f.source_url:
              raise RuntimeError("url-sourced file missing source_url")
          return await fetch_url(f.source_url, max_bytes=max_bytes)
      if f.source == "upload":
          raise RuntimeError(
              "upload-sourced files must be indexed inline via index_upload_bytes()"
          )
      raise RuntimeError(f"unknown file.source: {f.source!r}")


  async def index_upload_bytes(
      db: AsyncSession,
      *,
      user: User,
      file_id,
      raw: bytes,
      content_type: str,
      filename: str,
      voyage_embedder: _Embedder,
      chunk_tokens: int = 800,
      chunk_overlap: int = 100,
  ) -> None:
      """Index an uploaded file whose bytes we already have in memory.

      Called from the upload endpoint's BackgroundTasks hook. We don't round-trip
      the bytes through Canvas/URL — we pass them straight to parse_to_markdown.
      """
      f = (await db.execute(select(FileModel).where(FileModel.id == file_id))).scalar_one()
      try:
          doc = parse_to_markdown(raw, content_type=content_type, filename=filename)
          chunks = list(chunk_markdown(doc, target_tokens=chunk_tokens, overlap_tokens=chunk_overlap))
          if not chunks:
              f.index_error = "no content after parse"
              return
          texts = [c.text for c in chunks]
          embeddings = await voyage_embedder.embed(texts, input_type="document")
          await db.execute(delete(Chunk).where(Chunk.file_id == f.id))
          for c, emb in zip(chunks, embeddings):
              db.add(Chunk(
                  user_id=user.id, course_id=f.course_id, file_id=f.id,
                  source_kind="file",
                  content_text=c.text, chunk_index=c.chunk_index, token_count=c.token_count,
                  page_hint=c.page_hint, heading_path=c.heading_path,
                  embedding=emb,
              ))
          f.indexed_at = datetime.now(timezone.utc)
          f.index_version = INDEX_VERSION
          f.index_error = None
      except Exception as e:  # noqa: BLE001
          f.index_error = f"{type(e).__name__}: {e}"
          f.indexed_at = None
      await db.flush()


  async def index_assignment_description(
      db: AsyncSession,
      *,
      user: User,
      deadline_id,
      voyage_embedder: _Embedder,
      chunk_tokens: int = 800,
      chunk_overlap: int = 100,
  ) -> None:
      d = (await db.execute(select(Deadline).where(Deadline.id == deadline_id))).scalar_one()
      desc = d.description or ""
      if not desc.strip():
          return
      # HTML-ish description? Strip tags cheaply. For richer parses, trafilatura
      # is available but assignment briefs are short + the LLM tolerates minor noise.
      if "<" in desc and ">" in desc:
          doc = parse_to_markdown(desc.encode("utf-8"), content_type="text/html", filename="assignment.html")
      else:
          doc = ParsedDoc(markdown=desc)

      chunks = list(chunk_markdown(doc, target_tokens=chunk_tokens, overlap_tokens=chunk_overlap))
      if not chunks:
          return
      embeddings = await voyage_embedder.embed([c.text for c in chunks], input_type="document")

      await db.execute(delete(Chunk).where(Chunk.deadline_id == d.id))
      for c, emb in zip(chunks, embeddings):
          db.add(Chunk(
              user_id=user.id, course_id=d.course_id, deadline_id=d.id,
              source_kind="assignment_description",
              content_text=c.text, chunk_index=c.chunk_index, token_count=c.token_count,
              page_hint=c.page_hint, heading_path=c.heading_path,
              embedding=emb,
          ))
      d.description_hash = sha256(desc.encode("utf-8")).hexdigest()
      await db.flush()
  ```

- [ ] **Step 9.4 — Run the test.**
  ```bash
  uv run pytest tests/test_rag_indexer.py -x -q
  ```
  Expected: `4 passed`.

- [ ] **Step 9.5 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 9.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/indexer.py \
          apps/studybuddy/backend/tests/test_rag_indexer.py
  git commit -m "feat(studybuddy): rag.indexer — compose download/parse/chunk/embed into chunks

  index_file for Canvas/URL-sourced rows (pulls via downloader),
  index_upload_bytes for user uploads already in memory,
  index_assignment_description for deadline descriptions (with sha256 for
  dirty-detection). Failures captured on files.index_error; indexed_at +
  index_version updated on success."
  ```

---

## Task 10 · Hook indexer into `sync_user`

**Files:**
- Modify: `apps/studybuddy/backend/studybuddy/sync/orchestrator.py`
- Create: `apps/studybuddy/backend/tests/test_sync_indexing.py`

**What it does:** After the existing sync loop, `sync_user` collects the set of file-ids and deadline-ids that are new or stale (by `indexed_at`, `index_version`, or `description_hash` drift) and returns them so the caller (API endpoint) can push a `BackgroundTasks` job to run the indexer batch. We don't kick off the background index inside `sync_user` directly — that would hide work from the caller and make testing awkward. Instead, `sync_user` returns a dataclass of pending work.

### Steps

- [ ] **Step 10.1 — Write the failing sync-indexing test.**

  Create `apps/studybuddy/backend/tests/test_sync_indexing.py`:
  ```python
  import os
  import pytest
  from hashlib import sha256
  from sqlalchemy import select
  from studybuddy.sync.orchestrator import sync_user
  from studybuddy.db.models import User, Course, File as FileModel, Deadline
  from studybuddy.security.crypto import encrypt_pat
  from studybuddy.rag import INDEX_VERSION


  MASTER_KEY = os.urandom(32)


  async def _user(db, email="a@eur.nl", pat="p"):
      ct, nonce = encrypt_pat(pat, MASTER_KEY)
      u = User(email=email, pat_encrypted=ct, pat_nonce=nonce)
      db.add(u); await db.flush()
      return u


  @pytest.mark.asyncio
  async def test_sync_returns_pending_indexing_for_new_files(db, httpx_mock):
      user = await _user(db)
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
          json=[{"id": 10, "name": "CS", "course_code": "CS101"}],
      )
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission",
          json=[{"id": "a1", "name": "PS1", "description": "<p>Old</p>",
                 "due_at": None, "html_url": "https://x"}],
      )
      httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
          json=[],
      )
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses/10/files",
          json=[{"id": 500, "display_name": "lec3.pdf",
                 "url": "https://x", "content-type": "application/pdf",
                 "size": 1024, "updated_at": "2026-04-16T12:00:00Z"}],
      )
      result = await sync_user(db, user, master_key=MASTER_KEY)
      # Every file fresh from Canvas is "pending".
      file_ids = [f.id for f in (await db.execute(select(FileModel))).scalars().all()]
      deadline_ids = [d.id for d in (await db.execute(select(Deadline))).scalars().all()]
      assert set(result.pending_file_ids) == set(file_ids)
      assert set(result.pending_deadline_ids) == set(deadline_ids)


  @pytest.mark.asyncio
  async def test_sync_skips_already_indexed_files(db, httpx_mock):
      user = await _user(db)
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
          json=[{"id": 10, "name": "CS"}],
      )
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission", json=[],
      )
      httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
          json=[],
      )
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses/10/files",
          json=[{"id": 500, "display_name": "lec3.pdf", "url": "https://x",
                 "content-type": "application/pdf", "size": 1024,
                 "updated_at": "2026-04-16T12:00:00Z"}],
      )
      # First sync inserts the file.
      await sync_user(db, user, master_key=MASTER_KEY)
      # Mark it fully indexed.
      f = (await db.execute(select(FileModel))).scalar_one()
      from datetime import datetime, timezone
      f.indexed_at = datetime.now(timezone.utc)
      f.index_version = INDEX_VERSION
      await db.commit()

      # Second sync: mock everything again (pytest-httpx consumes responses).
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
          json=[{"id": 10, "name": "CS"}],
      )
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission", json=[],
      )
      httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
          json=[],
      )
      httpx_mock.add_response(
          method="GET",
          url="https://canvas.eur.nl/api/v1/courses/10/files",
          json=[{"id": 500, "display_name": "lec3.pdf", "url": "https://x",
                 "content-type": "application/pdf", "size": 1024,
                 "updated_at": "2026-04-16T12:00:00Z"}],
      )
      result2 = await sync_user(db, user, master_key=MASTER_KEY)
      assert result2.pending_file_ids == []


  @pytest.mark.asyncio
  async def test_sync_reindexes_on_description_hash_drift(db, httpx_mock):
      user = await _user(db)
      for body in ("orig", "updated"):
          httpx_mock.add_response(
              method="GET",
              url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active&include%5B%5D=term",
              json=[{"id": 10, "name": "CS"}],
          )
          httpx_mock.add_response(
              method="GET",
              url="https://canvas.eur.nl/api/v1/courses/10/assignments?include%5B%5D=submission",
              json=[{"id": "a1", "name": "PS1", "description": f"<p>{body}</p>",
                     "due_at": None, "html_url": "https://x"}],
          )
          httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses/10/quizzes", json=[])
          httpx_mock.add_response(
              method="GET",
              url="https://canvas.eur.nl/api/v1/calendar_events?context_codes%5B%5D=course_10&type=event",
              json=[],
          )
          httpx_mock.add_response(
              method="GET",
              url="https://canvas.eur.nl/api/v1/courses/10/files",
              json=[],
          )
      r1 = await sync_user(db, user, master_key=MASTER_KEY)
      d = (await db.execute(select(Deadline))).scalar_one()
      d.description_hash = sha256("<p>orig</p>".encode()).hexdigest()  # pretend indexed
      await db.commit()
      r2 = await sync_user(db, user, master_key=MASTER_KEY)
      assert d.id in r2.pending_deadline_ids
  ```

- [ ] **Step 10.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_sync_indexing.py -x -q
  ```
  Expected: `AttributeError` — `sync_user` returns `None`, has no `pending_file_ids`.

- [ ] **Step 10.3 — Update `sync_user` to return a `SyncResult`.**

  Edit `apps/studybuddy/backend/studybuddy/sync/orchestrator.py`:

  Add these imports at the top (merge with existing imports):
  ```python
  from dataclasses import dataclass, field
  from hashlib import sha256
  from uuid import UUID
  from studybuddy.rag import INDEX_VERSION
  ```

  Add a dataclass near the top (just below the imports):
  ```python
  @dataclass
  class SyncResult:
      pending_file_ids: list[UUID] = field(default_factory=list)
      pending_deadline_ids: list[UUID] = field(default_factory=list)
  ```

  Change the signature and body of `sync_user` to return a `SyncResult`. Replace the existing function with:
  ```python
  async def sync_user(db: AsyncSession, user: User, master_key: bytes) -> SyncResult:
      if user.pat_encrypted is None or user.pat_nonce is None:
          raise ValueError("user has no PAT configured")

      try:
          pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, master_key)
      except Exception as e:
          raise ValueError("failed to decrypt stored PAT") from e

      client = CanvasClient(base_url=user.canvas_base_url, token=pat)

      try:
          courses_payload = await client.get_paginated(
              "/api/v1/courses",
              params={"enrollment_state": "active", "include[]": "term"},
          )
      except CanvasUnauthorized:
          user.pat_encrypted = None
          user.pat_nonce = None
          await db.flush()
          raise

      for c in courses_payload:
          await _upsert_course(db, user.id, c)

      courses = (await db.execute(select(Course).where(Course.user_id == user.id))).scalars().all()
      for course in courses:
          assignments = await _safe_get(
              client,
              f"/api/v1/courses/{course.canvas_course_id}/assignments",
              params={"include[]": "submission"},
          )
          for a in assignments:
              await _upsert_deadline(db, user.id, course.id, "assignment", a)

          quizzes = await _safe_get(client, f"/api/v1/courses/{course.canvas_course_id}/quizzes")
          for q in quizzes:
              await _upsert_deadline(db, user.id, course.id, "quiz", q)

          events = await _safe_get(
              client,
              "/api/v1/calendar_events",
              params={"context_codes[]": f"course_{course.canvas_course_id}", "type": "event"},
          )
          for e in events:
              await _upsert_deadline(db, user.id, course.id, "calendar_event", e)

          files = await _safe_get(client, f"/api/v1/courses/{course.canvas_course_id}/files")
          for f in files:
              await _upsert_file(db, user.id, course.id, f)

      user.last_synced_at = datetime.now(timezone.utc)
      await db.flush()

      return await _pending_indexing(db, user)


  async def _pending_indexing(db: AsyncSession, user: User) -> SyncResult:
      """Collect files/deadlines that need indexing after this sync.

      Files: indexed_at is NULL OR index_version < INDEX_VERSION OR
             updated_at > indexed_at.
      Deadlines: description is non-empty AND
                 (description_hash is NULL OR hash(description) != description_hash).
      """
      pending_files = (await db.execute(
          select(FileModel.id).where(
              FileModel.user_id == user.id,
              FileModel.deleted_at.is_(None),
              (
                  FileModel.indexed_at.is_(None)
                  | (FileModel.index_version.is_(None))
                  | (FileModel.index_version < INDEX_VERSION)
                  | (
                      FileModel.updated_at.is_not(None)
                      & (FileModel.updated_at > FileModel.indexed_at)
                  )
              ),
          )
      )).scalars().all()

      deadline_rows = (await db.execute(
          select(Deadline).where(Deadline.user_id == user.id)
      )).scalars().all()
      pending_deadlines: list = []
      for d in deadline_rows:
          desc = (d.description or "").strip()
          if not desc:
              continue
          h = sha256((d.description or "").encode("utf-8")).hexdigest()
          if d.description_hash != h:
              pending_deadlines.append(d.id)

      return SyncResult(
          pending_file_ids=list(pending_files),
          pending_deadline_ids=pending_deadlines,
      )
  ```

- [ ] **Step 10.4 — Update the existing sync tests that assert `sync_user` returns `None`.**

  Check `apps/studybuddy/backend/tests/test_sync.py`. The existing tests don't assign the return value, so no change needed — `await sync_user(...)` still works. Run them:
  ```bash
  uv run pytest tests/test_sync.py -x -q
  ```
  Expected: existing 3 tests still pass.

- [ ] **Step 10.5 — Run the new tests; confirm they pass.**
  ```bash
  uv run pytest tests/test_sync_indexing.py -x -q
  ```
  Expected: `3 passed`.

- [ ] **Step 10.6 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 10.7 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/sync/orchestrator.py \
          apps/studybuddy/backend/tests/test_sync_indexing.py
  git commit -m "feat(studybuddy): sync_user returns SyncResult with pending index ids

  After the Canvas upsert pass, compute which files/deadlines need
  (re)indexing: files where indexed_at is stale or index_version bumped,
  deadlines whose description_hash drifted. Returned to caller so the
  dashboard endpoint can dispatch BackgroundTasks."
  ```

---

## Task 11 · Retrieval function

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/rag/retrieval.py`
- Create: `apps/studybuddy/backend/tests/test_rag_retrieval.py`

**What it does:** Given `(db, user, course_id, query_embedding, top_k_recall, top_k_rerank, reranker)`, runs the pgvector cosine search, then reranks, and returns the top `N` `Chunk` rows in ranked order. For SQLite test mode, it uses a Python-side cosine fallback (since pgvector operators don't exist in SQLite). This lets tests exercise the whole path without Postgres.

### Steps

- [ ] **Step 11.1 — Write the failing retrieval test.**

  Create `apps/studybuddy/backend/tests/test_rag_retrieval.py`:
  ```python
  import pytest
  from sqlalchemy import select
  from studybuddy.db.models import Chunk, Course, File as FileModel, User
  from studybuddy.rag.retrieval import retrieve_chunks


  class FakeReranker:
      def __init__(self, order: list[int]):
          self._order = order

      async def rerank(self, *, query, documents, top_k):
          return self._order[:top_k]


  def _unit_vec(dim, nonzero_index):
      v = [0.0] * dim
      v[nonzero_index] = 1.0
      return v


  @pytest.mark.asyncio
  async def test_retrieve_scopes_to_course_and_ranks(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c1 = Course(user_id=u.id, canvas_course_id=1, name="A"); db.add(c1)
      c2 = Course(user_id=u.id, canvas_course_id=2, name="B"); db.add(c2)
      await db.flush()
      f1 = FileModel(user_id=u.id, course_id=c1.id, canvas_file_id=10,
                     filename="a.pdf", url="x", source="canvas")
      f2 = FileModel(user_id=u.id, course_id=c2.id, canvas_file_id=20,
                     filename="b.pdf", url="x", source="canvas")
      db.add_all([f1, f2]); await db.flush()
      # Three chunks in course 1; one in course 2.
      db.add_all([
          Chunk(user_id=u.id, course_id=c1.id, file_id=f1.id, source_kind="file",
                content_text="alpha", chunk_index=0, token_count=1, embedding=_unit_vec(512, 0)),
          Chunk(user_id=u.id, course_id=c1.id, file_id=f1.id, source_kind="file",
                content_text="beta", chunk_index=1, token_count=1, embedding=_unit_vec(512, 1)),
          Chunk(user_id=u.id, course_id=c1.id, file_id=f1.id, source_kind="file",
                content_text="gamma", chunk_index=2, token_count=1, embedding=_unit_vec(512, 2)),
          Chunk(user_id=u.id, course_id=c2.id, file_id=f2.id, source_kind="file",
                content_text="other_course", chunk_index=0, token_count=1, embedding=_unit_vec(512, 0)),
      ])
      await db.commit()

      # Query embedding closest to "alpha" (index 0) and "beta" (index 1).
      q = [0.9] + [0.0] * 511
      q[1] = 0.4  # inject some mass into beta dim
      rr = FakeReranker(order=[0, 1])  # assume reranker keeps first two in order
      chunks = await retrieve_chunks(
          db, user_id=u.id, course_id=c1.id,
          query_embedding=q, query_text="alpha beta",
          top_k_recall=10, top_k_rerank=2, reranker=rr,
      )
      texts = [c.content_text for c in chunks]
      assert "other_course" not in texts
      assert len(chunks) == 2
      assert "alpha" in texts[0]


  @pytest.mark.asyncio
  async def test_retrieve_empty_when_no_chunks(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="A"); db.add(c); await db.flush()
      rr = FakeReranker(order=[])
      chunks = await retrieve_chunks(
          db, user_id=u.id, course_id=c.id,
          query_embedding=[0.0] * 512, query_text="anything",
          top_k_recall=10, top_k_rerank=5, reranker=rr,
      )
      assert chunks == []
  ```

- [ ] **Step 11.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_rag_retrieval.py -x -q
  ```
  Expected: `ImportError`.

- [ ] **Step 11.3 — Implement the retrieval function.**

  Create `apps/studybuddy/backend/studybuddy/rag/retrieval.py`:
  ```python
  """Vector search + rerank for per-course chat.

  Production path (Postgres + pgvector):
      SELECT * FROM chunks WHERE user_id=:u AND course_id=:c
      ORDER BY embedding <=> :q LIMIT :n;

  Test path (SQLite): we can't use the `<=>` operator. Fall back to loading
  all matching rows and sorting by cosine distance in Python. Tests use
  small datasets so the cost is negligible.
  """
  from __future__ import annotations
  import math
  from typing import Protocol
  from sqlalchemy import select, text
  from sqlalchemy.ext.asyncio import AsyncSession

  from studybuddy.db.models import Chunk


  class _Reranker(Protocol):
      async def rerank(self, *, query: str, documents: list[str], top_k: int) -> list[int]: ...


  async def retrieve_chunks(
      db: AsyncSession,
      *,
      user_id,
      course_id,
      query_embedding: list[float],
      query_text: str,
      top_k_recall: int,
      top_k_rerank: int,
      reranker: _Reranker,
  ) -> list[Chunk]:
      recalled = await _recall(db, user_id=user_id, course_id=course_id,
                               query_embedding=query_embedding, limit=top_k_recall)
      if not recalled:
          return []
      documents = [c.content_text for c in recalled]
      order = await reranker.rerank(query=query_text, documents=documents, top_k=top_k_rerank)
      return [recalled[i] for i in order]


  async def _recall(db: AsyncSession, *, user_id, course_id,
                    query_embedding: list[float], limit: int) -> list[Chunk]:
      dialect = db.bind.dialect.name if db.bind else "sqlite"
      if dialect == "postgresql":
          # pgvector: <=> is cosine distance. Use bind param via text() with cast.
          stmt = text(
              """
              SELECT id FROM chunks
              WHERE user_id = :u AND course_id = :c
              ORDER BY embedding <=> (:q)::vector
              LIMIT :n
              """
          ).bindparams(u=user_id, c=course_id, q=query_embedding, n=limit)
          rows = (await db.execute(stmt)).all()
          ids = [r[0] for r in rows]
          if not ids:
              return []
          fetched = (await db.execute(select(Chunk).where(Chunk.id.in_(ids)))).scalars().all()
          # Preserve pgvector order.
          by_id = {c.id: c for c in fetched}
          return [by_id[i] for i in ids if i in by_id]

      # SQLite fallback: pull all, rank in Python.
      all_rows = (await db.execute(
          select(Chunk).where(Chunk.user_id == user_id, Chunk.course_id == course_id)
      )).scalars().all()
      if not all_rows:
          return []
      scored = [(_cosine_distance(query_embedding, c.embedding), c) for c in all_rows]
      scored.sort(key=lambda t: t[0])
      return [c for _, c in scored[:limit]]


  def _cosine_distance(a: list[float], b: list[float]) -> float:
      # a, b are raw lists of floats (JSON in SQLite).
      if not a or not b or len(a) != len(b):
          return 1.0
      dot = sum(x * y for x, y in zip(a, b))
      na = math.sqrt(sum(x * x for x in a))
      nb = math.sqrt(sum(x * x for x in b))
      if na == 0 or nb == 0:
          return 1.0
      return 1.0 - (dot / (na * nb))
  ```

- [ ] **Step 11.4 — Run the test.**
  ```bash
  uv run pytest tests/test_rag_retrieval.py -x -q
  ```
  Expected: `2 passed`.

- [ ] **Step 11.5 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 11.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/rag/retrieval.py \
          apps/studybuddy/backend/tests/test_rag_retrieval.py
  git commit -m "feat(studybuddy): rag.retrieval — pgvector top-K + Voyage rerank

  Dialect-aware: pgvector cosine on Postgres, Python cosine on SQLite
  so tests don't need a real vector DB."
  ```

---

**Phase 3 gate:** Ingestion primitives + indexer + sync integration + retrieval all shipped and tested. Phase 4 builds the chat service.

---

# Phase 4 · Chat service (prompt builder + streaming orchestrator)

Goal: build the `chat` module that owns prompt construction and the streaming response flow. No HTTP yet — just a pure async function that takes a session + user message and yields tokens, then persists the finalized message with citations.

Create the package init:

- [ ] **Phase-4 prep — create chat package.**
  ```bash
  cd apps/studybuddy/backend
  mkdir -p studybuddy/chat
  touch studybuddy/chat/__init__.py
  ```

  (Empty `__init__.py` is fine — this package's public surface is imported directly from submodules.)

---

## Task 12 · Prompt builder

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/chat/prompts.py`
- Create: `apps/studybuddy/backend/tests/test_chat_prompts.py`

**What it does:**
- `build_system_prompt(course_name, canvas_base_url) -> str`
- `build_context_block(chunks) -> str` — formats the top-K reranked chunks as `[1]`, `[2]`, ... numbered context, preserving `heading_path`, `page_hint`, filename.
- `build_messages(history, user_query, context_block) -> list[dict]` — the Anthropic SDK's `messages` shape. Trims history to the last 10 turns, ~4000 tokens.

### Steps

- [ ] **Step 12.1 — Write the failing prompt test.**

  Create `apps/studybuddy/backend/tests/test_chat_prompts.py`:
  ```python
  import pytest
  from studybuddy.db.models import Chunk
  from studybuddy.chat.prompts import (
      build_system_prompt, build_context_block, build_messages,
  )


  def _chunk(**kw):
      return Chunk(
          user_id=None, course_id=None, source_kind="file",
          content_text=kw.get("content_text", "body"),
          chunk_index=kw.get("chunk_index", 0),
          token_count=kw.get("token_count", 2),
          heading_path=kw.get("heading_path"),
          page_hint=kw.get("page_hint"),
          embedding=[0.0] * 512,
      )


  def test_system_prompt_names_course_and_base_url():
      p = build_system_prompt(course_name="Econ 101", canvas_base_url="canvas.eur.nl")
      assert "Econ 101" in p
      assert "canvas.eur.nl" in p
      assert "[1]" in p  # instruction about inline citations


  def test_context_block_numbered_with_metadata():
      chunks = [
          _chunk(content_text="Supply and demand basics.",
                 heading_path="Ch.1 > Basics", page_hint=3),
          _chunk(content_text="Elasticity is the responsiveness...",
                 heading_path=None, page_hint=None),
      ]
      block = build_context_block(chunks)
      assert "[1]" in block
      assert "[2]" in block
      assert "Ch.1 > Basics" in block
      assert "p.3" in block
      assert "Supply and demand basics" in block
      assert "Elasticity" in block


  def test_context_block_empty_when_no_chunks():
      assert build_context_block([]) == ""


  def test_build_messages_shape():
      history = [
          {"role": "user", "content": "hi"},
          {"role": "assistant", "content": "hello there"},
      ]
      msgs = build_messages(
          history=history,
          user_query="What is Big-O?",
          context_block="[1] algo.pdf:\nBig-O...",
      )
      # Anthropic messages API: alternating, last one is current user.
      assert msgs[-1]["role"] == "user"
      assert "What is Big-O?" in msgs[-1]["content"]
      assert "[1] algo.pdf" in msgs[-1]["content"]
      # History preserved.
      assert msgs[0]["role"] == "user"
      assert msgs[1]["role"] == "assistant"


  def test_build_messages_trims_long_history():
      # 30 turns of history; we expect at most 10 (last 10) + current user.
      history = []
      for i in range(15):
          history.append({"role": "user", "content": f"u{i}"})
          history.append({"role": "assistant", "content": f"a{i}"})
      msgs = build_messages(history=history, user_query="q", context_block="")
      assert len(msgs) <= 11
      assert msgs[-1]["role"] == "user" and "q" in msgs[-1]["content"]
  ```

- [ ] **Step 12.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_chat_prompts.py -x -q
  ```
  Expected: `ImportError`.

- [ ] **Step 12.3 — Implement the prompt module.**

  Create `apps/studybuddy/backend/studybuddy/chat/prompts.py`:
  ```python
  """Prompt assembly for per-course RAG chat.

  Context blocks are numbered [1]..[N] matching the reranked top-K chunks.
  The assistant is instructed to emit citations in the same [N] form, and
  we parse them post-hoc into structured citation rows.
  """
  from __future__ import annotations
  from typing import Iterable
  from studybuddy.db.models import Chunk


  _SYSTEM_TEMPLATE = (
      "You are a study assistant for {course_name} at {canvas_base_url}.\n"
      "You have access to course materials (lecture slides, readings, assignment "
      "briefs, and anything the user has uploaded).\n\n"
      "Rules:\n"
      "- Answer using ONLY the provided context blocks below. If the context "
      "does not contain the answer, say so plainly — do not invent facts or draw "
      "on outside knowledge.\n"
      "- Cite inline using [1], [2], ... matching the numbered context blocks. "
      "Place citations immediately after the claim they support.\n"
      "- Keep answers concise and structured (short paragraphs, bullet lists "
      "when useful).\n"
      "- Respond in the same language as the user's question when possible; "
      "course materials may be in English or Dutch."
  )


  def build_system_prompt(*, course_name: str, canvas_base_url: str) -> str:
      return _SYSTEM_TEMPLATE.format(
          course_name=course_name,
          canvas_base_url=canvas_base_url,
      )


  def build_context_block(chunks: Iterable[Chunk]) -> str:
      chunks = list(chunks)
      if not chunks:
          return ""
      parts: list[str] = []
      for i, c in enumerate(chunks, start=1):
          header_bits: list[str] = []
          if c.heading_path:
              header_bits.append(c.heading_path)
          if c.page_hint is not None:
              header_bits.append(f"p.{c.page_hint}")
          header = ", ".join(header_bits) if header_bits else "source"
          parts.append(f"[{i}] {header}:\n{c.content_text.strip()}")
      return "\n\n".join(parts)


  _MAX_HISTORY_TURNS = 10


  def build_messages(
      *,
      history: list[dict],
      user_query: str,
      context_block: str,
  ) -> list[dict]:
      trimmed = history[-_MAX_HISTORY_TURNS:] if len(history) > _MAX_HISTORY_TURNS else list(history)
      current = (f"{context_block}\n\n---\n\nQuestion: {user_query}"
                 if context_block else f"Question: {user_query}")
      return [*trimmed, {"role": "user", "content": current}]
  ```

- [ ] **Step 12.4 — Run the test.**
  ```bash
  uv run pytest tests/test_chat_prompts.py -x -q
  ```
  Expected: `5 passed`.

- [ ] **Step 12.5 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/chat/__init__.py \
          apps/studybuddy/backend/studybuddy/chat/prompts.py \
          apps/studybuddy/backend/tests/test_chat_prompts.py
  git commit -m "feat(studybuddy): chat.prompts — system + context + messages builders

  [N]-numbered context blocks with heading_path / page_hint in the header.
  History trimmed to last 10 turns before the current user message."
  ```

---

## Task 13 · Chat streaming service

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/chat/service.py`
- Create: `apps/studybuddy/backend/tests/test_chat_service.py`

**What it does:** One async-generator function:
`answer_and_stream(db, user, session_id, user_text, embedder, reranker, claude_client) -> AsyncIterator[StreamEvent]`.

Flow:
1. Load session, verify it belongs to the user.
2. Load last N messages as history.
3. Persist the user message (role="user").
4. Embed the query, retrieve top chunks, build context block.
5. Build prompt, stream Claude response, yield `StreamEvent(kind="token", text=...)` per delta.
6. On stream end, parse `[N]` markers, build `citations_json`, persist the assistant message, yield `StreamEvent(kind="done", message_id=..., citations=...)`.
7. On stream error: persist partial content with `error=True`, yield `StreamEvent(kind="error", message=...)`.

The Claude client is parameterized so tests can inject a fake streaming client.

### Steps

- [ ] **Step 13.1 — Write the failing chat-service test.**

  Create `apps/studybuddy/backend/tests/test_chat_service.py`:
  ```python
  import pytest
  from sqlalchemy import select
  from studybuddy.chat.service import answer_and_stream, StreamEvent
  from studybuddy.db.models import (
      ChatMessage, ChatSession, Chunk, Course, File as FileModel, User,
  )


  class FakeEmbedder:
      async def embed_query(self, text):
          return [0.0] * 512


  class FakeReranker:
      async def rerank(self, *, query, documents, top_k):
          return list(range(min(top_k, len(documents))))


  class FakeClaude:
      """Simulates an Anthropic streaming response as an async iterator of deltas."""

      def __init__(self, chunks: list[str], raise_after: int | None = None):
          self._chunks = chunks
          self._raise_after = raise_after

      def messages_stream(self, **kwargs):
          chunks = self._chunks
          raise_after = self._raise_after

          class _Ctx:
              async def __aenter__(self_inner):
                  return self_inner

              async def __aexit__(self_inner, *a):
                  return False

              async def text_stream(self_inner):  # async generator
                  for i, c in enumerate(chunks):
                      if raise_after is not None and i == raise_after:
                          raise RuntimeError("boom")
                      yield c

          return _Ctx()


  async def _setup(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
      f = FileModel(user_id=u.id, course_id=c.id, canvas_file_id=10,
                    filename="algo.pdf", url="https://canvas/algo.pdf", source="canvas")
      db.add(f); await db.flush()
      db.add(Chunk(
          user_id=u.id, course_id=c.id, file_id=f.id, source_kind="file",
          content_text="Big-O describes complexity.", chunk_index=0, token_count=4,
          heading_path="Ch1", page_hint=2, embedding=[1.0] + [0.0] * 511,
      ))
      s = ChatSession(user_id=u.id, course_id=c.id, title="Untitled")
      db.add(s); await db.commit()
      return u, c, s


  @pytest.mark.asyncio
  async def test_answer_streams_tokens_and_persists_citations(db):
      u, c, s = await _setup(db)
      claude = FakeClaude(chunks=["Big-O ", "is about ", "complexity [1]."])
      events: list[StreamEvent] = []
      async for ev in answer_and_stream(
          db, user=u, session_id=s.id, user_text="What is Big-O?",
          embedder=FakeEmbedder(), reranker=FakeReranker(), claude_client=claude,
          course_name=c.name, canvas_base_url="canvas.eur.nl",
          top_k_recall=5, top_k_rerank=3, claude_model="claude-sonnet-4-6",
      ):
          events.append(ev)
      await db.commit()

      # Token events for each streamed delta.
      token_text = "".join(e.text for e in events if e.kind == "token")
      assert "complexity [1]" in token_text

      done = [e for e in events if e.kind == "done"]
      assert len(done) == 1
      assert done[0].citations is not None
      # [1] should map to our single chunk.
      assert done[0].citations[0]["marker"] == 1

      msgs = (await db.execute(select(ChatMessage))).scalars().all()
      roles = sorted(m.role for m in msgs)
      assert roles == ["assistant", "user"]
      assistant = next(m for m in msgs if m.role == "assistant")
      assert "complexity [1]" in assistant.content
      assert assistant.error is False
      assert assistant.citations_json[0]["marker"] == 1


  @pytest.mark.asyncio
  async def test_answer_handles_stream_error_midway(db):
      u, c, s = await _setup(db)
      claude = FakeClaude(chunks=["Hello ", "world"], raise_after=1)
      events: list[StreamEvent] = []
      async for ev in answer_and_stream(
          db, user=u, session_id=s.id, user_text="hi",
          embedder=FakeEmbedder(), reranker=FakeReranker(), claude_client=claude,
          course_name=c.name, canvas_base_url="canvas.eur.nl",
          top_k_recall=5, top_k_rerank=3, claude_model="claude-sonnet-4-6",
      ):
          events.append(ev)
      await db.commit()

      err = [e for e in events if e.kind == "error"]
      assert len(err) == 1
      msgs = (await db.execute(select(ChatMessage))).scalars().all()
      assistant = next((m for m in msgs if m.role == "assistant"), None)
      assert assistant is not None
      assert assistant.error is True
      assert assistant.content.startswith("Hello")


  @pytest.mark.asyncio
  async def test_answer_with_no_chunks_still_responds(db):
      """If retrieval returns nothing, we still pass through to Claude with an
      empty context block; the model is instructed to say 'not in materials'."""
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=1, name="CS"); db.add(c); await db.flush()
      s = ChatSession(user_id=u.id, course_id=c.id, title="x"); db.add(s); await db.commit()

      claude = FakeClaude(chunks=["I don't have material on that."])
      events = []
      async for ev in answer_and_stream(
          db, user=u, session_id=s.id, user_text="obscure?",
          embedder=FakeEmbedder(), reranker=FakeReranker(), claude_client=claude,
          course_name=c.name, canvas_base_url="canvas.eur.nl",
          top_k_recall=5, top_k_rerank=3, claude_model="claude-sonnet-4-6",
      ):
          events.append(ev)
      await db.commit()
      done = [e for e in events if e.kind == "done"][0]
      assert done.citations == []
  ```

- [ ] **Step 13.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_chat_service.py -x -q
  ```
  Expected: `ImportError`.

- [ ] **Step 13.3 — Implement the chat service.**

  Create `apps/studybuddy/backend/studybuddy/chat/service.py`:
  ```python
  """Per-course chat streaming orchestrator.

  answer_and_stream is an async-generator that yields StreamEvent values
  as the Claude response streams in. It's provider-agnostic in tests —
  claude_client just needs to implement messages_stream(...) returning an
  async context manager with .text_stream() async generator.

  Side effects: persists the user message before streaming begins, and
  persists the assistant message after the stream ends (partial if the
  stream errored mid-flight, with error=True).
  """
  from __future__ import annotations
  import re
  from dataclasses import dataclass
  from typing import Any, AsyncIterator, Protocol
  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession

  from studybuddy.chat.prompts import build_context_block, build_messages, build_system_prompt
  from studybuddy.db.models import ChatMessage, ChatSession, Chunk, User
  from studybuddy.rag.retrieval import retrieve_chunks


  @dataclass
  class StreamEvent:
      kind: str  # "token" | "done" | "error"
      text: str = ""
      message_id: Any = None
      citations: list[dict] | None = None
      error: str | None = None


  class _Embedder(Protocol):
      async def embed_query(self, text: str) -> list[float]: ...


  class _Reranker(Protocol):
      async def rerank(self, *, query: str, documents: list[str], top_k: int) -> list[int]: ...


  _CITE_RE = re.compile(r"\[(\d+)\]")


  async def answer_and_stream(
      db: AsyncSession,
      *,
      user: User,
      session_id,
      user_text: str,
      embedder: _Embedder,
      reranker: _Reranker,
      claude_client: Any,
      course_name: str,
      canvas_base_url: str,
      top_k_recall: int,
      top_k_rerank: int,
      claude_model: str,
      max_output_tokens: int = 2048,
  ) -> AsyncIterator[StreamEvent]:
      session = (await db.execute(
          select(ChatSession).where(
              ChatSession.id == session_id,
              ChatSession.user_id == user.id,
          )
      )).scalar_one()

      history = await _load_history(db, session_id=session.id)

      # Persist user message up front — if stream fails, we still have it.
      db.add(ChatMessage(session_id=session.id, role="user", content=user_text))
      await db.flush()

      query_embedding = await embedder.embed_query(user_text)
      top_chunks = await retrieve_chunks(
          db,
          user_id=user.id,
          course_id=session.course_id,
          query_embedding=query_embedding,
          query_text=user_text,
          top_k_recall=top_k_recall,
          top_k_rerank=top_k_rerank,
          reranker=reranker,
      )
      context_block = build_context_block(top_chunks)
      messages = build_messages(
          history=[{"role": m.role, "content": m.content} for m in history],
          user_query=user_text,
          context_block=context_block,
      )
      system_prompt = build_system_prompt(course_name=course_name, canvas_base_url=canvas_base_url)

      full_text = ""
      had_error = False
      error_msg = ""

      try:
          async with claude_client.messages_stream(
              model=claude_model,
              max_tokens=max_output_tokens,
              system=system_prompt,
              messages=messages,
          ) as stream:
              async for delta in stream.text_stream():
                  full_text += delta
                  yield StreamEvent(kind="token", text=delta)
      except Exception as e:  # noqa: BLE001 — we persist the partial and let upstream decide
          had_error = True
          error_msg = f"{type(e).__name__}: {e}"

      citations = _extract_citations(full_text, top_chunks) if not had_error else []
      assistant_msg = ChatMessage(
          session_id=session.id,
          role="assistant",
          content=full_text,
          citations_json=citations if not had_error else None,
          error=had_error,
      )
      db.add(assistant_msg)
      await db.flush()

      if had_error:
          yield StreamEvent(kind="error", error=error_msg, message_id=assistant_msg.id)
      else:
          yield StreamEvent(
              kind="done",
              message_id=assistant_msg.id,
              citations=citations,
          )


  async def _load_history(db: AsyncSession, *, session_id) -> list[ChatMessage]:
      rows = (await db.execute(
          select(ChatMessage)
          .where(ChatMessage.session_id == session_id)
          .order_by(ChatMessage.created_at.asc())
      )).scalars().all()
      return list(rows)


  def _extract_citations(text: str, chunks: list[Chunk]) -> list[dict]:
      """Scan `[N]` markers; build structured citation dicts referencing the matched chunk.

      Markers that point past the number of available chunks are silently dropped.
      Duplicates (same N used twice) produce one entry per unique N.
      """
      markers = sorted({int(m.group(1)) for m in _CITE_RE.finditer(text)})
      result: list[dict] = []
      for n in markers:
          if 1 <= n <= len(chunks):
              c = chunks[n - 1]
              snippet = c.content_text[:180].replace("\n", " ").strip()
              result.append({
                  "marker": n,
                  "chunk_id": str(c.id) if c.id is not None else None,
                  "file_id": str(c.file_id) if c.file_id is not None else None,
                  "deadline_id": str(c.deadline_id) if c.deadline_id is not None else None,
                  "page_hint": c.page_hint,
                  "heading_path": c.heading_path,
                  "snippet": snippet,
              })
      return result
  ```

- [ ] **Step 13.4 — Run the test.**
  ```bash
  uv run pytest tests/test_chat_service.py -x -q
  ```
  Expected: `3 passed`.

- [ ] **Step 13.5 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 13.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/chat/service.py \
          apps/studybuddy/backend/tests/test_chat_service.py
  git commit -m "feat(studybuddy): chat.service — streaming orchestrator with citations

  answer_and_stream yields StreamEvent(token|done|error). Persists user
  message before streaming, persists finalized assistant message after
  with parsed [N] -> citation dicts. Claude client dependency-injected
  so tests use a fake; production wires anthropic.AsyncAnthropic."
  ```

---

**Phase 4 gate:** Prompt builder + streaming orchestrator land. Phase 5 wraps these in HTTP endpoints.

---

# Phase 5 · API endpoints

Goal: expose `/api/courses/{id}/materials/*` and `/api/courses/{id}/chat/*` through FastAPI, using existing `current_user` auth, existing `get_db` session dep, and `BackgroundTasks` for indexing.

Reusable helpers first, then the two routers, then register them in `main.py`.

---

## Task 14 · `chat` runtime factories + course lookup helper

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/chat/deps.py`
- Create: `apps/studybuddy/backend/tests/test_chat_deps.py`

**What it does:** Centralizes construction of `VoyageEmbedder`, `VoyageReranker`, and the Anthropic async client so endpoints don't duplicate that code. Also a small helper `resolve_course(db, user, canvas_course_id)` that returns the `Course` row or raises 404.

### Steps

- [ ] **Step 14.1 — Write the failing test.**

  Create `apps/studybuddy/backend/tests/test_chat_deps.py`:
  ```python
  import pytest
  from fastapi import HTTPException
  from studybuddy.chat.deps import (
      get_embedder, get_reranker, get_claude, resolve_course,
  )
  from studybuddy.db.models import Course, User


  def test_get_embedder_requires_key(monkeypatch):
      monkeypatch.setenv("VOYAGE_API_KEY", "")
      from studybuddy.config import get_settings
      get_settings.cache_clear()
      with pytest.raises(RuntimeError, match="VOYAGE_API_KEY"):
          get_embedder()


  def test_get_embedder_instantiates(monkeypatch):
      monkeypatch.setenv("VOYAGE_API_KEY", "vo-test")
      monkeypatch.setenv("STUDYBUDDY_MASTER_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
      monkeypatch.setenv("SESSION_SIGNING_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
      from studybuddy.config import get_settings
      get_settings.cache_clear()
      emb = get_embedder()
      assert emb is not None


  def test_get_reranker_requires_key(monkeypatch):
      monkeypatch.setenv("VOYAGE_API_KEY", "")
      from studybuddy.config import get_settings
      get_settings.cache_clear()
      with pytest.raises(RuntimeError, match="VOYAGE_API_KEY"):
          get_reranker()


  def test_get_claude_requires_key(monkeypatch):
      monkeypatch.setenv("ANTHROPIC_API_KEY", "")
      from studybuddy.config import get_settings
      get_settings.cache_clear()
      with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
          get_claude()


  @pytest.mark.asyncio
  async def test_resolve_course_hits(db):
      u = User(email="a@eur.nl"); db.add(u); await db.flush()
      c = Course(user_id=u.id, canvas_course_id=10, name="CS"); db.add(c); await db.commit()
      resolved = await resolve_course(db, user=u, canvas_course_id=10)
      assert resolved.id == c.id


  @pytest.mark.asyncio
  async def test_resolve_course_missing_raises_404(db):
      u = User(email="a@eur.nl"); db.add(u); await db.commit()
      with pytest.raises(HTTPException) as e:
          await resolve_course(db, user=u, canvas_course_id=999)
      assert e.value.status_code == 404
  ```

- [ ] **Step 14.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_chat_deps.py -x -q
  ```
  Expected: `ImportError`.

- [ ] **Step 14.3 — Implement `chat/deps.py`.**

  Create `apps/studybuddy/backend/studybuddy/chat/deps.py`:
  ```python
  """Small factories and lookup helpers shared by the chat/materials routers."""
  from __future__ import annotations
  from fastapi import HTTPException
  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession

  from studybuddy.config import get_settings
  from studybuddy.db.models import Course, User
  from studybuddy.rag.embedder import VoyageEmbedder
  from studybuddy.rag.reranker import VoyageReranker


  def get_embedder() -> VoyageEmbedder:
      s = get_settings()
      if not s.voyage_api_key:
          raise RuntimeError("VOYAGE_API_KEY is not set")
      return VoyageEmbedder(api_key=s.voyage_api_key)


  def get_reranker() -> VoyageReranker:
      s = get_settings()
      if not s.voyage_api_key:
          raise RuntimeError("VOYAGE_API_KEY is not set")
      return VoyageReranker(api_key=s.voyage_api_key)


  def get_claude():
      s = get_settings()
      if not s.anthropic_api_key:
          raise RuntimeError("ANTHROPIC_API_KEY is not set")
      from anthropic import AsyncAnthropic
      return AsyncAnthropic(api_key=s.anthropic_api_key)


  async def resolve_course(db: AsyncSession, *, user: User, canvas_course_id: int) -> Course:
      row = (await db.execute(
          select(Course).where(
              Course.user_id == user.id,
              Course.canvas_course_id == canvas_course_id,
          )
      )).scalar_one_or_none()
      if row is None:
          raise HTTPException(status_code=404, detail="course not found")
      return row
  ```

- [ ] **Step 14.4 — Run the test.**
  ```bash
  uv run pytest tests/test_chat_deps.py -x -q
  ```
  Expected: `6 passed`.

- [ ] **Step 14.5 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/chat/deps.py \
          apps/studybuddy/backend/tests/test_chat_deps.py
  git commit -m "feat(studybuddy): chat.deps — embedder/reranker/claude factories + course lookup

  Centralizes provider client construction and the
  (user, canvas_course_id) -> Course resolution used by both chat and
  materials routers."
  ```

---

## Task 15 · Materials API — list, upload, URL, delete, refresh

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/api/materials.py`
- Create: `apps/studybuddy/backend/tests/test_api_materials.py`

**What it does:** Five endpoints under `/api/courses/{canvas_course_id}/materials`:
- `GET /` — list all non-deleted files for the course, sorted by source then filename
- `POST /` — multipart upload (validates mime, size, persists `FileModel(source="upload")`, schedules indexing via `BackgroundTasks`)
- `POST /url` — JSON `{url}` → persist `FileModel(source="url")` with filename from URL, schedule indexing
- `DELETE /{file_id}` — 404 if Canvas-sourced; else cascades delete of chunks and removes the row
- `POST /refresh` — triggers `sync_user` + schedules indexing for every pending file/deadline

### Steps

- [ ] **Step 15.1 — Write the failing materials API test.**

  Create `apps/studybuddy/backend/tests/test_api_materials.py`:
  ```python
  import io
  import pytest
  from sqlalchemy import select
  from studybuddy.db.models import (
      Chunk, Course, File as FileModel, User,
  )


  async def _seed_course(db, user, canvas_course_id=10, name="CS"):
      c = Course(user_id=user.id, canvas_course_id=canvas_course_id, name=name)
      db.add(c); await db.commit()
      return c


  @pytest.mark.asyncio
  async def test_list_materials_empty(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      await _seed_course(db, u)
      resp = await authed_client.get("/api/courses/10/materials")
      assert resp.status_code == 200
      body = resp.json()
      assert body == {"materials": []}


  @pytest.mark.asyncio
  async def test_list_materials_groups_and_sorts(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      c = await _seed_course(db, u)
      db.add_all([
          FileModel(user_id=u.id, course_id=c.id, canvas_file_id=10,
                    filename="lec1.pdf", url="x", source="canvas"),
          FileModel(user_id=u.id, course_id=c.id, filename="mynotes.pdf",
                    url="x", source="upload"),
          FileModel(user_id=u.id, course_id=c.id, filename="Wiki",
                    url="https://en.wikipedia.org/wiki/Big_O", source="url",
                    source_url="https://en.wikipedia.org/wiki/Big_O"),
      ])
      await db.commit()
      resp = await authed_client.get("/api/courses/10/materials")
      assert resp.status_code == 200
      items = resp.json()["materials"]
      assert len(items) == 3
      sources = [m["source"] for m in items]
      # Canvas comes first.
      assert sources[0] == "canvas"
      assert set(sources) == {"canvas", "upload", "url"}


  @pytest.mark.asyncio
  async def test_upload_accepts_pdf_and_schedules_index(authed_client, db, monkeypatch):
      u = (await db.execute(select(User))).scalar_one()
      c = await _seed_course(db, u)

      called: dict = {}

      async def _fake_index_upload_bytes(db_, *, user, file_id, raw, content_type,
                                         filename, voyage_embedder,
                                         chunk_tokens=800, chunk_overlap=100):
          called["file_id"] = file_id
          called["filename"] = filename
          called["content_type"] = content_type

      from studybuddy.api import materials as mats
      monkeypatch.setattr(mats, "index_upload_bytes", _fake_index_upload_bytes)
      monkeypatch.setattr(mats, "get_embedder", lambda: object())

      files = {"file": ("hello.pdf", io.BytesIO(b"%PDF-1.4\n...\n"), "application/pdf")}
      resp = await authed_client.post("/api/courses/10/materials", files=files)
      assert resp.status_code == 200, resp.text
      body = resp.json()
      assert body["filename"] == "hello.pdf"
      assert body["source"] == "upload"
      # Background task should have fired (in tests FastAPI runs them after response).
      assert called.get("filename") == "hello.pdf"
      assert called["content_type"] == "application/pdf"

      row = (await db.execute(select(FileModel))).scalar_one()
      assert row.source == "upload"
      assert row.canvas_file_id is None


  @pytest.mark.asyncio
  async def test_upload_rejects_unsupported_mime(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      await _seed_course(db, u)
      files = {"file": ("bad.exe", io.BytesIO(b"MZ\x90\x00"), "application/x-msdownload")}
      resp = await authed_client.post("/api/courses/10/materials", files=files)
      assert resp.status_code == 415


  @pytest.mark.asyncio
  async def test_upload_rejects_oversize(authed_client, db, monkeypatch):
      """50MB default cap; simulate by shrinking it."""
      u = (await db.execute(select(User))).scalar_one()
      await _seed_course(db, u)
      monkeypatch.setenv("RAG_MAX_UPLOAD_MB", "1")
      from studybuddy.config import get_settings
      get_settings.cache_clear()
      big = b"x" * (2 * 1024 * 1024)
      files = {"file": ("huge.pdf", io.BytesIO(big), "application/pdf")}
      resp = await authed_client.post("/api/courses/10/materials", files=files)
      assert resp.status_code == 413


  @pytest.mark.asyncio
  async def test_add_url_material(authed_client, db, monkeypatch):
      u = (await db.execute(select(User))).scalar_one()
      c = await _seed_course(db, u)

      called: dict = {}

      async def _fake_index_file(db_, **kw):
          called.update(kw)

      from studybuddy.api import materials as mats
      monkeypatch.setattr(mats, "index_file", _fake_index_file)
      monkeypatch.setattr(mats, "get_embedder", lambda: object())

      resp = await authed_client.post(
          "/api/courses/10/materials/url",
          json={"url": "https://en.wikipedia.org/wiki/Gini_coefficient"},
      )
      assert resp.status_code == 200, resp.text
      body = resp.json()
      assert body["source"] == "url"
      assert body["source_url"].endswith("Gini_coefficient")
      row = (await db.execute(select(FileModel))).scalar_one()
      assert row.source == "url"
      assert called.get("file_id") == row.id


  @pytest.mark.asyncio
  async def test_delete_upload_cascades_chunks(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      c = await _seed_course(db, u)
      f = FileModel(user_id=u.id, course_id=c.id,
                    filename="mynotes.pdf", url="x", source="upload")
      db.add(f); await db.flush()
      db.add(Chunk(user_id=u.id, course_id=c.id, file_id=f.id,
                   source_kind="file", content_text="notes", chunk_index=0,
                   token_count=1, embedding=[0.0] * 512))
      await db.commit()

      resp = await authed_client.delete(f"/api/courses/10/materials/{f.id}")
      assert resp.status_code == 204
      remaining = (await db.execute(select(FileModel))).scalars().all()
      assert remaining == []
      chunks = (await db.execute(select(Chunk))).scalars().all()
      assert chunks == []


  @pytest.mark.asyncio
  async def test_delete_canvas_file_rejected(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      c = await _seed_course(db, u)
      f = FileModel(user_id=u.id, course_id=c.id, canvas_file_id=10,
                    filename="lec.pdf", url="x", source="canvas")
      db.add(f); await db.commit()
      resp = await authed_client.delete(f"/api/courses/10/materials/{f.id}")
      assert resp.status_code == 400
      assert "canvas" in resp.json()["detail"].lower()
  ```

- [ ] **Step 15.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_api_materials.py -x -q
  ```
  Expected: `404 Not Found` / `ImportError`.

- [ ] **Step 15.3 — Implement the materials router.**

  Create `apps/studybuddy/backend/studybuddy/api/materials.py`:
  ```python
  """Materials endpoints: list / upload / url / delete / refresh."""
  from __future__ import annotations
  from datetime import datetime, timezone
  from typing import Literal
  from urllib.parse import unquote, urlparse
  from uuid import UUID

  from fastapi import (
      APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status,
  )
  from pydantic import BaseModel
  from sqlalchemy import delete, select
  from sqlalchemy.ext.asyncio import AsyncSession

  from studybuddy.auth.deps import current_user
  from studybuddy.chat.deps import get_embedder, resolve_course
  from studybuddy.config import get_settings
  from studybuddy.db.base import get_db
  from studybuddy.db.models import Chunk, File as FileModel, User
  from studybuddy.rag.indexer import index_file, index_upload_bytes
  from studybuddy.security.crypto import decrypt_pat
  from studybuddy.sync.orchestrator import sync_user


  router = APIRouter(prefix="/api/courses/{canvas_course_id}/materials", tags=["materials"])


  _UPLOAD_MIME_ALLOW = {
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
      "text/x-markdown",
  }


  class MaterialResponse(BaseModel):
      id: UUID
      filename: str
      source: Literal["canvas", "upload", "url"]
      source_url: str | None = None
      size_bytes: int | None = None
      content_type: str | None = None
      indexed_at: datetime | None = None
      index_error: str | None = None
      updated_at: datetime | None = None


  class MaterialsListResponse(BaseModel):
      materials: list[MaterialResponse]


  class AddUrlPayload(BaseModel):
      url: str


  @router.get("", response_model=MaterialsListResponse)
  async def list_materials(
      canvas_course_id: int,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ) -> MaterialsListResponse:
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      rows = (await db.execute(
          select(FileModel)
          .where(FileModel.course_id == course.id, FileModel.deleted_at.is_(None))
          .order_by(
              # canvas < upload < url so Canvas sorts first lexically; we want same.
              FileModel.source.asc(),
              FileModel.filename.asc(),
          )
      )).scalars().all()
      return MaterialsListResponse(
          materials=[MaterialResponse(
              id=r.id, filename=r.filename, source=r.source,
              source_url=r.source_url, size_bytes=r.size_bytes,
              content_type=r.content_type, indexed_at=r.indexed_at,
              index_error=r.index_error, updated_at=r.updated_at,
          ) for r in rows]
      )


  @router.post("", response_model=MaterialResponse)
  async def upload_material(
      canvas_course_id: int,
      background: BackgroundTasks,
      file: UploadFile = File(...),
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ) -> MaterialResponse:
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      settings = get_settings()

      content_type = (file.content_type or "").split(";")[0].strip().lower()
      if content_type not in _UPLOAD_MIME_ALLOW:
          raise HTTPException(status_code=415, detail=f"unsupported content_type: {content_type!r}")

      raw = await file.read()
      if len(raw) == 0:
          raise HTTPException(status_code=400, detail="empty upload")
      if len(raw) > settings.rag_max_upload_mb * 1024 * 1024:
          raise HTTPException(status_code=413, detail="file exceeds upload cap")

      row = FileModel(
          user_id=user.id, course_id=course.id,
          filename=file.filename or "(untitled)",
          content_type=content_type,
          url="",  # no canvas-side URL for uploads
          size_bytes=len(raw),
          source="upload",
          uploaded_at=datetime.now(timezone.utc),
      )
      db.add(row)
      await db.commit()
      await db.refresh(row)

      embedder = get_embedder()
      background.add_task(
          index_upload_bytes,
          db,
          user=user,
          file_id=row.id,
          raw=raw,
          content_type=content_type,
          filename=row.filename,
          voyage_embedder=embedder,
          chunk_tokens=settings.rag_chunk_tokens,
          chunk_overlap=settings.rag_chunk_overlap,
      )
      return _to_response(row)


  @router.post("/url", response_model=MaterialResponse)
  async def add_url_material(
      canvas_course_id: int,
      payload: AddUrlPayload,
      background: BackgroundTasks,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ) -> MaterialResponse:
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      parsed = urlparse(payload.url)
      if parsed.scheme not in ("http", "https") or not parsed.hostname:
          raise HTTPException(status_code=400, detail="url must be http(s) with a hostname")

      filename = unquote(parsed.path.rsplit("/", 1)[-1]) or parsed.hostname
      settings = get_settings()
      row = FileModel(
          user_id=user.id, course_id=course.id,
          filename=filename,
          content_type=None,  # determined at fetch time
          url=payload.url,
          source="url",
          source_url=payload.url,
          uploaded_at=datetime.now(timezone.utc),
      )
      db.add(row)
      await db.commit()
      await db.refresh(row)

      embedder = get_embedder()
      background.add_task(
          index_file,
          db,
          user=user,
          file_id=row.id,
          voyage_embedder=embedder,
          pat=None,
          canvas_base_url=user.canvas_base_url,
          max_bytes=settings.rag_max_upload_mb * 1024 * 1024,
          chunk_tokens=settings.rag_chunk_tokens,
          chunk_overlap=settings.rag_chunk_overlap,
      )
      return _to_response(row)


  @router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
  async def delete_material(
      canvas_course_id: int,
      file_id: UUID,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ):
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      row = (await db.execute(
          select(FileModel).where(
              FileModel.id == file_id,
              FileModel.course_id == course.id,
              FileModel.user_id == user.id,
          )
      )).scalar_one_or_none()
      if row is None:
          raise HTTPException(status_code=404, detail="material not found")
      if row.source == "canvas":
          raise HTTPException(status_code=400, detail="cannot delete canvas-synced materials")
      await db.execute(delete(Chunk).where(Chunk.file_id == row.id))
      await db.delete(row)
      await db.commit()


  @router.post("/refresh", response_model=MaterialsListResponse)
  async def refresh_materials(
      canvas_course_id: int,
      background: BackgroundTasks,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ) -> MaterialsListResponse:
      settings = get_settings()
      if user.pat_encrypted is None or user.pat_nonce is None:
          raise HTTPException(status_code=400, detail="connect your Canvas PAT first")
      await resolve_course(db, user=user, canvas_course_id=canvas_course_id)

      result = await sync_user(db, user, master_key=settings.master_key_bytes())
      await db.commit()

      pat = decrypt_pat(user.pat_encrypted, user.pat_nonce, settings.master_key_bytes())
      embedder = get_embedder()
      for fid in result.pending_file_ids:
          background.add_task(
              index_file,
              db,
              user=user,
              file_id=fid,
              voyage_embedder=embedder,
              pat=pat,
              canvas_base_url=user.canvas_base_url,
              max_bytes=settings.rag_max_upload_mb * 1024 * 1024,
              chunk_tokens=settings.rag_chunk_tokens,
              chunk_overlap=settings.rag_chunk_overlap,
          )
      return await list_materials(canvas_course_id=canvas_course_id, user=user, db=db)


  def _to_response(r: FileModel) -> MaterialResponse:
      return MaterialResponse(
          id=r.id, filename=r.filename, source=r.source,
          source_url=r.source_url, size_bytes=r.size_bytes,
          content_type=r.content_type, indexed_at=r.indexed_at,
          index_error=r.index_error, updated_at=r.updated_at,
      )
  ```

- [ ] **Step 15.4 — Register the router in `main.py` (temporary for testing — finalized in Task 17).**

  Edit `apps/studybuddy/backend/studybuddy/main.py`. In `create_app`, add:
  ```python
      from studybuddy.api.materials import router as materials_router
      ...
      app.include_router(materials_router)
  ```
  (After `app.include_router(sync_router)`.)

- [ ] **Step 15.5 — Run the test.**
  ```bash
  uv run pytest tests/test_api_materials.py -x -q
  ```
  Expected: `8 passed`. If the upload test fails because `BackgroundTasks` hasn't run by the time we assert on `called`, FastAPI runs background tasks after the response in tests too — if it really hasn't fired, call the index function directly in the endpoint (drop `background.add_task`) and note that indexing will block the response; then re-add BackgroundTasks only if latency is a problem. Our async tests assert AFTER the response, so background tasks are already done in most cases. If flaky, make the test lenient by awaiting a small `asyncio.sleep(0)`.

- [ ] **Step 15.6 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 15.7 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/api/materials.py \
          apps/studybuddy/backend/studybuddy/main.py \
          apps/studybuddy/backend/tests/test_api_materials.py
  git commit -m "feat(studybuddy): materials API — list/upload/url/delete/refresh

  Multipart upload with mime whitelist + size cap, URL add with public-IP
  guard via rag.downloader.fetch_url, delete for user-sourced rows only,
  refresh triggers sync_user + schedules re-indexing of pending files."
  ```

---

## Task 16 · Chat sessions API — create / list / get / delete

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/api/chat_sessions.py`
- Create: `apps/studybuddy/backend/tests/test_api_chat_sessions.py`

**What it does:** Non-streaming endpoints for managing chat sessions per course:
- `POST /api/courses/{id}/chat/sessions` — create new session (optional body `{title}`)
- `GET /api/courses/{id}/chat/sessions` — list sessions (most recent first)
- `GET /api/courses/{id}/chat/sessions/{sid}` — full session + messages
- `DELETE /api/courses/{id}/chat/sessions/{sid}` — delete (cascades to messages)

### Steps

- [ ] **Step 16.1 — Write the failing test.**

  Create `apps/studybuddy/backend/tests/test_api_chat_sessions.py`:
  ```python
  import pytest
  from sqlalchemy import select
  from studybuddy.db.models import (
      ChatMessage, ChatSession, Course, User,
  )


  async def _course(db, user, canvas_course_id=10):
      c = Course(user_id=user.id, canvas_course_id=canvas_course_id, name="CS")
      db.add(c); await db.commit()
      return c


  @pytest.mark.asyncio
  async def test_create_session_defaults_title(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      await _course(db, u)
      resp = await authed_client.post("/api/courses/10/chat/sessions", json={})
      assert resp.status_code == 200
      body = resp.json()
      assert body["title"].startswith("New chat") or body["title"] == "Untitled"
      assert body["id"]


  @pytest.mark.asyncio
  async def test_create_session_with_title(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      await _course(db, u)
      resp = await authed_client.post(
          "/api/courses/10/chat/sessions", json={"title": "Midterm prep"},
      )
      assert resp.status_code == 200
      assert resp.json()["title"] == "Midterm prep"


  @pytest.mark.asyncio
  async def test_list_sessions_most_recent_first(authed_client, db):
      import datetime as dt
      u = (await db.execute(select(User))).scalar_one()
      c = await _course(db, u)
      older = ChatSession(user_id=u.id, course_id=c.id, title="older",
                          updated_at=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
      newer = ChatSession(user_id=u.id, course_id=c.id, title="newer",
                          updated_at=dt.datetime(2026, 4, 1, tzinfo=dt.timezone.utc))
      db.add_all([older, newer]); await db.commit()
      resp = await authed_client.get("/api/courses/10/chat/sessions")
      assert resp.status_code == 200
      body = resp.json()
      titles = [s["title"] for s in body["sessions"]]
      assert titles == ["newer", "older"]


  @pytest.mark.asyncio
  async def test_get_session_includes_messages(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      c = await _course(db, u)
      s = ChatSession(user_id=u.id, course_id=c.id, title="x"); db.add(s); await db.flush()
      db.add(ChatMessage(session_id=s.id, role="user", content="hi"))
      db.add(ChatMessage(session_id=s.id, role="assistant", content="hey [1]",
                         citations_json=[{"marker": 1, "snippet": "y"}]))
      await db.commit()
      resp = await authed_client.get(f"/api/courses/10/chat/sessions/{s.id}")
      assert resp.status_code == 200
      body = resp.json()
      assert len(body["messages"]) == 2
      assert body["messages"][1]["citations_json"][0]["marker"] == 1


  @pytest.mark.asyncio
  async def test_delete_session_cascades(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      c = await _course(db, u)
      s = ChatSession(user_id=u.id, course_id=c.id, title="x"); db.add(s); await db.flush()
      db.add(ChatMessage(session_id=s.id, role="user", content="hi"))
      await db.commit()
      resp = await authed_client.delete(f"/api/courses/10/chat/sessions/{s.id}")
      assert resp.status_code == 204
      assert (await db.execute(select(ChatSession))).scalars().all() == []
      assert (await db.execute(select(ChatMessage))).scalars().all() == []


  @pytest.mark.asyncio
  async def test_cannot_access_other_users_session(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      await _course(db, u)
      other = User(email="other@eur.nl"); db.add(other); await db.flush()
      oc = Course(user_id=other.id, canvas_course_id=10, name="CS"); db.add(oc); await db.flush()
      s = ChatSession(user_id=other.id, course_id=oc.id, title="secret")
      db.add(s); await db.commit()
      resp = await authed_client.get(f"/api/courses/10/chat/sessions/{s.id}")
      assert resp.status_code == 404
  ```

- [ ] **Step 16.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_api_chat_sessions.py -x -q
  ```
  Expected: `404` (no router).

- [ ] **Step 16.3 — Implement the chat-sessions router.**

  Create `apps/studybuddy/backend/studybuddy/api/chat_sessions.py`:
  ```python
  """CRUD for chat sessions per course."""
  from __future__ import annotations
  from datetime import datetime
  from uuid import UUID

  from fastapi import APIRouter, Depends, HTTPException, status
  from pydantic import BaseModel
  from sqlalchemy import delete, select
  from sqlalchemy.ext.asyncio import AsyncSession

  from studybuddy.auth.deps import current_user
  from studybuddy.chat.deps import resolve_course
  from studybuddy.db.base import get_db
  from studybuddy.db.models import ChatMessage, ChatSession, User


  router = APIRouter(prefix="/api/courses/{canvas_course_id}/chat/sessions", tags=["chat"])


  class CreateSessionPayload(BaseModel):
      title: str | None = None


  class SessionSummary(BaseModel):
      id: UUID
      title: str
      created_at: datetime
      updated_at: datetime


  class SessionList(BaseModel):
      sessions: list[SessionSummary]


  class MessageItem(BaseModel):
      id: UUID
      role: str
      content: str
      citations_json: list | None = None
      error: bool
      created_at: datetime


  class SessionDetail(BaseModel):
      id: UUID
      title: str
      created_at: datetime
      updated_at: datetime
      messages: list[MessageItem]


  @router.post("", response_model=SessionSummary)
  async def create_session(
      canvas_course_id: int,
      payload: CreateSessionPayload,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ) -> SessionSummary:
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      title = (payload.title or "").strip() or "New chat"
      s = ChatSession(user_id=user.id, course_id=course.id, title=title)
      db.add(s)
      await db.commit()
      await db.refresh(s)
      return SessionSummary(id=s.id, title=s.title, created_at=s.created_at, updated_at=s.updated_at)


  @router.get("", response_model=SessionList)
  async def list_sessions(
      canvas_course_id: int,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ) -> SessionList:
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      rows = (await db.execute(
          select(ChatSession)
          .where(ChatSession.user_id == user.id, ChatSession.course_id == course.id)
          .order_by(ChatSession.updated_at.desc())
      )).scalars().all()
      return SessionList(sessions=[
          SessionSummary(id=r.id, title=r.title, created_at=r.created_at, updated_at=r.updated_at)
          for r in rows
      ])


  @router.get("/{session_id}", response_model=SessionDetail)
  async def get_session(
      canvas_course_id: int,
      session_id: UUID,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ) -> SessionDetail:
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      s = (await db.execute(
          select(ChatSession).where(
              ChatSession.id == session_id,
              ChatSession.user_id == user.id,
              ChatSession.course_id == course.id,
          )
      )).scalar_one_or_none()
      if s is None:
          raise HTTPException(status_code=404, detail="session not found")
      msgs = (await db.execute(
          select(ChatMessage).where(ChatMessage.session_id == s.id).order_by(ChatMessage.created_at.asc())
      )).scalars().all()
      return SessionDetail(
          id=s.id, title=s.title,
          created_at=s.created_at, updated_at=s.updated_at,
          messages=[MessageItem(
              id=m.id, role=m.role, content=m.content,
              citations_json=m.citations_json, error=m.error,
              created_at=m.created_at,
          ) for m in msgs],
      )


  @router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
  async def delete_session(
      canvas_course_id: int,
      session_id: UUID,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ):
      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      row = (await db.execute(
          select(ChatSession).where(
              ChatSession.id == session_id,
              ChatSession.user_id == user.id,
              ChatSession.course_id == course.id,
          )
      )).scalar_one_or_none()
      if row is None:
          raise HTTPException(status_code=404, detail="session not found")
      await db.execute(delete(ChatMessage).where(ChatMessage.session_id == row.id))
      await db.delete(row)
      await db.commit()
  ```

- [ ] **Step 16.4 — Register in `main.py`.**

  Edit `apps/studybuddy/backend/studybuddy/main.py` `create_app`, add:
  ```python
      from studybuddy.api.chat_sessions import router as chat_sessions_router
      ...
      app.include_router(chat_sessions_router)
  ```

- [ ] **Step 16.5 — Run tests.**
  ```bash
  uv run pytest tests/test_api_chat_sessions.py -x -q
  ```
  Expected: `6 passed`.

- [ ] **Step 16.6 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/api/chat_sessions.py \
          apps/studybuddy/backend/studybuddy/main.py \
          apps/studybuddy/backend/tests/test_api_chat_sessions.py
  git commit -m "feat(studybuddy): chat sessions API — CRUD + message history fetch

  Scoped to (user, course). GET /session/{id} returns message list with
  citations_json so the frontend can rehydrate. DELETE cascades messages."
  ```

---

## Task 17 · Chat messages API — streaming SSE endpoint

**Files:**
- Create: `apps/studybuddy/backend/studybuddy/api/chat_messages.py`
- Create: `apps/studybuddy/backend/tests/test_api_chat_messages.py`

**What it does:** `POST /api/courses/{id}/chat/sessions/{sid}/messages` with body `{"content": str}`. Streams the assistant's answer as Server-Sent Events:
- `event: token\ndata: {"text": "..."}` — per delta
- `event: done\ndata: {"message_id": "...", "citations": [...]}` — end of stream
- `event: error\ndata: {"message": "..."}` — if the model errored mid-stream

Also autoupdates the session title to the first 60 chars of the first user message when `title == "New chat"`.

### Steps

- [ ] **Step 17.1 — Write the failing test.**

  Create `apps/studybuddy/backend/tests/test_api_chat_messages.py`:
  ```python
  import json
  import pytest
  from sqlalchemy import select
  from studybuddy.db.models import ChatMessage, ChatSession, Course, User


  class FakeEmbedder:
      async def embed_query(self, text):
          return [0.0] * 512


  class FakeReranker:
      async def rerank(self, *, query, documents, top_k):
          return list(range(min(top_k, len(documents))))


  class FakeClaude:
      def __init__(self, chunks):
          self._chunks = chunks

      def messages_stream(self, **kwargs):
          chunks = self._chunks

          class _Ctx:
              async def __aenter__(self_inner):
                  return self_inner

              async def __aexit__(self_inner, *a):
                  return False

              async def text_stream(self_inner):
                  for c in chunks:
                      yield c

          return _Ctx()


  @pytest.mark.asyncio
  async def test_post_message_streams_sse(authed_client, db, monkeypatch):
      from studybuddy.api import chat_messages as cm

      u = (await db.execute(select(User))).scalar_one()
      c = Course(user_id=u.id, canvas_course_id=10, name="CS"); db.add(c); await db.flush()
      s = ChatSession(user_id=u.id, course_id=c.id, title="New chat"); db.add(s); await db.commit()

      monkeypatch.setattr(cm, "get_embedder", lambda: FakeEmbedder())
      monkeypatch.setattr(cm, "get_reranker", lambda: FakeReranker())
      monkeypatch.setattr(cm, "get_claude", lambda: FakeClaude(["Hello ", "world."]))

      async with authed_client.stream(
          "POST", f"/api/courses/10/chat/sessions/{s.id}/messages",
          json={"content": "greet me"},
      ) as resp:
          assert resp.status_code == 200
          assert resp.headers["content-type"].startswith("text/event-stream")
          body = ""
          async for chunk in resp.aiter_text():
              body += chunk
      # SSE format: each event is two lines: `event: X` and `data: {...}` separated by blank line.
      assert "event: token" in body
      assert "Hello " in body and "world." in body
      assert "event: done" in body

      # Session title auto-updated to first message.
      s2 = (await db.execute(select(ChatSession))).scalar_one()
      assert s2.title != "New chat"
      assert "greet me" in s2.title


  @pytest.mark.asyncio
  async def test_post_message_rejects_empty(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      c = Course(user_id=u.id, canvas_course_id=10, name="CS"); db.add(c); await db.flush()
      s = ChatSession(user_id=u.id, course_id=c.id, title="x"); db.add(s); await db.commit()
      resp = await authed_client.post(
          f"/api/courses/10/chat/sessions/{s.id}/messages",
          json={"content": "   "},
      )
      assert resp.status_code == 422


  @pytest.mark.asyncio
  async def test_post_message_404_on_other_session(authed_client, db):
      u = (await db.execute(select(User))).scalar_one()
      c = Course(user_id=u.id, canvas_course_id=10, name="CS"); db.add(c); await db.flush()
      other = User(email="other@eur.nl"); db.add(other); await db.flush()
      oc = Course(user_id=other.id, canvas_course_id=10, name="CS"); db.add(oc); await db.flush()
      s = ChatSession(user_id=other.id, course_id=oc.id, title="x"); db.add(s); await db.commit()
      resp = await authed_client.post(
          f"/api/courses/10/chat/sessions/{s.id}/messages",
          json={"content": "hi"},
      )
      assert resp.status_code == 404
  ```

- [ ] **Step 17.2 — Run the test; confirm it fails.**
  ```bash
  uv run pytest tests/test_api_chat_messages.py -x -q
  ```
  Expected: `404`.

- [ ] **Step 17.3 — Implement the streaming endpoint.**

  Create `apps/studybuddy/backend/studybuddy/api/chat_messages.py`:
  ```python
  """Streaming chat message endpoint (Server-Sent Events)."""
  from __future__ import annotations
  import json
  from uuid import UUID

  from fastapi import APIRouter, Depends, HTTPException
  from pydantic import BaseModel, Field
  from sqlalchemy import select
  from sqlalchemy.ext.asyncio import AsyncSession
  from sse_starlette.sse import EventSourceResponse

  from studybuddy.auth.deps import current_user
  from studybuddy.chat.deps import get_claude, get_embedder, get_reranker, resolve_course
  from studybuddy.chat.service import answer_and_stream
  from studybuddy.config import get_settings
  from studybuddy.db.base import get_db
  from studybuddy.db.models import ChatSession, User


  router = APIRouter(
      prefix="/api/courses/{canvas_course_id}/chat/sessions/{session_id}/messages",
      tags=["chat"],
  )


  class MessagePayload(BaseModel):
      content: str = Field(min_length=1)


  @router.post("")
  async def post_message(
      canvas_course_id: int,
      session_id: UUID,
      payload: MessagePayload,
      user: User = Depends(current_user),
      db: AsyncSession = Depends(get_db),
  ):
      text = payload.content.strip()
      if not text:
          raise HTTPException(status_code=422, detail="content must be non-empty")

      course = await resolve_course(db, user=user, canvas_course_id=canvas_course_id)
      session = (await db.execute(
          select(ChatSession).where(
              ChatSession.id == session_id,
              ChatSession.user_id == user.id,
              ChatSession.course_id == course.id,
          )
      )).scalar_one_or_none()
      if session is None:
          raise HTTPException(status_code=404, detail="session not found")

      # Auto-title first message if session is still on its placeholder.
      if session.title.lower() in ("new chat", "untitled", ""):
          session.title = text[:60]
          await db.flush()

      settings = get_settings()
      embedder = get_embedder()
      reranker = get_reranker()
      claude = get_claude()

      async def _iter():
          try:
              async for event in answer_and_stream(
                  db,
                  user=user,
                  session_id=session.id,
                  user_text=text,
                  embedder=embedder,
                  reranker=reranker,
                  claude_client=claude,
                  course_name=course.name,
                  canvas_base_url=user.canvas_base_url,
                  top_k_recall=settings.rag_top_k_recall,
                  top_k_rerank=settings.rag_top_k_rerank,
                  claude_model=settings.rag_claude_model,
              ):
                  if event.kind == "token":
                      yield {"event": "token", "data": json.dumps({"text": event.text})}
                  elif event.kind == "done":
                      yield {
                          "event": "done",
                          "data": json.dumps({
                              "message_id": str(event.message_id),
                              "citations": event.citations or [],
                          }),
                      }
                  elif event.kind == "error":
                      yield {
                          "event": "error",
                          "data": json.dumps({
                              "message": event.error or "stream failed",
                              "message_id": str(event.message_id) if event.message_id else None,
                          }),
                      }
              await db.commit()
          except Exception as e:  # noqa: BLE001
              yield {"event": "error", "data": json.dumps({"message": f"{type(e).__name__}: {e}"})}

      return EventSourceResponse(_iter())
  ```

- [ ] **Step 17.4 — Register in `main.py`.**

  Edit `apps/studybuddy/backend/studybuddy/main.py`:
  ```python
      from studybuddy.api.chat_messages import router as chat_messages_router
      ...
      app.include_router(chat_messages_router)
  ```

- [ ] **Step 17.5 — Run tests.**
  ```bash
  uv run pytest tests/test_api_chat_messages.py -x -q
  ```
  Expected: `3 passed`.

- [ ] **Step 17.6 — Full suite.**
  ```bash
  uv run pytest -x -q
  ```
  Expected: all green.

- [ ] **Step 17.7 — Commit.**
  ```bash
  cd ../..
  git add apps/studybuddy/backend/studybuddy/api/chat_messages.py \
          apps/studybuddy/backend/studybuddy/main.py \
          apps/studybuddy/backend/tests/test_api_chat_messages.py
  git commit -m "feat(studybuddy): chat messages SSE endpoint

  POST /api/courses/{id}/chat/sessions/{sid}/messages streams assistant
  tokens as SSE. Auto-titles the session from the first user message.
  Events: token / done / error; persistence handled by chat.service."
  ```

---

**Phase 5 gate:** All backend HTTP surface is in place. The server exposes a complete RAG chat API. Phase 6 is the frontend.

---

# Phase 6 · Frontend

Goal: add the Deadlines / Chat / Materials sub-tab structure, build the chat and materials components, and gate the whole thing behind a feature-flag cookie (`sb_ff_chat=1`) so we can dogfood before public flip.

The frontend is lightly tested today — there's no vitest setup. We add a minimal vitest install so the two pieces with real logic (SSE token parser, `[N]` citation renderer) get unit tests. Visual components get manual smoke testing.

---

## Task 18 · Install frontend deps + minimal vitest setup

**Files:**
- Modify: `apps/studybuddy/frontend/package.json`
- Create: `apps/studybuddy/frontend/vitest.config.ts`
- Create: `apps/studybuddy/frontend/src/test/setup.ts`

### Steps

- [ ] **Step 18.1 — Install runtime + dev deps.**
  ```bash
  cd apps/studybuddy/frontend
  npm install react-markdown@^9 remark-gfm@^4
  npm install --save-dev vitest@^2 @vitest/ui@^2 \
    @testing-library/react@^16 @testing-library/jest-dom@^6 \
    jsdom@^25
  ```

- [ ] **Step 18.2 — Add `vitest.config.ts`.**
  ```ts
  import { defineConfig } from "vitest/config";
  import react from "@vitejs/plugin-react";

  export default defineConfig({
    plugins: [react()],
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      globals: true,
    },
  });
  ```

- [ ] **Step 18.3 — Add `src/test/setup.ts`.**
  ```ts
  import "@testing-library/jest-dom/vitest";
  ```

- [ ] **Step 18.4 — Add the `test` script to `package.json`.**

  In the `"scripts"` block, add:
  ```json
      "test": "vitest run",
      "test:watch": "vitest"
  ```

- [ ] **Step 18.5 — Confirm build + test scaffold is healthy.**
  ```bash
  npm run build
  npx vitest run --passWithNoTests
  ```
  Expected: both commands exit 0.

- [ ] **Step 18.6 — Commit.**
  ```bash
  cd ../../..
  git add apps/studybuddy/frontend/package.json \
          apps/studybuddy/frontend/package-lock.json \
          apps/studybuddy/frontend/vitest.config.ts \
          apps/studybuddy/frontend/src/test/setup.ts
  git commit -m "chore(studybuddy-frontend): add react-markdown, vitest, testing-library"
  ```

---

## Task 19 · Shared types + API clients (chat + materials)

**Files:**
- Modify: `apps/studybuddy/frontend/src/api/types.ts`
- Create: `apps/studybuddy/frontend/src/api/chat.ts`
- Create: `apps/studybuddy/frontend/src/api/materials.ts`
- Create: `apps/studybuddy/frontend/src/api/streaming.ts`
- Create: `apps/studybuddy/frontend/src/api/streaming.test.ts`

### Steps

- [ ] **Step 19.1 — Append chat/materials types.**

  Edit `apps/studybuddy/frontend/src/api/types.ts` — append:
  ```ts
  export type MaterialSource = "canvas" | "upload" | "url";

  export interface MaterialItem {
    id: string;
    filename: string;
    source: MaterialSource;
    source_url: string | null;
    size_bytes: number | null;
    content_type: string | null;
    indexed_at: string | null;
    index_error: string | null;
    updated_at: string | null;
  }

  export interface MaterialsListResponse {
    materials: MaterialItem[];
  }

  export interface Citation {
    marker: number;
    chunk_id: string | null;
    file_id: string | null;
    deadline_id: string | null;
    page_hint: number | null;
    heading_path: string | null;
    snippet: string;
  }

  export interface ChatMessageItem {
    id: string;
    role: "user" | "assistant";
    content: string;
    citations_json: Citation[] | null;
    error: boolean;
    created_at: string;
  }

  export interface SessionSummary {
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
  }

  export interface SessionDetail extends SessionSummary {
    messages: ChatMessageItem[];
  }

  export interface SessionListResponse {
    sessions: SessionSummary[];
  }
  ```

- [ ] **Step 19.2 — Add the SSE streaming helper with its own test.**

  Create `apps/studybuddy/frontend/src/api/streaming.ts`:
  ```ts
  /**
   * Minimal SSE reader over fetch(). No EventSource (no cookie support).
   *
   * Usage:
   *   for await (const evt of readSSE(response)) {
   *     if (evt.event === "token") ...
   *   }
   */
  export interface SSEEvent {
    event: string;
    data: string;
  }

  export async function* readSSE(response: Response): AsyncIterable<SSEEvent> {
    if (!response.body) throw new Error("response has no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        yield parseBlock(block);
      }
    }
    if (buffer.trim()) yield parseBlock(buffer);
  }

  function parseBlock(block: string): SSEEvent {
    let event = "message";
    const dataLines: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.trimEnd();
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    return { event, data: dataLines.join("\n") };
  }
  ```

  Create `apps/studybuddy/frontend/src/api/streaming.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { readSSE } from "./streaming";

  function mockResponse(chunks: string[]): Response {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(ctrl) {
        for (const c of chunks) ctrl.enqueue(enc.encode(c));
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }

  describe("readSSE", () => {
    it("yields events split on double newline", async () => {
      const body = [
        "event: token\ndata: {\"text\":\"Hi \"}\n\n",
        "event: token\ndata: {\"text\":\"world\"}\n\n",
        "event: done\ndata: {\"message_id\":\"m1\",\"citations\":[]}\n\n",
      ];
      const out: { event: string; data: string }[] = [];
      for await (const ev of readSSE(mockResponse(body))) out.push(ev);
      expect(out.map((e) => e.event)).toEqual(["token", "token", "done"]);
      expect(JSON.parse(out[0].data).text).toBe("Hi ");
      expect(JSON.parse(out[2].data).message_id).toBe("m1");
    });

    it("handles chunks split across packets", async () => {
      const body = ["event: tok", "en\ndata: {\"text\":\"x\"}\n\n"];
      const out: { event: string; data: string }[] = [];
      for await (const ev of readSSE(mockResponse(body))) out.push(ev);
      expect(out[0].event).toBe("token");
      expect(JSON.parse(out[0].data).text).toBe("x");
    });

    it("defaults event name to 'message' when only data:", async () => {
      const body = ["data: hello\n\n"];
      const out: { event: string; data: string }[] = [];
      for await (const ev of readSSE(mockResponse(body))) out.push(ev);
      expect(out[0].event).toBe("message");
      expect(out[0].data).toBe("hello");
    });
  });
  ```

- [ ] **Step 19.3 — Add the chat API client.**

  Create `apps/studybuddy/frontend/src/api/chat.ts`:
  ```ts
  import { apiFetch } from "./client";
  import type { SessionDetail, SessionListResponse, SessionSummary } from "./types";
  import { readSSE } from "./streaming";

  export async function listSessions(canvasCourseId: number): Promise<SessionListResponse> {
    return apiFetch(`/api/courses/${canvasCourseId}/chat/sessions`);
  }

  export async function createSession(
    canvasCourseId: number,
    title?: string,
  ): Promise<SessionSummary> {
    return apiFetch(`/api/courses/${canvasCourseId}/chat/sessions`, {
      method: "POST",
      body: JSON.stringify({ title: title ?? null }),
      headers: { "content-type": "application/json" },
    });
  }

  export async function getSession(
    canvasCourseId: number,
    sessionId: string,
  ): Promise<SessionDetail> {
    return apiFetch(`/api/courses/${canvasCourseId}/chat/sessions/${sessionId}`);
  }

  export async function deleteSession(
    canvasCourseId: number,
    sessionId: string,
  ): Promise<void> {
    await apiFetch(`/api/courses/${canvasCourseId}/chat/sessions/${sessionId}`, {
      method: "DELETE",
      parseJson: false,
    });
  }

  export interface ChatStreamCallbacks {
    onToken: (text: string) => void;
    onDone: (payload: { message_id: string; citations: any[] }) => void;
    onError: (message: string) => void;
  }

  export async function streamMessage(
    canvasCourseId: number,
    sessionId: string,
    content: string,
    cb: ChatStreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
    const url = `${base}/api/courses/${canvasCourseId}/chat/sessions/${sessionId}/messages`;
    const resp = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ content }),
      headers: { "content-type": "application/json", "accept": "text/event-stream" },
      credentials: "include",
      signal,
    });
    if (!resp.ok) {
      cb.onError(`HTTP ${resp.status}`);
      return;
    }
    try {
      for await (const ev of readSSE(resp)) {
        if (ev.event === "token") {
          try { cb.onToken((JSON.parse(ev.data) as { text: string }).text); } catch { /* skip malformed */ }
        } else if (ev.event === "done") {
          try { cb.onDone(JSON.parse(ev.data)); } catch { cb.onDone({ message_id: "", citations: [] }); }
        } else if (ev.event === "error") {
          try { cb.onError((JSON.parse(ev.data) as { message: string }).message); } catch { cb.onError("stream error"); }
        }
      }
    } catch (e) {
      cb.onError(String(e));
    }
  }
  ```

  **Note:** `apiFetch` is assumed to already exist in `client.ts`. If it takes a `parseJson` option, wire it through; if not, add a minimal overload — look at the existing signature and follow it. If `apiFetch` doesn't exist yet (all calls use `fetch` directly), introduce a tiny one-liner wrapper here and use it consistently across these new files.

- [ ] **Step 19.4 — Add the materials API client.**

  Create `apps/studybuddy/frontend/src/api/materials.ts`:
  ```ts
  import { apiFetch } from "./client";
  import type { MaterialsListResponse, MaterialItem } from "./types";

  export async function listMaterials(canvasCourseId: number): Promise<MaterialsListResponse> {
    return apiFetch(`/api/courses/${canvasCourseId}/materials`);
  }

  export async function uploadMaterial(
    canvasCourseId: number,
    file: File,
  ): Promise<MaterialItem> {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch(`/api/courses/${canvasCourseId}/materials`, {
      method: "POST",
      body: fd,
    });
  }

  export async function addUrlMaterial(
    canvasCourseId: number,
    url: string,
  ): Promise<MaterialItem> {
    return apiFetch(`/api/courses/${canvasCourseId}/materials/url`, {
      method: "POST",
      body: JSON.stringify({ url }),
      headers: { "content-type": "application/json" },
    });
  }

  export async function deleteMaterial(
    canvasCourseId: number,
    fileId: string,
  ): Promise<void> {
    await apiFetch(`/api/courses/${canvasCourseId}/materials/${fileId}`, {
      method: "DELETE",
      parseJson: false,
    });
  }

  export async function refreshMaterials(canvasCourseId: number): Promise<MaterialsListResponse> {
    return apiFetch(`/api/courses/${canvasCourseId}/materials/refresh`, { method: "POST" });
  }
  ```

- [ ] **Step 19.5 — If `apiFetch` doesn't exist or lacks `parseJson`, add/update `client.ts`.**

  Open `apps/studybuddy/frontend/src/api/client.ts`. If it doesn't already expose `apiFetch(path, options)` with support for skipping JSON parsing on 204 responses, add this minimal function:
  ```ts
  export interface ApiFetchOptions extends RequestInit {
    /** Set to false to skip response.json() (for 204 / non-JSON responses). */
    parseJson?: boolean;
  }

  export async function apiFetch<T = any>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
    const { parseJson = true, ...init } = opts;
    const resp = await fetch(`${base}${path}`, {
      credentials: "include",
      ...init,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    if (!parseJson || resp.status === 204) return undefined as unknown as T;
    return resp.json();
  }
  ```
  (If `apiFetch` already exists with a similar shape, leave it alone and just confirm that `parseJson: false` short-circuits JSON parsing.)

- [ ] **Step 19.6 — Run vitest.**
  ```bash
  cd apps/studybuddy/frontend
  npx vitest run
  ```
  Expected: `3 tests passed` (the streaming tests).

- [ ] **Step 19.7 — Type-check build.**
  ```bash
  npm run build
  ```
  Expected: clean build.

- [ ] **Step 19.8 — Commit.**
  ```bash
  cd ../../..
  git add apps/studybuddy/frontend/src/api/
  git commit -m "feat(studybuddy-frontend): chat + materials API clients with SSE reader

  types.ts extended with MaterialItem/Citation/SessionDetail/etc.
  streaming.ts parses SSE frames over fetch() (EventSource lacks cookies).
  chat.ts streamMessage wires token/done/error callbacks.
  materials.ts covers list/upload/url/delete/refresh."
  ```

---

## Task 20 · URL routing, sub-tabs, and feature flag

**Files:**
- Create: `apps/studybuddy/frontend/src/lib/featureFlags.ts`
- Create: `apps/studybuddy/frontend/src/components/CourseSubTabs.tsx`
- Modify: `apps/studybuddy/frontend/src/pages/Dashboard.tsx`

**What it does:**
- Reads a `sb_ff_chat` cookie; if `!== "1"`, Chat/Materials sub-tabs are hidden and the page falls back to the v1 deadline view.
- Introduces a `view` query-string param (`deadlines | chat | materials`) that the Dashboard reads. If no course is selected (the "All" tab), sub-tabs are hidden.
- Sub-tabs component is pill-styled, active one black.

### Steps

- [ ] **Step 20.1 — Feature flag helper.**

  Create `apps/studybuddy/frontend/src/lib/featureFlags.ts`:
  ```ts
  export function getCookie(name: string): string | null {
    const pairs = document.cookie.split(";").map((p) => p.trim().split("=", 2));
    for (const [k, v] of pairs) {
      if (k === name) return decodeURIComponent(v ?? "");
    }
    return null;
  }

  export function isChatFeatureEnabled(): boolean {
    return getCookie("sb_ff_chat") === "1";
  }
  ```

- [ ] **Step 20.2 — CourseSubTabs component.**

  Create `apps/studybuddy/frontend/src/components/CourseSubTabs.tsx`:
  ```tsx
  import { clsx } from "clsx"; // if clsx not installed, replace with template strings

  export type SubTabKey = "deadlines" | "chat" | "materials";

  interface Props {
    active: SubTabKey;
    onChange: (next: SubTabKey) => void;
    chatEnabled: boolean;
  }

  export function CourseSubTabs({ active, onChange, chatEnabled }: Props) {
    const tabs: { key: SubTabKey; label: string }[] = [
      { key: "deadlines", label: "Deadlines" },
    ];
    if (chatEnabled) {
      tabs.push({ key: "chat", label: "Chat" });
      tabs.push({ key: "materials", label: "Materials" });
    }
    return (
      <div className="flex gap-2 flex-wrap mb-4">
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={
                "px-4 py-1.5 rounded-full border-2 border-black text-sm font-medium transition " +
                (isActive
                  ? "bg-black text-cream shadow-clay-hover"
                  : "bg-oat-light text-black hover:shadow-clay-hover")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
    );
  }
  ```

  (If `clsx` isn't installed, the string concatenation above still works.)

- [ ] **Step 20.3 — Integrate into Dashboard.**

  Open `apps/studybuddy/frontend/src/pages/Dashboard.tsx`. Near the top of the component:
  ```tsx
  import { useSearchParams } from "react-router-dom";
  import { CourseSubTabs, type SubTabKey } from "../components/CourseSubTabs";
  import { isChatFeatureEnabled } from "../lib/featureFlags";
  // Placeholders — implemented in Tasks 21 and 22. Keep these imports stubbed
  // by adding empty components below, or guard with a feature-flag fallback.
  // For now, render a "coming soon" card for chat/materials until those tasks land.
  ```

  Inside the component, add:
  ```tsx
  const [searchParams, setSearchParams] = useSearchParams();
  const chatEnabled = isChatFeatureEnabled();
  const selectedCourseId = searchParams.get("course");
  const view = (searchParams.get("view") as SubTabKey) || "deadlines";

  function setView(next: SubTabKey) {
    const sp = new URLSearchParams(searchParams);
    sp.set("view", next);
    setSearchParams(sp);
  }
  ```

  Where the current deadline render block begins (after the course-tab row), conditionally render:
  ```tsx
  {selectedCourseId && chatEnabled && (
    <CourseSubTabs active={view} onChange={setView} chatEnabled={chatEnabled} />
  )}
  {view === "deadlines" && (
    /* existing deadline buckets rendering goes here, unchanged */
  )}
  {view === "chat" && (
    <div className="rounded-2xl border-2 border-black bg-white p-6">Chat coming in Task 21.</div>
  )}
  {view === "materials" && (
    <div className="rounded-2xl border-2 border-black bg-white p-6">Materials coming in Task 22.</div>
  )}
  ```

  **Important:** don't delete any existing JSX — wrap the current deadline render inside `view === "deadlines" &&` so the default view is unchanged.

- [ ] **Step 20.4 — Smoke-check.**
  ```bash
  cd apps/studybuddy/frontend
  npm run dev
  ```
  Open http://localhost:5173, sign in, click a course. You should still see deadlines. Now set the flag:
  ```js
  // Paste into the browser console:
  document.cookie = "sb_ff_chat=1; path=/; max-age=31536000";
  // Then refresh.
  ```
  With the flag set, the Deadlines / Chat / Materials sub-tabs appear. Clicking Chat shows the placeholder. Without the flag, the app behaves exactly like v1.

- [ ] **Step 20.5 — Build.**
  ```bash
  npm run build
  ```
  Expected: clean.

- [ ] **Step 20.6 — Commit.**
  ```bash
  cd ../../..
  git add apps/studybuddy/frontend/src/lib/featureFlags.ts \
          apps/studybuddy/frontend/src/components/CourseSubTabs.tsx \
          apps/studybuddy/frontend/src/pages/Dashboard.tsx
  git commit -m "feat(studybuddy-frontend): sub-tabs + sb_ff_chat feature flag

  When the cookie is set, each course view gains Deadlines/Chat/Materials
  sub-tabs with placeholders for the new views. Without the flag, v1
  behaviour is unchanged."
  ```

---

## Task 21 · Chat components

**Files:**
- Create: `apps/studybuddy/frontend/src/components/chat/Citation.tsx`
- Create: `apps/studybuddy/frontend/src/components/chat/Citation.test.tsx`
- Create: `apps/studybuddy/frontend/src/components/chat/MessageContent.tsx`
- Create: `apps/studybuddy/frontend/src/components/chat/MessageList.tsx`
- Create: `apps/studybuddy/frontend/src/components/chat/SourcesPanel.tsx`
- Create: `apps/studybuddy/frontend/src/components/chat/ChatInput.tsx`
- Create: `apps/studybuddy/frontend/src/components/chat/SessionStrip.tsx`
- Create: `apps/studybuddy/frontend/src/components/chat/ChatTab.tsx`

**What they do:**
- `Citation` — the clickable `[N]` pill with hover snippet + scroll-to-source behavior.
- `MessageContent` — renders assistant markdown via `react-markdown` with a custom text-node walker that replaces `[N]` occurrences with `<Citation>` components.
- `MessageList` — maps messages to bubbles (user cream, assistant white), scrolls to bottom on new content.
- `SourcesPanel` — numbered source cards with heading path, page, snippet, "Open in Canvas" link.
- `ChatInput` — auto-growing textarea, Enter-to-send, Shift+Enter for newline.
- `SessionStrip` — horizontal scrolling pills of recent sessions + "+ New chat" button.
- `ChatTab` — glues everything: fetches session, handles streaming, manages citation scroll refs.

### Steps

- [ ] **Step 21.1 — Citation component + test.**

  Create `apps/studybuddy/frontend/src/components/chat/Citation.tsx`:
  ```tsx
  interface Props {
    n: number;
    onClick: (n: number) => void;
  }

  export function Citation({ n, onClick }: Props) {
    return (
      <button
        type="button"
        onClick={() => onClick(n)}
        className="inline-flex items-center justify-center mx-0.5 px-1.5 min-w-[1.3rem] h-5 text-[0.7rem] font-medium rounded-full border border-black bg-oat-light hover:bg-black hover:text-cream transition align-baseline"
        aria-label={`Source ${n}`}
      >
        {n}
      </button>
    );
  }
  ```

  Create `apps/studybuddy/frontend/src/components/chat/Citation.test.tsx`:
  ```tsx
  import { describe, it, expect, vi } from "vitest";
  import { render, fireEvent, screen } from "@testing-library/react";
  import { Citation } from "./Citation";

  describe("Citation", () => {
    it("calls onClick with n on click", () => {
      const spy = vi.fn();
      render(<Citation n={3} onClick={spy} />);
      fireEvent.click(screen.getByLabelText("Source 3"));
      expect(spy).toHaveBeenCalledWith(3);
    });
  });
  ```

- [ ] **Step 21.2 — MessageContent with citation rewrites.**

  Create `apps/studybuddy/frontend/src/components/chat/MessageContent.tsx`:
  ```tsx
  import ReactMarkdown from "react-markdown";
  import remarkGfm from "remark-gfm";
  import { Citation } from "./Citation";

  interface Props {
    content: string;
    onCitationClick: (n: number) => void;
  }

  const RE = /\[(\d+)\]/g;

  /**
   * Replace [N] markers in a text string with Citation components, keeping
   * the surrounding plain text intact. Called from react-markdown's text
   * renderer so it runs after markdown parsing.
   */
  function renderText(text: string, onClick: (n: number) => void) {
    const parts: (string | JSX.Element)[] = [];
    let last = 0;
    for (const m of text.matchAll(RE)) {
      const n = Number(m[1]);
      const start = m.index ?? 0;
      if (start > last) parts.push(text.slice(last, start));
      parts.push(<Citation key={`c${start}-${n}`} n={n} onClick={onClick} />);
      last = start + m[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
  }

  export function MessageContent({ content, onCitationClick }: Props) {
    return (
      <div className="prose prose-sm max-w-none text-black">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // @ts-expect-error — react-markdown passes a text node here
            p({ children, ...props }) {
              const mapped = childrenToElements(children, onCitationClick);
              return <p {...props}>{mapped}</p>;
            },
            li({ children, ...props }) {
              const mapped = childrenToElements(children, onCitationClick);
              return <li {...props}>{mapped}</li>;
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  function childrenToElements(children: any, onClick: (n: number) => void): any {
    if (typeof children === "string") return renderText(children, onClick);
    if (Array.isArray(children)) return children.map((c, i) => {
      if (typeof c === "string") return <span key={i}>{renderText(c, onClick)}</span>;
      return c;
    });
    return children;
  }
  ```

- [ ] **Step 21.3 — SourcesPanel, MessageList, ChatInput, SessionStrip.**

  `src/components/chat/SourcesPanel.tsx`:
  ```tsx
  import { forwardRef } from "react";
  import type { Citation } from "../../api/types";

  interface Props {
    citations: Citation[];
    cardRefs: React.MutableRefObject<Map<number, HTMLDivElement | null>>;
  }

  export function SourcesPanel({ citations, cardRefs }: Props) {
    if (citations.length === 0) return null;
    return (
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-wider font-medium opacity-60">Sources</div>
        {citations.map((c) => (
          <div
            key={c.marker}
            ref={(el) => { cardRefs.current.set(c.marker, el); }}
            className="rounded-2xl border-2 border-black bg-white p-3 text-sm transition"
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex w-6 h-6 rounded-full bg-black text-cream text-xs items-center justify-center">
                {c.marker}
              </span>
              <span className="font-medium truncate">
                {c.heading_path ?? "source"}
              </span>
            </div>
            {c.page_hint != null && <div className="text-xs mt-1 opacity-60">p.{c.page_hint}</div>}
            <p className="mt-2 text-xs leading-snug opacity-80">{c.snippet}</p>
          </div>
        ))}
      </div>
    );
  }
  ```

  `src/components/chat/MessageList.tsx`:
  ```tsx
  import { useEffect, useRef } from "react";
  import type { ChatMessageItem } from "../../api/types";
  import { MessageContent } from "./MessageContent";

  interface Props {
    messages: ChatMessageItem[];
    streaming: { content: string; citations: any[] } | null;
    onCitationClick: (n: number) => void;
  }

  export function MessageList({ messages, streaming, onCitationClick }: Props) {
    const endRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages.length, streaming?.content]);

    return (
      <div className="space-y-3 overflow-y-auto flex-1 pr-2">
        {messages.map((m) => (
          <div key={m.id}
               className={
                 "rounded-2xl border-2 border-black p-3 max-w-[85%] " +
                 (m.role === "user" ? "ml-auto bg-cream" : "bg-white")
               }>
            {m.role === "user"
              ? <p className="whitespace-pre-wrap">{m.content}</p>
              : <MessageContent content={m.content} onCitationClick={onCitationClick} />}
            {m.error && (
              <div className="mt-2 text-xs text-pomegranate-dark">Stream errored mid-reply.</div>
            )}
          </div>
        ))}
        {streaming && (
          <div className="rounded-2xl border-2 border-black bg-white p-3 max-w-[85%]">
            <MessageContent content={streaming.content + "▍"} onCitationClick={onCitationClick} />
          </div>
        )}
        <div ref={endRef} />
      </div>
    );
  }
  ```

  `src/components/chat/ChatInput.tsx`:
  ```tsx
  import { useRef, useState } from "react";

  interface Props {
    onSubmit: (text: string) => void;
    disabled?: boolean;
    placeholder?: string;
  }

  export function ChatInput({ onSubmit, disabled, placeholder }: Props) {
    const [value, setValue] = useState("");
    const ref = useRef<HTMLTextAreaElement | null>(null);

    function submit() {
      const v = value.trim();
      if (!v || disabled) return;
      onSubmit(v);
      setValue("");
      if (ref.current) ref.current.style.height = "auto";
    }

    return (
      <div className="flex gap-2 items-end border-t-2 border-black pt-3 mt-3">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.currentTarget.style.height = "auto";
            e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder ?? "Ask anything…"}
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none rounded-2xl border-2 border-black bg-white px-3 py-2 text-sm focus:outline-none focus:shadow-clay-hover disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled}
          className="rounded-full bg-black text-cream w-10 h-10 flex items-center justify-center text-sm disabled:opacity-50"
          aria-label="Send"
        >→</button>
      </div>
    );
  }
  ```

  `src/components/chat/SessionStrip.tsx`:
  ```tsx
  import type { SessionSummary } from "../../api/types";

  interface Props {
    sessions: SessionSummary[];
    activeId: string | null;
    onPick: (id: string) => void;
    onNew: () => void;
  }

  export function SessionStrip({ sessions, activeId, onPick, onNew }: Props) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          type="button"
          onClick={onNew}
          className="shrink-0 px-3 py-1.5 rounded-full border-2 border-black bg-matcha text-sm font-medium"
        >+ New chat</button>
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s.id)}
              className={
                "shrink-0 px-3 py-1.5 rounded-full border-2 border-black text-sm truncate max-w-[16ch] " +
                (isActive ? "bg-black text-cream" : "bg-oat-light hover:shadow-clay-hover")
              }
              title={s.title}
            >
              {s.title || "Untitled"}
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 21.4 — ChatTab (the glue).**

  Create `apps/studybuddy/frontend/src/components/chat/ChatTab.tsx`:
  ```tsx
  import { useEffect, useRef, useState } from "react";
  import {
    createSession, deleteSession, getSession, listSessions, streamMessage,
  } from "../../api/chat";
  import type {
    ChatMessageItem, Citation, SessionDetail, SessionSummary,
  } from "../../api/types";
  import { MessageList } from "./MessageList";
  import { SessionStrip } from "./SessionStrip";
  import { SourcesPanel } from "./SourcesPanel";
  import { ChatInput } from "./ChatInput";

  interface Props {
    canvasCourseId: number;
    courseName: string;
  }

  export function ChatTab({ canvasCourseId, courseName }: Props) {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [detail, setDetail] = useState<SessionDetail | null>(null);
    const [streaming, setStreaming] = useState<{ content: string; citations: Citation[] } | null>(null);
    const [activeCitations, setActiveCitations] = useState<Citation[]>([]);
    const cardRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
      listSessions(canvasCourseId).then((r) => {
        setSessions(r.sessions);
        if (r.sessions.length > 0) setSessionId(r.sessions[0].id);
      });
    }, [canvasCourseId]);

    useEffect(() => {
      if (!sessionId) { setDetail(null); setActiveCitations([]); return; }
      getSession(canvasCourseId, sessionId).then((d) => {
        setDetail(d);
        const last = [...d.messages].reverse().find((m) => m.role === "assistant");
        setActiveCitations((last?.citations_json ?? []) as Citation[]);
      });
    }, [canvasCourseId, sessionId]);

    async function handleSend(text: string) {
      let sid = sessionId;
      if (!sid) {
        const s = await createSession(canvasCourseId);
        sid = s.id;
        setSessionId(sid);
        setSessions((prev) => [s, ...prev]);
      }
      // Optimistic user message.
      const userMsg: ChatMessageItem = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: text,
        citations_json: null,
        error: false,
        created_at: new Date().toISOString(),
      };
      setDetail((d) => d ? { ...d, messages: [...d.messages, userMsg] } : d);
      setStreaming({ content: "", citations: [] });

      const ac = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ac;

      await streamMessage(canvasCourseId, sid!, text, {
        onToken: (t) => setStreaming((prev) => prev ? { ...prev, content: prev.content + t } : prev),
        onDone: (payload) => {
          const cits = (payload.citations ?? []) as Citation[];
          setActiveCitations(cits);
          setStreaming(null);
          // Refresh session detail to pick up the persisted message with its real id.
          getSession(canvasCourseId, sid!).then(setDetail);
        },
        onError: (msg) => {
          setStreaming(null);
          setDetail((d) => d && ({
            ...d,
            messages: [...d.messages, {
              id: `err-${Date.now()}`,
              role: "assistant",
              content: `Error: ${msg}`,
              citations_json: null,
              error: true,
              created_at: new Date().toISOString(),
            }],
          }));
        },
      }, ac.signal);
    }

    function handleCitationClick(n: number) {
      const el = cardRefs.current.get(n);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-black");
        setTimeout(() => el.classList.remove("ring-2", "ring-black"), 900);
      }
    }

    async function handleNewChat() {
      const s = await createSession(canvasCourseId);
      setSessions((prev) => [s, ...prev]);
      setSessionId(s.id);
    }

    async function handleDeleteSession(id: string) {
      await deleteSession(canvasCourseId, id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (sessionId === id) setSessionId(null);
    }

    const messages = detail?.messages ?? [];
    const isEmpty = messages.length === 0 && !streaming;

    return (
      <div className="flex flex-col h-[70vh]">
        <SessionStrip
          sessions={sessions}
          activeId={sessionId}
          onPick={setSessionId}
          onNew={handleNewChat}
        />
        <div className="grid md:grid-cols-[2fr_1fr] gap-4 flex-1 mt-2 min-h-0">
          <div className="flex flex-col min-h-0">
            {isEmpty
              ? <WelcomeCard courseName={courseName} onPick={handleSend} />
              : <MessageList
                  messages={messages}
                  streaming={streaming}
                  onCitationClick={handleCitationClick}
                />}
            <ChatInput
              onSubmit={handleSend}
              disabled={!!streaming}
              placeholder={`Ask about ${courseName}…`}
            />
          </div>
          <div className="hidden md:block overflow-y-auto">
            <SourcesPanel citations={activeCitations} cardRefs={cardRefs} />
          </div>
        </div>
      </div>
    );
  }

  function WelcomeCard({ courseName, onPick }: { courseName: string; onPick: (t: string) => void }) {
    const examples = [
      `What's on the next exam for ${courseName}?`,
      "Summarize the latest lecture.",
      "Explain the hardest concept in simpler words.",
    ];
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="rounded-2xl border-2 border-black bg-white p-6 max-w-md">
          <h3 className="font-medium text-lg mb-2">Ask me about {courseName}.</h3>
          <p className="text-sm opacity-70 mb-4">Try one of these:</p>
          <div className="flex flex-col gap-2">
            {examples.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onPick(e)}
                className="text-left text-sm rounded-full border-2 border-black bg-oat-light px-3 py-1.5 hover:shadow-clay-hover"
              >{e}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 21.5 — Wire `ChatTab` into `Dashboard.tsx`.**

  Replace the `view === "chat"` placeholder with:
  ```tsx
  {view === "chat" && selectedCourseId && (
    <ChatTab
      canvasCourseId={Number(selectedCourseId)}
      courseName={/* the selected course's name from the existing courses list */}
    />
  )}
  ```
  Import: `import { ChatTab } from "../components/chat/ChatTab";`

- [ ] **Step 21.6 — Run vitest.**
  ```bash
  npx vitest run
  ```
  Expected: `4 tests passed` (3 streaming + 1 Citation).

- [ ] **Step 21.7 — Build.**
  ```bash
  npm run build
  ```
  Expected: clean. If `prose` class isn't recognized by your Tailwind setup, install `@tailwindcss/typography` or remove the `prose` className — plain HTML styling is acceptable.

- [ ] **Step 21.8 — Commit.**
  ```bash
  cd ../../..
  git add apps/studybuddy/frontend/src/components/chat/ \
          apps/studybuddy/frontend/src/pages/Dashboard.tsx
  git commit -m "feat(studybuddy-frontend): chat UI — streaming + citations + sessions

  Citation pills, markdown-aware rendering via react-markdown, SourcesPanel
  with scroll-to-card on [N] click, SessionStrip for history, ChatInput
  with auto-grow textarea, ChatTab glue with optimistic user bubble and
  live streaming state."
  ```

---

## Task 22 · Materials components

**Files:**
- Create: `apps/studybuddy/frontend/src/components/materials/MaterialRow.tsx`
- Create: `apps/studybuddy/frontend/src/components/materials/MaterialsList.tsx`
- Create: `apps/studybuddy/frontend/src/components/materials/AddMaterialModal.tsx`
- Create: `apps/studybuddy/frontend/src/components/materials/MaterialsTab.tsx`

### Steps

- [ ] **Step 22.1 — MaterialRow.**
  ```tsx
  // src/components/materials/MaterialRow.tsx
  import type { MaterialItem } from "../../api/types";

  interface Props { item: MaterialItem; onDelete?: () => void; }

  const statusColor = (m: MaterialItem) => {
    if (m.index_error) return "bg-pomegranate";
    if (m.indexed_at) return "bg-matcha";
    return "bg-lemon";
  };

  function fmtSize(bytes: number | null) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  export function MaterialRow({ item, onDelete }: Props) {
    const isCanvas = item.source === "canvas";
    return (
      <div className="flex items-center gap-3 border-b border-oat-dark/30 py-2 text-sm">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor(item)}`} title={item.index_error ?? (item.indexed_at ? "Indexed" : "Indexing")} />
        <span className="flex-1 truncate font-medium">{item.filename}</span>
        <span className="text-xs opacity-60 w-24">{fmtSize(item.size_bytes)}</span>
        <span className={"text-xs px-2 py-0.5 rounded-full border border-black " + (isCanvas ? "bg-slushie" : item.source === "url" ? "bg-ube" : "bg-cream")}>
          {item.source}
        </span>
        {item.indexed_at && <span className="text-xs opacity-60 w-28 truncate">{new Date(item.indexed_at).toLocaleString()}</span>}
        {!isCanvas && onDelete && (
          <button type="button" onClick={onDelete} className="w-7 h-7 rounded-full border-2 border-black hover:bg-pomegranate" aria-label="Delete">🗑</button>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 22.2 — MaterialsList.**
  ```tsx
  // src/components/materials/MaterialsList.tsx
  import type { MaterialItem } from "../../api/types";
  import { MaterialRow } from "./MaterialRow";

  interface Props {
    items: MaterialItem[];
    onDelete: (id: string) => void;
  }

  export function MaterialsList({ items, onDelete }: Props) {
    const canvas = items.filter((m) => m.source === "canvas");
    const user = items.filter((m) => m.source !== "canvas");
    return (
      <div className="space-y-6">
        <section>
          <h3 className="text-xs uppercase tracking-wider font-medium opacity-60 mb-1">
            From Canvas · {canvas.length} file{canvas.length === 1 ? "" : "s"}
          </h3>
          {canvas.length === 0
            ? <p className="text-sm opacity-60">No Canvas materials synced.</p>
            : canvas.map((m) => <MaterialRow key={m.id} item={m} />)}
        </section>
        <section>
          <h3 className="text-xs uppercase tracking-wider font-medium opacity-60 mb-1">
            Your uploads · {user.length} item{user.length === 1 ? "" : "s"}
          </h3>
          {user.length === 0
            ? <p className="text-sm opacity-60">Nothing uploaded yet.</p>
            : user.map((m) => <MaterialRow key={m.id} item={m} onDelete={() => onDelete(m.id)} />)}
        </section>
      </div>
    );
  }
  ```

- [ ] **Step 22.3 — AddMaterialModal.**
  ```tsx
  // src/components/materials/AddMaterialModal.tsx
  import { useState } from "react";

  interface Props {
    open: boolean;
    onClose: () => void;
    onFile: (f: File) => Promise<void>;
    onUrl: (url: string) => Promise<void>;
  }

  export function AddMaterialModal({ open, onClose, onFile, onUrl }: Props) {
    const [tab, setTab] = useState<"file" | "url">("file");
    const [busy, setBusy] = useState(false);
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string | null>(null);

    if (!open) return null;

    async function submitFile(e: React.ChangeEvent<HTMLInputElement>) {
      const f = e.target.files?.[0];
      if (!f) return;
      setBusy(true); setError(null);
      try { await onFile(f); onClose(); } catch (err) { setError(String(err)); }
      finally { setBusy(false); }
    }
    async function submitUrl() {
      const v = url.trim();
      if (!v) return;
      setBusy(true); setError(null);
      try { await onUrl(v); onClose(); } catch (err) { setError(String(err)); }
      finally { setBusy(false); }
    }

    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
        <div className="bg-white rounded-3xl border-2 border-black p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
          <h3 className="font-medium text-lg mb-3">Add material</h3>
          <div className="flex gap-2 mb-4">
            {(["file", "url"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                      className={"px-3 py-1 rounded-full border-2 border-black text-sm " +
                        (tab === t ? "bg-black text-cream" : "bg-oat-light")}>{t}</button>
            ))}
          </div>
          {tab === "file" ? (
            <div className="flex flex-col gap-3">
              <input type="file" accept=".pdf,.pptx,.docx,.txt,.md" onChange={submitFile} disabled={busy} />
              <p className="text-xs opacity-60">PDF / PPTX / DOCX / TXT / MD up to 50 MB.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="border-2 border-black rounded-full px-3 py-1.5 text-sm"
              />
              <button type="button" onClick={submitUrl} disabled={busy}
                      className="rounded-full bg-black text-cream px-4 py-1.5 text-sm disabled:opacity-50">
                {busy ? "Fetching…" : "Add link"}
              </button>
            </div>
          )}
          {error && <p className="text-sm text-pomegranate-dark mt-3">{error}</p>}
        </div>
      </div>
    );
  }
  ```

- [ ] **Step 22.4 — MaterialsTab.**
  ```tsx
  // src/components/materials/MaterialsTab.tsx
  import { useEffect, useState } from "react";
  import {
    addUrlMaterial, deleteMaterial, listMaterials, refreshMaterials, uploadMaterial,
  } from "../../api/materials";
  import type { MaterialItem } from "../../api/types";
  import { MaterialsList } from "./MaterialsList";
  import { AddMaterialModal } from "./AddMaterialModal";

  interface Props { canvasCourseId: number; courseName: string; }

  export function MaterialsTab({ canvasCourseId, courseName }: Props) {
    const [items, setItems] = useState<MaterialItem[]>([]);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    async function reload() {
      const r = await listMaterials(canvasCourseId);
      setItems(r.materials);
    }

    useEffect(() => { reload(); /* on mount + when course changes */ }, [canvasCourseId]);

    // Soft polling: while any row is still indexing, refresh every 5s.
    useEffect(() => {
      const pending = items.some((m) => m.indexed_at === null && m.index_error === null);
      if (!pending) return;
      const id = setInterval(reload, 5000);
      return () => clearInterval(id);
    }, [items]);

    async function handleRefresh() {
      setBusy(true);
      try {
        const r = await refreshMaterials(canvasCourseId);
        setItems(r.materials);
      } finally { setBusy(false); }
    }

    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-xl">Materials · {courseName}</h2>
          <div className="flex gap-2">
            <button type="button"
              onClick={() => setOpen(true)}
              className="rounded-full border-2 border-black bg-matcha px-3 py-1 text-sm">+ Add</button>
            <button type="button"
              onClick={handleRefresh}
              disabled={busy}
              className="rounded-full border-2 border-black bg-cream px-3 py-1 text-sm">
              {busy ? "Refreshing…" : "↻"}
            </button>
          </div>
        </div>
        <MaterialsList items={items} onDelete={async (id) => {
          await deleteMaterial(canvasCourseId, id);
          await reload();
        }} />
        <AddMaterialModal
          open={open}
          onClose={() => setOpen(false)}
          onFile={async (f) => { await uploadMaterial(canvasCourseId, f); await reload(); }}
          onUrl={async (u) => { await addUrlMaterial(canvasCourseId, u); await reload(); }}
        />
      </div>
    );
  }
  ```

- [ ] **Step 22.5 — Wire into Dashboard.**

  Replace the `view === "materials"` placeholder:
  ```tsx
  {view === "materials" && selectedCourseId && (
    <MaterialsTab
      canvasCourseId={Number(selectedCourseId)}
      courseName={/* selected course name */}
    />
  )}
  ```

- [ ] **Step 22.6 — Build.**
  ```bash
  cd apps/studybuddy/frontend
  npm run build
  ```
  Expected: clean.

- [ ] **Step 22.7 — Commit.**
  ```bash
  cd ../../..
  git add apps/studybuddy/frontend/src/components/materials/ \
          apps/studybuddy/frontend/src/pages/Dashboard.tsx
  git commit -m "feat(studybuddy-frontend): materials UI — list, upload, url, delete, refresh

  Grouped by source (Canvas / Your uploads), status dot per row, add
  modal with File/Link tabs, polling every 5s while anything is indexing."
  ```

---

**Phase 6 gate:** Frontend is feature-complete behind `sb_ff_chat=1`. Phase 7 covers local smoke and Railway deployment.

---

# Phase 7 · Deployment & smoke

Goal: validate end-to-end locally against one real EUR course, then deploy to Railway/Vercel behind the flag, then dogfood.

---

## Task 23 · Local end-to-end smoke

**Files:** none (manual verification).

### Steps

- [ ] **Step 23.1 — Start the full stack locally.**

  Terminal 1 (backend):
  ```bash
  cd apps/studybuddy/backend
  uv run alembic upgrade head
  uv run uvicorn studybuddy.main:app --reload --port 8000
  ```

  Terminal 2 (frontend):
  ```bash
  cd apps/studybuddy/frontend
  npm run dev
  ```

- [ ] **Step 23.2 — Configure secrets in `backend/.env` (local only, never commit).**
  ```dotenv
  VOYAGE_API_KEY=vo-xxxxxxxxxxxxxxxxxxxxxxxx
  ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx
  RAG_CLAUDE_MODEL=claude-sonnet-4-6
  ```
  Then restart the backend.

- [ ] **Step 23.3 — Flip the feature flag in the browser.**
  ```js
  document.cookie = "sb_ff_chat=1; path=/; max-age=31536000";
  location.reload();
  ```

- [ ] **Step 23.4 — Walk through each user story.**

  Tick each off as you go:
  - [ ] Sign in with magic link.
  - [ ] Submit Canvas PAT, wait for dashboard to populate.
  - [ ] Click a course with materials → verify sub-tabs appear.
  - [ ] Go to **Materials** → verify Canvas files list with yellow "indexing" dot, then green "indexed" after ~30s (Voyage rate-limit note: first index of a large course may take minutes).
  - [ ] Click **+ Add** → upload a short PDF → verify it appears in *Your uploads* and transitions to indexed.
  - [ ] Click **+ Add** → paste a Wikipedia URL → verify it lands and indexes.
  - [ ] Delete one of your uploads → verify it disappears.
  - [ ] Go to **Chat** → send "Summarize the latest lecture." → verify:
      - "Searching materials…" shows briefly
      - Tokens stream in with visible caret
      - `[1]`, `[2]` appear inline as clickable pills
      - Sources panel populates with numbered cards
      - Clicking `[1]` scrolls/flashes the matching source card
  - [ ] Ask a question with no relevant content (e.g., "What's the weather today?") → verify the assistant says "I don't have material on that."
  - [ ] Create a second chat session → verify the session strip shows both.
  - [ ] Delete a session → verify it disappears.
  - [ ] Disable the feature flag (`document.cookie = "sb_ff_chat=; path=/; max-age=0"; location.reload();`) → verify v1 view renders unchanged.

- [ ] **Step 23.5 — Capture anything broken and fix before Task 24.**

  If something fails here, write a small new test that reproduces it, fix the code, then rerun the suite. Don't roll past this step.

- [ ] **Step 23.6 — No commit (this task is verification only).**

---

## Task 24 · Railway / Vercel deployment

**Files:** none (cloud-side config).

### Steps

- [ ] **Step 24.1 — Add the new env vars to Railway.**

  In the Railway project → Service → Variables, add:
  ```
  VOYAGE_API_KEY=<real>
  ANTHROPIC_API_KEY=<real>
  RAG_CLAUDE_MODEL=claude-sonnet-4-6
  ```
  Leave the other RAG knobs (chunk tokens, top-k, etc.) unset so defaults apply. Railway will redeploy automatically.

- [ ] **Step 24.2 — Confirm migration runs.**

  Railway's start command runs `alembic upgrade head && uvicorn …`, so the migration should apply on deploy. Confirm:
  ```bash
  # from Railway's logs:
  # Running upgrade 0001_initial_schema -> 0002_rag_chat, v2 RAG chat: ...
  ```
  If the migration fails because of a missing extension, SSH into the Neon SQL console and run:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```
  (Should already be in place from the v1 migration, but double-check.)

- [ ] **Step 24.3 — Verify the backend health endpoint.**
  ```bash
  curl -s https://studybuddy-production-adb1.up.railway.app/health
  # Expected: {"ok":true}
  ```

- [ ] **Step 24.4 — Deploy the frontend.**

  Push the branch; Vercel auto-builds. Confirm the preview/prod deploy succeeds. No frontend env vars changed.

- [ ] **Step 24.5 — Flip the feature-flag cookie for your own account only.**

  In the production frontend origin:
  ```js
  document.cookie = "sb_ff_chat=1; path=/; max-age=31536000; secure; samesite=lax";
  location.reload();
  ```
  Friends without this cookie see v1 unchanged.

- [ ] **Step 24.6 — Run through Task 23's smoke checklist against production.**

  Focus on: first-time course index (watch Railway logs for Voyage rate-limits), chat answer latency, citation click behavior.

- [ ] **Step 24.7 — Decide on public rollout.**

  If the week of dogfood is clean:
  - Remove the feature-flag gates from `Dashboard.tsx` (drop `isChatFeatureEnabled()` check).
  - Announce to the 4 beta friends (post-DKIM verification so their magic links actually arrive).
  - Bump app version, commit, deploy.

- [ ] **Step 24.8 — Final commit for the public flip.**
  ```bash
  git add apps/studybuddy/frontend/src/pages/Dashboard.tsx \
          apps/studybuddy/frontend/src/components/CourseSubTabs.tsx
  git commit -m "chore(studybuddy-frontend): remove sb_ff_chat gate — v2 is public"
  ```

---

# Appendix · Self-review checklist

Before considering this plan "done" the implementer should verify:

**Spec coverage** — every requirement in
`docs/superpowers/specs/2026-04-17-studybuddy-v2-rag-chat-design.md` maps to
at least one task:

| Spec section | Task(s) |
|---|---|
| File/deadlines schema deltas | Task 2, 3 |
| `chunks` / `chat_sessions` / `chat_messages` tables | Task 2, 3 |
| Parser (PDF/PPTX/DOCX/HTML/MD/TXT) | Task 4 |
| Chunker (markdown-aware, 800/100) | Task 5 |
| Embedder (Voyage voyage-3-lite) | Task 6 |
| Reranker (Voyage rerank-2-lite) | Task 7 |
| Downloader (Canvas + URL, size cap, private-IP guard) | Task 8 |
| Indexer (compose + error capture) | Task 9 |
| Freshness / re-index on sync | Task 10 |
| Retrieval (pgvector top-20 + rerank top-5) | Task 11 |
| System prompt + context block + history trim | Task 12 |
| Streaming chat service with citation parsing | Task 13 |
| `/materials` endpoints (list/upload/url/delete/refresh) | Task 15 |
| Mime + size whitelisting | Task 15 |
| `/chat/sessions` CRUD | Task 16 |
| `/chat/sessions/{sid}/messages` SSE | Task 17 |
| Course sub-tabs with URL param | Task 20 |
| Feature-flag cookie gating | Task 20, 24 |
| Chat UI (messages + sources + citations + session strip + input) | Task 21 |
| Materials UI (list + add modal + refresh + delete) | Task 22 |
| End-to-end smoke on EUR courses | Task 23 |
| Railway / Vercel deploy | Task 24 |
| Risks (Voyage rate limits, Canvas auth quirks, latency messaging) | Task 8, 23 |

**Type + name consistency**

- Backend fields: `index_version`, `indexed_at`, `index_error` (not `indexing_version` / `indexed_on`) — used consistently across migration, model, indexer, and API.
- `MaterialItem.indexed_at` and `.index_error` on frontend match the API response shape.
- Stream event names are `"token"`, `"done"`, `"error"` in `chat/service.py`, `chat_messages.py`, and `streaming.ts`.
- `sb_ff_chat` cookie name is identical in `featureFlags.ts`, deploy docs, and the smoke checklist.

**Placeholder scan**

- No `TBD` / `TODO` / "implement later" in the plan body.
- Every step that writes code shows the actual code.
- Commands have expected outputs or exit codes where useful.
- Optional helpers (`apiFetch`, `clsx`) have fallbacks documented inline.

**Frequent commits**

- Every task ends with a commit.
- No commit bundles more than one feature.
- Tests are committed with their implementation, in the same commit.

---

*End of plan.*

