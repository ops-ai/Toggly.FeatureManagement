# frozen_string_literal: true

module Toggly
  # Maps common HTTP headers into RequestContext fields.
  #
  # Does not invent identity, groups, or claims — merge those separately.
  class HttpRequestMapper
    COUNTRY_HEADERS = %w[
      cf-ipcountry
      x-vercel-ip-country
      cloudfront-viewer-country
    ].freeze

    class << self
      # Build RequestContext from a header bag (case-insensitive keys).
      #
      # @param headers [Hash, nil]
      # @return [RequestContext]
      def from_http_headers(headers)
        return RequestContext.new if headers.nil? || headers.empty?

        RequestContext.new(
          user_agent: header(headers, "user-agent"),
          accept_language: header(headers, "accept-language"),
          country: first_present(headers, *COUNTRY_HEADERS)
        )
      end

      # Merge HTTP-mapped request fields over an existing evaluation context.
      #
      # @param headers [Hash, nil]
      # @param base [Context, nil]
      # @return [Context]
      def merge_into(headers, base)
        request = from_http_headers(headers)
        return Context.new(request: request) if base.nil?

        base.with_request(request)
      end

      private

      def first_present(headers, *names)
        names.each do |name|
          value = header(headers, name)
          return value if value
        end
        nil
      end

      def header(headers, name)
        lower = name.downcase
        headers.each do |key, value|
          next unless key && key.to_s.downcase == lower
          next if value.nil?

          text = value.to_s
          return text unless text.empty?
        end
        nil
      end
    end
  end
end
