"""
Toggly FastAPI - FastAPI integration for Toggly feature flag management.

Provides middleware, dependency injection, and route decorators
for seamless FastAPI integration.
"""

from toggly_fastapi.decorators import (
    FeatureFlagRouter,
    feature_flag_required,
    feature_gate_required,
    feature_switch,
)
from toggly_fastapi.dependencies import (
    ClientDep,
    ContextDep,
    FeatureGateDependency,
    TogglyDep,
    feature_enabled,
    get_client,
    get_evaluation_context,
    get_toggly,
    require_feature,
    require_features,
    with_feature_context,
)
from toggly_fastapi.middleware import (
    TogglyASGIMiddleware,
    TogglyMiddleware,
    TogglyRequestHelper,
    configure_toggly,
    get_context_from_request,
    get_current_toggly,
    get_toggly_client,
)

__version__ = "0.1.0"
__all__ = [
    "ClientDep",
    "ContextDep",
    "FeatureFlagRouter",
    "FeatureGateDependency",
    "TogglyASGIMiddleware",
    # Type aliases
    "TogglyDep",
    # Middleware
    "TogglyMiddleware",
    "TogglyRequestHelper",
    "configure_toggly",
    "feature_enabled",
    # Decorators
    "feature_flag_required",
    "feature_gate_required",
    "feature_switch",
    "get_client",
    "get_context_from_request",
    "get_current_toggly",
    "get_evaluation_context",
    # Dependencies
    "get_toggly",
    "get_toggly_client",
    "require_feature",
    "require_features",
    "with_feature_context",
]
