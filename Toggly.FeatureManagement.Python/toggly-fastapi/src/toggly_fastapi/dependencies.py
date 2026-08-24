"""FastAPI dependency injection for Toggly feature flags."""

from __future__ import annotations

from typing import Annotated, Any, Callable, Optional

from fastapi import Depends, HTTPException, Request
from starlette.status import HTTP_403_FORBIDDEN
from toggly import EvaluationContext, FeatureRequirement, TogglyClient

from toggly_fastapi.middleware import (
    TogglyRequestHelper,
    get_context_from_request,
    get_current_toggly,
    get_toggly_client,
)


def get_toggly(request: Request) -> TogglyRequestHelper:
    """FastAPI dependency that provides the Toggly request helper.

    This is the primary way to access Toggly in FastAPI route handlers.

    Args:
        request: The FastAPI request.

    Returns:
        TogglyRequestHelper for the current request.

    Raises:
        HTTPException: If Toggly is not configured.

    Example:
        from fastapi import Depends
        from toggly_fastapi import get_toggly, TogglyRequestHelper

        @app.get("/")
        async def root(toggly: TogglyRequestHelper = Depends(get_toggly)):
            if toggly.is_enabled("my-feature"):
                return {"message": "Feature enabled!"}
            return {"message": "Feature disabled"}
    """
    # Try to get from request state (set by middleware)
    if hasattr(request, "state") and hasattr(request.state, "toggly"):
        return request.state.toggly

    # Try to get from context var (set by middleware)
    helper = get_current_toggly()
    if helper is not None:
        return helper

    # Create new helper if middleware not used
    return TogglyRequestHelper(request)


# Type alias for cleaner dependency injection
TogglyDep = Annotated[TogglyRequestHelper, Depends(get_toggly)]


def get_evaluation_context(request: Request) -> EvaluationContext:
    """FastAPI dependency that provides the evaluation context.

    Args:
        request: The FastAPI request.

    Returns:
        EvaluationContext for the current request.

    Example:
        from fastapi import Depends
        from toggly import EvaluationContext
        from toggly_fastapi import get_evaluation_context

        @app.get("/")
        async def root(context: EvaluationContext = Depends(get_evaluation_context)):
            print(f"User: {context.identity}")
            return {"identity": context.identity}
    """
    # Try to get from middleware helper
    if hasattr(request, "state") and hasattr(request.state, "toggly"):
        return request.state.toggly.context

    # Create fresh context
    return get_context_from_request(request)


# Type alias for cleaner dependency injection
ContextDep = Annotated[EvaluationContext, Depends(get_evaluation_context)]


def get_client() -> TogglyClient | None:
    """FastAPI dependency that provides the Toggly client.

    Returns:
        The TogglyClient or None if not configured.

    Example:
        from fastapi import Depends
        from toggly import TogglyClient
        from toggly_fastapi import get_client

        @app.get("/debug")
        async def debug_info(client: TogglyClient = Depends(get_client)):
            if client:
                return client.get_debug_info()
            return {"error": "Client not configured"}
    """
    return get_toggly_client()  # type: ignore


# Type alias for cleaner dependency injection
ClientDep = Annotated[Optional[TogglyClient], Depends(get_client)]


def require_feature(
    feature_key: str,
    *,
    status_code: int = HTTP_403_FORBIDDEN,
    detail: str | None = None,
) -> Callable[[TogglyRequestHelper], bool]:
    """Create a dependency that requires a feature to be enabled.

    Args:
        feature_key: The feature key that must be enabled.
        status_code: HTTP status code if feature is disabled.
        detail: Error message if feature is disabled.

    Returns:
        A dependency function.

    Raises:
        HTTPException: If the feature is disabled.

    Example:
        from fastapi import Depends
        from toggly_fastapi import require_feature

        @app.get(
            "/new-feature",
            dependencies=[Depends(require_feature("new-feature"))]
        )
        async def new_feature_endpoint():
            return {"message": "New feature active!"}

        # With custom error
        @app.get(
            "/beta",
            dependencies=[Depends(require_feature(
                "beta",
                status_code=404,
                detail="Coming soon!"
            ))]
        )
        async def beta_endpoint():
            return {"message": "Beta content"}
    """

    def dependency(toggly: TogglyDep) -> bool:
        if not toggly.is_enabled(feature_key):
            raise HTTPException(
                status_code=status_code,
                detail=detail or f"Feature '{feature_key}' is not available",
            )
        return True

    return dependency


