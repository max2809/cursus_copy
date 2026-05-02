import pytest
from sqlalchemy import select
from studybuddy.db.models import User


@pytest.mark.asyncio
async def test_onboarding_rejects_invalid_pat(authed_client, db, httpx_mock):
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
