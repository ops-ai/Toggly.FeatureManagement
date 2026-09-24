# frozen_string_literal: true

require "digest"

module Toggly
  # Catalog-local, MF-parity variant allocator.
  #
  # Assigns a feature variant purely from a {FeatureDefinition}'s
  # `variants` / `allocation` and a targeting context (`identity` + `groups`),
  # bit-for-bit matching `Microsoft.FeatureManagement` 4.7.0's
  # `FeatureManager#GetVariantAsync`. Verified against the shared
  # `variant-allocator-corpus/cases.json` gold corpus.
  #
  # This replaces the `evaluated-variants-signed` dual-rail: there is no
  # network call here — the caller supplies the already filter-evaluated
  # `enabled` boolean (the same value `Client#enabled?` would return for
  # this feature/context) and this module does the rest locally.
  module VariantAllocator
    module_function

    # Assignment reasons (mirrors MF `AssignmentReason`).
    REASON_NONE = "None"
    REASON_USER = "User"
    REASON_GROUP = "Group"
    REASON_PERCENTILE = "Percentile"
    REASON_DEFAULT_WHEN_ENABLED = "DefaultWhenEnabled"
    REASON_DEFAULT_WHEN_DISABLED = "DefaultWhenDisabled"

    # Result of a variant assignment.
    #
    # @!attribute variant_name [String, nil] Assigned variant name, or nil if unassigned
    # @!attribute configuration_value [Object, nil] The assigned variant's configuration payload
    # @!attribute enabled [Boolean] Effective enabled flag after StatusOverride is applied
    # @!attribute reason [String] One of the REASON_* constants above
    Assignment = Struct.new(:variant_name, :configuration_value, :enabled, :reason, keyword_init: true)

    # Assign a variant for a feature + targeting context.
    #
    # @param definition [FeatureDefinition] Feature definition (variants + allocation)
    # @param enabled [Boolean] The filter-evaluated enabled state for this context
    #   (i.e. what `EvaluationEngine#evaluate` returns for this definition/context)
    # @param identity [String, nil] Targeting user id
    # @param groups [Array<String>] Targeting groups
    # @param ignore_case [Boolean] MF `TargetingEvaluationOptions.IgnoreCase` parity knob.
    #   Defaults to `false`, matching Microsoft.FeatureManagement's default.
    # @return [Assignment]
    def assign(definition, enabled:, identity: nil, groups: [], ignore_case: false)
      variants = definition&.variants || []
      allocation = definition&.allocation

      return build_assignment(nil, variants, enabled, REASON_NONE) if variants.empty?

      unless enabled
        variant_name = allocation&.default_when_disabled
        return build_assignment(variant_name, variants, enabled, REASON_DEFAULT_WHEN_DISABLED)
      end

      variant_name, reason = resolve_enabled_allocation(
        allocation, identity, groups, ignore_case, definition.feature_key
      )
      build_assignment(variant_name, variants, enabled, reason)
    end

    def resolve_enabled_allocation(allocation, identity, groups, ignore_case, feature_key)
      return [nil, REASON_DEFAULT_WHEN_ENABLED] unless allocation

      user_variant = match_user(allocation.user, identity, ignore_case)
      return [user_variant, REASON_USER] if user_variant

      group_variant = match_group(allocation.group, groups, ignore_case)
      return [group_variant, REASON_GROUP] if group_variant

      percentile_variant = match_percentile(allocation.percentile, allocation.seed, identity, feature_key, ignore_case)
      return [percentile_variant, REASON_PERCENTILE] if percentile_variant

      [allocation.default_when_enabled, REASON_DEFAULT_WHEN_ENABLED]
    end

    def match_user(entries, identity, ignore_case)
      return nil if identity.nil? || identity.to_s.empty?

      Array(entries).each do |entry|
        users = Array(entry[:users])
        matched = if ignore_case
                    users.any? { |u| u.to_s.casecmp?(identity.to_s) }
                  else
                    users.include?(identity.to_s)
                  end
        return entry[:variant] if matched
      end
      nil
    end

    def match_group(entries, groups, ignore_case)
      context_groups = Array(groups).map(&:to_s)
      return nil if context_groups.empty?

      Array(entries).each do |entry|
        entry_groups = Array(entry[:groups]).map(&:to_s)
        matched = if ignore_case
                    entry_groups.any? { |eg| context_groups.any? { |cg| cg.casecmp?(eg) } }
                  else
                    entry_groups.intersect?(context_groups)
                  end
        return entry[:variant] if matched
      end
      nil
    end

    def match_percentile(entries, seed, identity, feature_key, ignore_case)
      list = Array(entries)
      return nil if list.empty?

      pct = compute_percentile(identity, seed, feature_key, ignore_case)
      list.each do |entry|
        from = entry[:from].to_f
        to = entry[:to].to_f
        matched = to >= 100.0 ? pct >= from : (pct >= from && pct < to)
        return entry[:variant] if matched
      end
      nil
    end

    # MF-parity percentile hash.
    #
    # `contextId = "{userId}\n{hint}"`, `hint = seed` (if non-nil) else
    # `"allocation\n{featureName}"`. SHA-256 over the UTF-8 bytes; the first
    # 4 bytes read as a little-endian uint32; `pct = marker / 0xFFFFFFFF * 100`.
    #
    # @return [Float] Percentile in [0, 100]
    def compute_percentile(identity, seed, feature_key, ignore_case)
      user_id = identity.to_s
      user_id = user_id.downcase if ignore_case
      hint = seed.nil? ? "allocation\n#{feature_key}" : seed.to_s
      context_id = "#{user_id}\n#{hint}"

      digest = Digest::SHA256.digest(context_id)
      marker = digest.byteslice(0, 4).unpack1("V") # little-endian uint32; unpack1("V") is endian-explicit
      (marker.to_f / 0xFFFFFFFF) * 100.0
    end

    def build_assignment(variant_name, variants, base_enabled, reason)
      variant = Array(variants).find { |v| v.name == variant_name }
      effective_enabled =
        if variant&.enabled_override?
          true
        elsif variant&.disabled_override?
          false
        else
          base_enabled
        end

      Assignment.new(
        variant_name: variant_name,
        configuration_value: variant&.configuration_value,
        enabled: effective_enabled,
        reason: reason
      )
    end
  end
end
