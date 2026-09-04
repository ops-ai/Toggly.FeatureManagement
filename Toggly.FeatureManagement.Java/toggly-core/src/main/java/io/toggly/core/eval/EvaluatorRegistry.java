package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Registry of filter evaluators.
 *
 * <p>Pre-registers built-in evaluators (including Microsoft.* and segment
 * aliases) and allows custom evaluator registration.</p>
 */
public final class EvaluatorRegistry {

    private final Map<String, FilterEvaluator> evaluators = new ConcurrentHashMap<>();

    /**
     * Creates a new registry with built-in evaluators.
     */
    public EvaluatorRegistry() {
        register("AlwaysOn", AlwaysOnEvaluator.INSTANCE);
        register("AlwaysOff", AlwaysOffEvaluator.INSTANCE);

        register("Percentage", PercentageEvaluator.INSTANCE);
        register("Microsoft.Percentage", PercentageEvaluator.INSTANCE);

        register("TimeWindow", TimeWindowEvaluator.INSTANCE);
        register("Microsoft.TimeWindow", TimeWindowEvaluator.INSTANCE);

        register("Targeting", TargetingEvaluator.INSTANCE);
        register("Microsoft.Targeting", TargetingEvaluator.INSTANCE);

        register("ContextProperty", ContextPropertyEvaluator.INSTANCE);

        register("BrowserFamily", BrowserFamilyEvaluator.INSTANCE);
        register("BrowserLanguage", BrowserLanguageEvaluator.INSTANCE);
        register("Country", CountryEvaluator.INSTANCE);
        register("CountryFamily", CountryEvaluator.INSTANCE);
        register("DeviceType", DeviceTypeEvaluator.INSTANCE);
        register("OS", OperatingSystemEvaluator.INSTANCE);
        register("OperatingSystem", OperatingSystemEvaluator.INSTANCE);
        register("UserClaims", UserClaimsEvaluator.INSTANCE);
    }

    /**
     * Registers a custom filter evaluator.
     *
     * @param name the filter name
     * @param evaluator the evaluator implementation
     */
    public void register(String name, FilterEvaluator evaluator) {
        if (name == null || evaluator == null) {
            throw new IllegalArgumentException("name and evaluator must not be null");
        }
        evaluators.put(name, evaluator);
    }

    /**
     * Gets an evaluator by name.
     *
     * @param name the filter name
     * @return the evaluator or null if not found
     */
    public FilterEvaluator get(String name) {
        return evaluators.get(name);
    }

    /**
     * Checks if an evaluator is registered.
     *
     * @param name the filter name
     * @return true if an evaluator exists for this name
     */
    public boolean hasEvaluator(String name) {
        return evaluators.containsKey(name);
    }

    /**
     * Evaluates a filter using the appropriate evaluator.
     *
     * @param filter the filter to evaluate
     * @param featureKey the feature key being evaluated
     * @param context the evaluation context
     * @return true if the filter passes, false if it fails or no evaluator is found
     */
    public boolean evaluateFilter(FeatureFilter filter, String featureKey, EvaluationContext context) {
        FilterEvaluator evaluator = get(filter.getName());
        if (evaluator == null) {
            // Unknown filter type - treat as false for safety (fail closed)
            return false;
        }
        return evaluator.evaluate(filter, featureKey, context);
    }

    /**
     * Removes an evaluator.
     *
     * @param name the filter name
     * @return the removed evaluator or null
     */
    public FilterEvaluator unregister(String name) {
        return evaluators.remove(name);
    }
}
