# frozen_string_literal: true

module Toggly
  # Main client for interacting with Toggly feature flags.
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
  # @example With configuration object
  #   config = Toggly::Config.new(
  #     app_key: "your-app-key",
  #     environment: "Production",
  #     refresh_interval: 60
  #   )
  #   client = Toggly::Client.new(config)
  class Client
    # @return [Config] Client configuration
    attr_reader :config

    # @return [Hash<String, FeatureDefinition>] Current definitions
    attr_reader :definitions

    # @return [Boolean] Whether the client is ready
    attr_reader :ready

    # Create a new client
    #
    # @param config_or_options [Config, Hash] Configuration object or options hash
    def initialize(config_or_options = {})
      @config = config_or_options.is_a?(Config) ? config_or_options : Config.new(**config_or_options)
      @config.validate!

      @definitions = {}
      @mutex = Mutex.new
      @ready = false
      @closed = false

      @engine = EvaluationEngine.new(logger: @config.logger)
      @provider = DefinitionsProvider.new(
        config: @config,
        logger: @config.logger,
        on_definitions_updated: -> { refresh }
      )

      @refresh_thread = nil

      initialize_definitions
      Toggly.register_entity_contexts_at_startup(@config) unless @config.disable_entity_context_registration
      start_background_refresh unless @config.disable_background_refresh
    end

    # Check if a feature is enabled
    #
    # @param feature_key [String, Symbol] The feature key
    # @param context [Context, nil] Optional evaluation context
    # @param default [Boolean] Default value if feature not found
    # @return [Boolean]
    def enabled?(feature_key, context: nil, default: nil)
      key = feature_key.to_s

      definition = @mutex.synchronize { @definitions[key] }

      # Check defaults if not found
      if definition.nil?
        return default unless default.nil?
        return @config.defaults[key] if @config.defaults.key?(key)
        return @config.enable_undefined_in_dev if development?

        return false
      end

      @engine.evaluate(definition, context)
    end

    # Check if a feature is disabled
    #
    # @param feature_key [String, Symbol] The feature key
    # @param context [Context, nil] Optional evaluation context
    # @param default [Boolean] Default value if feature not found
    # @return [Boolean]
    def disabled?(feature_key, context: nil, default: nil)
      !enabled?(feature_key, context: context, default: default.nil? ? nil : !default)
    end

    # Get detailed evaluation result
    #
    # @param feature_key [String, Symbol] The feature key
    # @param context [Context, nil] Optional evaluation context
    # @return [EvaluationResult]
    def evaluate(feature_key, context: nil)
      key = feature_key.to_s
      definition = @mutex.synchronize { @definitions[key] }

      @engine.evaluate_with_details(definition, context)
    end

    # Get a feature definition
    #
    # @param feature_key [String, Symbol] The feature key
    # @return [FeatureDefinition, nil]
    def feature(feature_key)
      @mutex.synchronize { @definitions[feature_key.to_s] }
    end

    # Get all feature keys
    #
    # @return [Array<String>]
    def feature_keys
      @mutex.synchronize { @definitions.keys }
    end

    # Get all features
    #
    # @return [Array<FeatureDefinition>]
    def features
      @mutex.synchronize { @definitions.values }
    end

    # Manually refresh definitions
    #
    # @param force [Boolean] Force refresh even if not modified
    # @return [Boolean] Whether definitions were updated
    def refresh(force: false)
      return false if @config.offline_mode?

      new_definitions = @provider.fetch(force: force)

      if new_definitions
        @mutex.synchronize do
          @definitions = new_definitions
          @ready = true
        end

        save_snapshot
        log_info("Definitions refreshed (#{new_definitions.size} features)")
        true
      else
        false
      end
    rescue StandardError => e
      log_error("Failed to refresh definitions: #{e.message}")
      false
    end

    # Close the client and stop background refresh
    def close
      @closed = true
      @provider.stop_websocket
      @refresh_thread&.kill
      @refresh_thread = nil
    end

    # Check if client is closed
    #
    # @return [Boolean]
    def closed?
      @closed
    end

    # Wait for client to be ready
    #
    # @param timeout [Numeric] Maximum wait time in seconds
    # @return [Boolean] Whether client became ready
    def wait_for_ready(timeout: 5)
      start_time = Time.now

      until @ready
        return false if (Time.now - start_time) > timeout

        sleep(0.01)
      end

      true
    end

    private

    def initialize_definitions
      # Try to load from snapshot first
      load_snapshot if @config.snapshot_provider

      # Initialize with defaults if in offline mode
      if @config.offline_mode?
        @config.defaults.each do |key, value|
          @definitions[key] = FeatureDefinition.new(
            feature_key: key,
            enabled: value
          )
        end
        @ready = true
        return
      end

      # Fetch from API
      refresh(force: true)
    rescue StandardError => e
      log_error("Failed to initialize definitions: #{e.message}")

      # Use snapshot or defaults as fallback
      @ready = true if @definitions.any? || @config.defaults.any?
    end

    def start_background_refresh
      return if @config.disable_background_refresh
      return if @config.offline_mode?
      return if @config.refresh_interval <= 0

      @refresh_thread = Thread.new do
        loop do
          break if @closed

          sleep(@config.refresh_interval)
          break if @closed

          # When WebSocket is connected, skip HTTP refresh unless
          # the fallback interval has elapsed
          next if @provider.should_skip_refresh?

          refresh
        end
      end

      @refresh_thread.abort_on_exception = false

      # Start WebSocket live updates after background refresh is set up
      start_live_updates
    end

    def start_live_updates
      return unless @config.enable_live_updates
      return if @config.offline_mode?

      @provider.start_websocket
    end

    def load_snapshot
      return unless @config.snapshot_provider

      data = @config.snapshot_provider.load
      return unless data

      @mutex.synchronize do
        @definitions = data[:definitions]
      end

      log_debug("Loaded #{@definitions.size} features from snapshot")
    rescue StandardError => e
      log_warn("Failed to load snapshot: #{e.message}")
    end

    def save_snapshot
      return unless @config.snapshot_provider

      @config.snapshot_provider.save(@definitions)
      log_debug("Saved snapshot with #{@definitions.size} features")
    rescue StandardError => e
      log_warn("Failed to save snapshot: #{e.message}")
    end

    def development?
      env = ENV["RACK_ENV"] || ENV["RAILS_ENV"] || ENV["APP_ENV"] || "development"
      env.downcase == "development"
    end

    def log_info(message)
      @config.logger&.info("[Toggly] #{message}")
    end

    def log_debug(message)
      @config.logger&.debug("[Toggly] #{message}")
    end

    def log_warn(message)
      @config.logger&.warn("[Toggly] #{message}")
    end

    def log_error(message)
      @config.logger&.error("[Toggly] #{message}")
    end
  end
end
