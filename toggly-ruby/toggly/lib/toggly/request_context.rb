# frozen_string_literal: true

module Toggly
  # HTTP request fields used by segment identity filters.
  class RequestContext
    # @return [String, nil]
    attr_reader :user_agent, :accept_language, :country

    def initialize(user_agent: nil, accept_language: nil, country: nil)
      @user_agent = blank_to_nil(user_agent)
      @accept_language = blank_to_nil(accept_language)
      @country = blank_to_nil(country)
    end

    # @return [Hash]
    def to_h
      {
        userAgent: @user_agent,
        acceptLanguage: @accept_language,
        country: @country
      }
    end

    # Create from a hash accepting camelCase or snake_case keys.
    #
    # @param data [Hash, nil]
    # @return [RequestContext, nil]
    def self.from_hash(data)
      return nil unless data.is_a?(Hash)

      new(
        user_agent: first_value(data, "userAgent", "user_agent"),
        accept_language: first_value(data, "acceptLanguage", "accept_language"),
        country: first_value(data, "country")
      )
    end

    # @param other [Object]
    # @return [Boolean]
    def ==(other)
      return false unless other.is_a?(RequestContext)

      @user_agent == other.user_agent &&
        @accept_language == other.accept_language &&
        @country == other.country
    end
    alias eql? ==

    # @return [Integer]
    def hash
      [@user_agent, @accept_language, @country].hash
    end

    def self.first_value(data, *keys)
      keys.each do |key|
        next unless data.key?(key) || data.key?(key.to_sym)

        value = data[key] || data[key.to_sym]
        next if value.nil?

        text = value.to_s
        return text unless text.empty?
      end
      nil
    end
    private_class_method :first_value

    private

    def blank_to_nil(value)
      return nil if value.nil?

      text = value.to_s
      text.empty? ? nil : text
    end
  end
end
