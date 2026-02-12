# toggly-cache

Redis caching support for [Toggly](https://toggly.io) feature flag management.

## Installation

```ruby
gem 'toggly-cache'
```

## Quick Start

```ruby
require 'toggly'
require 'toggly-cache'
require 'redis'

redis = Redis.new(url: ENV['REDIS_URL'])
provider = Toggly::Cache::RedisSnapshotProvider.new(redis: redis)

client = Toggly::Client.new(
  app_key: 'your-app-key',
  snapshot_provider: provider
)
```

## Documentation

See the [main README](../README.md) for full documentation.

## License

MIT
