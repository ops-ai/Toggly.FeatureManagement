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
```

Entity `ContextProperty` filters evaluate `{kind, key, attributes}` and are ANDed with user filters. Register kinds with `register_context` (startup PUT to `sdk/{appKey}/contexts`, opt out via `register_contexts_on_startup=False`).

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
| `enable_usage_tracking` | `bool` | `True` | Track feature usage |
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
- No dependencies (zero dependencies core)

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
