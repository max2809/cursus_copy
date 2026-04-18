"""Voyage AI embedder for voyage-3-lite.

We call the REST API directly (rather than the `voyageai` SDK) because the
async SDK wraps httpx anyway and direct calls make tests trivial via
pytest-httpx.
"""
from __future__ import annotations
import asyncio
import logging
from typing import Iterable, Literal
import httpx

logger = logging.getLogger(__name__)

_ENDPOINT = "https://api.voyageai.com/v1/embeddings"
_MODEL = "voyage-3-lite"

InputType = Literal["document", "query"]


class VoyageEmbedder:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = _MODEL,
        batch_size: int = 50,
        timeout_s: float = 30.0,
        max_retries: int = 5,
        base_delay_s: float = 0.5,
    ):
        if not api_key:
            raise ValueError("VoyageEmbedder requires an api_key")
        self._api_key = api_key
        self._model = model
        self._batch_size = batch_size
        self._timeout_s = timeout_s
        self._max_retries = max_retries
        self._base_delay_s = base_delay_s

    async def embed(self, texts: list[str], *, input_type: InputType) -> list[list[float]]:
        out: list[list[float]] = []
        for batch in _batched(texts, self._batch_size):
            vecs = await self._one_batch(batch, input_type=input_type)
            out.extend(vecs)
        return out

    async def embed_query(self, text: str) -> list[float]:
        vecs = await self.embed([text], input_type="query")
        return vecs[0]

    async def _one_batch(self, batch: list[str], *, input_type: InputType) -> list[list[float]]:
        body = {"input": batch, "model": self._model, "input_type": input_type}
        headers = {"Authorization": f"Bearer {self._api_key}"}
        for attempt in range(self._max_retries):
            try:
                async with httpx.AsyncClient(timeout=self._timeout_s) as c:
                    r = await c.post(_ENDPOINT, json=body, headers=headers)
                if r.status_code == 200:
                    payload = r.json()
                    return [row["embedding"] for row in payload["data"]]
                if r.status_code in (429, 500, 502, 503, 504):
                    delay = self._base_delay_s * (2 ** attempt)
                    logger.warning("voyage embed %s; retrying in %.1fs", r.status_code, delay)
                    await asyncio.sleep(delay)
                    continue
                r.raise_for_status()
            except (httpx.TimeoutException, httpx.TransportError) as e:
                delay = self._base_delay_s * (2 ** attempt)
                logger.warning("voyage embed transport error: %s; retrying in %.1fs", e, delay)
                await asyncio.sleep(delay)
        raise RuntimeError("voyage embed failed after retries")


def _batched(items: list[str], n: int) -> Iterable[list[str]]:
    for i in range(0, len(items), n):
        yield items[i:i + n]
