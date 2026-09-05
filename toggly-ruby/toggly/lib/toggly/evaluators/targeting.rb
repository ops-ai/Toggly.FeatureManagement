# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for user/group targeting rules.
    #
    # Supports targeting by:
    # - Specific user identities
    # - Group membership
    # - Definitions Audience.* indexed params and default rollout
    class Targeting < Base
      def self.type
        "Targeting"
      end

      def self.aliases
        %w[Microsoft.Targeting targeting]
      end

      # Evaluate targeting rule
      #
      # @param rule [Hash] Rule with users/groups or Audience.* params
      # @param context [Context] Evaluation context
      # @param feature_key [String] The feature key
      # @return [Boolean, nil] True if matched, false if excluded, nil to continue
      def evaluate(rule, context, feature_key: nil)
        return nil unless context

        users = collect_users(rule)
        excluded_users = Array(rule_value(rule, "excludedUsers") || rule_value(rule, "excluded_users"))

        if context.identity?
          return false if excluded_users.any? { |u| u.to_s == context.identity }
          return true if users.include?(context.identity)
        end

        groups = collect_groups(rule)
        excluded_groups = Array(rule_value(rule, "excludedGroups") || rule_value(rule, "excluded_groups"))

        return false if excluded_groups.any? { |g| context.in_group?(g) }
        return true if groups.any? { |g| context.in_group?(g) }

        default_percentage = SegmentHelpers.as_float(
          rule,
          "Audience.DefaultRolloutPercentage",
          "DefaultRolloutPercentage",
          "defaultRolloutPercentage",
          "default_percentage",
          "Percentage"
        )
        return StickyHash.compute_percentile(context.identity, feature_key.to_s) < default_percentage if default_percentage&.positive? && context.identity?

        # No match — continue evaluation for legacy sequential rules
        nil
      end

      private

      def collect_users(rule)
        users = []
        append_list_values(users, rule_value(rule, "users") || rule_value(rule, "Users"))
        SegmentHelpers.parameters(rule).each do |key, value|
          next unless key.to_s.start_with?("Audience.Users:") && value

          users << value.to_s
        end
        users.uniq
      end

      def collect_groups(rule)
        groups = []
        append_list_values(groups, rule_value(rule, "groups") || rule_value(rule, "Groups"))
        SegmentHelpers.parameters(rule).each do |key, value|
          next unless key.to_s.start_with?("Audience.Groups:") && value

          groups << value.to_s
        end
        groups.uniq
      end

      def append_list_values(memo, raw)
        case raw
        when Array
          raw.each { |item| memo << item.to_s }
        when String
          raw.split(",").each do |item|
            trimmed = item.strip
            memo << trimmed unless trimmed.empty?
          end
        when nil
          nil
        else
          memo << raw.to_s
        end
      end
    end
  end
end
