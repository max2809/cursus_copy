import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def encrypt_pat(plaintext: str, key: bytes) -> tuple[bytes, bytes]:
    """Encrypt a Canvas PAT. Returns (ciphertext, nonce)."""
    if len(key) != 32:
        raise ValueError("key must be 32 bytes")
    aes = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aes.encrypt(nonce, plaintext.encode("utf-8"), associated_data=None)
    return ciphertext, nonce


def decrypt_pat(ciphertext: bytes, nonce: bytes, key: bytes) -> str:
    """Decrypt a Canvas PAT. Raises on tamper/wrong key/wrong nonce."""
    if len(key) != 32:
        raise ValueError("key must be 32 bytes")
    aes = AESGCM(key)
    plaintext = aes.decrypt(nonce, ciphertext, associated_data=None)
    return plaintext.decode("utf-8")
