# frozen_string_literal: true

module Toggly
  # A single named variant of a feature flag, as sent on the catalog
  # (`definitions` / `definitions-signed`) wire alongside `filters`.
  #
  # Matches the shape produced by `Microsoft.FeatureManagement`'s
  # `VariantDefinition` (`Name`, `ConfigurationValue`, `StatusOverride`).
  class FeatureVariant
    # Valid `StatusOverride` values (MF `StatusOverride` enum as strings).
    STATUS_OVERRIDES = %w[None Enabled Disabled].freeze

    # @return [String] Variant name
    attr_reader :name

    # @return [Object, nil] Untyped configuration payload for this variant
    attr_reader :configuration_value

    # @return [String] "None" | "Enabled" | "Disabled"
    attr_reader :status_override

    def initialize(name:, configuration_value: nil, status_override: "None")
      @name = name.to_s
      @configuration_value = configuration_value
      @status_override = STATUS_OVERRIDES.include?(status_override.to_s) ? status_override.to_s : "None"
    end

    # @param hash [Hash] Variant hash (camelCase wire or snake_case snapshot)
    # @return [FeatureVariant]
    def self.from_hash(hash)
      hash = symbolize_keys(hash)
      configuration_value = if hash.key?(:configurationValue)
                              hash[:configurationValue]
                            else
                              hash[:configuration_value]
                            end

      new(
        name: hash[:name],
        configuration_value: configuration_value,
        status_override: hash[:statusOverride] || hash[:status_override] || "None"
      )
    end

    # @return [Boolean] True when this variant forces the feature to be
    #   reported enabled regardless of the base filter-evaluated state.
    def enabled_override?
      @status_override == "Enabled"
    end

    # @return [Boolean] True when this variant forces the feature to be
    #   reported disabled regardless of the base filter-evaluated state.
    def disabled_override?
      @status_override == "Disabled"
    end

    # @return [Hash]
    def to_h
      {
        name: @name,
        configuration_value: @configuration_value,
        status_override: @status_override
      }
    end

    def ==(other)
      other.is_a?(FeatureVariant) &&
        @name == other.name &&
        @configuration_value == other.configuration_value &&
        @status_override == other.status_override
    end
    alias eql? ==

    def hash
      [@name, @configuration_value, @status_override].hash
    end

    def self.symbolize_keys(hash)
      return {} unless hash.is_a?(Hash)

      hash.transform_keys { |k| k.is_a?(String) ? k.to_sym : k }
    end
    private_class_method :symbolize_keys
  end

  # Allocation rules for assigning variants to users/groups/percentile
  # buckets, matching `Microsoft.FeatureManagement`'s `Allocation` schema.
  class FeatureVariantAllocation
    # @return [String, nil] Variant assigned when the feature is enabled and
    #   no user/group/percentile allocation matched.
    attr_reader :default_when_enabled

    # @return [String, nil] Variant assigned when the feature is disabled.
    attr_reader :default_when_disabled

    # @return [String, nil] Seed for the percentile hash; falls back to
    #   "allocation\n{featureName}" when nil.
    attr_reader :seed

    # @return [Array<Hash>] `[{ variant:, users: [...] }, ...]`
    attr_reader :user

    # @return [Array<Hash>] `[{ variant:, groups: [...] }, ...]`
    attr_reader :group

    # @return [Array<Hash>] `[{ variant:, from:, to: }, ...]`
    attr_reader :percentile

    def initialize(default_when_enabled: nil, default_when_disabled: nil, seed: nil, user: [], group: [], percentile: [])
      @default_when_enabled = default_when_enabled
      @default_when_disabled = default_when_disabled
      @seed = seed
      @user = Array(user)
      @group = Array(group)
      @percentile = Array(percentile)
    end

    # @param hash [Hash, nil]
    # @return [FeatureVariantAllocation, nil] nil when +hash+ is nil (no allocation configured)
    def self.from_hash(hash)
      return nil unless hash.is_a?(Hash)

      hash = symbolize_keys(hash)
      new(
        default_when_enabled: hash[:defaultWhenEnabled] || hash[:default_when_enabled],
        default_when_disabled: hash[:defaultWhenDisabled] || hash[:default_when_disabled],
        seed: hash[:seed],
        user: parse_entries(hash[:user], :users),
        group: parse_entries(hash[:group], :groups),
        percentile: parse_percentile_entries(hash[:percentile])
      )
    end

    # @return [Hash]
    def to_h
      {
        default_when_enabled: @default_when_enabled,
        default_when_disabled: @default_when_disabled,
        seed: @seed,
        user: @user,
        group: @group,
        percentile: @percentile
      }
    end

    def ==(other)
      other.is_a?(FeatureVariantAllocation) &&
        @default_when_enabled == other.default_when_enabled &&
        @default_when_disabled == other.default_when_disabled &&
        @seed == other.seed &&
        @user == other.user &&
        @group == other.group &&
        @percentile == other.percentile
    end
    alias eql? ==

    def hash
      [@default_when_enabled, @default_when_disabled, @seed, @user, @group, @percentile].hash
    end

    def self.parse_entries(raw, members_key)
      Array(raw).filter_map do |entry|
        next unless entry.is_a?(Hash)

        entry = symbolize_keys(entry)
        { variant: entry[:variant], members_key => Array(entry[members_key]).map(&:to_s) }
      end
    end
    private_class_method :parse_entries

    def self.parse_percentile_entries(raw)
      Array(raw).filter_map do |entry|
        next unless entry.is_a?(Hash)

        entry = symbolize_keys(entry)
        { variant: entry[:variant], from: entry[:from].to_f, to: entry[:to].to_f }
      end
    end
    private_class_method :parse_percentile_entries

    def self.symbolize_keys(hash)
      return {} unless hash.is_a?(Hash)

      hash.transform_keys { |k| k.is_a?(String) ? k.to_sym : k }
    end
    private_class_method :symbolize_keys
  end
end
