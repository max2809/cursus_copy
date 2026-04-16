import os
import pytest
from studybuddy.security.crypto import encrypt_pat, decrypt_pat


KEY = os.urandom(32)


def test_roundtrip_returns_original():
    plaintext = "abc123_canvas_pat"
    ciphertext, nonce = encrypt_pat(plaintext, KEY)
    assert decrypt_pat(ciphertext, nonce, KEY) == plaintext


def test_nonce_is_12_bytes():
    _, nonce = encrypt_pat("x", KEY)
    assert len(nonce) == 12


def test_different_nonces_per_call():
    _, n1 = encrypt_pat("x", KEY)
    _, n2 = encrypt_pat("x", KEY)
    assert n1 != n2


def test_ciphertext_differs_per_call():
    c1, _ = encrypt_pat("x", KEY)
    c2, _ = encrypt_pat("x", KEY)
    assert c1 != c2


def test_wrong_key_fails():
    ciphertext, nonce = encrypt_pat("x", KEY)
    other_key = os.urandom(32)
    with pytest.raises(Exception):
        decrypt_pat(ciphertext, nonce, other_key)


def test_wrong_nonce_fails():
    ciphertext, _ = encrypt_pat("x", KEY)
    with pytest.raises(Exception):
        decrypt_pat(ciphertext, os.urandom(12), KEY)
