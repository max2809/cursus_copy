import hashlib
import secrets


def new_token(num_bytes: int = 32) -> str:
    """Return a URL-safe random token with `num_bytes` of entropy."""
    return secrets.token_urlsafe(num_bytes)


def hash_token(token: str) -> bytes:
    """Return SHA-256 hash of a token (raw 32 bytes)."""
    return hashlib.sha256(token.encode("utf-8")).digest()
