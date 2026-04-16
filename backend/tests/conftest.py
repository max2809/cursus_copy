import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool
from studybuddy.db.base import Base
from studybuddy.main import create_app


# Use an in-memory SQLite DB for tests. Production uses Postgres (Neon), but
# tests exercise CRUD and business logic only — no pgvector, no PG-specific
# features. SQLite via aiosqlite avoids the Windows ProactorEventLoop +
# asyncpg teardown issues and is much faster for unit tests.
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture
async def test_engine():
    # StaticPool + single shared connection so the :memory: DB is the same
    # across all checkouts within one test. New engine per test = clean slate.
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(test_engine):
    Session = async_sessionmaker(test_engine, expire_on_commit=False)
    session = Session()
    try:
        yield session
    finally:
        await session.rollback()
        await session.close()


@pytest_asyncio.fixture
async def client(db):
    from studybuddy.db.base import get_db

    app = create_app()

    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def authed_client(client, db):
    """Client with a logged-in user."""
    from studybuddy.db.models import User
    from studybuddy.auth.session import create_session

    user = User(email="u@eur.nl")
    db.add(user)
    await db.commit()

    session_token = await create_session(db, user)
    await db.commit()
    client.cookies.set("sb_session", session_token)
    return client
