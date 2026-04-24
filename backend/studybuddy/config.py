import base64
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+asyncpg://studybuddy:studybuddy@localhost:5432/studybuddy"
    studybuddy_master_key: str = ""
    session_signing_key: str = ""
    resend_api_key: str = ""
    resend_from: str = "Cursus <noreply@cursus.me>"
    magic_link_base_url: str = "http://localhost:5173"
    frontend_origin: str = "http://localhost:5173"
    canvas_base_url: str = "canvas.eur.nl"
    cookie_secure: bool = False  # set True in production (HTTPS only)

    # RAG / chat
    voyage_api_key: str = ""
    anthropic_api_key: str = ""
    rag_chunk_tokens: int = 800
    rag_chunk_overlap: int = 100
    rag_top_k_recall: int = 20
    rag_top_k_rerank: int = 5
    rag_max_upload_mb: int = 50
    rag_claude_model: str = "claude-sonnet-4-6"
    rag_rewriter_model: str = "claude-haiku-4-5-20251001"

    def master_key_bytes(self) -> bytes:
        raw = base64.b64decode(self.studybuddy_master_key)
        if len(raw) != 32:
            raise ValueError("STUDYBUDDY_MASTER_KEY must decode to exactly 32 bytes")
        return raw

    def session_signing_key_bytes(self) -> bytes:
        raw = base64.b64decode(self.session_signing_key)
        if len(raw) != 32:
            raise ValueError("SESSION_SIGNING_KEY must decode to exactly 32 bytes")
        return raw


@lru_cache
def get_settings() -> Settings:
    return Settings()
