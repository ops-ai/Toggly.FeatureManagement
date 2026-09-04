package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

/**
 * Evaluator for AlwaysOff filter - always returns false.
 */
public final class AlwaysOffEvaluator implements FilterEvaluator {

    public static final AlwaysOffEvaluator INSTANCE = new AlwaysOffEvaluator();

    private AlwaysOffEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        return false;
    }
}
