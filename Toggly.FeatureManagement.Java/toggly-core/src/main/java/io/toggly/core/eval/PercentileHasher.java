package io.toggly.core.eval;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Sticky percentile bucket matching Definitions / {@code @ops-ai/toggly-eval}:
 * SHA-256 of {@code featureKey + "\n" + userId}, little-endian uint32 from the
 * first 4 digest bytes, then {@code (value / 0xFFFFFFFF) * 100}.
 */
public final class PercentileHasher {

    private PercentileHasher() {}

    /**
     * Computes a sticky bucket in {@code [0, 100)}.
     *
     * @param userId user identity
     * @param featureKey feature key (hashed first, then newline, then userId)
     * @return bucket in {@code [0, 100)}
     */
    public static double computePercentile(String userId, String featureKey) {
        String input = featureKey + "\n" + userId;
        byte[] digest = sha256(input.getBytes(StandardCharsets.UTF_8));
        long value = readUint32LE(digest, 0);
        return (value / (double) 0xFFFFFFFFL) * 100.0;
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
