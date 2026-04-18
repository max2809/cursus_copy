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
