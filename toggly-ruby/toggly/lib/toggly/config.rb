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
    attr_accessor :app_key

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

    # Default values
    DEFAULT_BASE_URL = "https://app.toggly.io/"
    DEFAULT_REFRESH_INTERVAL = 300 # 5 minutes
    DEFAULT_HTTP_TIMEOUT = 10 # seconds
    DEFAULT_ENVIRONMENT = "Production"

    def initialize(**options)
      @app_key = options[:app_key]
      @environment = options[:environment] || DEFAULT_ENVIRONMENT
      @base_url = normalize_url(options[:base_url] || DEFAULT_BASE_URL)
      @definitions_url = options[:definitions_url]
      @refresh_interval = options[:refresh_interval] || DEFAULT_REFRESH_INTERVAL
      @http_timeout = options[:http_timeout] || DEFAULT_HTTP_TIMEOUT
      @enable_undefined_in_dev = options[:enable_undefined_in_dev] || false
      @disable_background_refresh = options[:disable_background_refresh] || false
      @app_version = options[:app_version]
      @instance_name = options[:instance_name]
      @defaults = options[:defaults] || {}
      @snapshot_provider = options[:snapshot_provider]
      @use_signed_definitions = options[:use_signed_definitions] || false
      @allowed_key_ids = options[:allowed_key_ids] || []
      @logger = options[:logger]
    end

    # Get the definitions endpoint URL
    #
    # @return [String]
    def definitions_endpoint
      base = @definitions_url || @base_url
      "#{normalize_url(base)}definitions/#{@app_key}/#{@environment}"
    end

    # Validate the configuration
    #
    # @raise [ConfigError] if configuration is invalid
    def validate!
      return if offline_mode?

      raise ConfigError, "app_key is required" if @app_key.nil? || @app_key.empty?
      raise ConfigError, "environment is required" if @environment.nil? || @environment.empty?
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
        app_version: @app_version,
        instance_name: @instance_name,
        use_signed_definitions: @use_signed_definitions
      }
    end

    private

    def normalize_url(url)
      return url if url.nil?

      url.end_with?("/") ? url : "#{url}/"
    end
  end
end
