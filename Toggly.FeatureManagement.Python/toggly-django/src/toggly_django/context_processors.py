"""Django context processors for Toggly feature flags."""

from __future__ import annotations

from typing import Any

from django.http import HttpRequest

from toggly_django.utils import get_client, get_context_from_request


def toggly_context(request: HttpRequest) -> dict[str, Any]:
    """Context processor that adds Toggly to template context.

    Adds a `toggly` object to the template context that provides
    easy access to feature flags.

    Usage in settings.py:
        TEMPLATES = [
            {
                'OPTIONS': {
                    'context_processors': [
                        ...
                        'toggly_django.context_processors.toggly_context',
                    ],
                },
            },
        ]

    Usage in templates:
        {% if toggly.is_enabled.new_feature %}
            <div>New feature content</div>
        {% endif %}

        or directly:
        {% if toggly.flags.new_feature %}
            <div>New feature content</div>
        {% endif %}

    Args:
        request: The Django request.

    Returns:
        Dictionary with 'toggly' key containing TemplateToggly instance.
    """
    return {
        "toggly": TemplateToggly(request),
    }


class TemplateToggly:
    """Helper class for accessing Toggly in templates."""

    def __init__(self, request: HttpRequest) -> None:
        """Initialize the template helper.

        Args:
            request: The Django request.
        """
        self._request = request
        self._context = None
        self._client = get_client()
        self._flags_cache: dict[str, bool] | None = None

    @property
    def context(self):
        """Get the evaluation context."""
        if self._context is None:
            self._context = get_context_from_request(self._request)
        return self._context

    @property
    def is_enabled(self) -> FeatureFlagChecker:
        """Get a feature flag checker for template attribute access.

        Usage in templates:
            {% if toggly.is_enabled.my_feature %}
        """
        return FeatureFlagChecker(self)

    @property
    def is_disabled(self) -> FeatureFlagChecker:
        """Get a feature flag checker for disabled features.

        Usage in templates:
            {% if toggly.is_disabled.my_feature %}
        """
        return FeatureFlagChecker(self, negate=True)

    @property
    def flags(self) -> dict[str, bool]:
        """Get all feature flags as a dictionary.

        Usage in templates:
            {% if toggly.flags.my_feature %}
            {{ toggly.flags }}
        """
        if self._flags_cache is None:
            if self._client is not None:
                self._flags_cache = self._client.feature_flags
            else:
                self._flags_cache = {}
        return self._flags_cache

    def check(self, feature_key: str, default: bool = False) -> bool:
        """Check if a feature is enabled.

        Args:
            feature_key: The feature key to check.
            default: Default value if client unavailable.

        Returns:
            True if the feature is enabled.
        """
        if self._client is None:
            return default
        return self._client.is_enabled(feature_key, self.context, default=default)


class FeatureFlagChecker:
    """Helper class for attribute-style feature flag access in templates."""

    def __init__(self, toggly: TemplateToggly, negate: bool = False) -> None:
        """Initialize the checker.

        Args:
            toggly: The TemplateToggly instance.
            negate: Whether to negate results.
        """
        self._toggly = toggly
        self._negate = negate

    def __getattr__(self, name: str) -> bool:
        """Get feature flag state by attribute access.

        Converts underscores to hyphens for feature keys.

        Args:
            name: The feature key (underscores converted to hyphens).

        Returns:
            True if feature is enabled (or disabled if negated).
        """
        # Convert underscores to hyphens (common in feature keys)
        feature_key = name.replace("_", "-")
        result = self._toggly.check(feature_key)
        return not result if self._negate else result

    def __getitem__(self, key: str) -> bool:
        """Get feature flag state by item access.

        Args:
            key: The exact feature key.

        Returns:
            True if feature is enabled (or disabled if negated).
        """
        result = self._toggly.check(key)
        return not result if self._negate else result
