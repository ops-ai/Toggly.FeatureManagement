# toggly

Core Ruby SDK for [Toggly](https://toggly.io) feature flag management.

**Zero required runtime dependencies** — pure Ruby evaluation. Optional gems:

- `websocket-client-simple` — live definition updates
- `grpc` + `google-protobuf` — usage / business metrics telemetry send

The Gemfile `:development, :test` group also includes `grpc` and
`google-protobuf` so `bundle exec rspec` can exercise the native conversion
path without making them required runtime deps of the published gem.

Entity `ContextProperty` filters evaluate `Toggly::EntityContext` (`kind`, `key`, `attributes`) and are ANDed with user filters. `Toggly.register_context` optionally PUTs schemas to `sdk/{appKey}/contexts`.

## Installation

```ruby
gem 'toggly'

# Optional: send usage + business metrics over gRPC
gem 'grpc'
gem 'google-protobuf'
```

## Quick Start

```ruby
require 'toggly'

client = Toggly::Client.new(
  app_key: 'your-app-key',
  environment: 'Production'
)

if client.enabled?(:my_feature)
  # Feature is enabled (also records a usage check when tracking is on)
end
```

## Feature variants (catalog-local, MF-parity)

`get_variant` / `get_variant_value` assign a variant purely from the
feature's `variants` / `allocation` catalog data (no network round-trip),
matching `Microsoft.FeatureManagement`'s `IVariantFeatureManager`
bit-for-bit — verified against the shared
`variant-allocator-corpus/cases.json` gold corpus.

```ruby
# Prefer ambient identity: Config#identity, Client#set_identity, or Rails
# feature_variant (uses toggly_context). Per-call context is an override.
client = Toggly::Client.new(app_key: '...', environment: 'Production', identity: 'user-1')
client.set_identity('user-2') # optional runtime update

variant = client.get_variant('checkout-flow') # uses client identity
variant = client.get_variant('checkout-flow', context: Toggly::Context.new(identity: 'override'))
variant&.name                 # assigned variant name, or nil
variant&.configuration_value  # untyped configuration payload
variant&.enabled               # effective enabled after StatusOverride
variant&.reason                # "User" | "Group" | "Percentile" | "DefaultWhenEnabled" | "DefaultWhenDisabled"

client.get_variant_value('checkout-flow') # shortcut for configuration_value
```

`enabled?` stays filter-based only. The `enable_variants` /
`evaluated-variants-signed` dual-rail (and `set_variant_identity`) was
removed in 1.0 — see [CHANGELOG.md](CHANGELOG.md).

## Usage & metrics telemetry

When `app_key` is set, usage tracking and metrics default **on** (disable with
`enable_usage_tracking: false` / `enable_metrics: false`, or
`TOGGLY_DISABLE_TELEMETRY=1`). Batches flush about every 60 seconds and on
`client.close`.

```ruby
client.record_usage('Checkout', identity: 'user-1')
client.record_view('Banner', identity: 'user-1')
client.measure('revenue', 12.5, feature: 'Checkout', variant: 'enabled')
client.increment_counter('clicks', 1, feature: 'Banner')
client.observe('latency_ms', 42.0)
client.flush_telemetry
client.close
```

gRPC metadata includes `ua` = `toggly-ruby/{VERSION}` against
`metrics_base_url` (default `https://app.toggly.io/`). Without the optional
`grpc` gem, evaluation still works; send is a no-op with a warning.

## Documentation

See the [main README](../README.md) for full documentation.

## License

MIT
