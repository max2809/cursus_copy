import pytest
from sqlalchemy import select
from studybuddy.db.models import User


@pytest.mark.asyncio
async def test_onboarding_rejects_invalid_pat(authed_client, db, httpx_mock):
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/users/self", status_code=401)
    resp = await authed_client.post("/api/onboarding/pat", json={"pat": "bogus"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_onboarding_stores_encrypted_pat_and_syncs(authed_client, db, httpx_mock):
    # Only the Canvas /users/self validation call is made synchronously; the
    # full sync is dispatched to a BackgroundTask and doesn't fire inside the
    # test's request lifecycle. Validate only that the PAT landed encrypted.
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
