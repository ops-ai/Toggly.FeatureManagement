package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

/**
 * Evaluator for percentage-based rollouts.
 *
 * <p>Uses Definitions-aligned sticky SHA-256 hashing
 * ({@code featureKey + "\n" + identity}) for consistent buckets.</p>
 */
public final class PercentageEvaluator implements FilterEvaluator {

    public static final PercentageEvaluator INSTANCE = new PercentageEvaluator();

    private PercentageEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        Double percentage = FilterParamUtils.asFloat(filter, "Value");
        if (percentage == null) {
            percentage = FilterParamUtils.asFloat(filter, "Percentage");
        }
        if (percentage == null) {
            percentage = FilterParamUtils.asFloat(filter, "percentage");
        }

        if (percentage == null || percentage <= 0) {
            return false;
        }
        if (percentage >= 100) {
            return true;
        }

        String identity = context != null ? context.getIdentity() : null;
        if (identity == null || identity.isEmpty()) {
            return false;
        }

        return PercentileHasher.computePercentile(identity, featureKey) < percentage;
    }

    /**
     * Calculates a deterministic bucket in {@code [0, 100)} for the identity.
     *
     * @param identity the user identity
     * @param featureKey the feature key
     * @return a bucket value between 0 and 100 (exclusive of 100)
     */
    double calculateBucket(String identity, String featureKey) {
        return PercentileHasher.computePercentile(identity, featureKey);
    }
}
