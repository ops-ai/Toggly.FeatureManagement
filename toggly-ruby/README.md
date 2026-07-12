# Toggly Ruby SDK

<p align="center">
  <a href="https://rubygems.org/gems/toggly"><img src="https://img.shields.io/gem/v/toggly.svg" alt="Gem version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://docs.toggly.io"><img src="https://img.shields.io/badge/docs-docs.toggly.io-blue.svg" alt="Documentation"></a>
  <a href="https://toggly.io"><img src="https://img.shields.io/badge/website-toggly.io-0A66C2.svg" alt="Website"></a>
</p>

High-performance Ruby SDK for [Toggly](https://toggly.io) feature flag management. Works with or without Toggly.io.

## Packages

| Package | Description | RubyGems |
|---------|-------------|----------|
| `toggly` | Core SDK with zero dependencies | [toggly](https://rubygems.org/gems/toggly) |
| `toggly-rails` | Rails integration with Railtie | [toggly-rails](https://rubygems.org/gems/toggly-rails) |
| `toggly-cache` | Redis caching support | [toggly-cache](https://rubygems.org/gems/toggly-cache) |

## Requirements

- Ruby 3.0+
- Rails 7.0+ (for toggly-rails)

## Installation

### Core SDK (Pure Ruby)

```ruby
# Gemfile
gem 'toggly'
```

### Rails Integration

```ruby
# Gemfile
gem 'toggly-rails'
```

### With Redis Caching

```ruby
# Gemfile
gem 'toggly-cache'
```

## Quick Start

### Basic Usage

```ruby
require 'toggly'

# Configure the client
client = Toggly::Client.new(
  app_key: 'your-app-key',
  environment: 'Production'
)

# Check if a feature is enabled
if client.enabled?(:new_dashboard)
  # Show new dashboard
else
  # Show old dashboard
end
```

### With Global Configuration

```ruby
require 'toggly'

# Configure globally
Toggly.configure do |config|
  config.app_key = ENV['TOGGLY_APP_KEY']
  config.environment = 'Production'
end

# Use anywhere
if Toggly.enabled?(:my_feature)
  # Feature is on
end
```

### Rails Integration

```ruby
# config/initializers/toggly.rb
Toggly::Rails.configure do |config|
  config.app_key = Rails.application.credentials.toggly_app_key
  config.environment = Rails.env.production? ? 'Production' : 'Staging'
end
```

Or generate the initializer:

```bash
rails generate toggly:install
```

Then use in controllers and views:

```ruby
# Controller
class DashboardController < ApplicationController
  def show
    if feature_enabled?(:new_dashboard)
      render :new_dashboard
    else
      render :dashboard
    end
  end
end
```

```erb
<!-- View -->
<% if feature_enabled?(:new_header) %>
  <%= render "new_header" %>
<% else %>
  <%= render "header" %>
<% end %>

<%= when_feature_enabled(:promo_banner) do %>
  <div class="promo">Special Offer!</div>
<% end %>
```

## User Context

Target features to specific users, groups, or traits:

```ruby
# Create a context
context = Toggly::Context.new(
  identity: 'user-123',
  groups: ['beta-testers', 'premium'],
  traits: {
    country: 'US',
    plan: 'enterprise',
    created_at: '2024-01-15'
  }
)

# Check feature with context
if client.enabled?(:premium_feature, context: context)
  # Enabled for this user
end
```

### Rails Context Builder

Configure automatic context building from your users:

```ruby
Toggly::Rails.configure do |config|
  config.app_key = 'your-app-key'

  # Simple: extract identity from user.id
  config.identity_method = :id

  # Groups from user method
  config.groups_method = :role_names

  # Custom traits
  config.add_trait(:plan) { |request, user| user&.subscription&.plan }
  config.add_trait(:country) { |request, _| request.headers['CF-IPCountry'] }
end
```

Or use a custom context builder:

```ruby
config.context_builder = ->(request, user) do
  Toggly::Context.new(
    identity: user&.id&.to_s,
    groups: user&.roles&.pluck(:name) || [],
    traits: {
      plan: user&.subscription&.plan,
      country: request.headers['CF-IPCountry'],
      locale: I18n.locale
    }
  )
end
```

## Offline Mode

Use feature flags without connecting to Toggly.io:

```ruby
client = Toggly::Client.new(
  defaults: {
    'feature-a' => true,
    'feature-b' => false
  }
)

# Works without network access
client.enabled?('feature-a') # => true
```

## Caching with Redis

For high-availability and faster startup:

```ruby
require 'toggly'
require 'toggly-cache'
require 'redis'

redis = Redis.new(url: ENV['REDIS_URL'])
provider = Toggly::Cache::RedisSnapshotProvider.new(
  redis: redis,
  key_prefix: 'myapp:toggly',
  ttl: 3600  # 1 hour
)

client = Toggly::Client.new(
  app_key: 'your-app-key',
  snapshot_provider: provider
)
```

With connection pool:

```ruby
require 'connection_pool'

pool = ConnectionPool.new(size: 5) { Redis.new(url: ENV['REDIS_URL']) }
provider = Toggly::Cache::RedisSnapshotProvider.new(redis: pool)
```

## Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `app_key` | - | Your Toggly app key (required unless offline) |
| `environment` | `"Production"` | Environment name |
| `base_url` | `"https://app.toggly.io/"` | API base URL |
| `refresh_interval` | `300` | Refresh interval in seconds |
| `http_timeout` | `10` | HTTP timeout in seconds |
| `enable_undefined_in_dev` | `false` | Enable unknown features in development |
| `disable_background_refresh` | `false` | Disable background polling |
| `defaults` | `{}` | Default values for offline mode |
| `snapshot_provider` | `nil` | Persistence provider |

## Testing

### RSpec

```ruby
# spec/rails_helper.rb
require 'toggly/rails/testing'

RSpec.configure do |config|
  config.include Toggly::Rails::Testing::RSpecHelpers
end

# In your tests
describe 'Dashboard' do
  it 'shows new UI when feature enabled' do
    with_feature(:new_ui, enabled: true) do
      visit dashboard_path
      expect(page).to have_content('New Dashboard')
    end
  end

  it 'shows old UI when feature disabled' do
    with_feature(:new_ui, enabled: false) do
      visit dashboard_path
      expect(page).to have_content('Dashboard')
    end
  end
end
```

### Minitest

```ruby
require 'toggly/rails/testing'

class DashboardTest < ActionDispatch::IntegrationTest
  include Toggly::Rails::Testing::MinitestHelpers

  test 'shows new UI when feature enabled' do
    with_feature(:new_ui, enabled: true) do
      get dashboard_path
      assert_includes response.body, 'New Dashboard'
    end
  end
end
```

## Rake Tasks

```bash
# List all features
rake toggly:list

# Check specific feature
rake toggly:check[feature_key]

# Refresh definitions
rake toggly:refresh

# Show configuration
rake toggly:config
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Application                        │
├─────────────────────────────────────────────────────────────┤
│  toggly-rails (optional)                                    │
│  ├── Railtie (auto-configuration)                           │
│  ├── ControllerConcern (feature_enabled?)                   │
│  ├── ViewHelpers (when_feature_enabled)                     │
│  ├── Middleware (request context)                           │
│  └── Generators (rails g toggly:install)                    │
├─────────────────────────────────────────────────────────────┤
│  toggly (core)                                              │
│  ├── Client (main interface)                                │
│  ├── Context (user identity/groups/traits)                  │
│  ├── EvaluationEngine (rule processing)                     │
│  ├── DefinitionsProvider (API fetching)                     │
│  └── SnapshotProviders (Memory, File)                       │
├─────────────────────────────────────────────────────────────┤
│  toggly-cache (optional)                                    │
│  └── RedisSnapshotProvider                                  │
└─────────────────────────────────────────────────────────────┘
```

## Thread Safety

All Toggly components are thread-safe:

- Definitions are protected by Mutex
- Background refresh runs in a separate thread
- Context building is stateless

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`bundle exec rspec`)
4. Commit your changes
5. Push to the branch
6. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [Documentation](https://docs.toggly.io/sdks/ruby)
- [Toggly Dashboard](https://app.toggly.io)
- [GitHub Repository](https://github.com/ops-ai/toggly-ruby)
- [RubyGems](https://rubygems.org/gems/toggly)
