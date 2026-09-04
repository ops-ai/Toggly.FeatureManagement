# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for contextual targeting based on traits.
    #
    # Supports various comparison operators on trait values.
    class ContextualTargeting < Base
      # Supported operators
      OPERATORS = %w[
        eq ne gt gte lt lte
        contains not_contains
        starts_with ends_with
        in not_in
        matches
        exists not_exists
      ].freeze

      def self.type
        "contextual"
      end

      def self.aliases
        %w[ContextualTargeting]
      end

      # Evaluate contextual targeting rule
      #
      # @param rule [Hash] Rule with "conditions" array
      # @param context [Context] Evaluation context with traits
      # @param feature_key [String] The feature key
      # @return [Boolean, nil] True if all conditions match, nil if no conditions
      def evaluate(rule, context, feature_key: nil)
        conditions = Array(rule_value(rule, "conditions"))
        return nil if conditions.empty?
        return nil unless context

        match_type = rule_value(rule, "matchType") || rule_value(rule, "match_type") || "all"

        if match_type == "any"
          conditions.any? { |condition| evaluate_condition(condition, context) }
        else
          conditions.all? { |condition| evaluate_condition(condition, context) }
        end
      end

      private

      def evaluate_condition(condition, context)
        trait_key = condition["trait"] || condition["key"] || condition["attribute"]
        return false unless trait_key

        operator = (condition["operator"] || condition["op"] || "eq").to_s.downcase
        expected = condition["value"] || condition["values"]

        actual = context.trait(trait_key)

        case operator
        when "eq", "equals", "=="
          compare_equal(actual, expected)
        when "ne", "not_equals", "!="
          !compare_equal(actual, expected)
        when "gt", ">"
          compare_numeric(actual, expected) { |a, e| a > e }
        when "gte", ">="
          compare_numeric(actual, expected) { |a, e| a >= e }
        when "lt", "<"
          compare_numeric(actual, expected) { |a, e| a < e }
        when "lte", "<="
          compare_numeric(actual, expected) { |a, e| a <= e }
        when "contains"
          actual.to_s.include?(expected.to_s)
        when "not_contains"
          !actual.to_s.include?(expected.to_s)
        when "starts_with"
          actual.to_s.start_with?(expected.to_s)
        when "ends_with"
          actual.to_s.end_with?(expected.to_s)
        when "in"
          Array(expected).map(&:to_s).include?(actual.to_s)
        when "not_in"
          !Array(expected).map(&:to_s).include?(actual.to_s)
        when "matches", "regex"
          actual.to_s.match?(Regexp.new(expected.to_s))
        when "exists"
          context.trait?(trait_key)
        when "not_exists"
          !context.trait?(trait_key)
        else
          false
        end
      rescue RegexpError
        false
      end

      def compare_equal(actual, expected)
        return actual.to_s.downcase == expected.to_s.downcase if actual.is_a?(String) || expected.is_a?(String)

        actual == expected
      end

      def compare_numeric(actual, expected)
        actual_num = to_number(actual)
        expected_num = to_number(expected)

        return false if actual_num.nil? || expected_num.nil?

        yield(actual_num, expected_num)
      end

      def to_number(value)
        return value if value.is_a?(Numeric)

        Float(value)
      rescue ArgumentError, TypeError
        nil
      end
    end
  end
end
