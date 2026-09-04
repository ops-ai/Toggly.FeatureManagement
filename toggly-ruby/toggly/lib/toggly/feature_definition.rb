# frozen_string_literal: true

module Toggly
  # Represents a feature flag definition.
  #
  # @example
  #   definition = Toggly::FeatureDefinition.new(
  #     feature_key: "dark-mode",
  #     feature_type: "Release",
  #     enabled: true,
  #     rules: [{ "type" => "percentage", "value" => 50 }]
  #   )
  class FeatureDefinition
    # @return [String] Unique feature key
    attr_reader :feature_key

    # @return [String] Feature type (Release, Experiment, Ops, Permission)
    attr_reader :feature_type

    # @return [Boolean] Whether the feature is globally enabled
    attr_reader :enabled

    # @return [Array<Hash>] Evaluation rules
    attr_reader :rules

    # @return [Hash] Additional metadata
    attr_reader :metadata

    # @return [Time, nil] When the feature was created
    attr_reader :created_at

    # @return [Time, nil] When the feature was last updated
    attr_reader :updated_at, :requirement_type, :context_kind, :context_requirement_type

    # @return [String, nil] Feature description
    attr_reader :description

    # Feature types
    TYPES = %w[Release Experiment Ops Permission].freeze

    # rubocop:disable-next Metrics/ParameterLists
    def initialize(
      feature_key:,
      feature_type: "Release",
      enabled: false,
      rules: [],
      metadata: {},
      description: nil,
      created_at: nil,
      updated_at: nil,
      requirement_type: "Any",
      context_kind: nil,
      context_requirement_type: nil
    )
      @feature_key = feature_key.to_s
      @feature_type = validate_type(feature_type)
      @enabled = enabled ? true : false
      @rules = Array(rules)
      @metadata = metadata || {}
      @description = description
      @created_at = parse_time(created_at)
      @updated_at = parse_time(updated_at)
      @requirement_type = requirement_type || "Any"
      @context_kind = context_kind
      @context_requirement_type = context_requirement_type
    end

    # Create from a hash (e.g., from JSON)
    #
    # @param hash [Hash] Feature definition hash
    # @return [FeatureDefinition]
    def self.from_hash(hash)
      hash = symbolize_keys(hash)

      # Map API "filters" to internal "rules" format
      rules = hash[:rules] || hash[:filters] || []

      # In Toggly's model, features are enabled based on filter evaluation.
      # If the API doesn't send "enabled", derive it from whether filters exist.
      enabled = if hash.key?(:enabled)
                  hash[:enabled]
                else
                  !rules.empty?
                end

      new(
        feature_key: hash[:featureKey] || hash[:feature_key],
        feature_type: hash[:featureType] || hash[:feature_type] || "Release",
        enabled: enabled,
        rules: rules,
        metadata: hash[:metadata] || {},
        description: hash[:description],
        created_at: hash[:createdAt] || hash[:created_at],
        updated_at: hash[:updatedAt] || hash[:updated_at],
        requirement_type: hash[:requirementType] || hash[:requirement_type] || "Any",
        context_kind: hash[:contextKind] || hash[:context_kind],
        context_requirement_type: hash[:contextRequirementType] || hash[:context_requirement_type]
      )
    end

    # Convert to hash for serialization
    #
    # @return [Hash]
    def to_h
      {
        feature_key: @feature_key,
        feature_type: @feature_type,
        enabled: @enabled,
        rules: @rules,
        metadata: @metadata,
        description: @description,
        created_at: @created_at&.iso8601,
        updated_at: @updated_at&.iso8601
      }
    end

    # Check if feature has rules
    #
    # @return [Boolean]
    def rules?
      !@rules.empty?
    end

    # Check if feature is a release toggle
    #
    # @return [Boolean]
    def release?
      @feature_type == "Release"
    end

    # Check if feature is an experiment
    #
    # @return [Boolean]
    def experiment?
      @feature_type == "Experiment"
    end

    # Check if feature is an ops toggle
    #
    # @return [Boolean]
    def ops?
      @feature_type == "Ops"
    end

    # Check if feature is a permission toggle
    #
    # @return [Boolean]
    def permission?
      @feature_type == "Permission"
    end

    # Equality check
    #
    # @param other [FeatureDefinition]
    # @return [Boolean]
    def ==(other)
      return false unless other.is_a?(FeatureDefinition)

      @feature_key == other.feature_key &&
        @feature_type == other.feature_type &&
        @enabled == other.enabled &&
        @rules == other.rules
    end
    alias eql? ==

    # Hash code for use in collections
    #
    # @return [Integer]
    def hash
      [@feature_key, @feature_type, @enabled, @rules].hash
    end

    private

    def validate_type(type)
      type_str = type.to_s
      return type_str if TYPES.include?(type_str)

      "Release"
    end

    def parse_time(value)
      return nil if value.nil?
      return value if value.is_a?(Time)

      Time.parse(value.to_s)
    rescue ArgumentError
      nil
    end

    def self.symbolize_keys(hash)
      return hash unless hash.is_a?(Hash)

      hash.transform_keys { |k| k.is_a?(String) ? k.to_sym : k }
    end
    private_class_method :symbolize_keys
  end
end
