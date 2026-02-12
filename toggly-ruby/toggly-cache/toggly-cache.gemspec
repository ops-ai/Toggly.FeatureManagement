# frozen_string_literal: true

require_relative "lib/toggly/cache/version"

Gem::Specification.new do |spec|
  spec.name = "toggly-cache"
  spec.version = Toggly::Cache::VERSION
  spec.authors = ["Ops.ai"]
  spec.email = ["support@ops.ai"]

  spec.summary = "Redis caching support for Toggly feature flags"
  spec.description = "Redis-based snapshot provider for Toggly feature flags. Enables persistent caching and sharing of feature definitions across processes."
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

  spec.add_dependency "toggly", "~> 0.1"
  spec.add_dependency "redis", ">= 4.0"
end
