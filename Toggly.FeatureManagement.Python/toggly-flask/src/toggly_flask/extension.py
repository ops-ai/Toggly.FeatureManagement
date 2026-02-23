"""Flask extension for Toggly feature flags."""

from __future__ import annotations

from typing import Any

from flask import Flask, g, has_request_context, request
from toggly import (
    EvaluationContext,
    TogglyClient,
    TogglyConfig,
    get_default_client,
    set_default_client,
)


class Toggly:
    """Flask extension for Toggly feature flag management.

    This extension initializes the Toggly client and provides request-scoped
    feature flag evaluation with automatic context extraction.

    Usage:
        # Option 1: Initialize with app
        app = Flask(__name__)
        toggly = Toggly(app)

        # Option 2: Factory pattern
        toggly = Toggly()
        toggly.init_app(app)

    Configuration in Flask:
        app.config['TOGGLY_APP_KEY'] = 'your-app-key'
        app.config['TOGGLY_ENVIRONMENT'] = 'Production'
        app.config['TOGGLY_BASE_URL'] = 'https://definitions.toggly.io'
        app.config['TOGGLY_REFRESH_INTERVAL'] = 180.0
        app.config['TOGGLY_FEATURE_DEFAULTS'] = {'my-feature': False}
    """

    def __init__(
        self,
        app: Flask | None = None,
        *,
        client: TogglyClient | None = None,
    ) -> None:
        """Initialize the Toggly extension.

        Args:
            app: Flask application instance.
            client: Optional pre-configured TogglyClient.
        """
        self._client = client
        self.app = app

        if app is not None:
            self.init_app(app)

    def init_app(self, app: Flask) -> None:
        """Initialize the extension with a Flask application.

        Args:
            app: Flask application instance.
        """
        self.app = app

        # Set default config values
        app.config.setdefault("TOGGLY_APP_KEY", None)
        app.config.setdefault("TOGGLY_ENVIRONMENT", "Production")
        app.config.setdefault("TOGGLY_BASE_URL", "https://definitions.toggly.io")
        app.config.setdefault("TOGGLY_REFRESH_INTERVAL", 180.0)
        app.config.setdefault("TOGGLY_FEATURE_DEFAULTS", {})
        app.config.setdefault("TOGGLY_USE_SIGNED_DEFINITIONS", False)
        app.config.setdefault("TOGGLY_CONNECT_TIMEOUT", 10.0)
        app.config.setdefault("TOGGLY_REQUEST_TIMEOUT", 30.0)
        app.config.setdefault("TOGGLY_ENABLE_USAGE_TRACKING", True)
        app.config.setdefault("TOGGLY_DISABLE_BACKGROUND_REFRESH", False)
        app.config.setdefault("TOGGLY_DEBUG", False)

        # Store extension in app extensions
        if not hasattr(app, "extensions"):
            app.extensions = {}
        app.extensions["toggly"] = self

        # Initialize client if not provided
        if self._client is None:
            self._initialize_client(app)

        # Register before_request handler
        app.before_request(self._before_request)

        # Register template context processor
        app.context_processor(self._context_processor)

    def _initialize_client(self, app: Flask) -> None:
        """Initialize the Toggly client from Flask config.

        Args:
            app: Flask application instance.
        """
        config = TogglyConfig(
            app_key=app.config.get("TOGGLY_APP_KEY"),
            environment=app.config.get("TOGGLY_ENVIRONMENT", "Production"),
            base_url=app.config.get("TOGGLY_BASE_URL", "https://definitions.toggly.io"),
            feature_defaults=app.config.get("TOGGLY_FEATURE_DEFAULTS", {}),
            refresh_interval=app.config.get("TOGGLY_REFRESH_INTERVAL", 180.0),
            use_signed_definitions=app.config.get("TOGGLY_USE_SIGNED_DEFINITIONS", False),
            connect_timeout=app.config.get("TOGGLY_CONNECT_TIMEOUT", 10.0),
            request_timeout=app.config.get("TOGGLY_REQUEST_TIMEOUT", 30.0),
            enable_usage_tracking=app.config.get("TOGGLY_ENABLE_USAGE_TRACKING", True),
            disable_background_refresh=app.config.get("TOGGLY_DISABLE_BACKGROUND_REFRESH", False),
            debug=app.config.get("TOGGLY_DEBUG", False),
        )

        self._client = TogglyClient(config)
        self._client.init()
        set_default_client(self._client)

    def _before_request(self) -> None:
        """Before request handler to set up request context."""
        g.toggly = TogglyRequestHelper(self)

    def _context_processor(self) -> dict[str, Any]:
        """Template context processor.

        Returns:
            Dictionary with 'toggly' key for template access.
        """
        return {"toggly": TemplateToggly(self)}

    @property
    def client(self) -> TogglyClient | None:
        """Get the Toggly client instance.

        Returns:
            The TogglyClient instance or None if not initialized.
        """
        return self._client

    def is_enabled(
        self,
        feature_key: str,
        context: EvaluationContext | None = None,
        default: bool = False,
    ) -> bool:
        """Check if a feature is enabled.

        Args:
            feature_key: The feature key to check.
            context: Optional evaluation context.
            default: Default value if client unavailable.

        Returns:
            True if the feature is enabled.
        """
        if self._client is None:
            return default

        if context is None and has_request_context():
            context = get_context_from_request()

        return self._client.is_enabled(feature_key, context, default=default)

    def is_disabled(
        self,
        feature_key: str,
        context: EvaluationContext | None = None,
        default: bool = True,
    ) -> bool:
        """Check if a feature is disabled.

        Args:
            feature_key: The feature key to check.
            context: Optional evaluation context.
            default: Default value if client unavailable.

        Returns:
            True if the feature is disabled.
        """
        return not self.is_enabled(feature_key, context, default=not default)

    def evaluate_gate(
        self,
        feature_keys: list[str],
        requirement: str = "all",
        negate: bool = False,
        context: EvaluationContext | None = None,
    ) -> bool:
        """Evaluate multiple features as a gate.

        Args:
            feature_keys: List of feature keys.
            requirement: 'all' or 'any'.
            negate: Whether to negate the result.
            context: Optional evaluation context.

        Returns:
            True if the gate passes.
        """
        if self._client is None:
            return False

        if context is None and has_request_context():
            context = get_context_from_request()

        from toggly import FeatureRequirement

        req = (
            FeatureRequirement.ALL
            if requirement.lower() == "all"
            else FeatureRequirement.ANY
        )
        return self._client.evaluate_gate(feature_keys, req, context, negate)

    @property
    def flags(self) -> dict[str, bool]:
        """Get all feature flags.

        Returns:
            Dictionary of feature key to enabled state.
        """
        if self._client is None:
            return {}
        return self._client.feature_flags


