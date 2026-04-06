"""Starlette/FastAPI middleware for Toggly feature flags."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Awaitable, Callable, Optional, Union

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Receive, Scope, Send
from toggly import (
    AsyncTogglyClient,
    EvaluationContext,
    TogglyClient,
    TogglyConfig,
    get_default_client,
    set_default_client,
)

# Context variable to store request-scoped Toggly helper
_toggly_context: ContextVar[Optional["TogglyRequestHelper"]] = ContextVar(
    "toggly_context", default=None
)

# Module-level client reference
_client: Optional[Union[TogglyClient, AsyncTogglyClient]] = None


def configure_toggly(
    *,
    app_key: str | None = None,
    environment: str = "Production",
    base_url: str = "https://definitions.toggly.io",
    feature_defaults: dict[str, bool] | None = None,
    refresh_interval: float = 180.0,
    use_signed_definitions: bool = False,
    enable_variants: bool = False,
    connect_timeout: float = 10.0,
    request_timeout: float = 30.0,
    enable_usage_tracking: bool = True,
    disable_background_refresh: bool = False,
    debug: bool = False,
    client: TogglyClient | AsyncTogglyClient | None = None,
) -> TogglyClient | AsyncTogglyClient:
    """Configure Toggly for FastAPI applications.

    Call this function during application startup to initialize the Toggly client.

    Args:
        app_key: Your Toggly application key.
        environment: Environment name (e.g., 'Production', 'Staging').
        base_url: Toggly API base URL.
        feature_defaults: Default feature values.
        refresh_interval: Interval in seconds for background refresh.
        use_signed_definitions: Whether to use signed definitions.
        enable_variants: Whether to fetch evaluated variants from the variants endpoint.
        connect_timeout: Connection timeout in seconds.
        request_timeout: Request timeout in seconds.
        enable_usage_tracking: Whether to track feature usage.
        disable_background_refresh: Whether to disable background refresh.
        debug: Enable debug mode.
        client: Optional pre-configured client to use.

    Returns:
        The configured TogglyClient.

    Example:
        from fastapi import FastAPI
        from toggly_fastapi import configure_toggly, TogglyMiddleware

        app = FastAPI()

        @app.on_event("startup")
        def startup():
            configure_toggly(
                app_key="your-app-key",
                environment="Production"
            )

        app.add_middleware(TogglyMiddleware)
    """
    global _client

    if client is not None:
        _client = client
        set_default_client(client)  # type: ignore
        return client

    config = TogglyConfig(
        app_key=app_key,
        environment=environment,
        base_url=base_url,
        feature_defaults=feature_defaults or {},
        refresh_interval=refresh_interval,
        use_signed_definitions=use_signed_definitions,
        enable_variants=enable_variants,
        connect_timeout=connect_timeout,
        request_timeout=request_timeout,
        enable_usage_tracking=enable_usage_tracking,
        disable_background_refresh=disable_background_refresh,
        debug=debug,
    )

    _client = TogglyClient(config)
    _client.init()
    set_default_client(_client)

    return _client


def get_toggly_client() -> TogglyClient | AsyncTogglyClient | None:
    """Get the configured Toggly client.

    Returns:
        The TogglyClient or None if not configured.
    """
    global _client
    if _client is not None:
        return _client
    return get_default_client()


def get_current_toggly() -> "TogglyRequestHelper | None":
    """Get the current request's Toggly helper from context.

    Returns:
        The TogglyRequestHelper for the current request or None.
    """
    return _toggly_context.get()


class TogglyMiddleware(BaseHTTPMiddleware):
    """Starlette/FastAPI middleware for Toggly feature flags.

    Attaches a TogglyRequestHelper to each request for easy feature flag access.

    Usage:
        from fastapi import FastAPI
        from toggly_fastapi import TogglyMiddleware, configure_toggly

        app = FastAPI()

        @app.on_event("startup")
        def startup():
            configure_toggly(app_key="your-app-key")

        app.add_middleware(TogglyMiddleware)

        @app.get("/")
        async def root(request: Request):
            if request.state.toggly.is_enabled("my-feature"):
                return {"message": "Feature enabled!"}
            return {"message": "Feature disabled"}
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """Process the request.

        Args:
            request: The incoming request.
            call_next: The next middleware or route handler.

        Returns:
            The response.
        """
        # Create request helper
        helper = TogglyRequestHelper(request)

        # Store in request state for access via request.state.toggly
        request.state.toggly = helper

        # Store in context var for dependency injection
        token = _toggly_context.set(helper)

        try:
            response = await call_next(request)
            return response
        finally:
            _toggly_context.reset(token)


