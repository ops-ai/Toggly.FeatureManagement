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
      entity_rules, user_rules = definition.rules.partition { |rule| Evaluators::ContextProperty.context_property?(rule) }

      if entity_rules.any?
        entity_ok = evaluate_entity_group(definition, entity_rules, context)
        unless entity_ok
          result&.reason = "entity_filters_failed"
          return false
        end
        return true if user_rules.empty?

        return evaluate_filter_group(user_rules, definition.requirement_type, context, definition.feature_key, result)
      end

      rules = user_rules.empty? ? definition.rules : user_rules
      evaluate_filter_group(rules, definition.requirement_type, context, definition.feature_key, result)
    end

    def evaluate_entity_group(definition, rules, context)
      entity = context&.entity
      return false unless entity

      results = rules.map { |rule| Evaluators::ContextProperty.evaluate_single(rule, entity) }
      req = (definition.context_requirement_type || definition.requirement_type || "Any").to_s
      req.casecmp?("All") ? results.all? : results.any?
    end

    def evaluate_filter_group(rules, requirement_type, context, feature_key, result)
      req = (requirement_type || "Any").to_s
      all_mode = req.casecmp?("All")
      matched = false
      matched_rule = nil
      matched_rule_index = nil

      rules.each_with_index do |rule, index|
        rule_type = rule["type"] || rule[:type] || rule["name"] || rule[:name] || "AlwaysOn"
        evaluator = @registry.get(rule_type)

        unless evaluator
          log_warn("Unknown evaluator type: #{rule_type} for feature #{feature_key}")
          if all_mode
            result&.reason = "unknown_filter"
            return false
          end
          next
        end

        begin
          value = evaluator.evaluate(rule, context, feature_key: feature_key)
          rule_passed = value == true
        rescue StandardError => e
          log_error("Error evaluating filter #{index} for #{feature_key}: #{e.message}")
          rule_passed = false
        end

        if all_mode
          unless rule_passed
            result&.reason = "no_match" if result
            return false
          end
          matched = true
          matched_rule = rule
          matched_rule_index = index
          next
        end

        next unless rule_passed

        matched = true
        matched_rule = rule
        matched_rule_index = index
        break
      end

      if result
        if matched
          result.matched_rule = matched_rule
          result.matched_rule_index = matched_rule_index
          result.reason = "rule_matched"
        else
          result.reason = "no_match"
        end
      end

      matched
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
