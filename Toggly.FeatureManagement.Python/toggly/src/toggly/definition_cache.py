"""Shared definition-refresh cache helpers (sync + async clients)."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Literal, Mapping, Optional

from toggly.enums import LoadStatus
from toggly.models import FeatureDefinition, FeatureFilter, TogglyInitResponse

CacheOutcome = Literal["hit", "miss"]


class HttpCacheKind(str, Enum):
    """Classification of an HTTP definitions/variants response for cache telemetry."""

    NOT_MODIFIED = "not_modified"
    SAME_REVISION = "same_revision"
    NEW_CONTENT = "new_content"
    ERROR_STATUS = "error_status"


@dataclass(frozen=True)
class HttpCacheProbe:
    """Result of probing status + ETag against the local revision."""

    kind: HttpCacheKind
    response_etag: Optional[str] = None
    status_code: int = 0


def normalize_revision(revision: Optional[str]) -> Optional[str]:
    """Normalize an ETag/revision for comparison."""
    if not revision:
        return None
    return revision.strip().strip('"')


def revisions_match(left: Optional[str], right: Optional[str]) -> bool:
    """Return True when both revisions are present and equal."""
    a = normalize_revision(left)
    b = normalize_revision(right)
    return a is not None and b is not None and a == b


def if_none_match_headers(etag: Optional[str]) -> dict[str, str]:
    """Build conditional-GET headers from a stored ETag."""
    if not etag:
        return {}
    return {"If-None-Match": etag}


def probe_http_cache(
    status_code: int,
    previous_etag: Optional[str],
    response_headers: Mapping[str, Any],
) -> HttpCacheProbe:
    """Classify a definitions/variants HTTP response for hit/miss accounting."""
    response_etag: Optional[str] = None
    raw = response_headers.get("ETag")
    if raw is None:
        raw = response_headers.get("etag")
    if isinstance(raw, str):
        response_etag = raw

    if status_code == 304:
        return HttpCacheProbe(HttpCacheKind.NOT_MODIFIED, response_etag, status_code)
    if status_code != 200:
        return HttpCacheProbe(HttpCacheKind.ERROR_STATUS, response_etag, status_code)
    if revisions_match(previous_etag, response_etag):
        return HttpCacheProbe(HttpCacheKind.SAME_REVISION, response_etag, status_code)
    return HttpCacheProbe(HttpCacheKind.NEW_CONTENT, response_etag, status_code)


def cached_flags_response(flags: dict[str, bool]) -> TogglyInitResponse:
    """Build a CACHED init/refresh response from current in-memory flags."""
    return TogglyInitResponse(status=LoadStatus.CACHED, flags=dict(flags))


def extract_raw_defs_json(body: str) -> Optional[str]:
    """Extract the exact JSON value of the ``defs`` property from a response body."""
    marker = '"defs"'
    idx = body.find(marker)
    if idx < 0:
        return None
    idx = body.find(":", idx + len(marker))
    if idx < 0:
        return None
    idx += 1
    while idx < len(body) and body[idx].isspace():
        idx += 1
    if idx >= len(body):
        return None
    start_char = body[idx]
    if start_char not in "[{":
        return None
    open_c, close_c = ("[", "]") if start_char == "[" else ("{", "}")
    depth = 0
    in_string = False
    escape = False
    for i in range(idx, len(body)):
        c = body[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            continue
        if c == '"':
            in_string = True
        elif c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return body[idx : i + 1]
    return None


def parse_definitions_payload(data: Any) -> list[FeatureDefinition]:
    """Parse feature definitions from an API JSON payload."""
    definitions: list[FeatureDefinition] = []

    items: list[Any]
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("defs") or data.get("features") or data.get("definitions") or []
    else:
        items = []

    for item in items:
        if not isinstance(item, dict):
            continue

        feature_key = item.get("featureKey") or item.get("feature_key")
        if not feature_key:
            continue

        filters = []
        for f in item.get("filters", []):
            if isinstance(f, dict) and f.get("name"):
                filters.append(
                    FeatureFilter(
                        name=f["name"],
                        parameters=f.get("parameters", {}),
                    )
                )

        definitions.append(
            FeatureDefinition(
                feature_key=feature_key,
                filters=filters,
                requirement_type=item.get("requirementType", "Any"),
                context_kind=item.get("contextKind"),
                context_requirement_type=item.get("contextRequirementType"),
                secured_feature=item.get("securedFeature", False),
                metrics=item.get("metrics"),
            )
        )

    return definitions


def parse_signed_timestamp(ts: Any) -> Optional[int]:
    """Parse a signed-definitions timestamp field into an int, or None."""
    if isinstance(ts, bool):
        return None
    if isinstance(ts, (int, float)):
        return int(ts)
    return None
