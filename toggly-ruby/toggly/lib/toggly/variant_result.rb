# frozen_string_literal: true

module Toggly
  # Assigned variant for a feature, returned by `Client#get_variant`.
  #
  # Assignment is computed locally from the feature's catalog
  # `variants` / `allocation` (see {VariantAllocator}), matching
  # `Microsoft.FeatureManagement`'s `IVariantFeatureManager` bit-for-bit.
  # There is no network round-trip: this is not the `enable_variants`
  # dual-rail from earlier releases (removed; see CHANGELOG).
  class VariantResult
    # @return [String] Variant name
    attr_reader :name

    # @return [Object, nil] Untyped configuration payload for this variant
    attr_reader :configuration_value

    # @return [Boolean] Effective enabled flag for this feature/context after
    #   the variant's `StatusOverride` is applied. This can differ from
    #   `Client#enabled?`, which stays filter-based only; use this field when
    #   you need MF-identical `GetVariantAsync`-style effective-enabled
    #   semantics (e.g. a variant with `StatusOverride: "Enabled"` on an
    #   otherwise-disabled feature).
    attr_reader :enabled

    # @return [String] Assignment reason: "User" | "Group" | "Percentile" |
    #   "DefaultWhenEnabled" | "DefaultWhenDisabled"
    attr_reader :reason

    def initialize(name:, configuration_value: nil, enabled: true, reason: nil)
      @name = name
      @configuration_value = configuration_value
      @enabled = enabled
      @reason = reason
    end

    # @return [Hash]
    def to_h
      { name: @name, configuration_value: @configuration_value, enabled: @enabled, reason: @reason }
    end

    def ==(other)
      other.is_a?(VariantResult) &&
        @name == other.name &&
        @configuration_value == other.configuration_value &&
        @enabled == other.enabled &&
        @reason == other.reason
    end
    alias eql? ==
  end
end
