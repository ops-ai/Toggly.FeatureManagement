# toggly

Core Ruby SDK for [Toggly](https://toggly.io) feature flag management.

**Zero dependencies** - pure Ruby implementation.

Entity `ContextProperty` filters evaluate `Toggly::EntityContext` (`kind`, `key`, `attributes`) and are ANDed with user filters. `Toggly.register_context` optionally PUTs schemas to `sdk/{appKey}/contexts`.

## Installation

```ruby
gem 'toggly'
```

## Quick Start

```ruby
require 'toggly'

client = Toggly::Client.new(
  app_key: 'your-app-key',
  environment: 'Production'
)

if client.enabled?(:my_feature)
  # Feature is enabled
end
```

## Documentation

See the [main README](../README.md) for full documentation.

## License

MIT