class TogglyRequestHelper:
    """Helper class attached to Flask g object for request-scoped access."""

    def __init__(self, ext: Toggly) -> None:
        """Initialize the helper.

        Args:
            ext: The Toggly Flask extension.
        """
        self._ext = ext
        self._context: EvaluationContext | None = None

    @property
    def context(self) -> EvaluationContext:
        """Get or create the evaluation context for this request."""
        if self._context is None:
            self._context = get_context_from_request()
        return self._context

    def is_enabled(self, feature_key: str, default: bool = False) -> bool:
        """Check if a feature is enabled.

        Args:
            feature_key: The feature key to check.
            default: Default value if client unavailable.

        Returns:
            True if the feature is enabled.
        """
        return self._ext.is_enabled(feature_key, self.context, default=default)

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
        return self._ext.evaluate_gate(
            feature_keys, requirement, negate, self.context
        )

    @property
    def flags(self) -> dict[str, bool]:
        """Get all feature flags.

        Returns:
            Dictionary of feature key to enabled state.
        """
        return self._ext.flags


class TemplateToggly:
    """Helper class for accessing Toggly in Jinja2 templates."""

    def __init__(self, ext: Toggly) -> None:
        """Initialize the template helper.

        Args:
            ext: The Toggly Flask extension.
        """
        self._ext = ext
        self._context: EvaluationContext | None = None
        self._flags_cache: dict[str, bool] | None = None

    @property
    def context(self) -> EvaluationContext:
        """Get the evaluation context."""
        if self._context is None:
            self._context = get_context_from_request()
        return self._context

    @property
    def is_enabled(self) -> "FeatureFlagChecker":
        """Get a feature flag checker for template attribute access.

        Usage in templates:
            {% if toggly.is_enabled.my_feature %}
        """
        return FeatureFlagChecker(self)

    @property
    def is_disabled(self) -> "FeatureFlagChecker":
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
            self._flags_cache = self._ext.flags
        return self._flags_cache

    def check(self, feature_key: str, default: bool = False) -> bool:
        """Check if a feature is enabled.

        Args:
            feature_key: The feature key to check.
            default: Default value if client unavailable.

        Returns:
            True if the feature is enabled.
        """
        return self._ext.is_enabled(feature_key, self.context, default=default)


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


def get_context_from_request() -> EvaluationContext:
    """Create an EvaluationContext from the current Flask request.

    Extracts user identity from Flask-Login's current_user if available.

    Returns:
        An EvaluationContext populated from the request.
    """
    identity = None
    groups: list[str] = []
    traits: dict[str, Any] = {}

    # Try to get user from Flask-Login
    try:
        from flask_login import current_user

        if current_user.is_authenticated:
            # Use user ID as identity
            if hasattr(current_user, "id"):
                identity = str(current_user.id)
            elif hasattr(current_user, "get_id"):
                identity = current_user.get_id()

            # Get user groups/roles if available
            if hasattr(current_user, "roles"):
                roles = current_user.roles
                if callable(roles):
                    roles = roles()
                if roles:
                    groups = [str(r) for r in roles]
            elif hasattr(current_user, "groups"):
                grps = current_user.groups
                if callable(grps):
                    grps = grps()
                if grps:
                    groups = [str(g) for g in grps]

            # Add user traits
            if hasattr(current_user, "email"):
                email = current_user.email
                if email:
                    traits["email"] = email
            if hasattr(current_user, "is_admin"):
                traits["is_admin"] = bool(current_user.is_admin)
    except ImportError:
        pass

    # Add request metadata
    if has_request_context():
        traits["path"] = request.path
        traits["method"] = request.method
        traits["remote_addr"] = request.remote_addr

        # Add session ID if available
        try:
            from flask import session

            if session and hasattr(session, "sid"):
                traits["session_id"] = session.sid
        except (ImportError, RuntimeError):
            pass

    return EvaluationContext(
        identity=identity,
        groups=groups,
        traits=traits,
    )


def get_toggly() -> Toggly | None:
    """Get the Toggly extension from the current app.

    Returns:
        The Toggly extension or None if not initialized.
    """
    from flask import current_app

    if current_app and hasattr(current_app, "extensions"):
        return current_app.extensions.get("toggly")
    return None


def get_client() -> TogglyClient | None:
    """Get the Toggly client from the current app.

    Returns:
        The TogglyClient or None if not initialized.
    """
    return get_default_client()
