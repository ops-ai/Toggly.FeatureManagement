# frozen_string_literal: true

require_relative "lib/toggly/rails/version"

Gem::Specification.new do |spec|
  spec.name = "toggly-rails"
  spec.version = Toggly::Rails::VERSION
  spec.authors = ["Ops.ai"]
  spec.email = ["support@ops.ai"]

  spec.summary = "Rails integration for Toggly feature flags"
  spec.description = "Rails integration for Toggly feature flags including Railtie, controller concerns, view helpers, Rack middleware, and generators."
  spec.homepage = "https://toggly.io"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.0.0"

  spec.metadata["homepage_uri"] = spec.homepage
  spec.metadata["source_code_uri"] = "https://github.com/ops-ai/toggly-ruby"
  spec.metadata["changelog_uri"] = "https://github.com/ops-ai/toggly-ruby/blob/main/CHANGELOG.md"
  spec.metadata["documentation_uri"] = "https://docs.toggly.io/sdks/ruby"
  spec.metadata["rubygems_mfa_required"] = "true"

  spec.files = Dir.glob("lib/**/*") + %w[README.md LICENSE CHANGELOG.md]
  spec.require_paths = ["lib"]

  spec.add_dependency "railties", ">= 7.0"
  spec.add_dependency "toggly", "~> 0.1"
end
