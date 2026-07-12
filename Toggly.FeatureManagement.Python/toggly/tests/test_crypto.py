"""Tests for ES256 signed definitions verification."""

from __future__ import annotations

import base64
import hashlib
import secrets

import pytest

from toggly.crypto import verify_signed_definitions
from toggly.exceptions import TogglySignatureError
from toggly.models import JsonWebKey, JsonWebKeySet

# NIST P-256
_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_A = _P - 3
_GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
_GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5


def _mod_inverse(k: int, modulus: int) -> int:
    return pow(k, -1, modulus)


def _point_add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2 and (y1 + y2) % _P == 0:
        return None
    if p1 == p2:
        s = (3 * x1 * x1 + _A) * _mod_inverse(2 * y1 % _P, _P) % _P
    else:
        s = (y2 - y1) * _mod_inverse((x2 - x1) % _P, _P) % _P
    x3 = (s * s - x1 - x2) % _P
    y3 = (s * (x1 - x3) - y1) % _P
    return x3, y3


def _scalar_mult(k: int, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = _point_add(result, addend)
        addend = _point_add(addend, addend)
        k >>= 1
    return result


def _generate_keypair():
    d = secrets.randbelow(_N - 1) + 1
    pub = _scalar_mult(d, (_GX, _GY))
    assert pub is not None
    return d, pub


def _pad32(value: int) -> bytes:
    return value.to_bytes(32, "big")


def _compute_kid(x: int, y: int) -> str:
    digest = hashlib.sha1(_pad32(x) + _pad32(y)).hexdigest().upper()
    return f"{digest}ES256"


def _double_sha256(payload: str) -> bytes:
    first = hashlib.sha256(payload.encode("utf-8")).digest()
    return hashlib.sha256(first).digest()


def _sign_p1363(d: int, digest: bytes) -> bytes:
    z = int.from_bytes(digest, "big") % _N
    while True:
        k = secrets.randbelow(_N - 1) + 1
        point = _scalar_mult(k, (_GX, _GY))
        assert point is not None
        r = point[0] % _N
        if r == 0:
            continue
        s = (_mod_inverse(k, _N) * (z + r * d)) % _N
        if s == 0:
            continue
        return _pad32(r) + _pad32(s)


def _make_jwks(pub, kid: str) -> JsonWebKeySet:
    x, y = pub
    return JsonWebKeySet(
        keys=[
            JsonWebKey(
                kty="EC",
                kid=kid,
                crv="P-256",
                x=base64.urlsafe_b64encode(_pad32(x)).rstrip(b"=").decode("ascii"),
                y=base64.urlsafe_b64encode(_pad32(y)).rstrip(b"=").decode("ascii"),
                alg="ES256",
                use="sig",
            )
        ]
    )


def test_verify_signed_definitions_ok() -> None:
    d, pub = _generate_keypair()
    kid = _compute_kid(*pub)
    jwks = _make_jwks(pub, kid)

    defs = (
        '[{"featureKey":"demo","filters":[{"name":"AlwaysOn","parameters":{}}],'
        '"requirementType":"Any"}]'
    )
    ts = 1730000000
    sig = base64.b64encode(_sign_p1363(d, _double_sha256(f"{defs}|{ts}"))).decode("ascii")

    verify_signed_definitions(defs, ts, sig, kid, jwks, None)


def test_verify_signed_definitions_bad_signature() -> None:
    d, pub = _generate_keypair()
    kid = _compute_kid(*pub)
    jwks = _make_jwks(pub, kid)

    defs = "[]"
    ts = 1730000000
    raw = bytearray(_sign_p1363(d, _double_sha256(f"{defs}|{ts}")))
    raw[0] ^= 0xFF
    sig = base64.b64encode(bytes(raw)).decode("ascii")

    with pytest.raises(TogglySignatureError, match="Invalid signature"):
        verify_signed_definitions(defs, ts, sig, kid, jwks, None)


def test_verify_signed_definitions_allowed_kid() -> None:
    d, pub = _generate_keypair()
    kid = _compute_kid(*pub)
    jwks = _make_jwks(pub, kid)

    defs = "[]"
    ts = 1730000000
    sig = base64.b64encode(_sign_p1363(d, _double_sha256(f"{defs}|{ts}"))).decode("ascii")

    verify_signed_definitions(defs, ts, sig, kid, jwks, [kid])
    with pytest.raises(TogglySignatureError, match="kid not allowed"):
        verify_signed_definitions(defs, ts, sig, kid, jwks, ["nope"])
