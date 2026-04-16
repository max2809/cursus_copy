import asyncio
import re
import httpx


class CanvasUnauthorized(Exception):
    pass


class CanvasError(Exception):
    pass


class CanvasClient:
    def __init__(self, base_url: str, token: str, retry_delays: list[float] | None = None):
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._retry_delays = retry_delays if retry_delays is not None else [1.0, 2.0, 4.0]

    async def get_paginated(self, path: str, params: dict | None = None) -> list[dict]:
        url = f"https://{self._base_url}{path}"
        results: list[dict] = []
        async with httpx.AsyncClient(timeout=20.0) as client:
            current_url: str | None = url
            current_params: dict | None = params
            while current_url is not None:
                resp = await self._get_with_retry(client, current_url, current_params)
                body = resp.json()
                if isinstance(body, list):
                    results.extend(body)
                else:
                    results.append(body)
                    return results
                current_url = self._next_url(resp.headers.get("Link"))
                current_params = None
        return results

    async def _get_with_retry(self, client: httpx.AsyncClient, url: str, params: dict | None) -> httpx.Response:
        last_exc: Exception | None = None
        for delay in [0.0, *self._retry_delays]:
            if delay:
                await asyncio.sleep(delay)
            try:
                resp = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {self._token}"},
                    params=params,
                )
            except httpx.RequestError as e:
                last_exc = e
                continue
            if resp.status_code == 401:
                raise CanvasUnauthorized(f"Canvas 401 for {url}")
            if 500 <= resp.status_code < 600:
                last_exc = CanvasError(f"Canvas {resp.status_code} for {url}")
                continue
            resp.raise_for_status()
            return resp
        raise last_exc if last_exc else CanvasError("exhausted retries")

    @staticmethod
    def _next_url(link_header: str | None) -> str | None:
        if not link_header:
            return None
        for part in link_header.split(","):
            m = re.match(r'\s*<([^>]+)>\s*;\s*rel="([^"]+)"', part)
            if m and m.group(2) == "next":
                return m.group(1)
        return None
