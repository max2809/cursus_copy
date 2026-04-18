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
