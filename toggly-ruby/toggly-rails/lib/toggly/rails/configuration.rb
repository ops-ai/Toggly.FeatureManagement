# frozen_string_literal: true

module Toggly
  module Rails
    # Rails-specific configuration for Toggly.
    #
    # Extends the base Toggly configuration with Rails-specific options
    # like context builders and middleware settings.
    class Configuration
      # Core configuration options (delegated to Toggly::Config)
      attr_accessor :app_key, :environment, :base_url, :definitions_url,
                    :refresh_interval, :http_timeout,
                    :enable_undefined_in_dev, :disable_background_refresh,
                    :app_version, :instance_name, :defaults,
                    :snapshot_provider, :use_signed_definitions, :allowed_key_ids

      # Rails-specific options

      # @return [Proc, nil] Custom context builder proc
      attr_accessor :context_builder

      # @return [Boolean] Enable request-scoped context (via middleware)
      attr_accessor :request_context_enabled

      # @return [Symbol] Method to call on current_user for identity
      attr_accessor :identity_method

      # @return [Symbol] Method to call on current_user for groups
      attr_accessor :groups_method

      # @return [Hash<Symbol, Proc>] Custom trait extractors
      attr_accessor :trait_extractors

      # @return [Boolean] Use Rails.cache as snapshot provider
      attr_accessor :use_rails_cache

      # @return [String] Cache key prefix for Rails.cache
      attr_accessor :cache_key_prefix

      def initialize
        # Core defaults
        @environment = ::Rails.env.production? ? "Production" : "Staging" if defined?(::Rails)
        @refresh_interval = 300
        @http_timeout = 10
        @enable_undefined_in_dev = false
        @disable_background_refresh = false
        @defaults = {}
        @use_signed_definitions = false
        @allowed_key_ids = []

        # Rails-specific defaults
        @request_context_enabled = true
        @identity_method = :id
        @groups_method = nil
        @trait_extractors = {}
        @use_rails_cache = false
        @cache_key_prefix = "toggly"
      end

      # Apply this configuration to a Toggly::Config object
      #
      # @param config [Toggly::Config]
      # @return [void]
      def apply_to(config)
        config.app_key = app_key
        config.environment = environment
        config.base_url = base_url if base_url
        config.definitions_url = definitions_url if definitions_url
        config.refresh_interval = refresh_interval
        config.http_timeout = http_timeout
        config.enable_undefined_in_dev = enable_undefined_in_dev
        config.disable_background_refresh = disable_background_refresh
        config.app_version = app_version if app_version
        config.instance_name = instance_name if instance_name
        config.defaults = defaults
        config.use_signed_definitions = use_signed_definitions
        config.allowed_key_ids = allowed_key_ids

        # Set up snapshot provider
        config.snapshot_provider = build_snapshot_provider

        # Use Rails logger
        config.logger = ::Rails.logger if defined?(::Rails)
      end

      # Add a custom trait extractor
      #
      # @param name [Symbol] Trait name
      # @yield [request, user] Block that returns the trait value
      # @return [void]
      def add_trait(name, &block)
        @trait_extractors[name.to_sym] = block
      end

      private

      def build_snapshot_provider
        return snapshot_provider if snapshot_provider
        return nil unless use_rails_cache && defined?(::Rails)

        require_relative "cache_snapshot_provider"
        CacheSnapshotProvider.new(key_prefix: cache_key_prefix)
      end
    end
  end
end
