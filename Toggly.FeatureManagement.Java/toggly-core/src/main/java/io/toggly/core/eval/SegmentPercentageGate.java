package io.toggly.core.eval;

import java.util.concurrent.ThreadLocalRandom;

/**
 * Percentage gate for segment filters.
 *
 * <p>Sticky SHA-256 when identity is present; otherwise random. Missing or
 * {@code ≤ 0} fails closed (same as Go / toggly-eval).</p>
 */
public final class SegmentPercentageGate {

    private SegmentPercentageGate() {}

    public static boolean passes(Double percentage, String featureKey, String identity) {
        if (percentage == null || percentage <= 0) {
            return false;
        }
        if (percentage >= 100) {
            return true;
        }
        if (identity != null && !identity.isEmpty()) {
            return PercentileHasher.computePercentile(identity, featureKey) < percentage;
        }
        return ThreadLocalRandom.current().nextDouble() * 100 < percentage;
    }
}
