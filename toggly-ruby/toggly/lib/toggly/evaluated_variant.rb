# frozen_string_literal: true

module Toggly
  # Server-evaluated variant entry for a single feature flag, as returned by
  # `evaluated-variants-signed`. This is distinct from `FeatureDefinition`
  # (client-side rules): the server has already picked the winning variant.
  class EvaluatedVariantDef
    # @return [Boolean] Whether the feature is enabled for this assignment
    attr_reader :enabled

    # @return [String, nil] Assigned variant name, if any
    attr_reader :variant

    # @return [Object, nil] Configuration payload for the variant (shape depends on the feature)
    attr_reader :configuration_value

    def initialize(enabled:, variant: nil, configuration_value: nil)
      @enabled = enabled ? true : false
      @variant = variant
      @configuration_value = configuration_value
    end

    # Create from a hash (API response or snapshot; camelCase or snake_case).
    #
    # @param hash [Hash]
    # @return [EvaluatedVariantDef]
    def self.from_hash(hash)
      hash = symbolize_keys(hash)
      configuration_value = if hash.key?(:configurationValue)
                              hash[:configurationValue]
                            else
                              hash[:configuration_value]
                            end

      new(
        enabled: hash[:enabled],
        variant: hash[:variant],
        configuration_value: configuration_value
      )
    end

    # Convert to a hash for serialization (snapshot persistence).
    #
    # @return [Hash]
    def to_h
      {
        enabled: @enabled,
        variant: @variant,
        configuration_value: @configuration_value
      }
    end

    def ==(other)
      other.is_a?(EvaluatedVariantDef) &&
        @enabled == other.enabled &&
        @variant == other.variant &&
        @configuration_value == other.configuration_value
    end
    alias eql? ==

    def self.symbolize_keys(hash)
      return hash unless hash.is_a?(Hash)

      hash.transform_keys { |k| k.is_a?(String) ? k.to_sym : k }
    end
    private_class_method :symbolize_keys
  end

  # Assigned variant name and configuration value for a feature, returned by
  # `Client#get_variant` when `Config#enable_variants` is true.
  class VariantResult
    # @return [String] Variant name assigned by the server
    attr_reader :name

    # @return [Object, nil] Optional configuration payload for the variant
    attr_reader :configuration_value

    def initialize(name:, configuration_value: nil)
      @name = name
      @configuration_value = configuration_value
    end

    # @return [Hash]
    def to_h
      { name: @name, configuration_value: @configuration_value }
    end
  end
end
