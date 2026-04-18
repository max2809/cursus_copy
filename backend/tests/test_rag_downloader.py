import pytest
from studybuddy.rag.downloader import (
    download_canvas_file, fetch_url, DownloadTooLarge, DownloadError,
)


@pytest.mark.asyncio
async def test_canvas_file_download_happy_path(httpx_mock):
    # Step 1: Canvas metadata call.
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/files/500",
        json={
            "id": 500,
            "display_name": "lec3.pdf",
            "url": "https://signed.cloudfront.example.com/lec3.pdf?token=x",
            "content-type": "application/pdf",
            "size": 1024,
        },
    )
    # Step 2: follow the signed URL (no auth header).
    httpx_mock.add_response(
        method="GET",
        url="https://signed.cloudfront.example.com/lec3.pdf?token=x",
        content=b"%PDF-1.4 stub",
        headers={"content-type": "application/pdf"},
    )
    raw, ct, name = await download_canvas_file(
        canvas_base_url="canvas.eur.nl",
        pat="pat-123",
        canvas_file_id=500,
        max_bytes=10 * 1024 * 1024,
    )
    assert raw.startswith(b"%PDF")
    assert ct == "application/pdf"
    assert name == "lec3.pdf"


@pytest.mark.asyncio
async def test_canvas_download_too_large(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/files/501",
        json={
            "id": 501, "display_name": "huge.pdf",
            "url": "https://x.example/huge.pdf",
            "content-type": "application/pdf",
            "size": 200 * 1024 * 1024,
        },
    )
    with pytest.raises(DownloadTooLarge):
        await download_canvas_file(
            canvas_base_url="canvas.eur.nl",
            pat="pat",
            canvas_file_id=501,
            max_bytes=50 * 1024 * 1024,
        )


@pytest.mark.asyncio
async def test_fetch_url_html(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://en.wikipedia.org/wiki/Gini_coefficient",
        content=b"<html><body><article><p>About Gini</p></article></body></html>",
        headers={"content-type": "text/html; charset=utf-8"},
    )
    raw, ct, name = await fetch_url("https://en.wikipedia.org/wiki/Gini_coefficient", max_bytes=10_000_000)
    assert b"Gini" in raw
    assert ct.startswith("text/html")
    assert name == "Gini_coefficient"


@pytest.mark.asyncio
async def test_fetch_url_rejects_non_http():
    with pytest.raises(DownloadError, match="http"):
        await fetch_url("ftp://example.com/file.pdf", max_bytes=1_000_000)


@pytest.mark.asyncio
async def test_fetch_url_rejects_private_ip():
    with pytest.raises(DownloadError, match="private"):
        await fetch_url("http://127.0.0.1/secret", max_bytes=1_000_000)
