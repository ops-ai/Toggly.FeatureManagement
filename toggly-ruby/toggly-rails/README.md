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

    # Uses toggly_context (same ambient identity as feature_enabled?)
    variant = feature_variant(:checkout_flow)
    cta = feature_variant_value(:checkout_flow)
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

<%# Catalog-local variant from ambient toggly_context %>
<%= feature_variant_value(:checkout_flow) %>
```

Use the same feature key and context for both blocks. `feature` captures only
the selected block, and `negate: true` selects the complementary branch.
`when_feature_enabled` and `when_feature_disabled` remain available as
deprecated compatibility adapters. Boolean helpers and `feature_switch` are
unchanged. `feature_variant` / `feature_variant_value` mirror
`feature_enabled?` and use `toggly_context` when no override is passed.

## Documentation

See the [main README](../README.md) for full documentation.

## License

MIT
