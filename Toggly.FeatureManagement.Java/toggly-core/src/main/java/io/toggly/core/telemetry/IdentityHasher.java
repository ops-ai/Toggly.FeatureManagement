package io.toggly.core.telemetry;

import java.nio.charset.StandardCharsets;

/**
 * UTF-8 FNV-1a 32-bit identity hashing (signed int32), matching Go {@code hash/fnv}
 * {@code New32a} and Node {@code hashIdentity}.
 */
public final class IdentityHasher {

    private static final int FNV_OFFSET = (int) 2166136261L;
    private static final int FNV_PRIME = 16777619;

    private IdentityHasher() {
    }

    /**
     * Hashes an identity string to a signed 32-bit FNV-1a value.
     *
     * @param identity the identity (must not be null)
     * @return signed int32 hash
     */
    public static int hashIdentity(String identity) {
        int hash = FNV_OFFSET;
        byte[] bytes = identity.getBytes(StandardCharsets.UTF_8);
        for (byte b : bytes) {
            hash ^= (b & 0xff);
            hash *= FNV_PRIME;
        }
        return hash;
    }
}
