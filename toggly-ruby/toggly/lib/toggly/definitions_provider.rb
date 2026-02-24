# frozen_string_literal: true

require "net/http"
require "uri"
require "json"

begin
  require "websocket-client-simple"
  HAS_WEBSOCKET = true
rescue LoadError
  HAS_WEBSOCKET = false
end

module Toggly
  # Provider for fetching feature definitions from Toggly API.
  class DefinitionsProvider
    # Fallback HTTP refresh interval when WebSocket is connected (20 minutes)
    FALLBACK_REFRESH_INTERVAL = 20 * 60

    # Delay before attempting WebSocket reconnection (seconds)
    WS_RECONNECT_DELAY = 5

    # @return [Boolean] Whether the WebSocket connection is active
    attr_reader :ws_connected

    # @param config [Config] Configuration
    # @param logger [Logger, nil] Optional logger
    # @param on_definitions_updated [Proc, nil] Callback when WS signals an update
    def initialize(config:, logger: nil, on_definitions_updated: nil)
      @config = config
      @logger = logger
      @on_definitions_updated = on_definitions_updated
      @etag = nil
      @last_modified = nil

      # WebSocket state
      @ws = nil
      @ws_connected = false
      @ws_thread = nil
      @ws_closing = false
      @last_fallback_refresh = nil
    end

    # Fetch definitions from the API
    #
    # @param force [Boolean] Force fetch even if cached
    # @return [Hash, nil] Hash of definitions, or nil if not modified
    # @raise [NetworkError] On network failures
    # @raise [DefinitionsError] On API errors
    def fetch(force: false)
      return nil if @config.offline_mode?

      uri = URI.parse(@config.definitions_endpoint)
      http = build_http(uri)
      request = build_request(uri, force)

      response = http.request(request)
      handle_response(response)
    rescue Net::OpenTimeout, Net::ReadTimeout => e
      raise NetworkError.new("Request timeout: #{e.message}")
    rescue SocketError, Errno::ECONNREFUSED => e
      raise NetworkError.new("Connection failed: #{e.message}")
    rescue StandardError => e
      raise NetworkError.new("Request failed: #{e.message}")
    end

    # Reset cached headers (force full fetch next time)
    def reset_cache
      @etag = nil
      @last_modified = nil
    end

    # Check whether the periodic refresh should be skipped because the
    # WebSocket connection is active and the fallback interval has not elapsed.
    #
    # @return [Boolean] true if the refresh should be skipped
    def should_skip_refresh?
      return false unless @ws_connected
      return false if @last_fallback_refresh.nil?

      if (Time.now - @last_fallback_refresh) < FALLBACK_REFRESH_INTERVAL
        log_debug("WebSocket connected; skipping periodic HTTP refresh")
        true
      else
        @last_fallback_refresh = Time.now
        false
      end
    end

    # Start a WebSocket connection for live definition updates.
    # Requires the `websocket-client-simple` gem. If the gem is not installed
    # this method logs a message and returns without error.
    def start_websocket
      unless HAS_WEBSOCKET
        log_debug("websocket-client-simple gem not available; live updates disabled")
        return
      end

      return if @config.offline_mode?

      @ws_closing = false

      @ws_thread = Thread.new do
        loop do
          break if @ws_closing

          connect_websocket
          break if @ws_closing

          log_debug("WebSocket disconnected, reconnecting in #{WS_RECONNECT_DELAY}s")
          sleep(WS_RECONNECT_DELAY)
        end
      end

      @ws_thread.abort_on_exception = false
    end

    # Stop the WebSocket connection and its management thread.
    def stop_websocket
      @ws_closing = true
      @ws_connected = false

      if @ws
        begin
          @ws.close
        rescue StandardError
          # Ignore errors during close
        end
        @ws = nil
      end

      if @ws_thread
        @ws_thread.kill
        @ws_thread = nil
      end
    end

    private

    def build_http(uri)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = @config.http_timeout
      http.read_timeout = @config.http_timeout
      http
    end

    def build_request(uri, force)
      request = Net::HTTP::Get.new(uri)
      request["Accept"] = "application/json"
      request["User-Agent"] = "toggly-ruby/#{Toggly::VERSION}"

      # Add app version if configured
      request["X-App-Version"] = @config.app_version if @config.app_version

      # Add instance name if configured
      request["X-Instance-Name"] = @config.instance_name if @config.instance_name

      # Add conditional headers unless forcing
      unless force
        request["If-None-Match"] = @etag if @etag
        request["If-Modified-Since"] = @last_modified if @last_modified
      end

      request
    end

    def handle_response(response)
      case response.code.to_i
      when 200
        parse_definitions(response)
      when 304
        # Not modified
        log_debug("Definitions not modified")
        nil
      when 401, 403
        raise DefinitionsError, "Authentication failed: #{response.code}"
      when 404
        raise DefinitionsError, "Definitions not found (check app_key and environment)"
      else
        raise NetworkError.new(
          "API error: #{response.code}",
          status_code: response.code.to_i,
          response_body: response.body
        )
      end
    end

    def parse_definitions(response)
      # Cache headers for conditional requests
      @etag = response["ETag"]
      @last_modified = response["Last-Modified"]

      data = JSON.parse(response.body)
      features = if data.is_a?(Hash)
                   data["defs"] || data["features"] || data
                 else
                   data
                 end

      # Handle both array and object formats
      if features.is_a?(Array)
        features.each_with_object({}) do |item, hash|
          definition = FeatureDefinition.from_hash(item)
          hash[definition.feature_key] = definition
        end
      elsif features.is_a?(Hash)
        features.transform_values { |v| FeatureDefinition.from_hash(v) }
      else
        raise DefinitionsError, "Invalid definitions format"
      end
    rescue JSON::ParserError => e
      raise DefinitionsError, "Failed to parse definitions: #{e.message}"
    end

    def build_websocket_url
      base = @config.definitions_url || @config.base_url
      ws_url = base.gsub(%r{^https://}, "wss://").gsub(%r{^http://}, "ws://")
      ws_url = ws_url.chomp("/")
      "#{ws_url}/#{@config.app_key}/ws"
    end

    def connect_websocket
      url = build_websocket_url
      log_debug("Connecting WebSocket to: #{url}")

      provider = self
      connected_flag = false

      begin
        @ws = WebSocket::Client::Simple.connect(url)
      rescue StandardError => e
        log_error("Failed to create WebSocket: #{e.message}")
        @ws = nil
        return
      end

      @ws.on :open do
        provider.instance_variable_set(:@ws_connected, true)
        provider.instance_variable_set(:@last_fallback_refresh, Time.now)
        connected_flag = true
        provider.send(:log_debug, "WebSocket connected")
      end

      @ws.on :message do |msg|
        begin
          text = msg.data.to_s
          data = JSON.parse(text)
          msg_type = data["type"]

          if msg_type == "ping"
            next
          end

          if msg_type == "flags-updated" || msg_type == "update"
            provider.send(:log_debug, "WebSocket: definitions updated, refreshing")
            provider.instance_variable_get(:@on_definitions_updated)&.call
          end
        rescue JSON::ParserError
          # Non-JSON message - check for plain text signals
          plain = msg.data.to_s.strip
          if plain == "update" || plain == "flags-updated"
            provider.send(:log_debug, "WebSocket: definitions updated (plain text), refreshing")
            provider.instance_variable_get(:@on_definitions_updated)&.call
          end
        end
      end

      @ws.on :error do |e|
        provider.send(:log_error, "WebSocket error: #{e.message}")
      end

      @ws.on :close do |_e|
        provider.instance_variable_set(:@ws_connected, false)
        provider.instance_variable_set(:@ws, nil)
        connected_flag = false
        provider.send(:log_debug, "WebSocket connection closed")
      end

      # Block until disconnected or closing
      sleep(0.1) until !@ws || @ws_closing || (@ws && !@ws.open?)
    end

    def log_debug(message)
      @logger&.debug("[Toggly] #{message}")
    end

    def log_error(message)
      @logger&.error("[Toggly] #{message}")
    end
  end
end
