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
