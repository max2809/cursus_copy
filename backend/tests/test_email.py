import pytest
from studybuddy.email.resend_client import ResendClient


@pytest.mark.asyncio
async def test_sends_post_to_resend_api(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.resend.com/emails",
        json={"id": "email_123"},
        status_code=200,
    )
    client = ResendClient(api_key="test_key", default_from="Test <test@x.com>")
    result = await client.send_magic_link("user@eur.nl", "https://app/verify?token=abc")
    assert result["id"] == "email_123"


@pytest.mark.asyncio
async def test_raises_on_non_2xx(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.resend.com/emails",
        json={"error": "bad key"},
        status_code=401,
    )
    client = ResendClient(api_key="bad", default_from="Test <test@x.com>")
    with pytest.raises(Exception):
        await client.send_magic_link("user@eur.nl", "https://app/verify?token=abc")
