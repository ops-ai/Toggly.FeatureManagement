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


#: Variant does not affect whether the flag is considered enabled or disabled.
VARIANT_STATUS_OVERRIDE_NONE = "None"
#: When assigned, the feature flag is evaluated as enabled.
VARIANT_STATUS_OVERRIDE_ENABLED = "Enabled"
#: When assigned, the feature flag is evaluated as disabled.
VARIANT_STATUS_OVERRIDE_DISABLED = "Disabled"


@dataclass
class Variant:
    """A named variant of a feature flag (Microsoft.FeatureManagement schema)."""

    name: str
    """Unique name identifying this variant within the feature."""

    configuration_value: Any = None
    """Configuration payload for this variant (string, number, bool, or object)."""

    status_override: str = VARIANT_STATUS_OVERRIDE_NONE
    """``"None"`` | ``"Enabled"`` | ``"Disabled"`` — overrides effective enabled state."""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Variant | None:
        """Create a Variant from a dictionary (camelCase wire keys).

        Returns ``None`` when required fields are missing so a malformed
        catalog row cannot crash ``client.init()``.
        """
        name = data.get("name")
        if not name:
            return None
        return cls(
            name=str(name),
            configuration_value=data.get(
                "configurationValue", data.get("configuration_value")
            ),
            status_override=(
                data.get("statusOverride")
                or data.get("status_override")
                or VARIANT_STATUS_OVERRIDE_NONE
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for serialization."""
        return {
            "name": self.name,
            "configurationValue": self.configuration_value,
            "statusOverride": self.status_override,
        }


@dataclass
class UserAllocation:
    """Assigns a variant to a specific list of users by identity."""

    variant: str
    users: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> UserAllocation | None:
        """Create from a dictionary. Returns ``None`` when ``variant`` is missing."""
        variant = data.get("variant")
        if not variant:
            return None
        return cls(variant=str(variant), users=list(data.get("users") or []))

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for serialization."""
        return {"variant": self.variant, "users": self.users}


@dataclass
class GroupAllocation:
    """Assigns a variant to users belonging to specific groups."""

    variant: str
    groups: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> GroupAllocation | None:
        """Create from a dictionary. Returns ``None`` when ``variant`` is missing."""
        variant = data.get("variant")
        if not variant:
            return None
        return cls(variant=str(variant), groups=list(data.get("groups") or []))

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for serialization."""
        return {"variant": self.variant, "groups": self.groups}


@dataclass
class PercentileAllocation:
    """Assigns a variant to users whose computed percentile falls within a range."""

    variant: str
    from_: float = 0.0
    to: float = 100.0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PercentileAllocation | None:
        """Create from a dictionary (``from`` is a reserved word on the wire).

        Returns ``None`` when ``variant`` is missing. Uses explicit ``None``
        checks for ``from``/``to`` so a boundary of ``0`` is preserved
        (``or`` would wrongly treat ``0`` as missing).
        """
        variant = data.get("variant")
        if not variant:
            return None
        from_raw = data.get("from", 0.0)
        to_raw = data.get("to", 100.0)
        return cls(
            variant=str(variant),
            from_=float(from_raw if from_raw is not None else 0.0),
            to=float(to_raw if to_raw is not None else 100.0),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for serialization."""
        return {"variant": self.variant, "from": self.from_, "to": self.to}


@dataclass
class Allocation:
    """Defines how variants are allocated to users for a feature flag.

    Mirrors the ``Microsoft.FeatureManagement`` ``VariantFeatureDefinition``
    allocation schema: user/group/percentile targeting plus enabled/disabled
    defaults.
    """

    default_when_enabled: str | None = None
    """Variant to assign when enabled and no other allocation matches."""

    default_when_disabled: str | None = None
    """Variant to assign when the feature is disabled."""

    seed: str | None = None
    """Seed for percentile hashing. Defaults to ``allocation\\n{featureName}``."""

    user: list[UserAllocation] = field(default_factory=list)
    """Allocations that assign variants to specific users by identity."""

    group: list[GroupAllocation] = field(default_factory=list)
    """Allocations that assign variants to users in specific groups."""

    percentile: list[PercentileAllocation] = field(default_factory=list)
    """Allocations that assign variants based on a percentile bucket."""

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> Allocation | None:
        """Create an Allocation from a dictionary, or None when absent."""
        if not data:
            return None
        return cls(
            default_when_enabled=data.get("defaultWhenEnabled")
            or data.get("default_when_enabled"),
            default_when_disabled=data.get("defaultWhenDisabled")
            or data.get("default_when_disabled"),
            seed=data.get("seed"),
            user=[
                u
                for u in (UserAllocation.from_dict(x) for x in (data.get("user") or []))
                if u is not None
            ],
            group=[
                g
                for g in (GroupAllocation.from_dict(x) for x in (data.get("group") or []))
                if g is not None
            ],
            percentile=[
                p
                for p in (
                    PercentileAllocation.from_dict(x)
                    for x in (data.get("percentile") or [])
                )
                if p is not None
            ],
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to a dictionary for serialization."""
        return {
            "defaultWhenEnabled": self.default_when_enabled,
            "defaultWhenDisabled": self.default_when_disabled,
            "seed": self.seed,
            "user": [u.to_dict() for u in self.user],
            "group": [g.to_dict() for g in self.group],
            "percentile": [p.to_dict() for p in self.percentile],
        }


@dataclass
class FeatureDefinition:
    """Represents a feature flag definition.

    Contains the feature key and all associated filters that determine
    when the feature should be enabled, plus optional named variants and
    their allocation rules (catalog-local, MF-parity variant assignment).
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

    variants: list[Variant] = field(default_factory=list)
    """Named variants for this feature flag (A/B testing, progressive rollout)."""

    allocation: Allocation | None = None
    """Allocation rules for variant assignment (user, group, percentile targeting)."""

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
            "variants": [v.to_dict() for v in self.variants],
            "allocation": self.allocation.to_dict() if self.allocation else None,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> FeatureDefinition:
        """Create a FeatureDefinition from a dictionary."""
        filters = [
            FeatureFilter(name=f["name"], parameters=f.get("parameters", {}))
            for f in data.get("filters", [])
        ]
        variants = [
            v
            for v in (Variant.from_dict(x) for x in (data.get("variants") or []))
            if v is not None
        ]
        allocation = Allocation.from_dict(data.get("allocation"))
        return cls(
            feature_key=data["feature_key"],
            filters=filters,
            requirement_type=data.get("requirement_type") or data.get("requirementType") or "Any",
            context_kind=data.get("context_kind") or data.get("contextKind"),
            context_requirement_type=data.get("context_requirement_type")
            or data.get("contextRequirementType"),
            secured_feature=data.get("secured_feature", data.get("securedFeature", False)),
            metrics=data.get("metrics"),
            variants=variants,
            allocation=allocation,
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
    """Assigned variant for a feature, computed locally from the catalog.

    Returned by ``get_variant`` / ``get_variant_value``. Assignment follows
    the ``Microsoft.FeatureManagement`` precedence (disabled → only
    ``DefaultWhenDisabled``; enabled → User → Group → Percentile →
    ``DefaultWhenEnabled``), bit-for-bit compatible with MF 4.7.0.
    """

    name: str
    """Assigned variant name."""

    configuration_value: Any = None
    """Optional configuration payload for the variant."""

    enabled: bool = True
    """Effective enabled state after applying the variant's ``StatusOverride``.

    ``is_enabled()`` remains purely filter-based and does not apply
    ``StatusOverride``; use this field when MF-identical effective-enabled
    semantics are required.
    """

    assignment_reason: str = "None"
    """Why this variant was assigned: ``User`` | ``Group`` | ``Percentile`` |
    ``DefaultWhenEnabled`` | ``DefaultWhenDisabled``."""


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
