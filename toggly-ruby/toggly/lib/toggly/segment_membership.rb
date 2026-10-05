# frozen_string_literal: true

require "json"
require "net/http"
require "uri"

module Toggly
  # Backend-key client for targeting-list membership on app.toggly.io.
  class SegmentMembership
    def initialize(app_key:, app_base_url: "https://app.toggly.io")
      raise ArgumentError, "app_key is required" if app_key.nil? || app_key.empty?

      @app_key = app_key
      @base = app_base_url.sub(%r{/+\z}, "")
    end

    def list_segments
      request(Net::HTTP::Get, "/api/v2/segments")
    end

    def add_segment_members(segment, identifiers)
      request(Net::HTTP::Post, items_path(segment), { identifiers: identifiers })
    end

    def remove_segment_members(segment, identifiers)
      request(Net::HTTP::Delete, items_path(segment), { identifiers: identifiers })
    end

    def replace_segment_members(segment, identifiers)
      request(Net::HTTP::Put, items_path(segment), { identifiers: identifiers })
    end

    private

    def items_path(segment)
      "/api/v2/segments/#{URI.encode_www_form_component(segment).gsub("+", "%20")}/items"
    end

    def request(klass, path, body = nil)
      uri = URI.parse("#{@base}#{path}")
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = 30
      http.read_timeout = 30
      req = klass.new(uri)
      req["Authorization"] = @app_key
      req["Accept"] = "application/json"
      if body
        req["Content-Type"] = "application/json"
        req.body = JSON.generate(body)
      end
      response = http.request(req)
      unless response.is_a?(Net::HTTPSuccess)
        raise Toggly::NetworkError.new(
          "Segment membership failed",
          status_code: response.code.to_i,
          response_body: response.body
        )
      end

      # Mutations may return 204/empty bodies; do not JSON-parse blank payloads.
      body = response.body.to_s
      return nil if body.strip.empty?

      JSON.parse(body)
    end
  end
end
