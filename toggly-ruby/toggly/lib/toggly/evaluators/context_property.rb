# frozen_string_literal: true

module Toggly
  module Evaluators
    # Evaluator for ContextProperty entity filters. Fail closed.
    class ContextProperty < Base
      def self.type
        "ContextProperty"
      end

      def self.aliases
        %w[contextproperty]
      end

      def evaluate(rule, context, feature_key: nil)
        entity = context&.entity
        return false unless entity

        self.class.evaluate_single(rule, entity)
      end

      def self.context_property?(rule)
        type = rule["type"] || rule[:type] || rule["name"] || rule[:name]
        type.to_s.downcase == "contextproperty"
      end

      def self.evaluate_single(rule, entity)
        property = rule_lookup(rule, "Property")
        operator = rule_lookup(rule, "Operator")
        expected = rule_lookup(rule, "Value")
        value_type = (rule_lookup(rule, "ValueType") || "string").to_s.downcase
        return false if property.to_s.strip.empty? || operator.to_s.strip.empty? || expected.nil?

        operator = operator.to_s.downcase
        return false unless entity.attribute?(property)

        actual = entity.attribute(property)
        compare(actual, operator, expected.to_s, value_type)
      end

      def self.rule_lookup(rule, key)
        params = rule["parameters"] || rule[:parameters] || rule
        params[key] || params[key.to_s] || params[key.to_sym] ||
          params.find { |k, _| k.to_s.casecmp?(key.to_s) }&.last
      end

      def self.compare(actual, operator, expected, value_type)
        case operator
        when "eq"
          actual.to_s.casecmp?(expected)
        when "neq"
          !actual.to_s.casecmp?(expected)
        when "gt", "gte", "lt", "lte"
          compare_ordered(actual, expected, value_type, operator)
        when "in"
          expected.split(",").map(&:strip).reject(&:empty?).any? { |c| c.casecmp?(actual.to_s) }
        when "contains"
          if value_type == "string[]"
            Array(actual).any? { |v| v.to_s.casecmp?(expected) }
          else
            actual.to_s.downcase.include?(expected.downcase)
          end
        else
          false
        end
      end

      def self.compare_ordered(actual, expected, value_type, operator)
        if value_type == "datetime"
          a = Time.parse(actual.to_s)
          e = Time.parse(expected.to_s)
          cmp = a <=> e
        elsif value_type == "number"
          a = parse_number(actual)
          e = parse_number(expected)
          return false if a.nil? || e.nil?

          cmp = a <=> e
        else
          return false
        end
        case operator
        when "gt" then cmp.positive?
        when "gte" then cmp >= 0
        when "lt" then cmp.negative?
        when "lte" then cmp <= 0
        else false
        end
      rescue ArgumentError, TypeError
        false
      end

      # Strict numeric parse. Invalid strings must not coerce to 0.0.
      def self.parse_number(value)
        n = Float(value)
        return nil unless n.finite?

        n
      rescue ArgumentError, TypeError
        nil
      end
    end
  end
end
