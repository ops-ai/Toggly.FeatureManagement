"""
Toggly Flask - Flask integration for Toggly feature flag management.

Provides a Flask extension, view decorators, and template context
for seamless Flask integration.
"""

from toggly_flask.decorators import (
    FeatureFlagBlueprint,
    feature_flag_required,
    feature_flag_switch,
    feature_gate_required,
    feature_variant,
)
from toggly_flask.extension import (
    FeatureFlagChecker,
    TemplateToggly,
    Toggly,
    TogglyRequestHelper,
    get_client,
    get_context_from_request,
    get_toggly,
)

__version__ = "0.1.0"
__all__ = [
    # Extension
    "Toggly",
    "TogglyRequestHelper",
    "TemplateToggly",
    "FeatureFlagChecker",
    # Decorators
    "feature_flag_required",
    "feature_gate_required",
    "feature_flag_switch",
    "feature_variant",
    "FeatureFlagBlueprint",
    # Utilities
    "get_toggly",
    "get_client",
    "get_context_from_request",
]
