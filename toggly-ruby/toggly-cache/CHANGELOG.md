# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-XX-XX

### Added

- Initial release of Toggly Ruby SDK
- `toggly` - Core SDK with zero dependencies
  - Client for feature flag evaluation
  - Context for user identity, groups, and traits
  - Evaluation engine with multiple rule types
  - Percentage rollouts with consistent hashing
  - User and group targeting
  - Contextual targeting with operators
  - Time window rules
  - Memory and file snapshot providers
  - Background refresh support
  - Offline mode with defaults

- `toggly-rails` - Rails integration
  - Railtie for auto-configuration
  - Controller concern with `feature_enabled?` helper
  - View helpers (`when_feature_enabled`, `feature_switch`)
  - Rack middleware for request context
  - Context builder from current_user
  - Rails.cache snapshot provider
  - Generator for initializer
  - Rake tasks (list, check, refresh, config)
  - RSpec and Minitest helpers

- `toggly-cache` - Redis caching support
  - Redis snapshot provider
  - Connection pool support
  - TTL configuration
  - Touch/extend TTL support
