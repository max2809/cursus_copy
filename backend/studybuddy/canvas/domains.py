import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


class InvalidCanvasHost(ValueError):
    """Raised when a submitted Canvas host is syntactically unsafe."""


class CanvasHostUnreachable(ValueError):
    """Raised when a syntactically valid Canvas host cannot be resolved."""


_BLOCKED_SUFFIXES = (
    ".internal",
    ".local",
    ".localhost",
    ".test",
    ".invalid",
)


def normalize_canvas_base_url(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        raise InvalidCanvasHost("Invalid Canvas domain")

    candidate = raw if "://" in raw else f"https://{raw}"
    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError as exc:
        raise InvalidCanvasHost("Invalid Canvas domain") from exc

    if parsed.scheme.lower() != "https":
        raise InvalidCanvasHost("Invalid Canvas domain")
    if parsed.username or parsed.password or port is not None:
        raise InvalidCanvasHost("Invalid Canvas domain")

    hostname = parsed.hostname
    if not hostname:
        raise InvalidCanvasHost("Invalid Canvas domain")

    try:
        host = hostname.encode("idna").decode("ascii").lower().strip(".")
    except UnicodeError as exc:
        raise InvalidCanvasHost("Invalid Canvas domain") from exc

    if not host or "." not in host:
        raise InvalidCanvasHost("Invalid Canvas domain")
    if host == "localhost" or host.endswith(_BLOCKED_SUFFIXES):
        raise InvalidCanvasHost("Invalid Canvas domain")

    try:
        ipaddress.ip_address(host)
    except ValueError:
        return host
    raise InvalidCanvasHost("Invalid Canvas domain")


async def _resolve_host_ips(host: str) -> list[str]:
    try:
        results = await asyncio.to_thread(
            socket.getaddrinfo,
            host,
            443,
            0,
            socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise CanvasHostUnreachable("Could not reach that Canvas domain") from exc

    addresses: set[str] = set()
    for result in results:
        sockaddr = result[4]
        if sockaddr:
            addresses.add(sockaddr[0])
    if not addresses:
        raise CanvasHostUnreachable("Could not reach that Canvas domain")
    return sorted(addresses)


def _is_public_ip(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


async def validate_canvas_host(value: str) -> str:
    host = normalize_canvas_base_url(value)
    addresses = await _resolve_host_ips(host)
    if not all(_is_public_ip(address) for address in addresses):
        raise InvalidCanvasHost("Invalid Canvas domain")
    return host
