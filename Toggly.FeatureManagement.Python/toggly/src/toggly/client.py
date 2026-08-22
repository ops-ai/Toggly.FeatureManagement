"""Main Toggly client for feature flag management."""

from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import contextmanager, suppress
from datetime import datetime, timezone
from typing import Any, Iterator
from urllib.parse import urlencode

try:
    import websocket

    HAS_WEBSOCKET = True
except ImportError:
    HAS_WEBSOCKET = False

from toggly.config import TogglyConfig
from toggly.context import EvaluationContext
from toggly.crypto import verify_signed_definitions
from toggly.enums import FeatureRequirement, LoadStatus
from toggly.evaluator import EvaluationEngine, EvaluatorRegistry
from toggly.exceptions import (
    TogglyConfigError,
    TogglyNetworkError,
    TogglySignatureError,
)
from toggly.http import (
    HttpClient,
    build_definitions_url,
    build_evaluated_variants_url,
    build_jwks_url,
)
from toggly.models import (
    DebugInfo,
    EvaluatedVariantDef,
    FeatureDefinition,
    FeatureFilter,
    FeatureState,
    JsonWebKey,
    JsonWebKeySet,
    TogglyInitResponse,
    VariantResult,
)
from toggly.providers import (
    DefinitionsSnapshot,
    JwksSnapshot,
    MemorySnapshotProvider,
    VariantsSnapshot,
)
from toggly.version import __version__
from toggly.entity_context import register_entity_contexts_at_startup

logger = logging.getLogger("toggly")


