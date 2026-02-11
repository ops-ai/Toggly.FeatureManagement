"""Decorators for feature flag-controlled functions."""

from __future__ import annotations

import functools
from typing import Any, Callable, TypeVar, overload

from toggly.context import EvaluationContext
from toggly.enums import FeatureRequirement

# Type variables for decorator typing
F = TypeVar("F", bound=Callable[..., Any])

# Global client reference (set by framework integrations)
_default_client: Any = None


def set_default_client(client: Any) -> None:
    """Set the default client for decorators.

    Args:
        client: The TogglyClient instance to use.
    """
    global _default_client
    _default_client = client


def get_default_client() -> Any:
    """Get the default client.

    Returns:
        The default TogglyClient or None.
    """
    return _default_client


@overload
def feature_flag(feature_key: str) -> Callable[[F], F]:
    ...


@overload
def feature_flag(
    feature_key: str,
    *,
    default: Any = None,
    fallback: Callable[..., Any] | None = None,
    client: Any = None,
) -> Callable[[F], F]:
    ...


def feature_flag(
    feature_key: str,
    *,
    default: Any = None,
    fallback: Callable[..., Any] | None = None,
    client: Any = None,
) -> Callable[[F], F]:
    """Decorator to conditionally execute a function based on a feature flag.

    If the feature is disabled, returns the default value or calls the fallback.

    Example:
        >>> @feature_flag("new-algorithm")
        ... def calculate_score(data):
        ...     return new_algorithm(data)

        >>> @feature_flag("new-feature", fallback=old_implementation)
        ... def process(data):
        ...     return new_implementation(data)

    Args:
        feature_key: The feature flag key to check.
        default: Value to return if feature is disabled (default: None).
        fallback: Function to call if feature is disabled.
        client: TogglyClient instance (uses default if not provided).

    Returns:
        Decorated function.
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            active_client = client or _default_client
            if active_client is None:
                # No client available, execute function
                return func(*args, **kwargs)

            # Extract context from kwargs if provided
            context = kwargs.pop("_feature_context", None)
            if context is None:
                context = EvaluationContext()

            if active_client.is_enabled(feature_key, context):
                return func(*args, **kwargs)
            elif fallback is not None:
                return fallback(*args, **kwargs)
            else:
                return default

        return wrapper  # type: ignore

    return decorator


@overload
def feature_gate(feature_keys: list[str]) -> Callable[[F], F]:
    ...


@overload
def feature_gate(
    feature_keys: list[str],
    *,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: bool = False,
    default: Any = None,
    fallback: Callable[..., Any] | None = None,
    client: Any = None,
) -> Callable[[F], F]:
    ...


def feature_gate(
    feature_keys: list[str],
    *,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: bool = False,
    default: Any = None,
    fallback: Callable[..., Any] | None = None,
    client: Any = None,
) -> Callable[[F], F]:
    """Decorator to conditionally execute based on multiple feature flags.

    Example:
        >>> @feature_gate(["feature-a", "feature-b"], requirement=FeatureRequirement.ALL)
        ... def new_workflow():
        ...     return do_new_workflow()

        >>> @feature_gate(["beta", "premium"], requirement=FeatureRequirement.ANY)
        ... def premium_feature():
        ...     return do_premium_feature()

    Args:
        feature_keys: List of feature flag keys to check.
        requirement: Whether ALL or ANY features must be enabled.
        negate: Whether to negate the result.
        default: Value to return if gate fails (default: None).
        fallback: Function to call if gate fails.
        client: TogglyClient instance (uses default if not provided).

    Returns:
        Decorated function.
    """

    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            active_client = client or _default_client
            if active_client is None:
                # No client available, execute function
                return func(*args, **kwargs)

            # Extract context from kwargs if provided
            context = kwargs.pop("_feature_context", None)
            if context is None:
                context = EvaluationContext()

            if active_client.evaluate_gate(feature_keys, requirement, context, negate):
                return func(*args, **kwargs)
            elif fallback is not None:
                return fallback(*args, **kwargs)
            else:
                return default

        return wrapper  # type: ignore

    return decorator


class FeatureFlagContextManager:
    """Context manager for feature flag evaluation.

    Example:
        >>> with FeatureFlagContextManager(client, "new-feature") as enabled:
        ...     if enabled:
        ...         do_something()
    """

    def __init__(
        self,
        client: Any,
        feature_key: str,
        context: EvaluationContext | None = None,
    ) -> None:
        """Initialize the context manager.

        Args:
            client: TogglyClient instance.
            feature_key: Feature key to evaluate.
            context: Optional evaluation context.
        """
        self._client = client
        self._feature_key = feature_key
        self._context = context
        self._enabled: bool = False

    def __enter__(self) -> bool:
        """Enter the context, evaluating the feature flag.

        Returns:
            True if the feature is enabled.
        """
        if self._client:
            self._enabled = self._client.is_enabled(self._feature_key, self._context)
        return self._enabled

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Exit the context."""
        pass


def feature_context(
    feature_key: str,
    context: EvaluationContext | None = None,
    client: Any = None,
) -> FeatureFlagContextManager:
    """Create a context manager for feature flag evaluation.

    Example:
        >>> with feature_context("new-feature") as enabled:
        ...     if enabled:
        ...         do_new_thing()

    Args:
        feature_key: Feature key to evaluate.
        context: Optional evaluation context.
        client: TogglyClient instance (uses default if not provided).

    Returns:
        A context manager that yields the feature enabled state.
    """
    active_client = client or _default_client
    return FeatureFlagContextManager(active_client, feature_key, context)
