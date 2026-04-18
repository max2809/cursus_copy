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
