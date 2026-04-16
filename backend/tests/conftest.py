import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from studybuddy.db.base import Base
from studybuddy.main import create_app


TEST_DATABASE_URL = "postgresql+asyncpg://studybuddy:studybuddy@localhost:5432/studybuddy_test"


@pytest_asyncio.fixture(scope="session")
async def test_engine():
    # Ensure the test database exists, creating it if needed.
    admin_engine = create_async_engine(
        "postgresql+asyncpg://studybuddy:studybuddy@localhost:5432/postgres",
        isolation_level="AUTOCOMMIT",
    )
    async with admin_engine.connect() as conn:
        exists = (await conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname='studybuddy_test'")
        )).scalar()
        if not exists:
            await conn.execute(text("CREATE DATABASE studybuddy_test"))
    await admin_engine.dispose()

    engine = create_async_engine(TEST_DATABASE_URL, future=True)
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(test_engine):
    Session = async_sessionmaker(test_engine, expire_on_commit=False)
    async with Session() as session:
        yield session
    # Wipe all tables between tests (previous session may have committed).
    async with test_engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            await conn.execute(text(f'TRUNCATE "{table.name}" RESTART IDENTITY CASCADE'))


@pytest_asyncio.fixture
async def client(db):
    from studybuddy.db.base import get_db

    app = create_app()

    async def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
