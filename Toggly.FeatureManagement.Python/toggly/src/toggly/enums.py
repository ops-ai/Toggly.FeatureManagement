"""Enumerations for Toggly SDK."""

from enum import Enum


class FeatureRequirement(Enum):
    """Requirement type for evaluating multiple feature flags."""

    ALL = "all"
    """All specified features must be enabled."""

    ANY = "any"
    """At least one of the specified features must be enabled."""


class LoadStatus(Enum):
    """Status of feature flag loading."""

    FETCHED = "fetched"
    """Definitions were successfully fetched from the server."""

    CACHED = "cached"
    """Definitions were loaded from cache/snapshot."""

    DEFAULTS = "defaults"
    """Using default feature flag values."""

    ERROR = "error"
    """An error occurred while loading definitions."""


class FilterType(Enum):
    """Built-in filter types for feature evaluation."""

    ALWAYS_ON = "AlwaysOn"
    """Feature is always enabled."""

    PERCENTAGE = "Percentage"
    """Percentage-based rollout."""

    TIME_WINDOW = "TimeWindow"
    """Time-based feature availability."""

    TARGETING = "Targeting"
    """User/group targeting rules."""


class AppState(Enum):
    """Application state for lifecycle events."""

    ACTIVE = "active"
    """Application is in foreground and active."""

    INACTIVE = "inactive"
    """Application is transitioning states."""

    BACKGROUND = "background"
    """Application is in background."""
