import pytest
from studybuddy.canvas.client import CanvasClient, CanvasUnauthorized


@pytest.mark.asyncio
async def test_get_single_page(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses",
        json=[{"id": 1, "name": "Algorithms"}],
        status_code=200,
    )
    c = CanvasClient(base_url="canvas.eur.nl", token="t")
    results = await c.get_paginated("/api/v1/courses")
    assert results == [{"id": 1, "name": "Algorithms"}]


@pytest.mark.asyncio
async def test_get_paginated_follows_link_header(httpx_mock):
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses",
        json=[{"id": 1}],
        status_code=200,
        headers={"Link": '<https://canvas.eur.nl/api/v1/courses?page=2>; rel="next"'},
    )
    httpx_mock.add_response(
        method="GET",
        url="https://canvas.eur.nl/api/v1/courses?page=2",
        json=[{"id": 2}],
        status_code=200,
    )
    c = CanvasClient(base_url="canvas.eur.nl", token="t")
    results = await c.get_paginated("/api/v1/courses")
    assert [r["id"] for r in results] == [1, 2]


@pytest.mark.asyncio
async def test_401_raises_canvas_unauthorized(httpx_mock):
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/users/self", status_code=401)
    c = CanvasClient(base_url="canvas.eur.nl", token="bad")
    with pytest.raises(CanvasUnauthorized):
        await c.get_paginated("/api/v1/users/self")


@pytest.mark.asyncio
async def test_retries_on_5xx_then_succeeds(httpx_mock):
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses", status_code=500)
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses", status_code=502)
    httpx_mock.add_response(method="GET", url="https://canvas.eur.nl/api/v1/courses", json=[{"id": 1}], status_code=200)
    c = CanvasClient(base_url="canvas.eur.nl", token="t", retry_delays=[0, 0, 0])
    results = await c.get_paginated("/api/v1/courses")
    assert results == [{"id": 1}]
