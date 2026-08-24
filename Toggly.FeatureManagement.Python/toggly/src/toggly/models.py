"""Data models for Toggly SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from toggly.enums import LoadStatus


@dataclass
class FeatureFilter:
    """Represents a filter condition for feature evaluation.

    Filters determine whether a feature should be enabled based on
    various conditions like percentage rollout, time windows, or targeting rules.
    """

    name: str
    """Name of the filter type (e.g., 'AlwaysOn', 'Percentage', 'Targeting')."""

    parameters: dict[str, Any] = field(default_factory=dict)
    """Filter-specific parameters."""

    def __post_init__(self) -> None:
        """Validate filter after initialization."""
        if not self.name:
            raise ValueError("Filter name cannot be empty")


@dataclass
class FeatureDefinition:
    """Represents a feature flag definition.

    Contains the feature key and all associated filters that determine
    when the feature should be enabled.
    """

    feature_key: str
    """Unique identifier for the feature."""

    filters: list[FeatureFilter] = field(default_factory=list)
    """List of filters to evaluate for this feature."""

    requirement_type: str = "Any"
    """How to combine user filter results: 'Any' (OR) or 'All' (AND)."""

    context_kind: str | None = None
    """Optional entity context kind bound to this feature."""

    context_requirement_type: str | None = None
    """Any/All requirement for ContextProperty filters. Falls back to requirement_type."""

    secured_feature: bool = False
    """Whether this feature requires additional authorization."""

    metrics: list[str] | None = None
    """Optional list of metric keys for experiments."""

    def __post_init__(self) -> None:
        """Validate feature definition after initialization."""
        if not self.feature_key:
            raise ValueError("Feature key cannot be empty")
        if self.requirement_type not in ("Any", "All"):
            raise ValueError("Requirement type must be 'Any' or 'All'")
        if self.context_requirement_type is not None and self.context_requirement_type not in (
            "Any",
            "All",
        ):
            raise ValueError("Context requirement type must be 'Any' or 'All'")

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for serialization."""
        return {
            "feature_key": self.feature_key,
            "filters": [
                {"name": f.name, "parameters": f.parameters} for f in self.filters
            ],
            "requirement_type": self.requirement_type,
            "context_kind": self.context_kind,
            "context_requirement_type": self.context_requirement_type,
            "secured_feature": self.secured_feature,
            "metrics": self.metrics,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FeatureDefinition:
        """Create a FeatureDefinition from a dictionary."""
        filters = [
            FeatureFilter(name=f["name"], parameters=f.get("parameters", {}))
            for f in data.get("filters", [])
        ]
        return cls(
            feature_key=data["feature_key"],
            filters=filters,
            requirement_type=data.get("requirement_type") or data.get("requirementType") or "Any",
            context_kind=data.get("context_kind") or data.get("contextKind"),
            context_requirement_type=data.get("context_requirement_type")
            or data.get("contextRequirementType"),
            secured_feature=data.get("secured_feature", data.get("securedFeature", False)),
            metrics=data.get("metrics"),
        )


@dataclass
class FeatureState:
    """Represents the current state of a feature flag."""

    feature_key: str
    """Unique identifier for the feature."""

    enabled: bool
    """Whether the feature is currently enabled."""

    source: LoadStatus = LoadStatus.DEFAULTS
    """Where the feature state was loaded from."""

    evaluated_at: datetime | None = None
    """When the feature was last evaluated."""

    metadata: dict[str, Any] = field(default_factory=dict)
    """Additional metadata about the evaluation."""


@dataclass
class TogglyInitResponse:
    """Response from initializing or refreshing Toggly."""

    status: LoadStatus
    """Status of the initialization/refresh."""

    flags: dict[str, bool] = field(default_factory=dict)
    """Current feature flag states."""

    definitions: list[FeatureDefinition] = field(default_factory=list)
    """Full feature definitions if available."""

    error: str | None = None
    """Error message if status is ERROR."""

    etag: str | None = None
    """ETag for cache validation."""

    timestamp: datetime | None = None
    """When the definitions were fetched/cached."""


@dataclass
class NetworkState:
    """Represents the current network state."""

    is_connected: bool
    """Whether network is available."""

    connection_type: str | None = None
    """Type of connection (wifi, cellular, etc.)."""


@dataclass
class DebugInfo:
    """Debug information about the Toggly client state."""

    identity: str | None
    """Current user identity."""

    app_key: str | None
    """Application key being used."""

    environment: str
    """Current environment."""

    base_url: str
    """API base URL."""

    use_signed_definitions: bool
    """Whether signed definitions are enabled."""

    refresh_interval: float
    """Refresh interval in seconds."""

    last_refresh: datetime | None
    """When definitions were last refreshed."""

    last_error: str | None
    """Last error message if any."""

    etag: str | None
    """Current ETag value."""

    feature_count: int
    """Number of loaded features."""

    is_initialized: bool
    """Whether the client is initialized."""


@dataclass
class VariantResult:
    """Assigned variant name and configuration for a feature (when variants are enabled)."""

    name: str
    """Variant name assigned by the server."""

    configuration_value: Any = None
    """Optional configuration payload for the variant."""


@dataclass
class EvaluatedVariantDef:
    """Server-evaluated variant entry for a single feature flag."""

    enabled: bool
    """Whether the feature is enabled."""

    variant: str | None = None
    """Assigned variant name, if any."""

    configuration_value: Any = None
    """Configuration value for the variant (shape depends on the feature)."""

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for serialization."""
        return {
            "enabled": self.enabled,
            "variant": self.variant,
            "configuration_value": self.configuration_value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EvaluatedVariantDef:
        """Create from API or cache dictionary (camelCase or snake_case)."""
        return cls(
            enabled=bool(data.get("enabled", False)),
            variant=data.get("variant"),
            configuration_value=data.get("configurationValue", data.get("configuration_value")),
        )


@dataclass
class SignedDefinitionsResponse:
    """Response containing signed feature definitions."""

    definitions: list[FeatureDefinition]
    """Feature definitions."""

    signature: str
    """ECDSA signature of the definitions."""

    key_id: str
    """ID of the key used for signing."""

    timestamp: int
    """Unix timestamp of when definitions were signed."""


@dataclass
class JsonWebKey:
    """JSON Web Key for signature verification."""

    kty: str
    """Key type (e.g., 'EC')."""

    kid: str
    """Key ID."""

    crv: str
    """Curve name (e.g., 'P-256')."""

    x: str
    """X coordinate (base64url encoded)."""

    y: str
    """Y coordinate (base64url encoded)."""

    alg: str = "ES256"
    """Algorithm."""

    use: str = "sig"
    """Key use."""


@dataclass
class JsonWebKeySet:
    """JSON Web Key Set containing multiple keys."""

    keys: list[JsonWebKey] = field(default_factory=list)
    """List of JSON Web Keys."""

    def get_key(self, kid: str) -> JsonWebKey | None:
        """Get a key by its ID.

        Args:
            kid: Key ID to look up.

        Returns:
            The matching key or None if not found.

        """
        for key in self.keys:
            if key.kid == kid:
                return key
        return None
