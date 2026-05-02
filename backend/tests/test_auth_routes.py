import re
import pytest
from sqlalchemy import select
from studybuddy.db.models import User, MagicLinkToken, Session as SessionModel
from studybuddy.auth.session import create_session


@pytest.mark.asyncio
async def test_magic_link_returns_ok_for_unknown_email(client, httpx_mock):
    resp = await client.post("/api/auth/magic-link", json={"email": "nobody@eur.nl"})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


@pytest.mark.asyncio
async def test_magic_link_sends_email_for_known_email(client, db, httpx_mock):
    httpx_mock.add_response(
        method="POST", url="https://api.resend.com/emails",
        json={"id": "e"}, status_code=200,
    )
    db.add(User(email="a@eur.nl"))
    await db.commit()

    resp = await client.post("/api/auth/magic-link", json={"email": "a@eur.nl"})
    assert resp.status_code == 200

    rows = (await db.execute(select(MagicLinkToken))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_magic_link_lookup_is_case_insensitive(client, db, httpx_mock):
    httpx_mock.add_response(
        method="POST", url="https://api.resend.com/emails",
        json={"id": "e"}, status_code=200,
    )
    db.add(User(email="a@eur.nl"))
    await db.commit()

    resp = await client.post("/api/auth/magic-link", json={"email": "A@eur.nl"})
    assert resp.status_code == 200

    rows = (await db.execute(select(MagicLinkToken))).scalars().all()
    assert len(rows) == 1, "uppercase local-part should still match the lowercase row"


@pytest.mark.asyncio
async def test_verify_creates_session_cookie(client, db, httpx_mock):
    httpx_mock.add_response(
        method="POST", url="https://api.resend.com/emails",
        json={"id": "e"}, status_code=200,
    )
    db.add(User(email="a@eur.nl"))
    await db.commit()
    await client.post("/api/auth/magic-link", json={"email": "a@eur.nl"})

    sent = httpx_mock.get_request().content.decode()
    token = re.search(r"token=([A-Za-z0-9_-]+)", sent).group(1)

    resp = await client.post("/api/auth/verify", json={"token": token})
    assert resp.status_code == 200
    assert resp.json()["next"] == "/onboarding"
    assert "sb_session" in resp.cookies


@pytest.mark.asyncio
async def test_verify_rejects_bad_token(client):
    resp = await client.post("/api/auth/verify", json={"token": "not_real"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_logout_clears_cookie(client, db, httpx_mock):
    httpx_mock.add_response(
        method="POST", url="https://api.resend.com/emails",
        json={"id": "e"}, status_code=200,
    )
    db.add(User(email="a@eur.nl"))
    await db.commit()
    await client.post("/api/auth/magic-link", json={"email": "a@eur.nl"})
    sent = httpx_mock.get_request().content.decode()
    token = re.search(r"token=([A-Za-z0-9_-]+)", sent).group(1)
    await client.post("/api/auth/verify", json={"token": token})

    resp = await client.delete("/api/auth/session")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_me_returns_authenticated_account_state(client, db):
    user = User(
        email="a@eur.nl",
        canvas_base_url="canvas.other.edu",
        pat_encrypted=b"ciphertext",
        pat_nonce=b"nonce",
    )
    db.add(user)
    await db.commit()
    session_token = await create_session(db, user)
    await db.commit()
    client.cookies.set("sb_session", session_token)

    resp = await client.get("/api/auth/me")

    assert resp.status_code == 200
    assert resp.json() == {
        "email": "a@eur.nl",
        "canvas_base_url": "canvas.other.edu",
        "has_pat": True,
    }
