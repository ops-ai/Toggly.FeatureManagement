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
      # @return [Boolean] True if matched, false if excluded or rollout does not apply
      def evaluate(rule, context, feature_key: nil)
        ctx = context || Context.anonymous

        users = collect_users(rule)
        excluded_users = Array(rule_value(rule, "excludedUsers") || rule_value(rule, "excluded_users"))

        if ctx.identity?
          return false if excluded_users.any? { |u| u.to_s == ctx.identity }
          return true if users.include?(ctx.identity)
        end

        groups = collect_groups(rule)
        excluded_groups = Array(rule_value(rule, "excludedGroups") || rule_value(rule, "excluded_groups"))

        return false if excluded_groups.any? { |g| ctx.in_group?(g) }
        return true if groups.any? { |g| ctx.in_group?(g) }

        default_percentage = SegmentHelpers.as_float(
          rule,
          "Audience.DefaultRolloutPercentage",
          "DefaultRolloutPercentage",
          "defaultRolloutPercentage",
          "default_percentage",
          "Percentage"
        )
        return false if default_percentage.nil? || default_percentage <= 0
        return true if default_percentage >= 100
        return false unless ctx.identity?

        StickyHash.compute_percentile(ctx.identity, feature_key.to_s) < default_percentage
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
