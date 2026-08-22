# frozen_string_literal: true

require_relative "toggly/version"
require_relative "toggly/config"
require_relative "toggly/context"
require_relative "toggly/errors"
require_relative "toggly/feature_definition"
require_relative "toggly/evaluators/base"
require_relative "toggly/evaluators/always_on"
require_relative "toggly/evaluators/always_off"
require_relative "toggly/evaluators/percentage"
require_relative "toggly/evaluators/targeting"
require_relative "toggly/evaluators/time_window"
require_relative "toggly/evaluators/contextual_targeting"
require_relative "toggly/evaluators/context_property"
require_relative "toggly/entity_context"
require_relative "toggly/registry"
require_relative "toggly/evaluation_engine"
require_relative "toggly/snapshot_providers/base"
require_relative "toggly/snapshot_providers/memory"
require_relative "toggly/snapshot_providers/file"
require_relative "toggly/definitions_provider"
require_relative "toggly/client"

# Toggly - Feature Flag Management SDK for Ruby
#
# @example Basic usage
#   client = Toggly::Client.new(
#     app_key: "your-app-key",
#     environment: "Production"
#   )
#
#   if client.enabled?("my-feature")
#     # Feature is enabled
#   end
#
# @example With user context
#   context = Toggly::Context.new(
#     identity: "user-123",
#     groups: ["beta-testers"],
#     traits: { country: "US" }
#   )
#
#   if client.enabled?("premium-feature", context: context)
#     # Feature is enabled for this user
#   end
#
# @example Offline mode with defaults
#   client = Toggly::Client.new(
#     defaults: {
#       "feature-a" => true,
#       "feature-b" => false
#     }
#   )
module Toggly
  class << self
    # Global client instance
    attr_accessor :client

    # Configure and initialize the global client
    #
    # @yield [config] Configuration block
    # @return [Client] The configured client
    def configure
      config = Config.new
      yield(config) if block_given?
      @client = Client.new(config)
    end

    # Check if a feature is enabled using the global client
    #
    # @param feature_key [String, Symbol] The feature key
    # @param context [Context, nil] Optional evaluation context
    # @return [Boolean]
    def enabled?(feature_key, context: nil)
      raise Error, "Toggly not configured. Call Toggly.configure first." unless @client

      @client.enabled?(feature_key, context: context)
    end

    # Check if a feature is disabled using the global client
    #
    # @param feature_key [String, Symbol] The feature key
    # @param context [Context, nil] Optional evaluation context
    # @return [Boolean]
    def disabled?(feature_key, context: nil)
      !enabled?(feature_key, context: context)
    end

    # Reset the global client (mainly for testing)
    def reset!
      @client&.close
      @client = nil
    end
  end
end
