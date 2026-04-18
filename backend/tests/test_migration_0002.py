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
    # Range semantics: "<from>:<to>" renders SQL for going FROM <from> TO <to>,
    # so to render 0002 we start AT 0001 (pre-0002 state) and go to head.
    res = _alembic("upgrade", "0001:head", "--sql")
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
