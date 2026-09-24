package io.toggly.core.eval;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Percentile hash for MF-parity variant allocation, matching
 * {@code Microsoft.FeatureManagement}'s {@code TargetingEvaluator}.
 *
 * <p><strong>Not</strong> the same algorithm as {@link PercentageEvaluator} /
 * {@link PercentileHasher}, which match Definitions /
 * {@code @ops-ai/toggly-eval} (a different hash input order used for
 * {@code Percentage} filters and segment gating). Variant allocation must
 * bit-match Microsoft Feature Management, not the Definitions edge helper.</p>
 */
public final class VariantPercentileHasher {

    private static final double UINT32_MAX = 0xFFFFFFFFL;

    private VariantPercentileHasher() {}

    /**
     * Computes the MF-parity context percentage in {@code [0, 100]}.
     *
     * <p>Context id: {@code "{userId}\n{hint}"}, SHA-256 hashed; the first 4
     * digest bytes are read as a little-endian {@code uint32} and scaled to
     * a percentage. {@code userId} is lowercased first when {@code ignoreCase}
     * is true (MF's {@code TargetingEvaluationOptions.IgnoreCase}, default
     * {@code false}).</p>
     *
     * @param userId user identity (null is treated as empty)
     * @param hint {@code Allocation.seed} if configured, else
     *     {@code "allocation\n{featureKey}"}
     * @param ignoreCase whether to lowercase {@code userId} before hashing
     * @return context percentage in {@code [0, 100]}
     */
    public static double computeContextPercentage(String userId, String hint, boolean ignoreCase) {
        String effectiveUserId = userId != null ? userId : "";
        if (ignoreCase) {
            effectiveUserId = effectiveUserId.toLowerCase(java.util.Locale.ROOT);
        }
        String contextId = effectiveUserId + "\n" + hint;
        byte[] digest = sha256(contextId.getBytes(StandardCharsets.UTF_8));
        long marker = readUint32LE(digest, 0);
        return (marker / UINT32_MAX) * 100.0;
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }

    private static long readUint32LE(byte[] bytes, int offset) {
        return (bytes[offset] & 0xffL)
                | ((bytes[offset + 1] & 0xffL) << 8)
                | ((bytes[offset + 2] & 0xffL) << 16)
                | ((bytes[offset + 3] & 0xffL) << 24);
    }
}