class TogglyASGIMiddleware:
    """Pure ASGI middleware for Toggly feature flags.

    A lower-level alternative to TogglyMiddleware that works directly
    with the ASGI protocol.

    Usage:
        from fastapi import FastAPI
        from toggly_fastapi import TogglyASGIMiddleware

        app = FastAPI()
        app.add_middleware(TogglyASGIMiddleware)
    """

    def __init__(self, app: ASGIApp) -> None:
        """Initialize the middleware.

        Args:
            app: The ASGI application.
        """
        self.app = app

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        """Handle ASGI requests.

        Args:
            scope: ASGI scope.
            receive: ASGI receive function.
            send: ASGI send function.
        """
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Create a minimal request wrapper for context extraction
        request = Request(scope)
        helper = TogglyRequestHelper(request)

        # Store in scope state
        if "state" not in scope:
            scope["state"] = {}
        scope["state"]["toggly"] = helper

        # Store in context var
        token = _toggly_context.set(helper)

        try:
            await self.app(scope, receive, send)
        finally:
            _toggly_context.reset(token)


class TogglyRequestHelper:
    """Helper class for request-scoped feature flag access."""

    def __init__(self, request: Request) -> None:
        """Initialize the helper.

        Args:
            request: The Starlette/FastAPI request.
        """
        self._request = request
        self._context: EvaluationContext | None = None
        self._client = get_toggly_client()

    @property
    def context(self) -> EvaluationContext:
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
        return self._client.evaluate_gate(feature_keys, req, self.context, negate)

    @property
    def flags(self) -> dict[str, bool]:
        """Get all feature flags.

        Returns:
            Dictionary of feature key to enabled state.
        """
        if self._client is None:
            return {}
        return self._client.feature_flags


def get_context_from_request(request: Request) -> EvaluationContext:
    """Create an EvaluationContext from a Starlette/FastAPI request.

    Args:
        request: The Starlette/FastAPI request.

    Returns:
        An EvaluationContext populated from the request.
    """
    identity = None
    groups: list[str] = []
    traits: dict[str, Any] = {}

    # Try to get user from request state (common pattern)
    if hasattr(request, "state"):
        user = getattr(request.state, "user", None)
        if user is not None:
            # Get identity
            if hasattr(user, "id"):
                identity = str(user.id)
            elif hasattr(user, "sub"):  # JWT subject
                identity = str(user.sub)

            # Get groups/roles
            if hasattr(user, "roles"):
                roles = user.roles
                if callable(roles):
                    roles = roles()
                if roles:
                    groups = [str(r) for r in roles]
            elif hasattr(user, "groups"):
                grps = user.groups
                if callable(grps):
                    grps = grps()
                if grps:
                    groups = [str(g) for g in grps]
            elif hasattr(user, "scopes"):
                # OAuth2 scopes
                scopes = user.scopes
                if scopes:
                    groups = list(scopes) if isinstance(scopes, (list, set)) else [str(scopes)]

            # Get email
            if hasattr(user, "email"):
                email = user.email
                if email:
                    traits["email"] = email

    # Add request metadata
    traits["path"] = str(request.url.path)
    traits["method"] = request.method

    # Add client info
    if request.client:
        traits["client_host"] = request.client.host

    # Add headers-based info
    user_agent = request.headers.get("user-agent")
    if user_agent:
        traits["user_agent"] = user_agent

    # Add session if available
    session = getattr(request.state, "session", None) if hasattr(request, "state") else None
    if session and hasattr(session, "session_id"):
        traits["session_id"] = session.session_id

    return EvaluationContext(
        identity=identity,
        groups=groups,
        traits=traits,
    )
