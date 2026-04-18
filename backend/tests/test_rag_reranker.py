import pytest
from studybuddy.rag.reranker import VoyageReranker


@pytest.mark.asyncio
async def test_rerank_returns_topk_indices(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="https://api.voyageai.com/v1/rerank",
        json={
            "data": [
                {"index": 3, "relevance_score": 0.92},
                {"index": 0, "relevance_score": 0.81},
                {"index": 2, "relevance_score": 0.44},
            ],
            "model": "rerank-2-lite",
            "usage": {"total_tokens": 30},
        },
    )
    r = VoyageReranker(api_key="vo-test")
    order = await r.rerank(
        query="what is big-O",
        documents=["a", "b", "c", "d"],
        top_k=3,
    )
    assert order == [3, 0, 2]


@pytest.mark.asyncio
async def test_rerank_empty_documents_returns_empty():
    r = VoyageReranker(api_key="vo-test")
    assert await r.rerank(query="q", documents=[], top_k=5) == []


@pytest.mark.asyncio
@pytest.mark.httpx_mock(assert_all_responses_were_requested=False)
async def test_rerank_falls_back_on_persistent_failure(httpx_mock):
    # Always 500. Exhausts retries.
    for _ in range(4):
        httpx_mock.add_response(
            method="POST",
            url="https://api.voyageai.com/v1/rerank",
            status_code=500,
        )
    r = VoyageReranker(api_key="vo-test", max_retries=3, base_delay_s=0)
    # Fallback: first top_k indices in original order.
    order = await r.rerank(query="q", documents=["a", "b", "c"], top_k=2)
    assert order == [0, 1]
