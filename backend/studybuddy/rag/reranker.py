"""Voyage rerank-2-lite client.

rerank(query, documents, top_k) -> ordered list of indices into `documents`.
If the API persistently fails, falls back to returning the first top_k
indices in original order so the chat flow degrades gracefully.
"""
from __future__ import annotations
import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

_ENDPOINT = "https://api.voyageai.com/v1/rerank"
_MODEL = "rerank-2-lite"


class VoyageReranker:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = _MODEL,
        timeout_s: float = 20.0,
        max_retries: int = 3,
        base_delay_s: float = 0.5,
    ):
        if not api_key:
            raise ValueError("VoyageReranker requires an api_key")
        self._api_key = api_key
        self._model = model
        self._timeout_s = timeout_s
        self._max_retries = max_retries
        self._base_delay_s = base_delay_s

    async def rerank(self, *, query: str, documents: list[str], top_k: int) -> list[int]:
        if not documents:
            return []
        top_k = min(top_k, len(documents))
        body = {
            "query": query,
            "documents": documents,
            "model": self._model,
            "top_k": top_k,
        }
        headers = {"Authorization": f"Bearer {self._api_key}"}
        for attempt in range(self._max_retries):
            try:
                async with httpx.AsyncClient(timeout=self._timeout_s) as c:
                    r = await c.post(_ENDPOINT, json=body, headers=headers)
                if r.status_code == 200:
                    payload = r.json()
                    return [row["index"] for row in payload["data"]]
                if r.status_code in (429, 500, 502, 503, 504):
                    delay = self._base_delay_s * (2 ** attempt)
                    logger.warning("voyage rerank %s; retrying in %.1fs", r.status_code, delay)
                    await asyncio.sleep(delay)
                    continue
                r.raise_for_status()
            except (httpx.TimeoutException, httpx.TransportError) as e:
                delay = self._base_delay_s * (2 ** attempt)
                logger.warning("voyage rerank transport error: %s; retrying in %.1fs", e, delay)
                await asyncio.sleep(delay)
        logger.error("voyage rerank exhausted retries; falling back to identity order")
        return list(range(top_k))
