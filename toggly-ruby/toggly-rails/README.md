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
<%= feature(:promo) do %>
  <div class="promo">Special offer!</div>
<% end %>

<%= feature(:promo, negate: true) do %>
  <div class="standard">Standard offer</div>
<% end %>
```

Use the same feature key and context for both blocks. `feature` captures only
the selected block, and `negate: true` selects the complementary branch.
`when_feature_enabled` and `when_feature_disabled` remain available as
deprecated compatibility adapters. Boolean helpers and `feature_switch` are
unchanged.

## Documentation

See the [main README](../README.md) for full documentation.

## License

MIT
