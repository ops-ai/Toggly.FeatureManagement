"""Configuration for Toggly SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from toggly.providers import SnapshotProvider

# Type alias for state change handler
StateChangeHandler = Callable[[str, bool, bool], None]


@dataclass
class TogglyConfig:
    """Configuration for Toggly client.

    Example:
        >>> config = TogglyConfig(
        ...     app_key="your-app-key",
        ...     environment="Production",
        ...     feature_defaults={"new-feature": False}
        ... )

    """

    app_key: str | None = None
    """Your Toggly application key. Required for server communication."""

    environment: str = "Production"
    """Environment name (e.g., 'Production', 'Staging', 'Development')."""

    base_url: str = "https://definitions.toggly.io"
    """Base URL for the Toggly API."""

    definitions_url: str | None = None
    """Optional custom URL for fetching definitions."""

    identity: str | None = None
    """Default user identity for feature evaluation."""

    feature_defaults: dict[str, bool] = field(default_factory=dict)
    """Default feature flag values when not fetched from server."""

    refresh_interval: float = 180.0
    """Interval in seconds between automatic refreshes. 0 disables auto-refresh."""

    use_signed_definitions: bool = False
    """Whether to verify definition signatures."""

    enable_variants: bool = False
    """When True, fetch evaluated variants from ``/evaluated-variants-signed/...``."""

    allowed_key_ids: list[str] | None = None
    """List of allowed signing key IDs. None allows all keys."""

    connect_timeout: float = 10.0
    """Connection timeout in seconds."""

    request_timeout: float = 30.0
    """Request timeout in seconds."""

    snapshot_provider: SnapshotProvider | None = None
    """Provider for caching definitions locally."""

    enable_usage_tracking: bool = True
    """Whether to track feature flag usage."""

    enable_metrics: bool = False
    """Whether to collect custom metrics."""

    disable_background_refresh: bool = False
    """Disable automatic background refresh."""

    state_change_handlers: list[StateChangeHandler] = field(default_factory=list)
    """Callbacks invoked when feature states change."""

    enable_live_updates: bool = True
    """Enable WebSocket-based live updates for near-instant flag changes."""

    debug: bool = False
    """Enable debug logging."""

    def __post_init__(self) -> None:
        """Validate configuration after initialization."""
        # Ensure base_url doesn't have trailing slash
        self.base_url = self.base_url.rstrip("/")

        # Set definitions URL if not provided
        if self.definitions_url is None:
            self.definitions_url = self.base_url

        # Validate refresh interval
        if self.refresh_interval < 0:
            raise ValueError("refresh_interval must be non-negative")

        # Validate timeouts
        if self.connect_timeout <= 0:
            raise ValueError("connect_timeout must be positive")
        if self.request_timeout <= 0:
            raise ValueError("request_timeout must be positive")

    def with_app_key(self, app_key: str) -> TogglyConfig:
        """Create a new config with the specified app key.

        Args:
            app_key: The application key.

        Returns:
            A new TogglyConfig with the updated app key.

        """
        return self._copy(app_key=app_key)

    def with_environment(self, environment: str) -> TogglyConfig:
        """Create a new config with the specified environment.

        Args:
            environment: The environment name.

        Returns:
            A new TogglyConfig with the updated environment.

        """
        return self._copy(environment=environment)

    def with_defaults(self, defaults: dict[str, bool]) -> TogglyConfig:
        """Create a new config with the specified feature defaults.

        Args:
            defaults: Default feature flag values.

        Returns:
            A new TogglyConfig with the updated defaults.

        """
        return self._copy(feature_defaults={**self.feature_defaults, **defaults})

    def with_snapshot_provider(self, provider: SnapshotProvider) -> TogglyConfig:
        """Create a new config with the specified snapshot provider.

        Args:
            provider: The snapshot provider.

        Returns:
            A new TogglyConfig with the updated provider.

        """
        return self._copy(snapshot_provider=provider)

    def with_state_change_handler(self, handler: StateChangeHandler) -> TogglyConfig:
        """Create a new config with an additional state change handler.

        Args:
            handler: The state change handler.

        Returns:
            A new TogglyConfig with the handler added.

        """
        handlers = self.state_change_handlers + [handler]
        return self._copy(state_change_handlers=handlers)

    def _copy(self, **changes: Any) -> TogglyConfig:
        """Create a copy of this config with the specified changes.

        Args:
            **changes: Fields to update.

        Returns:
            A new TogglyConfig with the updates applied.

        """
        return TogglyConfig(
            app_key=changes.get("app_key", self.app_key),
            environment=changes.get("environment", self.environment),
            base_url=changes.get("base_url", self.base_url),
            definitions_url=changes.get("definitions_url", self.definitions_url),
            identity=changes.get("identity", self.identity),
            feature_defaults=changes.get("feature_defaults", self.feature_defaults.copy()),
            refresh_interval=changes.get("refresh_interval", self.refresh_interval),
            use_signed_definitions=changes.get(
                "use_signed_definitions", self.use_signed_definitions
            ),
            enable_variants=changes.get("enable_variants", self.enable_variants),
            allowed_key_ids=changes.get("allowed_key_ids", self.allowed_key_ids),
            connect_timeout=changes.get("connect_timeout", self.connect_timeout),
            request_timeout=changes.get("request_timeout", self.request_timeout),
            snapshot_provider=changes.get("snapshot_provider", self.snapshot_provider),
            enable_usage_tracking=changes.get("enable_usage_tracking", self.enable_usage_tracking),
            enable_metrics=changes.get("enable_metrics", self.enable_metrics),
            disable_background_refresh=changes.get(
                "disable_background_refresh", self.disable_background_refresh
            ),
            state_change_handlers=changes.get(
                "state_change_handlers", self.state_change_handlers.copy()
            ),
            enable_live_updates=changes.get("enable_live_updates", self.enable_live_updates),
            debug=changes.get("debug", self.debug),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert config to a dictionary (excluding sensitive data).

        Returns:
            Dictionary representation of the config.

        """
        return {
            "app_key": "***" if self.app_key else None,
            "environment": self.environment,
            "base_url": self.base_url,
            "refresh_interval": self.refresh_interval,
            "use_signed_definitions": self.use_signed_definitions,
            "enable_variants": self.enable_variants,
            "enable_usage_tracking": self.enable_usage_tracking,
            "enable_metrics": self.enable_metrics,
            "enable_live_updates": self.enable_live_updates,
            "debug": self.debug,
        }
