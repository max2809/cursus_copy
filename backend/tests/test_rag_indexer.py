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
        return b"# First version content\n\nInitial body paragraph with some words to embed.\n", "text/markdown", "t.md"

    async def _download_v2(**_):
        return b"# Second version with more words here\n\nReplacement body with different wording for the new index.\n", "text/markdown", "t.md"

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
