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
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/users/self",
        json={"id": 42, "name": "Test"},
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?enrollment_state=active",
        json=[],
    )

    resp = await authed_client.post("/api/onboarding/pat", json={"pat": "valid_pat"})
    assert resp.status_code == 200

    user = (await db.execute(select(User))).scalar_one()
    assert user.pat_encrypted is not None
    assert user.pat_nonce is not None
