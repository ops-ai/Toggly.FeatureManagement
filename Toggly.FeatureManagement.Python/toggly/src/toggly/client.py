"""Main Toggly client for feature flag management."""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from toggly.config import TogglyConfig
from toggly.context import EvaluationContext
from toggly.enums import FeatureRequirement, LoadStatus
from toggly.evaluator import EvaluationEngine, EvaluatorRegistry
from toggly.exceptions import TogglyConfigError, TogglyNetworkError
from toggly.http import HttpClient, build_definitions_url
from toggly.models import (
    DebugInfo,
    FeatureDefinition,
    FeatureFilter,
    FeatureState,
    TogglyInitResponse,
)
from toggly.providers import DefinitionsSnapshot, MemorySnapshotProvider

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
        self._flags: dict[str, bool] = dict(config.feature_defaults)
        self._identity = config.identity
        self._is_initialized = False
        self._last_refresh: datetime | None = None
        self._last_error: str | None = None
        self._etag: str | None = None
        self._lock = threading.RLock()

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
        cached = self._load_from_cache()
        if cached:
            self._apply_snapshot(cached)

        # Try to fetch from server if we have an app key
        if self._config.app_key:
            try:
                response = self._fetch_definitions()
                self._is_initialized = True
                self._start_background_refresh()
                return response
            except TogglyNetworkError as e:
                self._last_error = str(e)
                logger.warning(f"Failed to fetch definitions: {e}")

        # Fall back to cached or defaults
        self._is_initialized = True
        self._start_background_refresh()

        if cached:
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
            return self._fetch_definitions()
        except TogglyNetworkError as e:
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
        """Clear cached definitions."""
        self._snapshot_provider.clear()

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
                feature_count=len(self._definitions),
                is_initialized=self._is_initialized,
            )

    def close(self) -> None:
        """Close the client and stop background refresh."""
        self._stop_refresh.set()
        if self._refresh_thread and self._refresh_thread.is_alive():
            self._refresh_thread.join(timeout=5.0)

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

        try:
            data = response.json()
        except Exception as e:
            raise TogglyNetworkError(f"Invalid JSON response: {e}", cause=e) from e

        # Parse definitions
        definitions = self._parse_definitions(data)

        # Update state
        with self._lock:
            old_flags = dict(self._flags)
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
            timestamp=int(time.time()),
        )
        self._snapshot_provider.save_definitions(snapshot)

        return TogglyInitResponse(
            status=LoadStatus.FETCHED,
            flags=dict(self._flags),
            definitions=definitions,
            etag=self._etag,
            timestamp=datetime.now(timezone.utc),
        )

    def _parse_definitions(self, data: Any) -> list[FeatureDefinition]:
        """Parse definitions from API response.

        Args:
            data: JSON data from API.

        Returns:
            List of parsed feature definitions.

        """
        definitions = []

        # Handle array, signed envelope, and object responses
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("defs", data.get("features", data.get("definitions", [])))
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
            return self._snapshot_provider.load_definitions()
        except Exception as e:
            logger.warning(f"Failed to load from cache: {e}")
            return None

    def _apply_snapshot(self, snapshot: DefinitionsSnapshot) -> None:
        """Apply a snapshot to the current state.

        Args:
            snapshot: The snapshot to apply.

        """
        with self._lock:
            self._definitions = {d.feature_key: d for d in snapshot.definitions}
            self._update_flags()
            self._etag = snapshot.etag

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
                try:
                    self.refresh()
                except Exception as e:
                    logger.warning(f"Background refresh failed: {e}")

        self._refresh_thread = threading.Thread(
            target=refresh_loop,
            daemon=True,
            name="toggly-refresh",
        )
        self._refresh_thread.start()
