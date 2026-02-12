# frozen_string_literal: true

module Toggly
  # Engine for evaluating feature flags.
  #
  # Processes feature definitions and their rules to determine
  # if a feature should be enabled for a given context.
  class EvaluationEngine
    # @param registry [Registry] Evaluator registry
    # @param logger [Logger, nil] Optional logger
    def initialize(registry: nil, logger: nil)
      @registry = registry || Registry.new
      @logger = logger
    end

    # Evaluate a feature for a context
    #
    # @param definition [FeatureDefinition] The feature definition
    # @param context [Context, nil] The evaluation context
    # @return [Boolean] Whether the feature is enabled
    def evaluate(definition, context = nil)
      return false unless definition

      # If feature is globally disabled, return false
      return false unless definition.enabled

      # If no rules, feature is simply on/off based on enabled flag
      return definition.enabled unless definition.rules?

      # Evaluate rules in order
      evaluate_rules(definition, context)
    end

    # Evaluate with detailed result
    #
    # @param definition [FeatureDefinition] The feature definition
    # @param context [Context, nil] The evaluation context
    # @return [EvaluationResult] Detailed evaluation result
    def evaluate_with_details(definition, context = nil)
      result = EvaluationResult.new(
        feature_key: definition&.feature_key,
        enabled: false,
        reason: "unknown"
      )

      unless definition
        result.reason = "feature_not_found"
        return result
      end

      unless definition.enabled
        result.reason = "globally_disabled"
        return result
      end

      unless definition.rules?
        result.enabled = true
        result.reason = "globally_enabled"
        return result
      end

      result.enabled = evaluate_rules(definition, context, result)
      result
    end

    # @return [Registry]
    attr_reader :registry

    private

    def evaluate_rules(definition, context, result = nil)
      definition.rules.each_with_index do |rule, index|
        rule_type = rule["type"] || rule[:type] || "always_on"
        evaluator = @registry.get(rule_type)

        unless evaluator
          log_warn("Unknown evaluator type: #{rule_type} for feature #{definition.feature_key}")
          next
        end

        begin
          evaluation = evaluator.evaluate(rule, context, feature_key: definition.feature_key)

          # nil means continue to next rule
          next if evaluation.nil?

          if result
            result.matched_rule = rule
            result.matched_rule_index = index
            result.reason = "rule_matched"
          end

          return evaluation
        rescue StandardError => e
          log_error("Error evaluating rule #{index} for #{definition.feature_key}: #{e.message}")
          next
        end
      end

      # No rules matched, default to enabled (since the feature itself is enabled)
      result&.reason = "default_enabled"
      true
    end

    def log_warn(message)
      @logger&.warn("[Toggly] #{message}")
    end

    def log_error(message)
      @logger&.error("[Toggly] #{message}")
    end
  end

  # Result of a feature evaluation with details
  class EvaluationResult
    attr_accessor :feature_key, :enabled, :reason, :matched_rule, :matched_rule_index

    def initialize(feature_key:, enabled:, reason:)
      @feature_key = feature_key
      @enabled = enabled
      @reason = reason
      @matched_rule = nil
      @matched_rule_index = nil
    end

    def to_h
      {
        feature_key: @feature_key,
        enabled: @enabled,
        reason: @reason,
        matched_rule: @matched_rule,
        matched_rule_index: @matched_rule_index
      }
    end
  end
end
