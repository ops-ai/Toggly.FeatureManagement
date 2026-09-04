# frozen_string_literal: true

module Toggly
  module Evaluators
    # Base class for feature evaluators.
    #
    # Evaluators determine whether a feature should be enabled
    # based on rules and context.
    class Base
      # @return [String] Evaluator type identifier
      def self.type
        raise NotImplementedError, "Subclass must implement .type"
      end

      # Optional alternate registration names (e.g. Microsoft.* aliases).
      #
      # @return [Array<String>]
      def self.aliases
        []
      end

      # Evaluate a rule against a context
      #
      # @param rule [Hash] The rule configuration
      # @param context [Context] The evaluation context
      # @param feature_key [String] The feature key (for logging)
      # @return [Boolean, nil] true/false for match, nil to continue evaluation
      def evaluate(rule, context, feature_key: nil)
        raise NotImplementedError, "Subclass must implement #evaluate"
      end

      # Check if this evaluator handles a rule type
      #
      # @param rule_type [String] The rule type
      # @return [Boolean]
      def handles?(rule_type)
        Registry.normalize_key(rule_type) == Registry.normalize_key(self.class.type)
      end

      protected

      # Get a value from rule with fallback (supports nested +parameters+).
      #
      # @param rule [Hash] The rule
      # @param key [String, Symbol] The key to lookup
      # @param default [Object] Default value
      # @return [Object]
      def rule_value(rule, key, default = nil)
        return default unless rule.is_a?(Hash)

        params = rule["parameters"] || rule[:parameters]
        candidates = [rule]
        candidates << params if params.is_a?(Hash)

        candidates.each do |source|
          value = source[key.to_s] || source[key.to_sym] ||
                  source.find { |k, _| k.to_s.casecmp?(key.to_s) }&.last
          return value unless value.nil?
        end
        default
      end

      # Log evaluation result (if logger available)
      #
      # @param feature_key [String] The feature key
      # @param result [Boolean] The evaluation result
      # @param reason [String] The reason for the result
      def log_evaluation(feature_key, result, reason)
        # Subclasses can override to add logging
      end
    end
  end
end
