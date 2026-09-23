"""Toggly - Feature flag management SDK for Python.

A zero-dependency core library for feature flag management with support
for synchronous and asynchronous APIs.
"""

from toggly.async_client import AsyncTogglyClient
from toggly.client import TogglyClient
from toggly.config import TogglyConfig
from toggly.context import (
    EvaluationContext,
    HttpRequestMapper,
    RequestContext,
    TogglyEntityContext,
)
from toggly.decorators import (
    feature_context,
    feature_flag,
    feature_gate,
    get_default_client,
    set_default_client,
)
from toggly.entity_context import (
    EntityContextPropertySchema,
    EntityContextSchemaRegistration,
    register_context,
)
from toggly.enums import AppState, FeatureRequirement, FilterType, LoadStatus
from toggly.evaluator import (
    ContextPropertyEvaluator,
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
    Allocation,
    DebugInfo,
    FeatureDefinition,
    FeatureFilter,
    FeatureState,
    GroupAllocation,
    JsonWebKey,
    JsonWebKeySet,
    NetworkState,
    PercentileAllocation,
    TogglyInitResponse,
    UserAllocation,
    Variant,
    VariantResult,
)
from toggly.providers import (
    DefinitionsSnapshot,
    FileSnapshotProvider,
    JwksSnapshot,
    MemorySnapshotProvider,
    SnapshotProvider,
)
from toggly.variants import VariantAssignment, assign_variant
from toggly.version import __version__

__all__ = [
    # Clients
    "TogglyClient",
    "AsyncTogglyClient",
    "TogglyConfig",
    # Context
    "EvaluationContext",
    "HttpRequestMapper",
    "RequestContext",
    "TogglyEntityContext",
    "register_context",
    "EntityContextPropertySchema",
    "EntityContextSchemaRegistration",
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
    "ContextPropertyEvaluator",
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
    "Variant",
    "Allocation",
    "UserAllocation",
    "GroupAllocation",
    "PercentileAllocation",
    "VariantResult",
    "TogglyInitResponse",
    "DebugInfo",
    "NetworkState",
    "JsonWebKey",
    "JsonWebKeySet",
    # Variants (catalog-local allocator)
    "assign_variant",
    "VariantAssignment",
    # Providers
    "SnapshotProvider",
    "MemorySnapshotProvider",
    "FileSnapshotProvider",
    "DefinitionsSnapshot",
    "JwksSnapshot",
    "__version__",
]
