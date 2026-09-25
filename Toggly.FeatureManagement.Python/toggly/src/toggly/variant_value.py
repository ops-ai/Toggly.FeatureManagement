"""Soft-decode variant configuration values to a requested Python type.

Missing assignment and bind/decode failures return ``None`` — never raise solely
for shape mismatch, and never return a wrong-typed value.
"""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from typing import Any, TypeVar, cast

T = TypeVar("T")


def decode_variant_value(value: Any, type_: type[T] | None) -> Any:
    """Return ``value`` untyped when ``type_`` is ``None``; otherwise bind as ``T``.

    Binding prefers pydantic ``TypeAdapter`` when pydantic is importable. Without
    pydantic, falls back to ``isinstance``, dataclass construction from mappings,
    and simple constructor calls. Any failure soft-returns ``None``.
    """
    if type_ is None:
        return value
    if value is None:
        return None

    try:
        from pydantic import TypeAdapter

        return TypeAdapter(type_).validate_python(value)
    except ImportError:
        pass
    except Exception:
        return None

    return _decode_without_pydantic(value, type_)


_PRIMITIVE_TYPES = (bool, int, float, str, bytes, complex)


def _decode_without_pydantic(value: Any, type_: type[T]) -> T | None:
    try:
        # bool is a subclass of int — do not treat True/False as int/float.
        if type_ in (int, float) and isinstance(value, bool):
            return None

        if isinstance(value, type_):
            return cast(T, value)

        if type_ is float and isinstance(value, int):
            return cast(T, float(value))

        if is_dataclass(type_) and isinstance(value, dict):
            kwargs = {f.name: value[f.name] for f in fields(type_) if f.name in value}
            return cast(T, type_(**kwargs))

        # Never call builtins with **dict — int()/str()/bool() yield defaults
        # (0, "", False) instead of soft-null on shape mismatch.
        if (
            callable(type_)
            and isinstance(value, dict)
            and type_ not in _PRIMITIVE_TYPES
        ):
            return cast(T, type_(**value))

        return None
    except Exception:
        return None
