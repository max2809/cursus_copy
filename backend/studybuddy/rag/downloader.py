"""Fetch bytes from Canvas (by file id) or an arbitrary URL.

Size cap: raises DownloadTooLarge before allocating the body.
Private-IP guard: refuses to fetch 127.0.0.1, 10.x, 192.168.x, etc.,
  so a malicious URL submission can't probe internal infrastructure.
"""
from __future__ import annotations
import ipaddress
import socket
from urllib.parse import urlparse, unquote
import httpx


class DownloadError(Exception):
    pass


class DownloadTooLarge(DownloadError):
    pass


async def download_canvas_file(
    *,
    canvas_base_url: str,
    pat: str,
    canvas_file_id: int,
    max_bytes: int,
) -> tuple[bytes, str, str]:
    """Returns (bytes, content_type, filename)."""
    headers = {"Authorization": f"Bearer {pat}"}
    meta_url = f"https://{canvas_base_url}/api/v1/files/{canvas_file_id}"
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as c:
        r = await c.get(meta_url, headers=headers)
        r.raise_for_status()
        meta = r.json()
        size = int(meta.get("size") or 0)
        if size > max_bytes:
            raise DownloadTooLarge(f"canvas file {canvas_file_id} is {size} bytes (>{max_bytes})")
        signed_url = meta.get("url") or ""
        if not signed_url:
            raise DownloadError(f"canvas file {canvas_file_id} has no download url")
        content_type = meta.get("content-type") or meta.get("content_type") or "application/octet-stream"
        filename = meta.get("display_name") or meta.get("filename") or f"file-{canvas_file_id}"

        # Signed URL already contains auth; no bearer header.
        r2 = await c.get(signed_url)
        r2.raise_for_status()
        body = r2.content
        if len(body) > max_bytes:
            raise DownloadTooLarge(f"canvas file exceeded {max_bytes} bytes on download")
        return body, content_type, filename


async def download_canvas_page(
    *,
    canvas_base_url: str,
    pat: str,
    canvas_course_id: int,
    page_slug: str,
    max_bytes: int,
) -> tuple[bytes, str, str]:
    """Fetch a Canvas Page's body HTML. Returns (bytes, content_type, filename).

    Canvas Pages API: GET /api/v1/courses/{course_id}/pages/{page_url} returns
    {title, body, ...} where body is the rendered HTML.
    """
    headers = {"Authorization": f"Bearer {pat}"}
    url = f"https://{canvas_base_url}/api/v1/courses/{canvas_course_id}/pages/{page_slug}"
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        payload = r.json()
        body_html = (payload.get("body") or "").encode("utf-8")
        if len(body_html) > max_bytes:
            raise DownloadTooLarge(f"canvas page {page_slug} is {len(body_html)} bytes (>{max_bytes})")
        title = payload.get("title") or page_slug
        return body_html, "text/html", title


async def download_canvas_syllabus(
    *,
    canvas_base_url: str,
    pat: str,
    canvas_course_id: int,
    max_bytes: int,
) -> tuple[bytes, str, str]:
    """Fetch a course's syllabus body. Returns (bytes, content_type, filename).

    Canvas exposes the syllabus via the course detail endpoint when
    include[]=syllabus_body is requested; the field is HTML. We re-fetch
    at index time (rather than caching on the Course row) so edits to the
    syllabus propagate on the next index pass.
    """
    headers = {"Authorization": f"Bearer {pat}"}
    url = f"https://{canvas_base_url}/api/v1/courses/{canvas_course_id}?include[]=syllabus_body"
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as c:
        r = await c.get(url, headers=headers)
        r.raise_for_status()
        payload = r.json()
        body = (payload.get("syllabus_body") or "").strip()
        if not body:
            raise DownloadError(f"course {canvas_course_id} has no syllabus body")
        body_html = body.encode("utf-8")
        if len(body_html) > max_bytes:
            raise DownloadTooLarge(f"canvas syllabus {canvas_course_id} is {len(body_html)} bytes (>{max_bytes})")
        title = f"Syllabus — {payload.get('name') or 'course'}"
        return body_html, "text/html", title


async def fetch_url(url: str, *, max_bytes: int) -> tuple[bytes, str, str]:
    """Returns (bytes, content_type, filename) for a public URL."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise DownloadError(f"only http(s) urls allowed: {parsed.scheme!r}")
    if not parsed.hostname:
        raise DownloadError("url has no hostname")
    _guard_private_host(parsed.hostname)

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, max_redirects=5) as c:
        async with c.stream("GET", url) as r:
            r.raise_for_status()
            ct = r.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
            size_hint = int(r.headers.get("content-length") or 0)
            if size_hint and size_hint > max_bytes:
                raise DownloadTooLarge(f"url body {size_hint}B exceeds cap {max_bytes}B")

            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    raise DownloadTooLarge(f"url body exceeded cap {max_bytes}B during stream")

    filename = unquote(parsed.path.rsplit("/", 1)[-1]) or parsed.hostname
    return bytes(buf), ct, filename


def _guard_private_host(host: str) -> None:
    # Fast-path: literal IP strings don't need DNS resolution.
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if literal.is_private or literal.is_loopback or literal.is_link_local or literal.is_reserved:
            raise DownloadError(f"refusing to fetch private address {host}")
        return

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise DownloadError(f"cannot resolve host {host!r}: {e}") from e
    for info in infos:
        ip = info[4][0]
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
            raise DownloadError(f"refusing to fetch private address {ip} (host={host})")
