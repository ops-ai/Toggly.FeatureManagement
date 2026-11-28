"""Soft-decode a resolved feature's value by its declared catalog ``value_type``.

Mirrors the wire contract used across Toggly SDKs (OPS-2102): a feature
definition may carry a ``valueType`` of ``"boolean" | "string" | "number" |
"json" | "datetime"``. Typed getters built on these helpers never raise
solely for a shape mismatch and never return a wrong-typed value — they
soft-null (``None``) on a missing feature, a disabled flag, a declared-type
mismatch, or a decode failure.

Legacy catalogs without a ``valueType`` still attempt the decode so older
flags keep working; the decode itself is still soft-null on failure.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal

FeatureValueType = Literal["boolean", "string", "number", "json", "datetime"]

_VALUE_TYPES = frozenset({"boolean", "string", "number", "json", "datetime"})


def is_feature_value_type(value: Any) -> bool:
    """Return whether ``value`` is a recognized ``FeatureValueType`` string."""
    return value in _VALUE_TYPES


def value_type_matches(declared: str | None, requested: FeatureValueType) -> bool:
    """Return whether a typed getter for ``requested`` may attempt a decode.

    Absent/empty ``declared`` (legacy catalogs predating ``valueType``) always
    allows the decode attempt; the decode itself still soft-nulls on failure.
    """
    if not declared:
        return True
    return declared == requested


def decode_string_value(raw: Any, declared: str | None = None) -> str | None:
    """Soft-decode ``raw`` as ``str``, or ``None`` on mismatch/non-string."""
    if not value_type_matches(declared, "string"):
        return None
    if isinstance(raw, str):
        return raw
    return None


def decode_number_value(raw: Any, declared: str | None = None) -> float | None:
    """Soft-decode ``raw`` as a finite ``float``, or ``None`` on mismatch/failure."""
    if not value_type_matches(declared, "number"):
        return None
    # bool is a subclass of int in Python — never treat True/False as 0/1.
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str) and raw.strip() != "":
        try:
            return float(raw)
        except ValueError:
            return None
    return None


def decode_json_value(raw: Any, declared: str | None = None) -> Any | None:
    """Soft-decode ``raw`` as a JSON object/array, or ``None`` on mismatch/failure."""
    if not value_type_matches(declared, "json"):
        return None
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if isinstance(parsed, (dict, list)):
            return parsed
        return None
    return None


def decode_datetime_value(raw: Any, declared: str | None = None) -> datetime | None:
    """Soft-decode ``raw`` as a ``datetime`` from an ISO-8601 string.

    Soft-nulls on a non-ISO-8601 string, non-string/datetime input, or a
    declared-type mismatch.
    """
    if not value_type_matches(declared, "datetime"):
        return None
    if isinstance(raw, datetime):
        return raw
    if isinstance(raw, str) and raw.strip() != "":
        text = raw.strip()
        # datetime.fromisoformat predates "Z" support on older runtimes.
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None
    return None
