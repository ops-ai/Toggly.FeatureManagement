"""Utility functions for Toggly Django integration."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from django.http import HttpRequest

from toggly import EvaluationContext, TogglyClient, get_default_client

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractUser


def get_client() -> TogglyClient | None:
    """Get the Toggly client instance.

    Returns:
        The TogglyClient instance or None if not configured.
    """
    return get_default_client()


def get_context_from_request(
    request: HttpRequest,
    include_user_groups: bool = True,
) -> EvaluationContext:
    """Create an EvaluationContext from a Django request.

    Extracts user identity and groups from the request's authenticated user.

    Args:
        request: The Django HttpRequest.
        include_user_groups: Whether to include user's Django groups.

    Returns:
        An EvaluationContext populated from the request.
    """
    identity = None
    groups: list[str] = []
    traits: dict[str, Any] = {}

    # Get user identity
    if hasattr(request, "user") and request.user.is_authenticated:
        user: AbstractUser = request.user  # type: ignore

        # Use user ID as identity
        identity = str(user.pk)

        # Get user groups if requested
        if include_user_groups and hasattr(user, "groups"):
            groups = list(user.groups.values_list("name", flat=True))

        # Add user traits
        if hasattr(user, "email") and user.email:
            traits["email"] = user.email
        if hasattr(user, "is_staff"):
            traits["is_staff"] = user.is_staff
        if hasattr(user, "is_superuser"):
            traits["is_superuser"] = user.is_superuser

    # Add request metadata
    traits["path"] = request.path
    traits["method"] = request.method

    # Add session ID if available
    if hasattr(request, "session") and request.session.session_key:
        traits["session_id"] = request.session.session_key

    return EvaluationContext(
        identity=identity,
        groups=groups,
        traits=traits,
    )


def is_feature_enabled(
    feature_key: str,
    request: HttpRequest | None = None,
    context: EvaluationContext | None = None,
    default: bool = False,
) -> bool:
    """Check if a feature is enabled.

    Args:
        feature_key: The feature key to check.
        request: Optional Django request for context extraction.
        context: Optional explicit evaluation context.
        default: Default value if client is not available.

    Returns:
        True if the feature is enabled.
    """
    client = get_client()
    if client is None:
        return default

    if context is None and request is not None:
        context = get_context_from_request(request)

    return client.is_enabled(feature_key, context, default=default)


def is_feature_disabled(
    feature_key: str,
    request: HttpRequest | None = None,
    context: EvaluationContext | None = None,
    default: bool = True,
) -> bool:
    """Check if a feature is disabled.

    Args:
        feature_key: The feature key to check.
        request: Optional Django request for context extraction.
        context: Optional explicit evaluation context.
        default: Default value if client is not available.

    Returns:
        True if the feature is disabled.
    """
    return not is_feature_enabled(
        feature_key, request, context, default=not default
    )
