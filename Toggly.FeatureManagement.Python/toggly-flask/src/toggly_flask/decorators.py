"""Flask view decorators for Toggly feature flags."""

from __future__ import annotations

import functools
from typing import Any, Callable, TypeVar

from flask import Response, abort, redirect

from toggly import FeatureRequirement
from toggly_flask.extension import get_client, get_context_from_request

F = TypeVar("F", bound=Callable[..., Any])


def feature_flag_required(
    feature_key: str,
    *,
    redirect_url: str | None = None,
    status_code: int = 403,
    fallback_view: Callable[..., Response] | None = None,
) -> Callable[[F], F]:
    """Decorator to require a feature flag for a view.

    Args:
        feature_key: The feature key that must be enabled.
        redirect_url: URL to redirect to if feature is disabled.
        status_code: HTTP status code to return if feature is disabled (default 403).
        fallback_view: Alternative view to call if feature is disabled.

    Returns:
        Decorated view function.

    Example:
        @app.route('/new-dashboard')
        @feature_flag_required('new-dashboard')
        def new_dashboard():
            return render_template('new_dashboard.html')

        @app.route('/beta')
        @feature_flag_required('beta-feature', redirect_url='/coming-soon/')
        def beta_view():
            return render_template('beta.html')
    """

    def decorator(view_func: F) -> F:
        @functools.wraps(view_func)
        def wrapper(*args: Any, **kwargs: Any) -> Response:
            client = get_client()

            if client is not None:
                context = get_context_from_request()
                if client.is_enabled(feature_key, context):
                    return view_func(*args, **kwargs)

            # Feature is disabled or client unavailable
            if redirect_url:
                return redirect(redirect_url)

            if fallback_view:
                return fallback_view(*args, **kwargs)

            abort(status_code, description=f"Feature '{feature_key}' is not available")

        return wrapper  # type: ignore

    return decorator


def feature_gate_required(
    feature_keys: list[str],
    *,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: bool = False,
    redirect_url: str | None = None,
    status_code: int = 403,
    fallback_view: Callable[..., Response] | None = None,
) -> Callable[[F], F]:
    """Decorator to require multiple feature flags for a view.

    Args:
        feature_keys: List of feature keys to check.
        requirement: Whether ALL or ANY features must be enabled.
        negate: Whether to negate the result.
        redirect_url: URL to redirect to if gate fails.
        status_code: HTTP status code to return if gate fails (default 403).
        fallback_view: Alternative view to call if gate fails.

    Returns:
        Decorated view function.

    Example:
        @app.route('/admin-reports')
        @feature_gate_required(['admin-tools', 'advanced-reporting'])
        def admin_reports():
            return render_template('admin_reports.html')

        @app.route('/exclusive')
        @feature_gate_required(
            ['beta', 'premium'],
            requirement=FeatureRequirement.ANY
        )
        def exclusive_content():
            return render_template('exclusive.html')
    """

    def decorator(view_func: F) -> F:
        @functools.wraps(view_func)
        def wrapper(*args: Any, **kwargs: Any) -> Response:
            client = get_client()

            if client is not None:
                context = get_context_from_request()
                if client.evaluate_gate(feature_keys, requirement, context, negate):
                    return view_func(*args, **kwargs)

            # Gate failed or client unavailable
            if redirect_url:
                return redirect(redirect_url)

            if fallback_view:
                return fallback_view(*args, **kwargs)

            abort(status_code, description="Required features are not available")

        return wrapper  # type: ignore

    return decorator


def feature_flag_switch(
    feature_key: str,
    enabled_view: Callable[..., Response],
    disabled_view: Callable[..., Response],
) -> Callable[..., Response]:
    """Create a view that switches between two implementations.

    Args:
        feature_key: The feature key to check.
        enabled_view: View to use when feature is enabled.
        disabled_view: View to use when feature is disabled.

    Returns:
        A view function that delegates based on feature state.

    Example:
        app.add_url_rule(
            '/checkout',
            'checkout',
            feature_flag_switch(
                'new-checkout',
                new_checkout_view,
                old_checkout_view
            )
        )
    """

    def view(*args: Any, **kwargs: Any) -> Response:
        client = get_client()

        if client is not None:
            context = get_context_from_request()
            if client.is_enabled(feature_key, context):
                return enabled_view(*args, **kwargs)

        return disabled_view(*args, **kwargs)

    return view


def feature_variant(
    feature_key: str,
    default_view: Callable[..., Response],
    variants: dict[str, Callable[..., Response]] | None = None,
) -> Callable[[F], F]:
    """Decorator to select view based on feature variant value.

    This decorator allows routing to different views based on the
    feature's variant/experiment value.

    Args:
        feature_key: The feature key to check.
        default_view: View to use when feature is disabled or no variant matches.
        variants: Dictionary mapping variant values to view functions.

    Returns:
        Decorated view function.

    Example:
        @app.route('/checkout')
        @feature_variant(
            'checkout-experiment',
            default_view=original_checkout,
            variants={
                'variant-a': checkout_variant_a,
                'variant-b': checkout_variant_b,
            }
        )
        def checkout():
            # This function is never called; it's replaced by the variant
            pass
    """
    variants = variants or {}

    def decorator(view_func: F) -> F:
        @functools.wraps(view_func)
        def wrapper(*args: Any, **kwargs: Any) -> Response:
            client = get_client()

            if client is not None:
                context = get_context_from_request()
                if client.is_enabled(feature_key, context):
                    # Get the feature state for variant info
                    state = client.get_feature_state(feature_key, context)
                    variant = state.metadata.get("variant")

                    if variant and variant in variants:
                        return variants[variant](*args, **kwargs)

                    # Feature is enabled but no matching variant
                    return view_func(*args, **kwargs)

            return default_view(*args, **kwargs)

        return wrapper  # type: ignore

    return decorator


class FeatureFlagBlueprint:
    """Utility class for creating feature-gated blueprints.

    Example:
        from flask import Blueprint
        from toggly_flask import FeatureFlagBlueprint

        bp = Blueprint('beta', __name__)
        feature_bp = FeatureFlagBlueprint(bp, 'beta-features')

        @feature_bp.route('/new-page')
        def new_page():
            return 'New page!'
    """

    def __init__(
        self,
        blueprint: Any,
        feature_key: str,
        *,
        redirect_url: str | None = None,
        status_code: int = 403,
    ) -> None:
        """Initialize the feature-gated blueprint.

        Args:
            blueprint: The Flask Blueprint to wrap.
            feature_key: The feature key required for all routes.
            redirect_url: URL to redirect to if feature is disabled.
            status_code: HTTP status code to return if feature is disabled.
        """
        self._blueprint = blueprint
        self._feature_key = feature_key
        self._redirect_url = redirect_url
        self._status_code = status_code

    def route(
        self,
        rule: str,
        **options: Any,
    ) -> Callable[[F], F]:
        """Register a route with automatic feature flag checking.

        Args:
            rule: The URL rule.
            **options: Additional options for Blueprint.route().

        Returns:
            Decorator function.
        """

        def decorator(f: F) -> F:
            @self._blueprint.route(rule, **options)
            @feature_flag_required(
                self._feature_key,
                redirect_url=self._redirect_url,
                status_code=self._status_code,
            )
            @functools.wraps(f)
            def wrapped(*args: Any, **kwargs: Any) -> Response:
                return f(*args, **kwargs)

            return wrapped  # type: ignore

        return decorator
