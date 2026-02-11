package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

/**
 * Interface for filter evaluators.
 *
 * <p>Implement this interface to create custom filter types.</p>
 */
@FunctionalInterface
public interface FilterEvaluator {

    /**
     * Evaluates whether the filter passes for the given context.
     *
     * @param filter the filter to evaluate
     * @param featureKey the feature key being evaluated
     * @param context the evaluation context
     * @return true if the filter passes
     */
    boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context);
}
