"""Django view decorators for Toggly feature flags."""

from __future__ import annotations

import functools
from typing import Any, Callable, TypeVar

from django.http import HttpRequest, HttpResponse, HttpResponseForbidden
from toggly import FeatureRequirement

from toggly_django.utils import get_client, get_context_from_request

F = TypeVar("F", bound=Callable[..., Any])


def feature_flag_required(
    feature_key: str,
    *,
    redirect_url: str | None = None,
    raise_exception: bool = False,
    fallback_view: Callable[..., HttpResponse] | None = None,
) -> Callable[[F], F]:
    """Decorator to require a feature flag for a view.

    Args:
        feature_key: The feature key that must be enabled.
        redirect_url: URL to redirect to if feature is disabled.
        raise_exception: Whether to raise PermissionDenied.
        fallback_view: Alternative view to call if feature is disabled.

    Returns:
        Decorated view function.

    Example:
        @feature_flag_required('new-dashboard')
        def new_dashboard(request):
            return render(request, 'new_dashboard.html')

        @feature_flag_required('beta-feature', redirect_url='/coming-soon/')
        def beta_view(request):
            return render(request, 'beta.html')
    """

    def decorator(view_func: F) -> F:
        @functools.wraps(view_func)
        def wrapper(
            request: HttpRequest,
            *args: Any,
            **kwargs: Any,
        ) -> HttpResponse:
            client = get_client()

            if client is not None:
                context = get_context_from_request(request)
                if client.is_enabled(feature_key, context):
                    return view_func(request, *args, **kwargs)

            # Feature is disabled or client unavailable
            if raise_exception:
                from django.core.exceptions import PermissionDenied

                raise PermissionDenied(
                    f"Feature '{feature_key}' is not enabled"
                )

            if redirect_url:
                from django.shortcuts import redirect

                return redirect(redirect_url)

            if fallback_view:
                return fallback_view(request, *args, **kwargs)

            return HttpResponseForbidden(
                f"Feature '{feature_key}' is not available"
            )

        return wrapper  # type: ignore

    return decorator


def feature_gate_required(
    feature_keys: list[str],
    *,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: bool = False,
    redirect_url: str | None = None,
    raise_exception: bool = False,
    fallback_view: Callable[..., HttpResponse] | None = None,
) -> Callable[[F], F]:
    """Decorator to require multiple feature flags for a view.

    Args:
        feature_keys: List of feature keys to check.
        requirement: Whether ALL or ANY features must be enabled.
        negate: Whether to negate the result.
        redirect_url: URL to redirect to if gate fails.
        raise_exception: Whether to raise PermissionDenied.
        fallback_view: Alternative view to call if gate fails.

    Returns:
        Decorated view function.

    Example:
        @feature_gate_required(['admin-tools', 'advanced-reporting'])
        def admin_reports(request):
            return render(request, 'admin_reports.html')

        @feature_gate_required(
            ['beta', 'premium'],
            requirement=FeatureRequirement.ANY
        )
        def exclusive_content(request):
            return render(request, 'exclusive.html')
    """

    def decorator(view_func: F) -> F:
        @functools.wraps(view_func)
        def wrapper(
            request: HttpRequest,
            *args: Any,
            **kwargs: Any,
        ) -> HttpResponse:
            client = get_client()

            if client is not None:
                context = get_context_from_request(request)
                if client.evaluate_gate(
                    feature_keys, requirement, context, negate
                ):
                    return view_func(request, *args, **kwargs)

            # Gate failed or client unavailable
            if raise_exception:
                from django.core.exceptions import PermissionDenied

                raise PermissionDenied("Required features are not enabled")

            if redirect_url:
                from django.shortcuts import redirect

                return redirect(redirect_url)

            if fallback_view:
                return fallback_view(request, *args, **kwargs)

            return HttpResponseForbidden("Required features are not available")

        return wrapper  # type: ignore

    return decorator


def feature_flag_switch(
    feature_key: str,
    enabled_view: Callable[..., HttpResponse],
    disabled_view: Callable[..., HttpResponse],
) -> Callable[[HttpRequest], HttpResponse]:
    """Create a view that switches between two implementations.

    Args:
        feature_key: The feature key to check.
        enabled_view: View to use when feature is enabled.
        disabled_view: View to use when feature is disabled.

    Returns:
        A view function that delegates based on feature state.

    Example:
        urlpatterns = [
            path('checkout/', feature_flag_switch(
                'new-checkout',
                new_checkout_view,
                old_checkout_view
            )),
        ]
    """

    def view(request: HttpRequest, *args: Any, **kwargs: Any) -> HttpResponse:
        client = get_client()

        if client is not None:
            context = get_context_from_request(request)
            if client.is_enabled(feature_key, context):
                return enabled_view(request, *args, **kwargs)

        return disabled_view(request, *args, **kwargs)

    return view
