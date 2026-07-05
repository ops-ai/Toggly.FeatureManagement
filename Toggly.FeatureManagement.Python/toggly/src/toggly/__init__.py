"""Toggly - Feature flag management SDK for Python.

A zero-dependency core library for feature flag management with support
for synchronous and asynchronous APIs.
"""

from toggly.async_client import AsyncTogglyClient
from toggly.client import TogglyClient
from toggly.config import TogglyConfig
from toggly.context import EvaluationContext
from toggly.decorators import (
    feature_context,
    feature_flag,
    feature_gate,
    get_default_client,
    set_default_client,
)
from toggly.enums import AppState, FeatureRequirement, FilterType, LoadStatus
from toggly.evaluator import (
    EvaluationEngine,
    EvaluatorRegistry,
    FilterEvaluator,
)
from toggly.exceptions import (
    TogglyConfigError,
    TogglyError,
    TogglyEvaluationError,
    TogglyNetworkError,
    TogglySignatureError,
    TogglyTimeoutError,
)
from toggly.models import (
    DebugInfo,
    EvaluatedVariantDef,
    FeatureDefinition,
    FeatureFilter,
    FeatureState,
    JsonWebKey,
    JsonWebKeySet,
    NetworkState,
    TogglyInitResponse,
    VariantResult,
)
from toggly.providers import (
    DefinitionsSnapshot,
    FileSnapshotProvider,
    JwksSnapshot,
    MemorySnapshotProvider,
    SnapshotProvider,
    VariantsSnapshot,
)

from toggly.version import __version__
__all__ = [
    # Clients
    "TogglyClient",
    "AsyncTogglyClient",
    "TogglyConfig",
    # Context
    "EvaluationContext",
    # Decorators
    "feature_flag",
    "feature_gate",
    "feature_context",
    "set_default_client",
    "get_default_client",
    # Enums
    "FeatureRequirement",
    "LoadStatus",
    "FilterType",
    "AppState",
    # Evaluation
    "EvaluationEngine",
    "EvaluatorRegistry",
    "FilterEvaluator",
    # Exceptions
    "TogglyError",
    "TogglyConfigError",
    "TogglyEvaluationError",
    "TogglyNetworkError",
    "TogglySignatureError",
    "TogglyTimeoutError",
    # Models
    "FeatureDefinition",
    "FeatureFilter",
    "FeatureState",
    "EvaluatedVariantDef",
    "VariantResult",
    "TogglyInitResponse",
    "DebugInfo",
    "NetworkState",
    "JsonWebKey",
    "JsonWebKeySet",
    # Providers
    "SnapshotProvider",
    "MemorySnapshotProvider",
    "FileSnapshotProvider",
    "DefinitionsSnapshot",
    "VariantsSnapshot",
    "JwksSnapshot",
]
