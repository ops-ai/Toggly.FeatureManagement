"""Django middleware for Toggly feature flags."""

from __future__ import annotations

from typing import Callable

from django.http import HttpRequest, HttpResponse

from toggly_django.utils import get_client, get_context_from_request


class TogglyMiddleware:
    """Middleware that attaches Toggly context to each request.

    Adds `request.toggly` attribute for easy access to feature flags.

    Usage in settings.py:
        MIDDLEWARE = [
            ...
            'toggly_django.middleware.TogglyMiddleware',
            ...
        ]

    Usage in views:
        def my_view(request):
            if request.toggly.is_enabled('my-feature'):
                ...
    """

    def __init__(
        self,
        get_response: Callable[[HttpRequest], HttpResponse],
    ) -> None:
        """Initialize the middleware.

        Args:
            get_response: The next middleware or view.
        """
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        """Process the request.

        Args:
            request: The incoming request.

        Returns:
            The response from the view.
        """
        # Attach Toggly helper to request
        request.toggly = TogglyRequestHelper(request)  # type: ignore

        response = self.get_response(request)

        return response


class TogglyRequestHelper:
    """Helper class attached to request for easy feature flag access."""

    def __init__(self, request: HttpRequest) -> None:
        """Initialize the helper.

        Args:
            request: The Django request.
        """
        self._request = request
        self._context = None
        self._client = get_client()

    @property
    def context(self):
        """Get or create the evaluation context for this request."""
        if self._context is None:
            self._context = get_context_from_request(self._request)
        return self._context

    def is_enabled(self, feature_key: str, default: bool = False) -> bool:
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

    def is_disabled(self, feature_key: str, default: bool = True) -> bool:
        """Check if a feature is disabled.

        Args:
            feature_key: The feature key to check.
            default: Default value if client unavailable.

        Returns:
            True if the feature is disabled.
        """
        return not self.is_enabled(feature_key, default=not default)

    def evaluate_gate(
        self,
        feature_keys: list[str],
        requirement: str = "all",
        negate: bool = False,
    ) -> bool:
        """Evaluate multiple features as a gate.

        Args:
            feature_keys: List of feature keys.
            requirement: 'all' or 'any'.
            negate: Whether to negate the result.

        Returns:
            True if the gate passes.
        """
        if self._client is None:
            return False

        from toggly import FeatureRequirement

        req = (
            FeatureRequirement.ALL
            if requirement.lower() == "all"
            else FeatureRequirement.ANY
        )
        return self._client.evaluate_gate(
            feature_keys, req, self.context, negate
        )

    @property
    def flags(self) -> dict[str, bool]:
        """Get all feature flags.

        Returns:
            Dictionary of feature key to enabled state.
        """
        if self._client is None:
            return {}
        return self._client.feature_flags
