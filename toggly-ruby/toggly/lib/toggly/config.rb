# frozen_string_literal: true

module Toggly
  # Configuration for the Toggly client.
  #
  # @example
  #   config = Toggly::Config.new(
  #     app_key: "your-app-key",
  #     environment: "Production"
  #   )
  class Config
    # @return [String] Application key from Toggly dashboard
    attr_reader :app_key

    # @return [String] Environment name (e.g., "Production", "Staging")
    attr_accessor :environment

    # @return [String] Base URL for Toggly API
    attr_accessor :base_url

    # @return [String] Definitions URL (overrides base_url for definitions)
    attr_accessor :definitions_url

    # @return [Integer] Refresh interval in seconds
    attr_accessor :refresh_interval

    # @return [Integer] HTTP timeout in seconds
    attr_accessor :http_timeout

    # @return [Boolean] Enable undefined features in development
    attr_accessor :enable_undefined_in_dev

    # @return [Boolean] Disable background refresh
    attr_accessor :disable_background_refresh

    # @return [Boolean] Enable WebSocket live updates (default: true)
    attr_accessor :enable_live_updates
    attr_accessor :disable_entity_context_registration

    # @return [String] Application version
    attr_accessor :app_version

    # @return [String] Instance name for distributed systems
    attr_accessor :instance_name

    # @return [Hash<String, Boolean>] Default feature values for offline mode
    attr_accessor :defaults

    # @return [SnapshotProviders::Base, nil] Snapshot provider for persistence
    attr_accessor :snapshot_provider

    # @return [Boolean] Use signed definitions
    attr_accessor :use_signed_definitions

    # @return [Array<String>] Allowed key IDs for signed definitions
    attr_accessor :allowed_key_ids

    # @return [Logger, nil] Logger instance
    attr_accessor :logger

    # @return [Boolean] Enable feature usage tracking (Usage.SendStats)
    attr_reader :enable_usage_tracking

    # @return [Boolean] Enable business metrics (Metrics.SendMetrics)
    attr_reader :enable_metrics

    # @return [String] Base URL for usage/metrics gRPC (default app.toggly.io)
    attr_accessor :metrics_base_url

    # @return [Numeric] Usage flush interval in seconds
    attr_accessor :usage_flush_interval

    # @return [Numeric] Metrics flush interval in seconds
    attr_accessor :metrics_flush_interval

    # Injectable usage transport (tests / custom senders). Must respond to +send_stats+.
    attr_accessor :usage_client

    # Injectable metrics transport (tests / custom senders). Must respond to +send_metrics+.
    attr_accessor :metrics_client

    # Default values
    DEFAULT_BASE_URL = "https://definitions.toggly.io/"
    DEFAULT_REFRESH_INTERVAL = 300 # 5 minutes
    DEFAULT_HTTP_TIMEOUT = 10 # seconds
    DEFAULT_ENVIRONMENT = "Production"
    DEFAULT_METRICS_BASE_URL = "https://app.toggly.io/"
    DEFAULT_TELEMETRY_FLUSH_SECONDS = 60.0

    def initialize(**options)
      @app_key = options[:app_key]
      @environment = options[:environment] || DEFAULT_ENVIRONMENT
      @base_url = normalize_url(options[:base_url] || DEFAULT_BASE_URL)
      @definitions_url = options[:definitions_url]
      @refresh_interval = options[:refresh_interval] || DEFAULT_REFRESH_INTERVAL
      @http_timeout = options[:http_timeout] || DEFAULT_HTTP_TIMEOUT
      @enable_undefined_in_dev = options[:enable_undefined_in_dev] || false
      @disable_background_refresh = options[:disable_background_refresh] || false
      @enable_live_updates = options.fetch(:enable_live_updates, true)
      @disable_entity_context_registration = options.fetch(:disable_entity_context_registration, false)
      @app_version = options[:app_version]
      @instance_name = options[:instance_name]
      @defaults = options[:defaults] || {}
      @snapshot_provider = options[:snapshot_provider]
      @use_signed_definitions = options[:use_signed_definitions] || false
      @allowed_key_ids = options[:allowed_key_ids] || []
      @logger = options[:logger]

      @usage_tracking_explicit = options.key?(:enable_usage_tracking)
      @metrics_explicit = options.key?(:enable_metrics)
      @enable_usage_tracking = options[:enable_usage_tracking] if @usage_tracking_explicit
      @enable_metrics = options[:enable_metrics] if @metrics_explicit
      apply_telemetry_defaults!
      @metrics_base_url = normalize_url(options[:metrics_base_url] || DEFAULT_METRICS_BASE_URL)
      @usage_flush_interval = options.fetch(:usage_flush_interval, DEFAULT_TELEMETRY_FLUSH_SECONDS)
      @metrics_flush_interval = options.fetch(:metrics_flush_interval, DEFAULT_TELEMETRY_FLUSH_SECONDS)
      @usage_client = options[:usage_client]
      @metrics_client = options[:metrics_client]
    end

    # Get the definitions endpoint URL
    #
    # @return [String]
    def definitions_endpoint
      base = @definitions_url || @base_url
      endpoint = @use_signed_definitions ? "definitions-signed" : "definitions"
      "#{normalize_url(base)}#{endpoint}/#{@app_key}/#{@environment}"
    end

    # Validate the configuration
    #
    # @raise [ConfigError] if configuration is invalid
    def validate!
      return if offline_mode?

      raise ConfigError, "app_key is required" if @app_key.nil? || @app_key.empty?
      raise ConfigError, "environment is required" if @environment.nil? || @environment.empty?
    end

    def app_key=(value)
      @app_key = value
      apply_telemetry_defaults!
    end

    def enable_usage_tracking=(value)
      @usage_tracking_explicit = true
      @enable_usage_tracking = value
    end

    def enable_metrics=(value)
      @metrics_explicit = true
      @enable_metrics = value
    end

    # Apply usage/metrics defaults from the current +app_key+ and
    # +TOGGLY_DISABLE_TELEMETRY+. Explicit +enable_usage_tracking+ /
    # +enable_metrics+ assignments still win. Call after a configure block
    # so +Config.new+ without options does not leave usage stuck off.
    #
    # @return [self]
    def apply_telemetry_defaults!
      default = telemetry_enabled_by_default?
      @enable_usage_tracking = default unless @usage_tracking_explicit
      @enable_metrics = default unless @metrics_explicit
      self
    end

    # Check if running in offline mode (defaults only)
    #
    # @return [Boolean]
    def offline_mode?
      (@app_key.nil? || @app_key.empty?) && !@defaults.empty?
    end

    # Convert to hash
    #
    # @return [Hash]
    def to_h
      {
        app_key: @app_key,
        environment: @environment,
        base_url: @base_url,
        definitions_url: @definitions_url,
        refresh_interval: @refresh_interval,
        http_timeout: @http_timeout,
        enable_undefined_in_dev: @enable_undefined_in_dev,
        disable_background_refresh: @disable_background_refresh,
        enable_live_updates: @enable_live_updates,
        app_version: @app_version,
        instance_name: @instance_name,
        use_signed_definitions: @use_signed_definitions,
        enable_usage_tracking: @enable_usage_tracking,
        enable_metrics: @enable_metrics,
        metrics_base_url: @metrics_base_url,
        usage_flush_interval: @usage_flush_interval,
        metrics_flush_interval: @metrics_flush_interval
      }
    end

    private

    def telemetry_enabled_by_default?
      !@app_key.to_s.empty? && ENV["TOGGLY_DISABLE_TELEMETRY"] != "1"
    end

    def normalize_url(url)
      return url if url.nil?

      url.end_with?("/") ? url : "#{url}/"
    end
  end
end
