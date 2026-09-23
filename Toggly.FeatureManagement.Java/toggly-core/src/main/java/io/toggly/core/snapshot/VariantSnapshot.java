package io.toggly.core.snapshot;

import io.toggly.core.model.EvaluatedVariantDef;

import java.time.Instant;
import java.util.Collections;
import java.util.Map;
import java.util.Objects;

/**
 * Immutable snapshot of server-evaluated feature variants at a point in time.
 *
 * <p>Populated only when {@code enableVariants} is true. Kept separate from
 * {@link FeatureSnapshot}: the definitions pipeline stays the source of truth
 * for {@code isEnabled}; this snapshot exists purely to serve
 * {@code getVariant} / {@code getVariantValue} (dual-rail pattern, matching
 * the Python SDK).</p>
 */
public final class VariantSnapshot {

    private final Map<String, EvaluatedVariantDef> defs;
    private final Instant timestamp;
    private final String etag;
    private final String signature;
    private final String keyId;
    private final Long signedTimestamp;
    private final String signedDefsJson;

    public VariantSnapshot(
            Map<String, EvaluatedVariantDef> defs,
            Instant timestamp,
            String etag) {
        this(defs, timestamp, etag, null, null, null, null);
    }

    public VariantSnapshot(
            Map<String, EvaluatedVariantDef> defs,
            Instant timestamp,
            String etag,
            String signature,
            String keyId,
            Long signedTimestamp,
            String signedDefsJson) {
        this.defs = defs != null
                ? Collections.unmodifiableMap(defs)
                : Collections.emptyMap();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.etag = etag;
        this.signature = signature;
        this.keyId = keyId;
        this.signedTimestamp = signedTimestamp;
        this.signedDefsJson = signedDefsJson;
    }

    /**
     * Gets the evaluated variant entry for a feature.
     *
     * @param featureKey the feature key
     * @return the entry or null if not found
     */
    public EvaluatedVariantDef getVariant(String featureKey) {
        return defs.get(featureKey);
    }

    /**
     * Gets all evaluated variant entries.
     *
     * @return unmodifiable map of feature key to evaluated variant definition
     */
    public Map<String, EvaluatedVariantDef> getDefs() {
        return defs;
    }

    /**
     * Gets the timestamp when this snapshot was created.
     */
    public Instant getTimestamp() {
        return timestamp;
    }

    /**
     * Gets the ETag for cache validation.
     */
    public String getEtag() {
        return etag;
    }

    /**
     * Base64 ES256 signature over {@code {signedDefsJson}|{signedTimestamp}}.
     */
    public String getSignature() {
        return signature;
    }

    /**
     * Signing key id (kid).
     */
    public String getKeyId() {
        return keyId;
    }

    /**
     * Unix-seconds timestamp included in the signed payload.
     */
    public Long getSignedTimestamp() {
        return signedTimestamp;
    }

    /**
     * Exact JSON text of the signed {@code defs} object from the server.
     */
    public String getSignedDefsJson() {
        return signedDefsJson;
    }

    /**
     * Checks if this snapshot has no variant entries.
     *
     * <p>An empty map is a valid post-fetch state (the environment may simply
     * have no assigned variants). Callers must not treat {@code isEmpty()} as
     * "never fetched" — {@code HttpSnapshotProvider} tracks that separately.
     */
    public boolean isEmpty() {
        return defs.isEmpty();
    }

    /**
     * Creates an empty snapshot.
     */
    public static VariantSnapshot empty() {
        return new VariantSnapshot(null, Instant.now(), null);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        VariantSnapshot that = (VariantSnapshot) o;
        return Objects.equals(defs, that.defs)
                && Objects.equals(etag, that.etag)
                && Objects.equals(signature, that.signature)
                && Objects.equals(keyId, that.keyId)
                && Objects.equals(signedTimestamp, that.signedTimestamp)
                && Objects.equals(signedDefsJson, that.signedDefsJson);
    }

    @Override
    public int hashCode() {
        return Objects.hash(defs, etag, signature, keyId, signedTimestamp, signedDefsJson);
    }
}
