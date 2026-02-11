"""FastAPI route decorators for Toggly feature flags."""

from __future__ import annotations

import functools
import inspect
from typing import Any, Callable, Optional, TypeVar

from fastapi import Depends, HTTPException, Request
from starlette.status import HTTP_403_FORBIDDEN

from toggly import FeatureRequirement

from toggly_fastapi.dependencies import TogglyDep, get_toggly
from toggly_fastapi.middleware import TogglyRequestHelper

F = TypeVar("F", bound=Callable[..., Any])


def feature_flag_required(
    feature_key: str,
    *,
    status_code: int = HTTP_403_FORBIDDEN,
    detail: Optional[str] = None,
    fallback: Optional[Callable[..., Any]] = None,
) -> Callable[[F], F]:
    """Decorator to require a feature flag for a route handler.

    This decorator wraps the route function to check if a feature is enabled
    before executing the handler.

    Args:
        feature_key: The feature key that must be enabled.
        status_code: HTTP status code to return if feature is disabled.
        detail: Error message if feature is disabled.
        fallback: Optional fallback function to call if feature is disabled.

    Returns:
        Decorated route function.

    Example:
        @app.get("/new-dashboard")
        @feature_flag_required("new-dashboard")
        async def new_dashboard():
            return {"message": "New dashboard!"}

        @app.get("/beta")
        @feature_flag_required("beta", status_code=404, detail="Coming soon!")
        async def beta_view():
            return {"message": "Beta content"}

        # With fallback
        async def old_checkout():
            return {"version": "v1"}

        @app.get("/checkout")
        @feature_flag_required("new-checkout", fallback=old_checkout)
        async def new_checkout():
            return {"version": "v2"}
    """

    def decorator(func: F) -> F:
        # Check if function is async
        is_async = inspect.iscoroutinefunction(func)

        if is_async:

            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                # Get toggly from kwargs or create new
                toggly = kwargs.get("toggly")
                if toggly is None:
                    request = kwargs.get("request")
                    if request is None:
                        # Look for Request in args
                        for arg in args:
                            if isinstance(arg, Request):
                                request = arg
                                break
                    if request is not None:
                        toggly = TogglyRequestHelper(request)

                if toggly is None or not toggly.is_enabled(feature_key):
                    if fallback is not None:
                        if inspect.iscoroutinefunction(fallback):
                            return await fallback(*args, **kwargs)
                        return fallback(*args, **kwargs)

                    raise HTTPException(
                        status_code=status_code,
                        detail=detail or f"Feature '{feature_key}' is not available",
                    )

                return await func(*args, **kwargs)

            return async_wrapper  # type: ignore
        else:

            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                toggly = kwargs.get("toggly")
                if toggly is None:
                    request = kwargs.get("request")
                    if request is None:
                        for arg in args:
                            if isinstance(arg, Request):
                                request = arg
                                break
                    if request is not None:
                        toggly = TogglyRequestHelper(request)

                if toggly is None or not toggly.is_enabled(feature_key):
                    if fallback is not None:
                        return fallback(*args, **kwargs)

                    raise HTTPException(
                        status_code=status_code,
                        detail=detail or f"Feature '{feature_key}' is not available",
                    )

                return func(*args, **kwargs)

            return sync_wrapper  # type: ignore

    return decorator


def feature_gate_required(
    feature_keys: list[str],
    *,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: bool = False,
    status_code: int = HTTP_403_FORBIDDEN,
    detail: Optional[str] = None,
    fallback: Optional[Callable[..., Any]] = None,
) -> Callable[[F], F]:
    """Decorator to require multiple feature flags for a route handler.

    Args:
        feature_keys: List of feature keys to check.
        requirement: Whether ALL or ANY features must be enabled.
        negate: Whether to negate the result.
        status_code: HTTP status code to return if gate fails.
        detail: Error message if gate fails.
        fallback: Optional fallback function to call if gate fails.

    Returns:
        Decorated route function.

    Example:
        @app.get("/admin")
        @feature_gate_required(["admin", "dashboard"])
        async def admin_dashboard():
            return {"message": "Admin dashboard"}

        @app.get("/premium")
        @feature_gate_required(
            ["premium", "vip"],
            requirement=FeatureRequirement.ANY
        )
        async def premium_content():
            return {"message": "Premium content"}
    """

    def decorator(func: F) -> F:
        is_async = inspect.iscoroutinefunction(func)
        req_str = "all" if requirement == FeatureRequirement.ALL else "any"

        if is_async:

            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                toggly = kwargs.get("toggly")
                if toggly is None:
                    request = kwargs.get("request")
                    if request is None:
                        for arg in args:
                            if isinstance(arg, Request):
                                request = arg
                                break
                    if request is not None:
                        toggly = TogglyRequestHelper(request)

                if toggly is None or not toggly.evaluate_gate(
                    feature_keys, req_str, negate
                ):
                    if fallback is not None:
                        if inspect.iscoroutinefunction(fallback):
                            return await fallback(*args, **kwargs)
                        return fallback(*args, **kwargs)

                    raise HTTPException(
                        status_code=status_code,
                        detail=detail or "Required features are not available",
                    )

                return await func(*args, **kwargs)

            return async_wrapper  # type: ignore
        else:

            @functools.wraps(func)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                toggly = kwargs.get("toggly")
                if toggly is None:
                    request = kwargs.get("request")
                    if request is None:
                        for arg in args:
                            if isinstance(arg, Request):
                                request = arg
                                break
                    if request is not None:
                        toggly = TogglyRequestHelper(request)

                if toggly is None or not toggly.evaluate_gate(
                    feature_keys, req_str, negate
                ):
                    if fallback is not None:
                        return fallback(*args, **kwargs)

                    raise HTTPException(
                        status_code=status_code,
                        detail=detail or "Required features are not available",
                    )

                return func(*args, **kwargs)

            return sync_wrapper  # type: ignore

    return decorator


