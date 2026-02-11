package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.FeatureFilter;
import io.toggly.core.model.FeatureRequirement;

import java.util.List;
import java.util.Map;

/**
 * Engine for evaluating feature flags.
 */
public final class EvaluationEngine {

    private final EvaluatorRegistry registry;

    /**
     * Creates an evaluation engine with default evaluators.
     */
    public EvaluationEngine() {
        this(new EvaluatorRegistry());
    }

    /**
     * Creates an evaluation engine with a custom registry.
     *
     * @param registry the evaluator registry
     */
    public EvaluationEngine(EvaluatorRegistry registry) {
        this.registry = registry != null ? registry : new EvaluatorRegistry();
    }

    /**
     * Gets the evaluator registry.
     *
     * @return the registry
     */
    public EvaluatorRegistry getRegistry() {
        return registry;
    }

    /**
     * Evaluates a feature definition.
     *
     * @param definition the feature definition
     * @param context the evaluation context
     * @return true if the feature should be enabled
     */
    public boolean evaluate(FeatureDefinition definition, EvaluationContext context) {
        if (definition == null) {
            return false;
        }

        List<FeatureFilter> filters = definition.getFilters();
        if (filters == null || filters.isEmpty()) {
            // No filters means feature is disabled
            return false;
        }

        FeatureRequirement requirement = definition.getRequirementType();
        String featureKey = definition.getFeatureKey();

        if (requirement == FeatureRequirement.ALL) {
            // All filters must pass
            for (FeatureFilter filter : filters) {
                if (!registry.evaluateFilter(filter, featureKey, context)) {
                    return false;
                }
            }
            return true;
        } else {
            // Any filter must pass (default)
            for (FeatureFilter filter : filters) {
                if (registry.evaluateFilter(filter, featureKey, context)) {
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * Evaluates multiple features as a gate.
     *
     * @param definitions map of feature definitions
     * @param featureKeys list of feature keys to evaluate
     * @param context the evaluation context
     * @param requirement whether ALL or ANY features must be enabled
     * @param negate whether to negate the final result
     * @return true if the gate passes
     */
    public boolean evaluateGate(
            Map<String, FeatureDefinition> definitions,
            List<String> featureKeys,
            EvaluationContext context,
            FeatureRequirement requirement,
            boolean negate) {

        if (featureKeys == null || featureKeys.isEmpty()) {
            // Empty list returns true (no requirements to fail)
            return !negate;
        }

        boolean result;
        if (requirement == FeatureRequirement.ALL) {
            result = true;
            for (String key : featureKeys) {
                FeatureDefinition def = definitions != null ? definitions.get(key) : null;
                if (!evaluate(def, context)) {
                    result = false;
                    break;
                }
            }
        } else {
            result = false;
            for (String key : featureKeys) {
                FeatureDefinition def = definitions != null ? definitions.get(key) : null;
                if (evaluate(def, context)) {
                    result = true;
                    break;
                }
            }
        }

        return negate ? !result : result;
    }

    /**
     * Evaluates a feature with defaults.
     *
     * @param definition the feature definition (may be null)
     * @param context the evaluation context
     * @param featureKey the feature key
     * @param defaults the default values map
     * @param defaultValue the fallback default if not in defaults map
     * @return true if the feature should be enabled
     */
    public boolean evaluateWithDefaults(
            FeatureDefinition definition,
            EvaluationContext context,
            String featureKey,
            Map<String, Boolean> defaults,
            boolean defaultValue) {

        if (definition != null) {
            return evaluate(definition, context);
        }

        // Check defaults map
        if (defaults != null && defaults.containsKey(featureKey)) {
            return defaults.get(featureKey);
        }

        return defaultValue;
    }
}
