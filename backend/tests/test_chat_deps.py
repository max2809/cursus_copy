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
