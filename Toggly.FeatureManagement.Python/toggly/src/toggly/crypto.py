"""ES256 signature verification for signed definitions.

Matches Go/worker behavior: payload = raw defs JSON + "|" + timestamp,
double SHA-256, then ECDSA P-256 verify (IEEE P1363 or DER).

Uses only the Python standard library (zero dependencies).
"""

from __future__ import annotations

import base64
import hashlib
from typing import Iterable

from toggly.exceptions import TogglySignatureError
from toggly.models import JsonWebKey, JsonWebKeySet

# NIST P-256 curve parameters
_P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
_A = _P - 3
_B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
_GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
_GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5


def verify_signed_definitions(
    raw_defs_json: str,
    timestamp: int,
    signature_b64: str,
    kid: str,
    jwks: JsonWebKeySet,
    allowed_kids: Iterable[str] | None = None,
) -> None:
    """Verify an ES256 signed definitions payload.

    Args:
        raw_defs_json: Exact JSON text of the ``defs`` property.
        timestamp: Unix-seconds timestamp included in the signed payload.
        signature_b64: Standard Base64 encoding of the ES256 signature.
        kid: Key id to look up in the JWKS.
        jwks: JWKS containing the public key.
        allowed_kids: Optional allow-list of kids (None/empty = allow all).

    Raises:
        TogglySignatureError: If verification fails.

    """
    if raw_defs_json is None:
        raise TogglySignatureError("Missing signed defs JSON")
    if not signature_b64:
        raise TogglySignatureError("Missing signature")
    if not kid:
        raise TogglySignatureError("Missing key id")
    if jwks is None:
        raise TogglySignatureError("Missing JWKS")

    jwk = jwks.get_key(kid)
    if jwk is None:
        raise TogglySignatureError(f"No matching JWK for kid: {kid}")

    pub = _parse_and_validate_key(jwk, allowed_kids)
    digest = _double_sha256(f"{raw_defs_json}|{timestamp}")
    try:
        signature = base64.b64decode(signature_b64)
    except Exception as e:
        raise TogglySignatureError("Failed to decode signature", cause=e) from e

    if len(signature) == 64:
        r = int.from_bytes(signature[:32], "big")
        s = int.from_bytes(signature[32:], "big")
    else:
        r, s = _parse_der_signature(signature)

    if not _ecdsa_verify(pub, digest, r, s):
        raise TogglySignatureError("Invalid signature")


def _double_sha256(payload: str) -> bytes:
    first = hashlib.sha256(payload.encode("utf-8")).digest()
    return hashlib.sha256(first).digest()


def _parse_and_validate_key(
    jwk: JsonWebKey,
    allowed_kids: Iterable[str] | None,
) -> tuple[int, int]:
    if jwk.alg != "ES256":
        raise TogglySignatureError(f"Unsupported alg: {jwk.alg}")
    if jwk.crv != "P-256":
        raise TogglySignatureError(f"Unsupported crv: {jwk.crv}")

    allowed = list(allowed_kids) if allowed_kids is not None else []
    if allowed and jwk.kid not in allowed:
        raise TogglySignatureError(f"kid not allowed: {jwk.kid}")

    try:
        x_bytes = _b64url_decode(jwk.x)
        y_bytes = _b64url_decode(jwk.y)
    except Exception as e:
        raise TogglySignatureError("Failed to decode JWK coordinate", cause=e) from e

    computed = _compute_kid(x_bytes, y_bytes)
    if jwk.kid != computed:
        raise TogglySignatureError(f"Invalid kid: expected {computed}, got {jwk.kid}")

    x = int.from_bytes(x_bytes, "big")
    y = int.from_bytes(y_bytes, "big")
    if not _is_on_curve(x, y):
        raise TogglySignatureError("Point not on P-256")
    return x, y


def _compute_kid(x_bytes: bytes, y_bytes: bytes) -> str:
    digest = hashlib.sha1(x_bytes + y_bytes).hexdigest().upper()
    return f"{digest}ES256"


def _b64url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(padded)
    except Exception:
        return base64.b64decode(padded)


def _is_on_curve(x: int, y: int) -> bool:
    return (y * y - (x * x * x + _A * x + _B)) % _P == 0


def _mod_inverse(k: int, modulus: int) -> int:
    return pow(k, -1, modulus)


def _point_add(
    p1: tuple[int, int] | None,
    p2: tuple[int, int] | None,
) -> tuple[int, int] | None:
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2 and (y1 + y2) % _P == 0:
        return None
    if p1 == p2:
        # Point double
        s = (3 * x1 * x1 + _A) * _mod_inverse(2 * y1 % _P, _P) % _P
    else:
        s = (y2 - y1) * _mod_inverse((x2 - x1) % _P, _P) % _P
    x3 = (s * s - x1 - x2) % _P
    y3 = (s * (x1 - x3) - y1) % _P
    return x3, y3


def _scalar_mult(k: int, point: tuple[int, int]) -> tuple[int, int] | None:
    result: tuple[int, int] | None = None
    addend: tuple[int, int] | None = point
    while k:
        if k & 1:
            result = _point_add(result, addend)
        addend = _point_add(addend, addend)
        k >>= 1
    return result


def _ecdsa_verify(pub: tuple[int, int], digest: bytes, r: int, s: int) -> bool:
    if not (1 <= r < _N and 1 <= s < _N):
        return False
    z = int.from_bytes(digest, "big") % _N
    w = _mod_inverse(s, _N)
    u1 = (z * w) % _N
    u2 = (r * w) % _N
    p1 = _scalar_mult(u1, (_GX, _GY))
    p2 = _scalar_mult(u2, pub)
    point = _point_add(p1, p2)
    if point is None:
        return False
    return point[0] % _N == r


def _parse_der_signature(der: bytes) -> tuple[int, int]:
    """Parse ASN.1 DER ECDSA signature into (r, s)."""
    try:
        if der[0] != 0x30:
            raise TogglySignatureError("Invalid DER signature")
        idx = 2
        if der[1] & 0x80:
            idx = 2 + (der[1] & 0x7F)

        if der[idx] != 0x02:
            raise TogglySignatureError("Invalid DER signature")
        idx += 1
        r_len = der[idx]
        idx += 1
        r = int.from_bytes(der[idx : idx + r_len], "big")
        idx += r_len

        if der[idx] != 0x02:
            raise TogglySignatureError("Invalid DER signature")
        idx += 1
        s_len = der[idx]
        idx += 1
        s = int.from_bytes(der[idx : idx + s_len], "big")
        return r, s
    except (IndexError, ValueError) as e:
        raise TogglySignatureError("Failed to parse DER signature", cause=e) from e
