import pytest
from sqlalchemy import select
from studybuddy.db.models import User


@pytest.mark.asyncio
async def test_onboarding_rejects_invalid_pat(authed_client, db, httpx_mock, monkeypatch):
    from studybuddy.api import onboarding as onboarding_mod

    async def fake_validate(host):
        return "canvas.eur.nl"

    monkeypatch.setattr(onboarding_mod, "validate_canvas_host", fake_validate)

    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/users/self", status_code=401)
    resp = await authed_client.post("/api/onboarding/pat", json={"pat": "bogus"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_onboarding_stores_encrypted_pat_and_syncs(authed_client, db, httpx_mock, monkeypatch):
    # Starlette runs BackgroundTasks before the test client returns the
    # response. Keep this endpoint test isolated from the full Canvas sync and
    # assert the background task is scheduled.
    sync_calls = []

    async def fake_sync(user_id, master_key):
        sync_calls.append((user_id, master_key))

    from studybuddy.api import onboarding as onboarding_mod
    monkeypatch.setattr(onboarding_mod, "sync_and_index_background", fake_sync)

    async def fake_validate(host):
        return "canvas.eur.nl"

    monkeypatch.setattr(onboarding_mod, "validate_canvas_host", fake_validate)

    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/users/self",
        json={"id": 42, "name": "Test"},
    )

    resp = await authed_client.post("/api/onboarding/pat", json={"pat": "valid_pat"})
    assert resp.status_code == 200

    # Expire the cached user row so we see the committed changes.
    db.expire_all()
    user = (await db.execute(select(User))).scalar_one()
    assert user.pat_encrypted is not None
    assert user.pat_nonce is not None
    assert len(sync_calls) == 1
    assert sync_calls[0][0] == user.id


@pytest.mark.asyncio
async def test_onboarding_validates_against_submitted_canvas_host_and_saves_it(
    authed_client, db, httpx_mock, monkeypatch
):
    sync_calls = []

    async def fake_sync(user_id, master_key):
        sync_calls.append((user_id, master_key))

    async def fake_validate(host):
        assert host == "https://Canvas.Other.EDU/profile/settings"
        return "canvas.other.edu"

    from studybuddy.api import onboarding as onboarding_mod

    monkeypatch.setattr(onboarding_mod, "sync_and_index_background", fake_sync)
    monkeypatch.setattr(onboarding_mod, "validate_canvas_host", fake_validate, raising=False)

    httpx_mock.add_response(
        method="GET",
        url="https://canvas.other.edu/api/v1/users/self",
        json={"id": 42, "name": "Other Canvas"},
    )

    resp = await authed_client.post(
        "/api/onboarding/pat",
        json={
            "pat": "valid_pat",
            "canvas_base_url": "https://Canvas.Other.EDU/profile/settings",
        },
    )

    assert resp.status_code == 200
    db.expire_all()
    user = (await db.execute(select(User))).scalar_one()
    assert user.canvas_base_url == "canvas.other.edu"
    assert user.pat_encrypted is not None
    assert len(sync_calls) == 1


@pytest.mark.asyncio
async def test_onboarding_missing_canvas_host_uses_saved_host(
    authed_client, db, httpx_mock, monkeypatch
):
    user = (await db.execute(select(User))).scalar_one()
    user.canvas_base_url = "canvas.saved.edu"
    await db.commit()

    async def fake_sync(user_id, master_key):
        return None

    async def fake_validate(host):
        assert host == "canvas.saved.edu"
        return "canvas.saved.edu"

    from studybuddy.api import onboarding as onboarding_mod

    monkeypatch.setattr(onboarding_mod, "sync_and_index_background", fake_sync)
    monkeypatch.setattr(onboarding_mod, "validate_canvas_host", fake_validate, raising=False)

    httpx_mock.add_response(
        method="GET",
        url="https://canvas.saved.edu/api/v1/users/self",
        json={"id": 42, "name": "Saved Canvas"},
    )

    resp = await authed_client.post("/api/onboarding/pat", json={"pat": "valid_pat"})

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_onboarding_rejects_invalid_canvas_host_before_calling_canvas(
    authed_client, monkeypatch
):
    from studybuddy.api import onboarding as onboarding_mod
    from studybuddy.canvas.domains import InvalidCanvasHost

    async def fake_validate(host):
        raise InvalidCanvasHost("Invalid Canvas domain")

    monkeypatch.setattr(onboarding_mod, "validate_canvas_host", fake_validate, raising=False)

    resp = await authed_client.post(
        "/api/onboarding/pat",
        json={"pat": "valid_pat", "canvas_base_url": "localhost"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid Canvas domain"
