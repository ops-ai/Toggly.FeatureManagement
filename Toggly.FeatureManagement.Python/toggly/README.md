# toggly

Feature flag management SDK for Python - zero dependencies core library.

Can be used *WITH* or *WITHOUT* [Toggly.io](https://toggly.io).

<p align="center">
  <a href="https://pypi.org/project/toggly/"><img src="https://img.shields.io/pypi/v/toggly.svg" alt="PyPI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

## What is a Feature Flag

A feature flag (or feature toggle) is a software development technique that allows you to enable or disable features in your application without deploying new code. This enables:

- **Gradual Rollouts**: Release features to a percentage of users
- **A/B Testing**: Test different implementations with different user groups
- **Kill Switches**: Instantly disable problematic features
- **Environment-Specific**: Different feature states per environment

## Installation

```bash
pip install toggly

# Optional: send usage/metrics over gRPC
pip install toggly[telemetry]
```

Entity `ContextProperty` filters evaluate `{kind, key, attributes}` and are ANDed with user filters. Register kinds with `register_context` (startup PUT to `sdk/{appKey}/contexts`, opt out via `register_contexts_on_startup=False`).

Segment filters (`BrowserFamily`, `BrowserLanguage`, `Country`, `DeviceType`, `OS`) and `UserClaims` read `EvaluationContext.request` / `claims`. Map HTTP headers with `HttpRequestMapper.from_http_headers` (or set `RequestContext` directly). Sticky percentage buckets use Definitions SHA-256 (`featureKey\nidentity`).

## Quick Start

### Basic Usage with Toggly.io

```python
from toggly import TogglyClient, TogglyConfig

# Create configuration
config = TogglyConfig(
    app_key="your-app-key",
    environment="Production"
)

# Initialize client
client = TogglyClient(config)
client.init()

# Check if a feature is enabled
if client.is_enabled("new-checkout-flow"):
    # New checkout implementation
    pass
else:
    # Original checkout implementation
    pass
```

### Using Decorators

```python
from toggly import TogglyClient, TogglyConfig, feature_flag, set_default_client

# Set up default client
config = TogglyConfig(app_key="your-app-key")
client = TogglyClient(config)
client.init()
set_default_client(client)

# Use decorator to control function execution
@feature_flag("new-algorithm")
def calculate_score(data):
    return new_algorithm(data)

# Or with a fallback
@feature_flag("new-algorithm", fallback=old_algorithm)
def calculate_score(data):
    return new_algorithm(data)
```

### Using Context Manager

```python
with client.feature_context("new-feature") as enabled:
    if enabled:
        # Feature is enabled
        do_new_thing()
    else:
        # Feature is disabled
        do_old_thing()
```

### Async Support

```python
from toggly import AsyncTogglyClient, TogglyConfig

config = TogglyConfig(app_key="your-app-key")
client = AsyncTogglyClient(config)

async def main():
    await client.init()

    if await client.is_enabled("new-feature"):
        await do_new_thing()
```

## Usage and business metrics

When an `app_key` is set, the client batches feature usage and business metrics
and sends them to Toggly over gRPC (~1 minute, plus flush on `close()` / process
exit). Core evaluate works without gRPC; install `toggly[telemetry]` to send.
gRPC calls attach metadata key `ua` (lowercase for grpcio; same semantics as
.NET/Go/Node `UA`).

```python
# Checks are recorded automatically from is_enabled when enable_usage_tracking
if client.is_enabled("new-checkout-flow"):
    client.record_usage("new-checkout-flow")  # interaction
    client.record_view("new-checkout-flow")   # rendered

client.measure("revenue", 9.99, {"feature": "new-checkout-flow"})
client.increment_counter("checkout_clicks")
client.observe("cart_depth", 3)
client.flush_telemetry()  # optional; also runs on close()
```

| Option | Default | Description |
|--------|---------|-------------|
| `enable_usage_tracking` | `True` | Record checks / usage / views via `Usage.SendStats` |
| `enable_metrics` | `True` | `measure` / `increment_counter` / `observe` via `Metrics.SendMetrics` |
| `metrics_base_url` | `https://app.toggly.io` | gRPC endpoint (separate from definitions `base_url`) |
| `usage_flush_interval` / `metrics_flush_interval` | `60` | Seconds; `0` disables the timer |

Set `TOGGLY_DISABLE_TELEMETRY=1` to disable both pipelines.

## Feature Gates (Multiple Features)

Evaluate multiple features together:

```python
from toggly import FeatureRequirement

# All features must be enabled
if client.evaluate_gate(
    ["feature-a", "feature-b"],
    requirement=FeatureRequirement.ALL
):
    # Both features are enabled
    pass

# Any feature must be enabled
if client.evaluate_gate(
    ["feature-a", "feature-b"],
    requirement=FeatureRequirement.ANY
):
    # At least one feature is enabled
    pass
```

## User Targeting

Target features to specific users or groups:

```python
from toggly import EvaluationContext

# Create user context
context = EvaluationContext(
    identity="user-123",
    groups=["beta-testers", "premium"],
    traits={"country": "US", "plan": "enterprise"}
)

# Evaluate with context
if client.is_enabled("premium-feature", context):
    # Feature is enabled for this user
    pass
```

## Offline Mode (Without Toggly.io)

Use feature flags without a server connection:

```python
from toggly import TogglyClient, TogglyConfig

config = TogglyConfig(
    feature_defaults={
        "feature-a": True,
        "feature-b": False,
        "feature-c": True
    }
)

client = TogglyClient(config)
client.init()

# Works completely offline using defaults
if client.is_enabled("feature-a"):
    pass
```

## Caching

Use file-based caching for offline support:

```python
from toggly import TogglyClient, TogglyConfig, FileSnapshotProvider

provider = FileSnapshotProvider(directory="/path/to/cache")

config = TogglyConfig(
    app_key="your-app-key",
    snapshot_provider=provider
)

client = TogglyClient(config)
client.init()  # Loads from cache if server unavailable
```

## State Change Handlers

React to feature flag changes:

```python
def on_feature_change(key: str, old_value: bool, new_value: bool):
    print(f"Feature {key} changed: {old_value} -> {new_value}")

config = TogglyConfig(
    app_key="your-app-key",
    state_change_handlers=[on_feature_change]
)
```

## Custom Evaluators

Register custom filter evaluators:

```python
from toggly.evaluator import FilterEvaluator, FeatureFilter
from toggly import EvaluationContext

class CustomEvaluator(FilterEvaluator):
    def evaluate(
        self,
        filter_: FeatureFilter,
        feature_key: str,
        context: EvaluationContext,
    ) -> bool:
        # Custom evaluation logic
        return context.traits.get("custom_field") == filter_.parameters.get("value")

# Register with client
client.registry.register("CustomFilter", CustomEvaluator())
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `app_key` | `str` | `None` | Your Toggly application key |
| `environment` | `str` | `"Production"` | Environment name |
| `base_url` | `str` | `"https://client.toggly.io"` | API base URL |
| `identity` | `str` | `None` | Default user identity |
| `feature_defaults` | `dict` | `{}` | Default feature flag values |
| `refresh_interval` | `float` | `180.0` | Auto-refresh interval (seconds) |
| `use_signed_definitions` | `bool` | `False` | Verify definition signatures |
| `connect_timeout` | `float` | `10.0` | Connection timeout (seconds) |
| `request_timeout` | `float` | `30.0` | Request timeout (seconds) |
| `snapshot_provider` | `SnapshotProvider` | `None` | Cache provider |
| `enable_usage_tracking` | `bool` | `True` | Track feature usage via gRPC |
| `enable_metrics` | `bool` | `True` | Send business metrics via gRPC |
| `metrics_base_url` | `str` | `"https://app.toggly.io"` | Usage/metrics gRPC base URL |
| `usage_flush_interval` | `float` | `60.0` | Usage flush interval (seconds) |
| `metrics_flush_interval` | `float` | `60.0` | Metrics flush interval (seconds) |
| `disable_background_refresh` | `bool` | `False` | Disable auto-refresh |

## Debug Information

Get current client state:

```python
info = client.get_debug_info()
print(f"Environment: {info.environment}")
print(f"Feature count: {info.feature_count}")
print(f"Last refresh: {info.last_refresh}")
print(f"Initialized: {info.is_initialized}")
```

## Framework Integrations

For framework-specific features, use the integration packages:

- **Django**: `pip install toggly toggly-django`
- **Flask**: `pip install toggly toggly-flask`
- **FastAPI**: `pip install toggly toggly-fastapi`
- **Redis/Memcached caching**: `pip install toggly toggly-cache[redis]`

## Requirements

- Python 3.8+
- No required dependencies (zero-dependency core)
- Optional: `toggly[telemetry]` for usage/metrics gRPC (`grpcio`, `protobuf`)
- Optional: `toggly[websocket]` for live updates

## Type Hints

The library is fully typed with Python type hints and includes `py.typed` marker for static type checkers.

```python
from toggly import TogglyClient, TogglyConfig, EvaluationContext

config: TogglyConfig = TogglyConfig(app_key="key")
client: TogglyClient = TogglyClient(config)
enabled: bool = client.is_enabled("feature")
```

## Thread Safety

The `TogglyClient` is thread-safe and can be shared across threads. Internal state is protected with locks.

## License

MIT

## Find Out More

Visit [Toggly.io](https://toggly.io) for more information and to create your free account.

## Feature Variants

Requires **toggly 1.1.0**. Feature variants are defined directly on the feature
in the Toggly catalog (or in your own `FeatureDefinition` objects) and are
assigned **locally**, from the same cached definitions used for `is_enabled` —
there is no separate variants request or cache. Assignment matches
[Microsoft.FeatureManagement](https://github.com/microsoft/FeatureManagement-Dotnet)
4.7.0 bit-for-bit: disabled features only ever resolve `DefaultWhenDisabled`;
enabled features are resolved in order — per-user allocation, then per-group
allocation, then percentile allocation, then `DefaultWhenEnabled`.

```python
from toggly import TogglyClient, TogglyConfig

client = TogglyClient(TogglyConfig(app_key="your-app-key"))
client.init()

# Uses the client's configured identity (TogglyConfig.identity) and no groups.
variant = client.get_variant("checkout-flow")
if variant is not None and variant.enabled:
    if variant.name == "B":
        use_new_checkout(variant.configuration_value)

# Or evaluate for a specific request/user (targeting overload).
variant = client.get_variant(
    "checkout-flow", user_id="user-123", groups=["beta"]
)

# Convenience accessor when you only need the configuration payload.
config_value = client.get_variant_value(
    "checkout-flow", user_id="user-123", groups=["beta"]
)

# Typed soft-bind (optional): pass `type=` to decode the payload as a Python
# type. Uses pydantic TypeAdapter when pydantic is installed; otherwise a
# best-effort local decode. Missing assignment or shape mismatch → None
# (never raises solely for mismatch, never returns a wrong-typed value).
from dataclasses import dataclass

@dataclass
class CheckoutConfig:
    color: str

typed = client.get_variant_value(
    "checkout-flow", user_id="user-123", type=CheckoutConfig
)
```

`get_variant` returns `None` when the feature does not exist or has no
variants defined; otherwise it returns a `VariantResult` with:

- `name` — the assigned variant's name.
- `configuration_value` — that variant's configuration payload (any JSON value).
- `enabled` — the *effective* enabled state after applying the variant's
  `StatusOverride` (a variant can force a feature on or off independent of the
  feature's own filter evaluation). `is_enabled()` remains purely filter-based
  and never applies `StatusOverride`.
- `assignment_reason` — one of `"User"`, `"Group"`, `"Percentile"`,
  `"DefaultWhenEnabled"`, `"DefaultWhenDisabled"`, or `"None"`.

`get_variant_value` is a convenience wrapper that returns just
`configuration_value` (or `None`). Pass optional `type=` for a soft-typed
bind. Both async equivalents are available on `AsyncTogglyClient` with the
same signature.

Percentile allocation uses the same SHA-256-based hashing as
Microsoft.FeatureManagement: `contextId = f"{user_id}\n{hint}"` where `hint`
is the allocation's `seed` if set, otherwise `f"allocation\n{feature_key}"`.
This makes bucket assignment deterministic and stable across SDKs/releases for
the same user, feature, and seed.
