package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

/**
 * Evaluator for AlwaysOn filter - always returns true.
 */
public final class AlwaysOnEvaluator implements FilterEvaluator {

    public static final AlwaysOnEvaluator INSTANCE = new AlwaysOnEvaluator();

    private AlwaysOnEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        return true;
    }
}
