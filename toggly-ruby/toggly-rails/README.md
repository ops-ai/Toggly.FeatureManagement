# toggly-rails

Rails integration for [Toggly](https://toggly.io) feature flag management.

## Installation

```ruby
gem 'toggly-rails'
```

## Quick Start

```bash
rails generate toggly:install
```

Then configure in `config/initializers/toggly.rb`:

```ruby
Toggly::Rails.configure do |config|
  config.app_key = ENV['TOGGLY_APP_KEY']
  config.environment = Rails.env.production? ? 'Production' : 'Staging'
end
```

## Usage

### Controllers

```ruby
class DashboardController < ApplicationController
  def show
    if feature_enabled?(:new_dashboard)
      render :new_dashboard
    end
  end
end
```

### Views

```erb
<% if feature_enabled?(:promo) %>
  <div class="promo">Special offer!</div>
<% end %>
```

## Documentation

See the [main README](../README.md) for full documentation.

## License

MIT
