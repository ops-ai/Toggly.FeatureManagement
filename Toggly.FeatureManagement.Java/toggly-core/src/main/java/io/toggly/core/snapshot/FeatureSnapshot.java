package io.toggly.core.snapshot;

import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.MetricDefinition;

import java.time.Instant;
import java.util.Collections;
import java.util.Map;
import java.util.Objects;

/**
 * Immutable snapshot of feature definitions at a point in time.
 *
 * <p>When signed definitions are enabled, {@link #getSignedDefsJson()} holds the
 * exact raw {@code defs} JSON used for cryptographic verification after a cache
 * round-trip (never re-serialize models for verify).</p>
 */
public final class FeatureSnapshot {

    private final Map<String, FeatureDefinition> features;
    private final Map<String, MetricDefinition> metrics;
    private final Instant timestamp;
    private final String etag;
    private final String signature;
    private final String keyId;
    private final Long signedTimestamp;
    private final String signedDefsJson;

    public FeatureSnapshot(
            Map<String, FeatureDefinition> features,
            Map<String, MetricDefinition> metrics,
            Instant timestamp,
            String etag) {
        this(features, metrics, timestamp, etag, null, null, null, null);
    }

    public FeatureSnapshot(
            Map<String, FeatureDefinition> features,
            Map<String, MetricDefinition> metrics,
            Instant timestamp,
            String etag,
            String signature,
            String keyId,
            Long signedTimestamp,
            String signedDefsJson) {
        this.features = features != null
                ? Collections.unmodifiableMap(features)
                : Collections.emptyMap();
        this.metrics = metrics != null
                ? Collections.unmodifiableMap(metrics)
                : Collections.emptyMap();
        this.timestamp = timestamp != null ? timestamp : Instant.now();
        this.etag = etag;
        this.signature = signature;
        this.keyId = keyId;
        this.signedTimestamp = signedTimestamp;
        this.signedDefsJson = signedDefsJson;
    }

    /**
     * Gets all feature definitions.
     *
     * @return unmodifiable map of feature key to definition
     */
    public Map<String, FeatureDefinition> getFeatures() {
        return features;
    }

    /**
     * Gets a specific feature definition.
     *
     * @param featureKey the feature key
     * @return the definition or null if not found
     */
    public FeatureDefinition getFeature(String featureKey) {
        return features.get(featureKey);
    }

    /**
     * Gets all metric definitions.
     *
     * @return unmodifiable map of metric key to definition
     */
    public Map<String, MetricDefinition> getMetrics() {
        return metrics;
    }

    /**
     * Gets the timestamp when this snapshot was created.
     *
     * @return the timestamp
     */
    public Instant getTimestamp() {
        return timestamp;
    }

    /**
     * Gets the ETag for cache validation.
     *
     * @return the etag or null
     */
    public String getEtag() {
        return etag;
    }

    /**
     * Base64 ES256 signature over {@code {signedDefsJson}|{signedTimestamp}}.
     *
     * @return signature or null
     */
    public String getSignature() {
        return signature;
    }

    /**
     * Signing key id (kid).
     *
     * @return key id or null
     */
    public String getKeyId() {
        return keyId;
    }

    /**
     * Unix-seconds timestamp included in the signed payload.
     *
     * @return signed timestamp or null
     */
    public Long getSignedTimestamp() {
        return signedTimestamp;
    }

    /**
     * Exact JSON text of the signed {@code defs} array from the server.
     *
     * @return raw defs JSON or null
     */
    public String getSignedDefsJson() {
        return signedDefsJson;
    }

    /**
     * Returns true when signature metadata required for re-verification is present.
     *
     * @return true if signature, kid, timestamp, and raw defs are set
     */
    public boolean hasSignatureMetadata() {
        return signature != null && !signature.isEmpty()
                && keyId != null && !keyId.isEmpty()
                && signedTimestamp != null
                && signedDefsJson != null;
    }

    /**
     * Checks if this snapshot is empty.
     *
     * @return true if no features are defined
     */
    public boolean isEmpty() {
        return features.isEmpty();
    }

    /**
     * Creates an empty snapshot.
     *
     * @return an empty snapshot
     */
    public static FeatureSnapshot empty() {
        return new FeatureSnapshot(null, null, Instant.now(), null);
    }

    /**
     * Returns a copy with updated signature metadata.
     *
     * @param signatureBase64 signature
     * @param kid key id
     * @param signedTs signed timestamp
     * @param rawDefsJson raw defs JSON
     * @return new snapshot
     */
    public FeatureSnapshot withSignature(
            String signatureBase64,
            String kid,
            Long signedTs,
            String rawDefsJson) {
        return new FeatureSnapshot(
                features, metrics, timestamp, etag,
                signatureBase64, kid, signedTs, rawDefsJson);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        FeatureSnapshot that = (FeatureSnapshot) o;
        return Objects.equals(features, that.features)
                && Objects.equals(metrics, that.metrics)
                && Objects.equals(etag, that.etag)
                && Objects.equals(signature, that.signature)
                && Objects.equals(keyId, that.keyId)
                && Objects.equals(signedTimestamp, that.signedTimestamp)
                && Objects.equals(signedDefsJson, that.signedDefsJson);
    }

    @Override
    public int hashCode() {
        return Objects.hash(features, metrics, etag, signature, keyId, signedTimestamp, signedDefsJson);
    }
}
