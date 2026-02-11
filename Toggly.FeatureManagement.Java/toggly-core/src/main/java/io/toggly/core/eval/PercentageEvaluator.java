package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

/**
 * Evaluator for percentage-based rollouts.
 *
 * <p>Uses deterministic hashing based on identity + feature key to ensure
 * consistent results for the same user.</p>
 */
public final class PercentageEvaluator implements FilterEvaluator {

    public static final PercentageEvaluator INSTANCE = new PercentageEvaluator();

    // FNV-1a 32-bit constants
    private static final int FNV_32_PRIME = 0x01000193;
    private static final int FNV1_32A_INIT = 0x811c9dc5;

    private PercentageEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        // Get percentage from parameters
        double percentage = filter.getDoubleParameter("Value", 0);
        if (percentage <= 0) {
            percentage = filter.getDoubleParameter("Percentage", 0);
        }
        if (percentage <= 0) {
            percentage = filter.getDoubleParameter("percentage", 0);
        }

        if (percentage <= 0) {
            return false;
        }
        if (percentage >= 100) {
            return true;
        }

        // Need identity for percentage rollout
        String identity = context.getIdentity();
        if (identity == null || identity.isEmpty()) {
            return false;
        }

        // Calculate deterministic bucket
        double bucket = calculateBucket(identity, featureKey);
        return bucket < percentage;
    }

    /**
     * Calculates a deterministic bucket (0-99.99) for the identity.
     *
     * @param identity the user identity
     * @param featureKey the feature key
     * @return a bucket value between 0 and 99.99
     */
    double calculateBucket(String identity, String featureKey) {
        String hashInput = identity + ":" + featureKey;
        int hashValue = fnv1a32(hashInput);
        // Convert to positive value and get percentage
        long unsigned = hashValue & 0xFFFFFFFFL;
        return (unsigned % 10000) / 100.0;
    }

    /**
     * Calculates FNV-1a 32-bit hash.
     *
     * @param input the string to hash
     * @return the hash value
     */
    static int fnv1a32(String input) {
        int hash = FNV1_32A_INIT;
        byte[] bytes = input.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        for (byte b : bytes) {
            hash ^= (b & 0xff);
            hash *= FNV_32_PRIME;
        }
        return hash;
    }
}
