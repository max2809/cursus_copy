import pytest

from studybuddy.canvas.domains import (
    InvalidCanvasHost,
    normalize_canvas_base_url,
    validate_canvas_host,
)


def test_normalize_accepts_host_and_https_url():
    assert normalize_canvas_base_url("Canvas.Example.EDU") == "canvas.example.edu"
    assert (
        normalize_canvas_base_url("https://canvas.example.edu/profile/settings")
        == "canvas.example.edu"
    )
    assert (
        normalize_canvas_base_url(" school.instructure.com ")
        == "school.instructure.com"
    )


@pytest.mark.parametrize(
    "value",
    [
        "",
        "http://canvas.example.edu",
        "https://user@canvas.example.edu",
        "https://canvas.example.edu:8443",
        "localhost",
        "canvas",
        "127.0.0.1",
        "::1",
        "school.local",
        "canvas.internal",
    ],
)
def test_normalize_rejects_invalid_or_unsafe_hosts(value):
    with pytest.raises(InvalidCanvasHost):
        normalize_canvas_base_url(value)


@pytest.mark.asyncio
async def test_validate_rejects_private_dns_results(monkeypatch):
    async def fake_resolve(host: str) -> list[str]:
        return ["10.0.0.5"]

    monkeypatch.setattr("studybuddy.canvas.domains._resolve_host_ips", fake_resolve)

    with pytest.raises(InvalidCanvasHost):
        await validate_canvas_host("canvas.example.edu")


@pytest.mark.asyncio
async def test_validate_returns_public_host(monkeypatch):
    async def fake_resolve(host: str) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr("studybuddy.canvas.domains._resolve_host_ips", fake_resolve)

    assert (
        await validate_canvas_host("https://Canvas.Example.EDU/path")
        == "canvas.example.edu"
    )
