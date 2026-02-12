# frozen_string_literal: true

module Toggly
  # Base error class for all Toggly errors
  class Error < StandardError; end

  # Raised when configuration is invalid
  class ConfigError < Error; end

  # Raised when network requests fail
  class NetworkError < Error
    attr_reader :status_code, :response_body

    def initialize(message, status_code: nil, response_body: nil)
      super(message)
      @status_code = status_code
      @response_body = response_body
    end
  end

  # Raised when definitions cannot be fetched
  class DefinitionsError < Error; end

  # Raised when feature evaluation fails
  class EvaluationError < Error
    attr_reader :feature_key

    def initialize(message, feature_key: nil)
      super(message)
      @feature_key = feature_key
    end
  end

  # Raised when snapshot operations fail
  class SnapshotError < Error; end

  # Raised when signed definitions verification fails
  class SignatureError < Error; end

  # Raised when the client is not initialized
  class NotInitializedError < Error
    def initialize(message = "Toggly client is not initialized")
      super
    end
  end

  # Raised when a feature is not found
  class FeatureNotFoundError < Error
    attr_reader :feature_key

    def initialize(feature_key)
      @feature_key = feature_key
      super("Feature not found: #{feature_key}")
    end
  end
end
