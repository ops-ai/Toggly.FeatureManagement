"""Entity context registration and schema catalog."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, TypeVar

from toggly.context import TogglyEntityContext

T = TypeVar("T")
logger = logging.getLogger("toggly")

_mappers: dict[str, Callable[[Any], TogglyEntityContext]] = {}
_schemas: dict[str, EntityContextSchemaRegistration] = {}


@dataclass
class EntityContextPropertySchema:
    """Named property in an entity context schema catalog."""

    name: str
    type: str


@dataclass
class EntityContextSchemaRegistration:
    """Schema posted to the dashboard entity-context catalog."""

    kind: str
    key_property: str
    display_name: str | None = None
    properties: list[EntityContextPropertySchema] = field(default_factory=list)


def register_context(
    kind: str,
    mapper: Callable[[T], TogglyEntityContext],
    schema: EntityContextSchemaRegistration | None = None,
) -> None:
    """Register a mapper from a domain object to entity context."""
    _mappers[kind] = mapper  # type: ignore[assignment]
    if schema is not None:
        schema.kind = kind
        if not schema.display_name:
            schema.display_name = kind
        _schemas[kind] = schema


def get_entity_context_schema_registrations() -> list[EntityContextSchemaRegistration]:
    """Return registered entity context schemas."""
    return list(_schemas.values())


def clear_entity_context_schema_registrations() -> None:
    """Clear mapper and schema registries (tests)."""
    _schemas.clear()
    _mappers.clear()


def map_entity(kind: str, entity: Any) -> TogglyEntityContext | None:
    """Map a domain object using the mapper registered for ``kind``."""
    mapper = _mappers.get(kind)
    if mapper is None:
        return None
    return mapper(entity)


def register_entity_contexts_at_startup(
    *,
    base_url: str,
    app_key: str,
    register_on_startup: bool = True,
    debug: bool = False,
    timeout: float = 10.0,
) -> None:
    """Best-effort PUT of registered schemas at client startup."""
    if register_on_startup is False:
        return
    if not app_key:
        return
    registrations = get_entity_context_schema_registrations()
    if not registrations:
        return
    payload = {
        "contexts": [
            {
                "kind": r.kind,
                "keyProperty": r.key_property,
                "displayName": r.display_name or r.kind,
                "properties": [{"name": p.name, "type": p.type} for p in r.properties],
            }
            for r in registrations
        ]
    }
    url = base_url.rstrip("/") + f"/sdk/{app_key}/contexts"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if debug:
                if 200 <= response.status < 300:
                    logger.debug(
                        "[Toggly] Registered %s entity context kind(s) at startup.",
                        len(payload["contexts"]),
                    )
                else:
                    logger.warning(
                        "[Toggly] Entity context registration returned HTTP %s.",
                        response.status,
                    )
    except Exception as exc:  # noqa: BLE001 - swallow transport errors
        if debug:
            logger.warning("[Toggly] Entity context registration failed. %s", exc)
        if isinstance(exc, urllib.error.URLError):
            return