def feature_switch(
    feature_key: str,
    enabled_handler: Callable[..., Any],
    disabled_handler: Callable[..., Any],
) -> Callable[..., Any]:
    """Create a route handler that switches between two implementations.

    Args:
        feature_key: The feature key to check.
        enabled_handler: Handler to use when feature is enabled.
        disabled_handler: Handler to use when feature is disabled.

    Returns:
        A route handler that delegates based on feature state.

    Example:
        async def new_checkout(request: Request):
            return {"version": "v2"}

        async def old_checkout(request: Request):
            return {"version": "v1"}

        app.add_api_route(
            "/checkout",
            feature_switch("new-checkout", new_checkout, old_checkout),
            methods=["GET"]
        )
    """
    is_async = inspect.iscoroutinefunction(
        enabled_handler
    ) or inspect.iscoroutinefunction(disabled_handler)

    if is_async:

        async def async_handler(*args: Any, **kwargs: Any) -> Any:
            request = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if request is not None:
                toggly = TogglyRequestHelper(request)
                if toggly.is_enabled(feature_key):
                    if inspect.iscoroutinefunction(enabled_handler):
                        return await enabled_handler(*args, **kwargs)
                    return enabled_handler(*args, **kwargs)

            if inspect.iscoroutinefunction(disabled_handler):
                return await disabled_handler(*args, **kwargs)
            return disabled_handler(*args, **kwargs)

        return async_handler
    else:

        def sync_handler(*args: Any, **kwargs: Any) -> Any:
            request = kwargs.get("request")
            if request is None:
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break

            if request is not None:
                toggly = TogglyRequestHelper(request)
                if toggly.is_enabled(feature_key):
                    return enabled_handler(*args, **kwargs)

            return disabled_handler(*args, **kwargs)

        return sync_handler


class FeatureFlagRouter:
    """A wrapper for FastAPI router that applies feature flags to all routes.

    Example:
        from fastapi import APIRouter
        from toggly_fastapi import FeatureFlagRouter

        router = APIRouter()
        feature_router = FeatureFlagRouter(router, "beta-api")

        @feature_router.get("/users")
        async def list_users():
            return {"users": []}

        @feature_router.post("/users")
        async def create_user():
            return {"status": "created"}
    """

    def __init__(
        self,
        router: Any,
        feature_key: str,
        *,
        status_code: int = HTTP_403_FORBIDDEN,
        detail: Optional[str] = None,
    ) -> None:
        """Initialize the feature flag router.

        Args:
            router: The FastAPI APIRouter to wrap.
            feature_key: The feature key required for all routes.
            status_code: HTTP status code if feature is disabled.
            detail: Error message if feature is disabled.
        """
        self._router = router
        self._feature_key = feature_key
        self._status_code = status_code
        self._detail = detail

    def _wrap_endpoint(self, endpoint: Callable[..., Any]) -> Callable[..., Any]:
        """Wrap an endpoint with feature flag checking.

        Args:
            endpoint: The route handler to wrap.

        Returns:
            Wrapped handler.
        """
        return feature_flag_required(
            self._feature_key,
            status_code=self._status_code,
            detail=self._detail,
        )(endpoint)

    def get(
        self, path: str, **kwargs: Any
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Register a GET route."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            wrapped = self._wrap_endpoint(func)
            self._router.get(path, **kwargs)(wrapped)
            return wrapped

        return decorator

    def post(
        self, path: str, **kwargs: Any
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Register a POST route."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            wrapped = self._wrap_endpoint(func)
            self._router.post(path, **kwargs)(wrapped)
            return wrapped

        return decorator

    def put(
        self, path: str, **kwargs: Any
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Register a PUT route."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            wrapped = self._wrap_endpoint(func)
            self._router.put(path, **kwargs)(wrapped)
            return wrapped

        return decorator

    def patch(
        self, path: str, **kwargs: Any
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Register a PATCH route."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            wrapped = self._wrap_endpoint(func)
            self._router.patch(path, **kwargs)(wrapped)
            return wrapped

        return decorator

    def delete(
        self, path: str, **kwargs: Any
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Register a DELETE route."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            wrapped = self._wrap_endpoint(func)
            self._router.delete(path, **kwargs)(wrapped)
            return wrapped

        return decorator

    def api_route(
        self, path: str, **kwargs: Any
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Register a route with custom methods."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            wrapped = self._wrap_endpoint(func)
            self._router.api_route(path, **kwargs)(wrapped)
            return wrapped

        return decorator
