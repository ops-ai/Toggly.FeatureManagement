"""
Toggly Django - Django integration for Toggly feature flag management.

Provides middleware, template tags, decorators, and context processors
for seamless Django integration.
"""

from toggly_django.apps import TogglyConfig as TogglyDjangoConfig
from toggly_django.decorators import feature_flag_required, feature_gate_required
from toggly_django.middleware import TogglyMiddleware
from toggly_django.utils import get_client, get_context_from_request

__version__ = "0.1.0"
__all__ = [
    "TogglyDjangoConfig",
    "TogglyMiddleware",
    "feature_flag_required",
    "feature_gate_required",
    "get_client",
    "get_context_from_request",
]

default_app_config = "toggly_django.apps.TogglyConfig"
