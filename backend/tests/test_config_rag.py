import pytest
from studybuddy.config import Settings


def test_rag_defaults_load(monkeypatch):
    """RAG knobs have sensible defaults and are typed correctly."""
    # Zero out any real values the dev .env might inject.
    for var in ("RAG_CHUNK_TOKENS", "RAG_CHUNK_OVERLAP", "RAG_TOP_K_RECALL",
                "RAG_TOP_K_RERANK", "RAG_MAX_UPLOAD_MB", "RAG_CLAUDE_MODEL",
                "VOYAGE_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("STUDYBUDDY_MASTER_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    monkeypatch.setenv("SESSION_SIGNING_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    s = Settings(_env_file=None)
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
    s = Settings(_env_file=None)
    assert s.rag_chunk_tokens == 512
    assert s.rag_top_k_recall == 10
    assert s.voyage_api_key == "vo-test"