def require_features(
    feature_keys: list[str],
    *,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: bool = False,
    status_code: int = HTTP_403_FORBIDDEN,
    detail: str | None = None,
) -> Callable[[TogglyRequestHelper], bool]:
    """Create a dependency that requires multiple features.

    Args:
        feature_keys: List of feature keys to check.
        requirement: Whether ALL or ANY features must be enabled.
        negate: Whether to negate the result.
        status_code: HTTP status code if gate fails.
        detail: Error message if gate fails.

    Returns:
        A dependency function.

    Raises:
        HTTPException: If the gate check fails.

    Example:
        from fastapi import Depends
        from toggly import FeatureRequirement
        from toggly_fastapi import require_features

        @app.get(
            "/admin",
            dependencies=[Depends(require_features(["admin", "dashboard"]))]
        )
        async def admin_dashboard():
            return {"message": "Admin dashboard"}

        @app.get(
            "/premium",
            dependencies=[Depends(require_features(
                ["premium", "vip"],
                requirement=FeatureRequirement.ANY
            ))]
        )
        async def premium_content():
            return {"message": "Premium content"}
    """

    def dependency(toggly: TogglyDep) -> bool:
        req_str = "all" if requirement == FeatureRequirement.ALL else "any"
        if not toggly.evaluate_gate(feature_keys, req_str, negate):
            raise HTTPException(
                status_code=status_code,
                detail=detail or "Required features are not available",
            )
        return True

    return dependency


def feature_enabled(
    feature_key: str,
    default: bool = False,
) -> Callable[[TogglyRequestHelper], bool]:
    """Create a dependency that provides the feature's enabled state.

    Unlike require_feature, this doesn't raise an exception - it just
    provides the boolean value for use in your route logic.

    Args:
        feature_key: The feature key to check.
        default: Default value if client is unavailable.

    Returns:
        A dependency function that returns the feature state.

    Example:
        from fastapi import Depends
        from toggly_fastapi import feature_enabled

        @app.get("/checkout")
        async def checkout(
            new_checkout: bool = Depends(feature_enabled("new-checkout"))
        ):
            if new_checkout:
                return {"version": "v2", "message": "New checkout!"}
            return {"version": "v1", "message": "Original checkout"}
    """

    def dependency(toggly: TogglyDep) -> bool:
        return toggly.is_enabled(feature_key, default=default)

    return dependency


class FeatureGateDependency:
    """A class-based dependency for complex feature gate logic.

    Useful when you need to inject feature state into a class or
    need more complex dependency patterns.

    Example:
        from fastapi import Depends
        from toggly_fastapi import FeatureGateDependency

        feature_gate = FeatureGateDependency(
            required=["base-feature"],
            optional=["enhanced-mode"]
        )

        @app.get("/api")
        async def api_endpoint(gate: dict = Depends(feature_gate)):
            if gate.get("enhanced-mode"):
                return {"mode": "enhanced"}
            return {"mode": "basic"}
    """

    def __init__(
        self,
        required: list[str] | None = None,
        optional: list[str] | None = None,
        *,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        status_code: int = HTTP_403_FORBIDDEN,
        detail: str | None = None,
    ) -> None:
        """Initialize the dependency.

        Args:
            required: Features that must be enabled.
            optional: Features to check but not require.
            requirement: Whether ALL or ANY required features must be enabled.
            status_code: HTTP status code if required features are missing.
            detail: Error message if required features are missing.
        """
        self.required = required or []
        self.optional = optional or []
        self.requirement = requirement
        self.status_code = status_code
        self.detail = detail

    def __call__(self, toggly: TogglyDep) -> dict[str, bool]:
        """Evaluate the feature gate.

        Args:
            toggly: The Toggly request helper.

        Returns:
            Dictionary of feature key to enabled state.

        Raises:
            HTTPException: If required features are not enabled.
        """
        result: dict[str, bool] = {}

        # Check required features
        if self.required:
            req_str = "all" if self.requirement == FeatureRequirement.ALL else "any"
            if not toggly.evaluate_gate(self.required, req_str):
                raise HTTPException(
                    status_code=self.status_code,
                    detail=self.detail or "Required features are not available",
                )
            for key in self.required:
                result[key] = toggly.is_enabled(key)

        # Check optional features
        for key in self.optional:
            result[key] = toggly.is_enabled(key)

        return result


def with_feature_context(
    identity: str | None = None,
    groups: list[str] | None = None,
    traits: dict[str, Any] | None = None,
) -> Callable[[Request], EvaluationContext]:
    """Create a custom evaluation context dependency.

    Useful when you need to override or augment the automatic
    context extraction.

    Args:
        identity: Override identity.
        groups: Override or additional groups.
        traits: Override or additional traits.

    Returns:
        A dependency function.

    Example:
        from fastapi import Depends
        from toggly_fastapi import with_feature_context

        @app.get("/admin-preview")
        async def admin_preview(
            context: EvaluationContext = Depends(
                with_feature_context(groups=["admin", "preview"])
            )
        ):
            # Evaluate features as if user were in admin/preview groups
            pass
    """

    def dependency(request: Request) -> EvaluationContext:
        # Start with request context
        base_context = get_context_from_request(request)

        # Override/merge values
        return EvaluationContext(
            identity=identity if identity is not None else base_context.identity,
            groups=groups if groups is not None else base_context.groups,
            traits={**base_context.traits, **(traits or {})},
        )

    return dependency
