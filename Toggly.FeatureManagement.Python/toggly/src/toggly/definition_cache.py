"""Shared definition-refresh cache helpers (sync + async clients)."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Mapping, Optional, Union

from toggly.crypto import verify_signed_definitions
from toggly.enums import LoadStatus
from toggly.exceptions import TogglyNetworkError, TogglySignatureError
from toggly.models import (
    EvaluatedVariantDef,
    FeatureDefinition,
    FeatureFilter,
    TogglyInitResponse,
)
from toggly.providers import DefinitionsSnapshot, VariantsSnapshot

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


@dataclass(frozen=True)
class ConditionalGetHit:
    """Serve in-memory flags without applying a new body."""

    # For SAME_REVISION, store the response ETag when present; 304 leaves etag alone.
    etag_to_store: Optional[str] = None


@dataclass(frozen=True)
class SignedDefinitionsEnvelope:
    """Parsed signed-definitions fields pending JWKS verification."""

    signed_defs_json: str
    signature: str
    kid: str
    signed_ts: int


@dataclass(frozen=True)
class StaleSignedHit:
    """Signed payload timestamp is older than the last accepted one."""


@dataclass(frozen=True)
class UnsignedDefinitionsParsed:
    """Unsigned definitions body ready to apply."""

    definitions: list[FeatureDefinition]


PreparedDefinitions = Union[
    StaleSignedHit,
    UnsignedDefinitionsParsed,
    SignedDefinitionsEnvelope,
]


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


def resolve_conditional_get(
    probe: HttpCacheProbe,
    *,
    resource_label: str,
) -> ConditionalGetHit | None:
    """Map a probe to an early cache hit, raise on HTTP error, or None for new content."""
    if probe.kind is HttpCacheKind.NOT_MODIFIED:
        return ConditionalGetHit(etag_to_store=None)
    if probe.kind is HttpCacheKind.ERROR_STATUS:
        raise TogglyNetworkError(
            f"Failed to fetch {resource_label}: HTTP {probe.status_code}",
            status_code=probe.status_code,
        )
    if probe.kind is HttpCacheKind.SAME_REVISION:
        return ConditionalGetHit(etag_to_store=probe.response_etag)
    return None


def cached_flags_response(flags: dict[str, bool]) -> TogglyInitResponse:
    """Build a CACHED init/refresh response from current in-memory flags."""
    return TogglyInitResponse(status=LoadStatus.CACHED, flags=dict(flags))


def cached_hit_result(
    flags: dict[str, bool],
) -> tuple[TogglyInitResponse, Literal["hit"], None]:
    """Return the standard cache-hit refresh triple."""
    return cached_flags_response(flags), "hit", None


def decode_json_text(raw_body: str) -> Any:
    """Parse a definitions response body as JSON."""
    try:
        return json.loads(raw_body)
    except Exception as e:
        raise TogglyNetworkError(f"Invalid JSON response: {e}", cause=e) from e


def decode_response_json(response: Any) -> Any:
    """Parse ``response.json()`` for variants (or similar) payloads."""
    try:
        return response.json()
    except Exception as e:
        raise TogglyNetworkError(f"Invalid JSON response: {e}", cause=e) from e


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


def is_stale_signed_timestamp(signed_ts: int, last_signed_timestamp: int) -> bool:
    """Return True when a signed payload is older than the last accepted one."""
    return signed_ts < last_signed_timestamp and last_signed_timestamp > 0


def parse_signed_definitions_envelope(
    raw_body: str, data: Any
) -> SignedDefinitionsEnvelope:
    """Extract and validate signed-definitions envelope fields (before JWKS verify)."""
    if not isinstance(data, dict):
        raise TogglySignatureError("Signed response must be an object")
    signed_defs_json = extract_raw_defs_json(raw_body)
    if signed_defs_json is None:
        raise TogglySignatureError("Signed response missing defs")
    raw_sig = data.get("signature")
    signature = raw_sig if isinstance(raw_sig, str) else None
    raw_kid = data.get("kid")
    kid = raw_kid if isinstance(raw_kid, str) else None
    signed_ts = parse_signed_timestamp(data.get("timestamp"))
    if not signature:
        raise TogglySignatureError("Signed response missing signature")
    if not kid:
        raise TogglySignatureError("Signed response missing kid")
    if signed_ts is None:
        raise TogglySignatureError("Signed response missing timestamp")
    return SignedDefinitionsEnvelope(
        signed_defs_json=signed_defs_json,
        signature=signature,
        kid=kid,
        signed_ts=signed_ts,
    )


def prepare_definitions_body(
    raw_body: str,
    *,
    use_signed: bool,
    last_signed_timestamp: int,
) -> PreparedDefinitions:
    """Decode a definitions HTTP body into unsigned defs, stale hit, or signed envelope."""
    data = decode_json_text(raw_body)
    if not use_signed:
        return UnsignedDefinitionsParsed(definitions=parse_definitions_payload(data))

    envelope = parse_signed_definitions_envelope(raw_body, data)
    if is_stale_signed_timestamp(envelope.signed_ts, last_signed_timestamp):
        return StaleSignedHit()
    return envelope


def definitions_from_signed_envelope(
    envelope: SignedDefinitionsEnvelope,
) -> list[FeatureDefinition]:
    """Parse definitions JSON from a verified signed envelope."""
    return parse_definitions_payload(json.loads(envelope.signed_defs_json))


def build_definitions_snapshot(
    definitions: list[FeatureDefinition],
    *,
    etag: Optional[str],
    signature: Optional[str] = None,
    kid: Optional[str] = None,
    signed_ts: Optional[int] = None,
    signed_defs_json: Optional[str] = None,
) -> DefinitionsSnapshot:
    """Build a definitions snapshot for deferred persistence."""
    return DefinitionsSnapshot(
        definitions=definitions,
        etag=etag,
        timestamp=signed_ts if signed_ts is not None else int(time.time()),
        signature=signature,
        key_id=kid,
        signed_defs_json=signed_defs_json,
    )


def fetched_definitions_result(
    flags: dict[str, bool],
    definitions: list[FeatureDefinition],
    *,
    etag: Optional[str],
    signature: Optional[str] = None,
    kid: Optional[str] = None,
    signed_ts: Optional[int] = None,
    signed_defs_json: Optional[str] = None,
) -> tuple[TogglyInitResponse, Literal["miss"], DefinitionsSnapshot]:
    """Build the FETCHED/miss return triple after applying new definitions."""
    init_response = TogglyInitResponse(
        status=LoadStatus.FETCHED,
        flags=dict(flags),
        definitions=definitions,
        etag=etag,
        timestamp=datetime.now(timezone.utc),
    )
    snapshot = build_definitions_snapshot(
        definitions,
        etag=etag,
        signature=signature,
        kid=kid,
        signed_ts=signed_ts,
        signed_defs_json=signed_defs_json,
    )
    return init_response, "miss", snapshot


def parse_evaluated_variants_payload(
    data: Any,
) -> tuple[dict[str, EvaluatedVariantDef], Optional[str], Optional[int], Optional[str]]:
    """Parse evaluated-variants-signed JSON body."""
    if not isinstance(data, dict):
        return {}, None, None, None
    raw_defs = data.get("defs")
    if not isinstance(raw_defs, dict):
        raw_defs = {}
    defs: dict[str, EvaluatedVariantDef] = {}
    for key, value in raw_defs.items():
        if isinstance(value, dict):
            defs[key] = EvaluatedVariantDef.from_dict(value)
    raw_sig = data.get("signature")
    signature = raw_sig if isinstance(raw_sig, str) else None
    ts = data.get("timestamp")
    if isinstance(ts, int):
        timestamp = ts
    elif isinstance(ts, float):
        timestamp = int(ts)
    else:
        timestamp = None
    raw_kid = data.get("kid")
    kid = raw_kid if isinstance(raw_kid, str) else None
    return defs, signature, timestamp, kid


def fetched_variants_result(
    flags: dict[str, bool],
    defs: dict[str, EvaluatedVariantDef],
    *,
    etag: Optional[str],
    signature: Optional[str],
    kid: Optional[str],
    timestamp: Optional[int],
) -> tuple[TogglyInitResponse, Literal["miss"], VariantsSnapshot]:
    """Build the FETCHED/miss return triple after applying evaluated variants."""
    snapshot = VariantsSnapshot(
        defs=defs,
        signature=signature,
        key_id=kid,
        timestamp=timestamp,
        etag=etag,
    )
    return (
        TogglyInitResponse(
            status=LoadStatus.FETCHED,
            flags=dict(flags),
            etag=etag,
            timestamp=datetime.now(timezone.utc),
        ),
        "miss",
        snapshot,
    )


def verify_and_parse_signed_envelope(
    envelope: SignedDefinitionsEnvelope,
    jwks: Any,
    allowed_key_ids: Any,
) -> tuple[list[FeatureDefinition], str, str, int, str]:
    """Verify a signed envelope and return definitions plus metadata fields."""
    verify_signed_definitions(
        envelope.signed_defs_json,
        envelope.signed_ts,
        envelope.signature,
        envelope.kid,
        jwks,
        allowed_key_ids,
    )
    definitions = definitions_from_signed_envelope(envelope)
    return (
        definitions,
        envelope.signature,
        envelope.kid,
        envelope.signed_ts,
        envelope.signed_defs_json,
    )


@dataclass(frozen=True)
class DefinitionsMissPlan:
    """Parsed definitions ready to apply under the client lock."""

    definitions: list[FeatureDefinition]
    response_etag: Optional[str]
    signature: Optional[str] = None
    kid: Optional[str] = None
    signed_ts: Optional[int] = None
    signed_defs_json: Optional[str] = None


@dataclass(frozen=True)
class VariantsMissPlan:
    """Parsed evaluated variants ready to apply under the client lock."""

    defs: dict[str, EvaluatedVariantDef]
    response_etag: Optional[str]
    signature: Optional[str] = None
    kid: Optional[str] = None
    timestamp: Optional[int] = None


class DefinitionRefreshMixin:
    """Shared conditional-GET hit completion for sync and async clients."""

    _flags: dict[str, bool]
    _etag: Optional[str]
    _last_refresh: Optional[datetime]
    _last_signed_timestamp: int
    _variant_defs: dict[str, EvaluatedVariantDef]
    _definitions: dict[str, FeatureDefinition]
    _config: Any

    def _complete_conditional_get_hit(
        self, early: ConditionalGetHit
    ) -> tuple[TogglyInitResponse, Literal["hit"], None]:
        """Mark refresh time, optionally store ETag, return a cache-hit triple."""
        self._last_refresh = datetime.now(timezone.utc)
        if early.etag_to_store:
            self._etag = early.etag_to_store
        return cached_hit_result(self._flags)

    def _complete_stale_signed_hit(
        self,
    ) -> tuple[TogglyInitResponse, Literal["hit"], None]:
        """Serve cached flags when a signed payload is older than last accepted."""
        self._last_refresh = datetime.now(timezone.utc)
        return cached_hit_result(self._flags)

    def _apply_fetched_definitions_unlocked(
        self,
        definitions: list[FeatureDefinition],
        response_etag: Optional[str],
    ) -> None:
        """Apply a new definitions revision; caller must hold ``_lock``."""
        old_flags = dict(self._flags)
        self._variant_defs = {}
        self._definitions = {d.feature_key: d for d in definitions}
        self._update_flags()  # type: ignore[attr-defined]
        self._last_refresh = datetime.now(timezone.utc)
        self._etag = response_etag
        self._notify_changes(old_flags)  # type: ignore[attr-defined]

    def _apply_fetched_variants_unlocked(
        self,
        defs: dict[str, EvaluatedVariantDef],
        response_etag: Optional[str],
    ) -> None:
        """Apply evaluated variants; caller must hold ``_lock``."""
        old_flags = dict(self._flags)
        self._variant_defs = defs
        self._definitions = {}
        self._flags = dict(self._config.feature_defaults)
        for key, vd in defs.items():
            self._flags[key] = vd.enabled
        self._last_refresh = datetime.now(timezone.utc)
        self._etag = response_etag
        self._notify_changes(old_flags)  # type: ignore[attr-defined]

    def _finalize_prepared_definitions(
        self,
        prepared: UnsignedDefinitionsParsed | SignedDefinitionsEnvelope,
        *,
        jwks: Any = None,
    ) -> tuple[
        list[FeatureDefinition],
        Optional[str],
        Optional[str],
        Optional[int],
        Optional[str],
    ]:
        """Turn a prepared body into definitions + optional signed metadata."""
        if isinstance(prepared, SignedDefinitionsEnvelope):
            (
                definitions,
                signature,
                kid,
                signed_ts,
                signed_defs_json,
            ) = verify_and_parse_signed_envelope(
                prepared, jwks, self._config.allowed_key_ids
            )
            self._last_signed_timestamp = signed_ts
            return definitions, signature, kid, signed_ts, signed_defs_json
        return prepared.definitions, None, None, None, None

    def _definitions_miss_result(
        self,
        definitions: list[FeatureDefinition],
        *,
        signature: Optional[str],
        kid: Optional[str],
        signed_ts: Optional[int],
        signed_defs_json: Optional[str],
    ) -> tuple[TogglyInitResponse, Literal["miss"], DefinitionsSnapshot]:
        """Build the miss triple from current client flags/etag."""
        return fetched_definitions_result(
            self._flags,
            definitions,
            etag=self._etag,
            signature=signature,
            kid=kid,
            signed_ts=signed_ts,
            signed_defs_json=signed_defs_json,
        )

    def _variants_miss_result(
        self,
        defs: dict[str, EvaluatedVariantDef],
        *,
        signature: Optional[str],
        kid: Optional[str],
        timestamp: Optional[int],
    ) -> tuple[TogglyInitResponse, Literal["miss"], VariantsSnapshot]:
        """Build the variants miss triple from current client flags/etag."""
        return fetched_variants_result(
            self._flags,
            defs,
            etag=self._etag,
            signature=signature,
            kid=kid,
            timestamp=timestamp,
        )

    def _plan_definitions_http_response(
        self,
        response: Any,
        *,
        load_jwks: Any,
    ) -> (
        tuple[TogglyInitResponse, Literal["hit"], None]
        | DefinitionsMissPlan
    ):
        """Interpret a definitions HTTP response into a hit or miss plan (no lock)."""
        previous_etag = self._etag
        probe = probe_http_cache(response.status_code, previous_etag, response.headers)
        early = resolve_conditional_get(probe, resource_label="definitions")
        if early is not None:
            return self._complete_conditional_get_hit(early)

        prepared = prepare_definitions_body(
            response.text(),
            use_signed=self._config.use_signed_definitions,
            last_signed_timestamp=self._last_signed_timestamp,
        )
        if isinstance(prepared, StaleSignedHit):
            return self._complete_stale_signed_hit()

        jwks = None
        if isinstance(prepared, SignedDefinitionsEnvelope):
            jwks = load_jwks()
        definitions, signature, kid, signed_ts, signed_defs_json = (
            self._finalize_prepared_definitions(prepared, jwks=jwks)
        )
        return DefinitionsMissPlan(
            definitions=definitions,
            response_etag=probe.response_etag,
            signature=signature,
            kid=kid,
            signed_ts=signed_ts,
            signed_defs_json=signed_defs_json,
        )

    def _plan_variants_http_response(
        self,
        response: Any,
    ) -> tuple[TogglyInitResponse, Literal["hit"], None] | VariantsMissPlan:
        """Interpret a variants HTTP response into a hit or miss plan (no lock)."""
        previous_etag = self._etag
        probe = probe_http_cache(response.status_code, previous_etag, response.headers)
        early = resolve_conditional_get(probe, resource_label="evaluated variants")
        if early is not None:
            return self._complete_conditional_get_hit(early)

        data = decode_response_json(response)
        defs, signature, timestamp, kid = parse_evaluated_variants_payload(data)
        return VariantsMissPlan(
            defs=defs,
            response_etag=probe.response_etag,
            signature=signature,
            kid=kid,
            timestamp=timestamp,
        )

    def _commit_definitions_miss_plan(
        self, plan: DefinitionsMissPlan
    ) -> tuple[TogglyInitResponse, Literal["miss"], DefinitionsSnapshot]:
        """Apply a definitions miss plan (caller must already hold ``_lock``)."""
        self._apply_fetched_definitions_unlocked(plan.definitions, plan.response_etag)
        return self._definitions_miss_result(
            plan.definitions,
            signature=plan.signature,
            kid=plan.kid,
            signed_ts=plan.signed_ts,
            signed_defs_json=plan.signed_defs_json,
        )

    def _commit_variants_miss_plan(
        self, plan: VariantsMissPlan
    ) -> tuple[TogglyInitResponse, Literal["miss"], VariantsSnapshot]:
        """Apply a variants miss plan (caller must already hold ``_lock``)."""
        self._apply_fetched_variants_unlocked(plan.defs, plan.response_etag)
        return self._variants_miss_result(
            plan.defs,
            signature=plan.signature,
            kid=plan.kid,
            timestamp=plan.timestamp,
        )
