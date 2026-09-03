# frozen_string_literal: true

require_relative "lib/toggly/version"

Gem::Specification.new do |spec|
  spec.name = "toggly"
  spec.version = Toggly::VERSION
  spec.authors = ["Ops.ai"]
  spec.email = ["support@ops.ai"]

  spec.summary = "Ruby SDK for Toggly feature flags"
  spec.description = "High-performance Ruby SDK for Toggly feature flag management. Works with or without Toggly.io."
  spec.homepage = "https://toggly.io"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.2.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/ops-ai/toggly-ruby"
  spec.metadata["changelog_uri"] = "https://github.com/ops-ai/toggly-ruby/blob/main/CHANGELOG.md"
  spec.metadata["documentation_uri"] = "https://docs.toggly.io/sdks/ruby"
  spec.metadata["rubygems_mfa_required"] = "true"

  spec.files = Dir.glob("lib/**/*") + %w[README.md LICENSE CHANGELOG.md]
  spec.require_paths = ["lib"]

  # Zero runtime dependencies for core gem

  # Optional: enables WebSocket live updates for real-time flag changes
  spec.metadata["optional_dependencies"] = "websocket-client-simple"
end
