import pytest
from studybuddy.rag.embedder import VoyageEmbedder


@pytest.mark.asyncio
async def test_embed_batches_under_limit(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.voyageai.com/v1/embeddings",
        json={
            "data": [{"embedding": [0.1] * 512}, {"embedding": [0.2] * 512}],
            "model": "voyage-3-lite",
            "usage": {"total_tokens": 10},
        },
    )
    e = VoyageEmbedder(api_key="vo-test")
    out = await e.embed(["hello", "world"], input_type="document")
    assert len(out) == 2
    assert len(out[0]) == 512
    assert out[0][0] == pytest.approx(0.1)
    assert out[1][0] == pytest.approx(0.2)


@pytest.mark.asyncio
async def test_embed_batches_large_input_to_multiple_requests(httpx_mock):
    # 120 inputs, batch size 50 -> three requests of 50/50/20.
    for batch in (50, 50, 20):
        httpx_mock.add_response(
            method="POST",
            url="https://api.voyageai.com/v1/embeddings",
            json={
                "data": [{"embedding": [float(i)] * 512} for i in range(batch)],
                "model": "voyage-3-lite",
                "usage": {"total_tokens": batch},
            },
        )
    e = VoyageEmbedder(api_key="vo-test", batch_size=50)
    out = await e.embed(["t"] * 120, input_type="document")
    assert len(out) == 120
    assert len(out[0]) == 512


@pytest.mark.asyncio
async def test_embed_retries_on_429(httpx_mock):
    # First call 429 -> retry -> 200
    httpx_mock.add_response(
        method="POST",
        url="https://api.voyageai.com/v1/embeddings",
        status_code=429,
        headers={"retry-after": "0"},
    )
    httpx_mock.add_response(
        method="POST",
        url="https://api.voyageai.com/v1/embeddings",
        json={"data": [{"embedding": [0.5] * 512}], "model": "voyage-3-lite", "usage": {}},
    )
    e = VoyageEmbedder(api_key="vo-test", max_retries=2, base_delay_s=0)
    out = await e.embed(["x"], input_type="document")
    assert out[0][0] == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_embed_query_uses_query_input_type(httpx_mock):
    def _assert_body(request):
        import json
        body = json.loads(request.content)
        assert body["input_type"] == "query"
        return True

    httpx_mock.add_response(
        method="POST",
        url="https://api.voyageai.com/v1/embeddings",
        match_content=None,
        json={"data": [{"embedding": [0.3] * 512}], "model": "voyage-3-lite", "usage": {}},
    )
    e = VoyageEmbedder(api_key="vo-test")
    out = await e.embed_query("what's on the midterm?")
    assert len(out) == 512
    # Verify the request body had input_type=query (httpx_mock records all requests).
    sent = httpx_mock.get_requests()[-1]
    assert b'"input_type":"query"' in sent.content or b'"input_type": "query"' in sent.content
