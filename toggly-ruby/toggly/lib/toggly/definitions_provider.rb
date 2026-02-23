# frozen_string_literal: true

require "net/http"
require "uri"
require "json"

module Toggly
  # Provider for fetching feature definitions from Toggly API.
  class DefinitionsProvider
    # @param config [Config] Configuration
    # @param logger [Logger, nil] Optional logger
    def initialize(config:, logger: nil)
      @config = config
      @logger = logger
      @etag = nil
      @last_modified = nil
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
      features = data["defs"] || data["features"] || data

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

    def log_debug(message)
      @logger&.debug("[Toggly] #{message}")
    end
  end
end
