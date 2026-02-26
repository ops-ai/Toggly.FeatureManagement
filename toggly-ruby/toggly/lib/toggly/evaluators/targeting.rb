# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for user/group targeting rules.
    #
    # Supports targeting by:
    # - Specific user identities
    # - Group membership
    class Targeting < Base
      def self.type
        "targeting"
      end

      # Evaluate targeting rule
      #
      # @param rule [Hash] Rule with "users" and/or "groups" arrays
      # @param context [Context] Evaluation context
      # @param feature_key [String] The feature key
      # @return [Boolean, nil] True if matched, false if excluded, nil to continue
      def evaluate(rule, context, _feature_key: nil)
        return nil unless context

        # Check user targeting
        users = Array(rule_value(rule, "users"))
        excluded_users = Array(rule_value(rule, "excludedUsers") || rule_value(rule, "excluded_users"))

        if context.identity?
          # Check exclusion first
          return false if excluded_users.any? { |u| u.to_s == context.identity }

          # Check inclusion
          return true if users.any? { |u| u.to_s == context.identity }
        end

        # Check group targeting
        groups = Array(rule_value(rule, "groups"))
        excluded_groups = Array(rule_value(rule, "excludedGroups") || rule_value(rule, "excluded_groups"))

        # Check group exclusion
        return false if excluded_groups.any? { |g| context.in_group?(g) }

        # Check group inclusion
        return true if groups.any? { |g| context.in_group?(g) }

        # No match, continue evaluation
        nil
      end
    end
  end
end