class TogglyClient:
    """Main client for Toggly feature flag management.

    Provides synchronous API for evaluating feature flags.

    Example:
        >>> config = TogglyConfig(
        ...     app_key="your-app-key",
        ...     environment="Production"
        ... )
        >>> client = TogglyClient(config)
        >>> client.init()
        >>> if client.is_enabled("new-feature"):
        ...     print("Feature is enabled!")

    """

    _FALLBACK_REFRESH_INTERVAL = 20 * 60  # 20 minutes in seconds
    _WS_RECONNECT_DELAY = 5  # seconds

    def __init__(
        self,
        config: TogglyConfig | None = None,
        *,
        app_key: str | None = None,
        environment: str = "Production",
        feature_defaults: dict[str, bool] | None = None,
        **kwargs: Any,
    ) -> None:
        """Initialize the Toggly client.

        Can be initialized with a TogglyConfig object or individual parameters.

        Args:
            config: Configuration object (preferred).
            app_key: Application key (if not using config).
            environment: Environment name (if not using config).
            feature_defaults: Default feature values (if not using config).
            **kwargs: Additional config parameters.

        """
        if config is None:
            config = TogglyConfig(
                app_key=app_key,
                environment=environment,
                feature_defaults=feature_defaults or {},
                **kwargs,
            )

        self._config = config
        self._definitions: dict[str, FeatureDefinition] = {}
        self._variant_defs: dict[str, EvaluatedVariantDef] = {}
        self._flags: dict[str, bool] = dict(config.feature_defaults)
        self._identity = config.identity
        self._is_initialized = False
        self._last_refresh: datetime | None = None
        self._last_error: str | None = None
        self._etag: str | None = None
        self._lock = threading.RLock()
        self._last_signed_timestamp: int = 0
        self._jwks: JsonWebKeySet | None = None
        self._jwks_expiry: float = 0.0

        # Components
        self._http = HttpClient(
            connect_timeout=config.connect_timeout,
            request_timeout=config.request_timeout,
        )
        self._engine = EvaluationEngine()
        self._snapshot_provider = config.snapshot_provider or MemorySnapshotProvider()

        # Background refresh
        self._refresh_thread: threading.Thread | None = None
        self._stop_refresh = threading.Event()

        # WebSocket live updates
        self._ws: Any = None
        self._ws_connected = False
        self._ws_thread: threading.Thread | None = None
        self._last_fallback_refresh: float = 0.0
        self._ws_stop_event = threading.Event()

        if config.app_key:
            register_entity_contexts_at_startup(
                base_url=config.base_url,
                app_key=config.app_key,
                register_on_startup=config.register_contexts_on_startup,
                debug=config.debug,
                timeout=config.connect_timeout,
            )

    @property
    def is_initialized(self) -> bool:
        """Check if the client is initialized.

        Returns:
            True if init() has been called successfully.

        """
        return self._is_initialized

    @property
    def current_identity(self) -> str | None:
        """Get the current user identity.

        Returns:
            The current identity or None.

        """
        return self._identity

    @property
    def feature_flags(self) -> dict[str, bool]:
        """Get all current feature flag states.

        Returns:
            Dictionary of feature key to enabled state.

        """
        with self._lock:
            return dict(self._flags)

    @property
    def registry(self) -> EvaluatorRegistry:
        """Get the evaluator registry for registering custom evaluators.

        Returns:
            The evaluator registry.

        """
        return self._engine.registry

    def init(self) -> TogglyInitResponse:
        """Initialize the client and fetch feature definitions.

        Returns:
            Response containing initialization status and flags.

        """
        # Try to load from cache first
        cached: DefinitionsSnapshot | None = None
        cached_variants: VariantsSnapshot | None = None
        if self._config.enable_variants:
            cached_variants = self._load_variants_from_cache()
            if cached_variants:
                self._apply_variants_snapshot(cached_variants)
        else:
            cached = self._load_from_cache()
            if cached:
                self._apply_snapshot(cached)

        # Try to fetch from server if we have an app key
        if self._config.app_key:
            try:
                response = (
                    self._fetch_variants()
                    if self._config.enable_variants
                    else self._fetch_definitions()
                )
                self._is_initialized = True
                self._start_background_refresh()
                self._start_websocket()
                return response
            except TogglyNetworkError as e:
                self._report_error(f"Failed to fetch definitions: {e}", e)
                self._last_error = str(e)
                logger.warning(f"Failed to fetch definitions: {e}")
            except TogglySignatureError as e:
                self._report_error("Invalid signature", e)
                self._last_error = str(e)
                logger.warning(f"Signature verification failed: {e}")

        # Fall back to cached or defaults
        self._is_initialized = True
        self._start_background_refresh()
        self._start_websocket()

        if self._config.enable_variants:
            if cached_variants:
                return TogglyInitResponse(
                    status=LoadStatus.CACHED,
                    flags=dict(self._flags),
                )
        elif cached:
            return TogglyInitResponse(
                status=LoadStatus.CACHED,
                flags=dict(self._flags),
            )

        return TogglyInitResponse(
            status=LoadStatus.DEFAULTS,
            flags=dict(self._flags),
        )

    def refresh(self) -> TogglyInitResponse:
        """Refresh feature definitions from the server.

        Returns:
            Response containing refresh status and updated flags.

        """
        if not self._config.app_key:
            return TogglyInitResponse(
                status=LoadStatus.DEFAULTS,
                flags=dict(self._flags),
            )

        try:
            if self._config.enable_variants:
                return self._fetch_variants()
            return self._fetch_definitions()
        except TogglyNetworkError as e:
            self._report_error(f"Failed to refresh definitions: {e}", e)
            self._last_error = str(e)
            return TogglyInitResponse(
                status=LoadStatus.ERROR,
                flags=dict(self._flags),
                error=str(e),
            )
        except TogglySignatureError as e:
            self._report_error("Invalid signature", e)
            self._last_error = str(e)
            return TogglyInitResponse(
                status=LoadStatus.ERROR,
                flags=dict(self._flags),
                error=str(e),
            )

    def is_enabled(
        self,
        feature_key: str,
        context: EvaluationContext | None = None,
        default: bool = False,
    ) -> bool:
        """Check if a feature is enabled.

        Args:
            feature_key: The feature key to check.
            context: Optional evaluation context. Uses default identity if not provided.
            default: Default value if feature is not found.

        Returns:
            True if the feature is enabled.

        """
        if context is None:
            context = EvaluationContext(identity=self._identity)

        with self._lock:
            if self._config.enable_variants:
                variant_entry = self._variant_defs.get(feature_key)
                if variant_entry is not None:
                    return variant_entry.enabled

            definition = self._definitions.get(feature_key)

            if definition is None:
                # Check static flags
                return self._flags.get(feature_key, default)

            return self._engine.evaluate(definition, context)

    def is_disabled(
        self,
        feature_key: str,
        context: EvaluationContext | None = None,
        default: bool = True,
    ) -> bool:
        """Check if a feature is disabled.

        Args:
            feature_key: The feature key to check.
            context: Optional evaluation context.
            default: Default value if feature is not found.

        Returns:
            True if the feature is disabled.

        """
        return not self.is_enabled(feature_key, context, default=not default)

    def evaluate_gate(
        self,
        feature_keys: list[str],
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        context: EvaluationContext | None = None,
        negate: bool = False,
    ) -> bool:
        """Evaluate multiple features as a gate.

        Args:
            feature_keys: List of feature keys to evaluate.
            requirement: Whether ALL or ANY features must be enabled.
            context: Optional evaluation context.
            negate: Whether to negate the final result.

        Returns:
            True if the gate passes.

        """
        if not feature_keys:
            # Empty list returns True (no requirements to fail)
            result = True
        elif requirement == FeatureRequirement.ALL:
            result = all(self.is_enabled(key, context) for key in feature_keys)
        else:
            result = any(self.is_enabled(key, context) for key in feature_keys)

        return not result if negate else result

    def get_variant(self, feature_key: str) -> VariantResult | None:
        """Return the assigned variant for a feature when ``enable_variants`` is True.

        Args:
            feature_key: Feature key.

        Returns:
            ``VariantResult`` if a variant is assigned, otherwise ``None``.

        """
        with self._lock:
            if not self._config.enable_variants:
                return None
            entry = self._variant_defs.get(feature_key)
            if entry is None or not entry.variant:
                return None
            return VariantResult(
                name=entry.variant,
                configuration_value=entry.configuration_value,
            )

    def get_variant_value(self, feature_key: str) -> Any:
        """Return the configuration value for the assigned variant, if any.

        Args:
            feature_key: Feature key.

        Returns:
            The variant ``configuration_value``, or ``None`` when unavailable.

        """
        variant = self.get_variant(feature_key)
        if variant is None:
            return None
        return variant.configuration_value

    def get_feature_state(
        self,
        feature_key: str,
        context: EvaluationContext | None = None,
    ) -> FeatureState:
        """Get detailed state information for a feature.

        Args:
            feature_key: The feature key.
            context: Optional evaluation context.

        Returns:
            FeatureState with details about the feature.

        """
        enabled = self.is_enabled(feature_key, context)
        with self._lock:
            definition = self._definitions.get(feature_key)

        return FeatureState(
            feature_key=feature_key,
            enabled=enabled,
            source=LoadStatus.FETCHED if definition else LoadStatus.DEFAULTS,
            evaluated_at=datetime.now(timezone.utc),
            metadata={
                "has_definition": definition is not None,
                "filter_count": len(definition.filters) if definition else 0,
            },
        )

    def set_identity(self, identity: str | None) -> TogglyInitResponse:
        """Set the current user identity.

        If identity changes and we have an app key, refreshes definitions.

        Args:
            identity: The new identity or None to clear.

        Returns:
            Response from refresh (if applicable).

        """
        old_identity = self._identity
        self._identity = identity

        # Notify handlers of identity change
        for handler in self._config.state_change_handlers:
            try:
                handler("__identity__", old_identity is not None, identity is not None)
            except Exception as e:
                logger.warning(f"State change handler error: {e}")

        # Refresh if we have an app key
        if self._config.app_key:
            return self.refresh()

        return TogglyInitResponse(
            status=LoadStatus.DEFAULTS,
            flags=dict(self._flags),
        )

    def clear_cache(self) -> None:
        """Clear cached definitions and JWKS."""
        self._snapshot_provider.clear()
        self._jwks = None
        self._jwks_expiry = 0.0
        self._last_signed_timestamp = 0
        self._etag = None

    def _report_error(self, message: str, error: Exception | None = None) -> None:
        """Invoke the optional on_error callback."""
        handler = self._config.on_error
        if handler is None:
            return
        try:
            handler(message, error)
        except Exception as callback_ex:
            logger.warning(f"on_error callback threw: {callback_ex}")

    def get_debug_info(self) -> DebugInfo:
        """Get debug information about the client state.

        Returns:
            DebugInfo with current state details.

        """
        with self._lock:
            return DebugInfo(
                identity=self._identity,
                app_key=self._config.app_key,
                environment=self._config.environment,
                base_url=self._config.base_url,
                use_signed_definitions=self._config.use_signed_definitions,
                refresh_interval=self._config.refresh_interval,
                last_refresh=self._last_refresh,
                last_error=self._last_error,
                etag=self._etag,
                feature_count=(
                    len(self._variant_defs)
                    if self._config.enable_variants
                    else len(self._definitions)
                ),
                is_initialized=self._is_initialized,
            )

    def close(self) -> None:
        """Close the client and stop background refresh."""
        self._stop_refresh.set()
        if self._refresh_thread and self._refresh_thread.is_alive():
            self._refresh_thread.join(timeout=5.0)
        self._stop_websocket()

    @contextmanager
    def feature_context(
        self,
        feature_key: str,
        context: EvaluationContext | None = None,
    ) -> Iterator[bool]:
        """Context manager for feature flag evaluation.

        Example:
            >>> with client.feature_context("new-feature") as enabled:
            ...     if enabled:
            ...         do_something()

        Args:
            feature_key: The feature key to check.
            context: Optional evaluation context.

        Yields:
            True if the feature is enabled.

        """
        yield self.is_enabled(feature_key, context)

    def __enter__(self) -> TogglyClient:
        """Enter context manager."""
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit context manager."""
        self.close()

    def _fetch_definitions(self) -> TogglyInitResponse:
        """Fetch definitions from the server.

        Returns:
            TogglyInitResponse with status and flags.

        Raises:
            TogglyNetworkError: If the request fails.
            TogglySignatureError: If signature verification fails.

        """
        if not self._config.app_key:
            raise TogglyConfigError("app_key is required for fetching definitions")

        url = build_definitions_url(
            self._config.base_url,
            self._config.app_key,
            self._config.environment,
            use_signed=self._config.use_signed_definitions,
            identity=self._identity,
        )

        headers: dict[str, str] = {}
        if self._etag:
            headers["If-None-Match"] = self._etag

        response = self._http.get(url, headers=headers)

        if response.status_code == 304:
            # Not modified
            self._last_refresh = datetime.now(timezone.utc)
            return TogglyInitResponse(
                status=LoadStatus.CACHED,
                flags=dict(self._flags),
            )

        if response.status_code != 200:
            raise TogglyNetworkError(
                f"Failed to fetch definitions: HTTP {response.status_code}",
                status_code=response.status_code,
            )

        raw_body = response.text()
        try:
            data = json.loads(raw_body)
        except Exception as e:
            raise TogglyNetworkError(f"Invalid JSON response: {e}", cause=e) from e

        signature: str | None = None
        kid: str | None = None
        signed_ts: int | None = None
        signed_defs_json: str | None = None

        if self._config.use_signed_definitions:
            if not isinstance(data, dict):
                raise TogglySignatureError("Signed response must be an object")
            signed_defs_json = self._extract_raw_defs_json(raw_body)
            if signed_defs_json is None:
                raise TogglySignatureError("Signed response missing defs")
            raw_sig = data.get("signature")
            signature = raw_sig if isinstance(raw_sig, str) else None
            raw_kid = data.get("kid")
            kid = raw_kid if isinstance(raw_kid, str) else None
            ts = data.get("timestamp")
            if isinstance(ts, bool):
                signed_ts = None
            elif isinstance(ts, (int, float)):
                signed_ts = int(ts)
            else:
                signed_ts = None
            if not signature:
                raise TogglySignatureError("Signed response missing signature")
            if not kid:
                raise TogglySignatureError("Signed response missing kid")
            if signed_ts is None:
                raise TogglySignatureError("Signed response missing timestamp")
            if signed_ts < self._last_signed_timestamp and self._last_signed_timestamp > 0:
                self._last_refresh = datetime.now(timezone.utc)
                return TogglyInitResponse(
                    status=LoadStatus.CACHED,
                    flags=dict(self._flags),
                )

            jwks = self._load_or_fetch_jwks()
            verify_signed_definitions(
                signed_defs_json,
                signed_ts,
                signature,
                kid,
                jwks,
                self._config.allowed_key_ids,
            )
            definitions = self._parse_definitions(json.loads(signed_defs_json))
            self._last_signed_timestamp = signed_ts
        else:
            definitions = self._parse_definitions(data)

        # Update state
        with self._lock:
            old_flags = dict(self._flags)
            self._variant_defs = {}
            self._definitions = {d.feature_key: d for d in definitions}
            self._update_flags()
            self._last_refresh = datetime.now(timezone.utc)
            self._etag = response.headers.get("ETag")

            # Notify handlers of changes
            self._notify_changes(old_flags)

        # Save to cache
        snapshot = DefinitionsSnapshot(
            definitions=definitions,
            etag=self._etag,
            timestamp=signed_ts if signed_ts is not None else int(time.time()),
            signature=signature,
            key_id=kid,
            signed_defs_json=signed_defs_json,
        )
        self._snapshot_provider.save_definitions(snapshot)

        return TogglyInitResponse(
            status=LoadStatus.FETCHED,
            flags=dict(self._flags),
            definitions=definitions,
            etag=self._etag,
            timestamp=datetime.now(timezone.utc),
        )

    def _extract_raw_defs_json(self, body: str) -> str | None:
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

    def _load_or_fetch_jwks(self) -> JsonWebKeySet:
        """Load JWKS from memory/cache or fetch from the server."""
        now = time.time()
        if self._jwks is not None and now < self._jwks_expiry:
            return self._jwks

        cached = self._snapshot_provider.load_jwks()
        if cached is not None and cached.jwks.keys:
            # Treat cached JWKS as valid for 30 days from its timestamp when present
            self._jwks = cached.jwks
            self._jwks_expiry = now + 30 * 24 * 3600
            return cached.jwks

        url = build_jwks_url(self._config.base_url)
        response = self._http.get(url)
        if response.status_code != 200:
            raise TogglyNetworkError(
                f"Failed to fetch JWKS: HTTP {response.status_code}",
                status_code=response.status_code,
            )
        try:
            data = response.json()
        except Exception as e:
            raise TogglyNetworkError(f"Invalid JWKS JSON: {e}", cause=e) from e

        keys: list[JsonWebKey] = []
        for item in data.get("keys", []) if isinstance(data, dict) else []:
            if not isinstance(item, dict):
                continue
            if not all(k in item for k in ("kid", "crv", "x", "y")):
                continue
            keys.append(
                JsonWebKey(
                    kty=item.get("kty", "EC"),
                    kid=item["kid"],
                    crv=item["crv"],
                    x=item["x"],
                    y=item["y"],
                    alg=item.get("alg", "ES256"),
                    use=item.get("use", "sig"),
                )
            )
        jwks = JsonWebKeySet(keys=keys)
        self._jwks = jwks
        self._jwks_expiry = now + 30 * 24 * 3600
        self._snapshot_provider.save_jwks(
            JwksSnapshot(jwks=jwks, timestamp=int(now))
        )
        return jwks

    def _fetch_variants(self) -> TogglyInitResponse:
        """Fetch evaluated variants from the signed variants endpoint."""
        if not self._config.app_key:
            raise TogglyConfigError("app_key is required for fetching variants")

        url = build_evaluated_variants_url(
            self._config.base_url,
            self._config.app_key,
            self._config.environment,
            identity=self._identity,
        )

        headers: dict[str, str] = {}
        if self._etag:
            headers["If-None-Match"] = self._etag

        response = self._http.get(url, headers=headers)

        if response.status_code == 304:
            self._last_refresh = datetime.now(timezone.utc)
            return TogglyInitResponse(
                status=LoadStatus.CACHED,
                flags=dict(self._flags),
            )

        if response.status_code != 200:
            raise TogglyNetworkError(
                f"Failed to fetch evaluated variants: HTTP {response.status_code}",
                status_code=response.status_code,
            )

        try:
            data = response.json()
        except Exception as e:
            raise TogglyNetworkError(f"Invalid JSON response: {e}", cause=e) from e

        defs, signature, timestamp, kid = self._parse_variants_payload(data)

        with self._lock:
            old_flags = dict(self._flags)
            self._variant_defs = defs
            self._definitions = {}
            self._flags = dict(self._config.feature_defaults)
            for key, vd in defs.items():
                self._flags[key] = vd.enabled
            self._last_refresh = datetime.now(timezone.utc)
            self._etag = response.headers.get("ETag")
            self._notify_changes(old_flags)

        snapshot = VariantsSnapshot(
            defs=defs,
            signature=signature,
            key_id=kid,
            timestamp=timestamp,
            etag=self._etag,
        )
        self._snapshot_provider.save_variants(snapshot)

        return TogglyInitResponse(
            status=LoadStatus.FETCHED,
            flags=dict(self._flags),
            etag=self._etag,
            timestamp=datetime.now(timezone.utc),
        )

    def _parse_variants_payload(
        self, data: Any
    ) -> tuple[dict[str, EvaluatedVariantDef], str | None, int | None, str | None]:
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

    def _parse_definitions(self, data: Any) -> list[FeatureDefinition]:
        """Parse definitions from API response.

        Args:
            data: JSON data from API.

        Returns:
            List of parsed feature definitions.

        """
        definitions = []

        # Handle array, signed envelope, and object responses
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

    def _load_from_cache(self) -> DefinitionsSnapshot | None:
        """Load definitions from cache.

        Returns:
            Cached snapshot or None.

        """
        try:
            snapshot = self._snapshot_provider.load_definitions()
        except Exception as e:
            logger.warning(f"Failed to load from cache: {e}")
            return None

        if snapshot is None:
            return None

        if self._config.use_signed_definitions:
            if not snapshot.has_signature_metadata():
                self._report_error(
                    "Snapshot is missing SignedDefsJson; loaded without "
                    "cryptographic re-verification. Clear and refresh to upgrade "
                    "the snapshot.",
                    None,
                )
                return snapshot
            try:
                jwks = self._load_or_fetch_jwks()
                assert snapshot.signed_defs_json is not None
                assert snapshot.timestamp is not None
                assert snapshot.signature is not None
                assert snapshot.key_id is not None
                verify_signed_definitions(
                    snapshot.signed_defs_json,
                    snapshot.timestamp,
                    snapshot.signature,
                    snapshot.key_id,
                    jwks,
                    self._config.allowed_key_ids,
                )
            except Exception as e:
                self._report_error("Failed to verify cached snapshot", e)
                logger.warning(f"Cached snapshot verification failed: {e}")
                return None

        return snapshot

    def _load_variants_from_cache(self) -> VariantsSnapshot | None:
        """Load evaluated variants from cache."""
        try:
            return self._snapshot_provider.load_variants()
        except Exception as e:
            logger.warning(f"Failed to load variants from cache: {e}")
            return None

    def _apply_variants_snapshot(self, snapshot: VariantsSnapshot) -> None:
        """Apply a variants snapshot to in-memory state."""
        with self._lock:
            self._variant_defs = dict(snapshot.defs)
            self._definitions = {}
            self._flags = dict(self._config.feature_defaults)
            for key, vd in snapshot.defs.items():
                self._flags[key] = vd.enabled
            self._etag = snapshot.etag

    def _apply_snapshot(self, snapshot: DefinitionsSnapshot) -> None:
        """Apply a snapshot to the current state.

        Args:
            snapshot: The snapshot to apply.

        """
        with self._lock:
            self._variant_defs = {}
            self._definitions = {d.feature_key: d for d in snapshot.definitions}
            self._update_flags()
            self._etag = snapshot.etag
            if snapshot.timestamp is not None:
                self._last_signed_timestamp = snapshot.timestamp

    def _update_flags(self) -> None:
        """Update flags dictionary based on current definitions."""
        # Start with defaults
        self._flags = dict(self._config.feature_defaults)

        # Evaluate all definitions with current context
        context = EvaluationContext(identity=self._identity)
        for key, definition in self._definitions.items():
            self._flags[key] = self._engine.evaluate(definition, context)

    def _notify_changes(self, old_flags: dict[str, bool]) -> None:
        """Notify handlers of feature flag changes.

        Args:
            old_flags: Previous flag states.

        """
        for key, new_value in self._flags.items():
            old_value = old_flags.get(key)
            if old_value != new_value:
                for handler in self._config.state_change_handlers:
                    try:
                        handler(key, old_value or False, new_value)
                    except Exception as e:
                        logger.warning(f"State change handler error: {e}")

    def _start_background_refresh(self) -> None:
        """Start background refresh thread."""
        if self._config.disable_background_refresh:
            return
        if self._config.refresh_interval <= 0:
            return
        if not self._config.app_key:
            return

        def refresh_loop() -> None:
            while not self._stop_refresh.wait(self._config.refresh_interval):
                # When WebSocket is connected and fallback interval hasn't elapsed, skip
                if (
                    self._ws_connected
                    and (time.time() - self._last_fallback_refresh)
                    < self._FALLBACK_REFRESH_INTERVAL
                ):
                    logger.debug(
                        "Skipping background refresh: WebSocket connected"
                    )
                    continue
                try:
                    self.refresh()
                    if self._ws_connected:
                        self._last_fallback_refresh = time.time()
                except Exception as e:
                    logger.warning(f"Background refresh failed: {e}")

        self._refresh_thread = threading.Thread(
            target=refresh_loop,
            daemon=True,
            name="toggly-refresh",
        )
        self._refresh_thread.start()

    def _start_websocket(self) -> None:
        """Start WebSocket connection for live updates."""
        if not self._config.enable_live_updates:
            return
        if not self._config.app_key:
            return

        if not HAS_WEBSOCKET:
            logger.debug(
                "websocket-client package not installed; skipping live updates. "
                "Install with: pip install toggly[websocket]"
            )
            return

        # Build WebSocket URL from base_url
        ws_url = self._config.base_url.replace("https://", "wss://").replace(
            "http://", "ws://"
        )
        ws_url = f"{ws_url}/{self._config.app_key}/ws"
        query_params = {
            "sdk": "python",
            "sdkVersion": __version__,
        }
        if self._etag:
            query_params["rev"] = self._etag
        ws_url = f"{ws_url}?{urlencode(query_params)}"

        self._ws_stop_event.clear()

        def ws_thread_loop() -> None:
            while not self._ws_stop_event.is_set():
                try:
                    ws_app = websocket.WebSocketApp(
                        ws_url,
                        on_open=self._on_ws_open,
                        on_message=self._on_ws_message,
                        on_close=self._on_ws_close,
                        on_error=self._on_ws_error,
                    )
                    self._ws = ws_app
                    ws_app.run_forever()
                except Exception as e:
                    logger.warning(f"WebSocket connection error: {e}")
                finally:
                    self._ws_connected = False

                if self._ws_stop_event.is_set():
                    break

                logger.debug(
                    f"WebSocket disconnected, reconnecting in "
                    f"{self._WS_RECONNECT_DELAY}s..."
                )
                self._ws_stop_event.wait(self._WS_RECONNECT_DELAY)

        self._ws_thread = threading.Thread(
            target=ws_thread_loop,
            daemon=True,
            name="toggly-websocket",
        )
        self._ws_thread.start()

    def _stop_websocket(self) -> None:
        """Stop WebSocket connection."""
        self._ws_stop_event.set()
        if self._ws is not None:
            with suppress(Exception):
                self._ws.close()
        if self._ws_thread is not None and self._ws_thread.is_alive():
            self._ws_thread.join(timeout=5.0)
        self._ws = None
        self._ws_connected = False

    def _on_ws_open(self, ws: Any) -> None:
        """Handle WebSocket connection open."""
        self._ws_connected = True
        self._last_fallback_refresh = time.time()
        logger.debug("WebSocket connected for live updates")

    def _on_ws_message(self, ws: Any, message: str) -> None:
        """Handle incoming WebSocket message."""
        try:
            data = json.loads(message)
        except (json.JSONDecodeError, TypeError):
            logger.debug(f"Ignoring non-JSON WebSocket message: {message!r}")
            return

        msg_type = data.get("type", "")

        if msg_type == "ping":
            return

        if msg_type == "signing-key-updated":
            logger.debug("Received signing-key-updated, clearing JWKS and refreshing")
            self._jwks = None
            self._jwks_expiry = 0.0
            self._etag = None
            try:
                self._snapshot_provider.clear_jwks()
            except Exception as e:
                self._report_error("Failed to clear JWKS after signing-key-updated", e)
            try:
                self.refresh()
            except Exception as e:
                self._report_error("Refresh after signing-key-updated failed", e)
                logger.warning(f"Refresh after signing-key-updated failed: {e}")
            return

        if msg_type in ("flags-updated", "update"):
            logger.debug(f"Received live update ({msg_type}), refreshing definitions")
            try:
                self.refresh()
            except Exception as e:
                logger.warning(f"Refresh after WebSocket update failed: {e}")

    def _on_ws_close(self, ws: Any, close_status_code: Any, close_msg: Any) -> None:
        """Handle WebSocket connection close."""
        self._ws_connected = False
        logger.debug(
            f"WebSocket closed (status={close_status_code}, msg={close_msg})"
        )

    def _on_ws_error(self, ws: Any, error: Any) -> None:
        """Handle WebSocket error."""
        logger.warning(f"WebSocket error: {error}")
