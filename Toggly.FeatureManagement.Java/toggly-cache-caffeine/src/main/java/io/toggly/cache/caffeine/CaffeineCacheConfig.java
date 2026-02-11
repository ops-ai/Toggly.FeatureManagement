package io.toggly.cache.caffeine;

import java.time.Duration;

/**
 * Configuration for Caffeine-based caching.
 */
public final class CaffeineCacheConfig {

    private final Duration expireAfterWrite;
    private final Duration refreshAfterWrite;
    private final int maximumSize;
    private final boolean recordStats;

    private CaffeineCacheConfig(Builder builder) {
        this.expireAfterWrite = builder.expireAfterWrite;
        this.refreshAfterWrite = builder.refreshAfterWrite;
        this.maximumSize = builder.maximumSize;
        this.recordStats = builder.recordStats;
    }

    /**
     * Gets the duration after which entries expire.
     *
     * @return the expiration duration, or null if not set
     */
    public Duration getExpireAfterWrite() {
        return expireAfterWrite;
    }

    /**
     * Gets the duration after which entries are refreshed asynchronously.
     *
     * @return the refresh duration, or null if not set
     */
    public Duration getRefreshAfterWrite() {
        return refreshAfterWrite;
    }

    /**
     * Gets the maximum cache size.
     *
     * @return the maximum size (0 for unlimited)
     */
    public int getMaximumSize() {
        return maximumSize;
    }

    /**
     * Whether to record cache statistics.
     *
     * @return true if stats are recorded
     */
    public boolean isRecordStats() {
        return recordStats;
    }

    /**
     * Creates a new builder.
     *
     * @return the builder
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Creates a default configuration.
     *
     * @return default config with 1 minute expiry
     */
    public static CaffeineCacheConfig defaults() {
        return builder()
                .expireAfterWrite(Duration.ofMinutes(1))
                .refreshAfterWrite(Duration.ofSeconds(30))
                .build();
    }

    /**
     * Builder for CaffeineCacheConfig.
     */
    public static class Builder {
        private Duration expireAfterWrite;
        private Duration refreshAfterWrite;
        private int maximumSize = 0;
        private boolean recordStats = false;

        private Builder() {}

        /**
         * Sets the duration after which entries expire.
         *
         * @param duration the expiration duration
         * @return this builder
         */
        public Builder expireAfterWrite(Duration duration) {
            this.expireAfterWrite = duration;
            return this;
        }

        /**
         * Sets the duration after which entries are refreshed asynchronously.
         *
         * @param duration the refresh duration
         * @return this builder
         */
        public Builder refreshAfterWrite(Duration duration) {
            this.refreshAfterWrite = duration;
            return this;
        }

        /**
         * Sets the maximum cache size.
         *
         * @param size the maximum size
         * @return this builder
         */
        public Builder maximumSize(int size) {
            this.maximumSize = size;
            return this;
        }

        /**
         * Enables cache statistics recording.
         *
         * @return this builder
         */
        public Builder recordStats() {
            this.recordStats = true;
            return this;
        }

        /**
         * Builds the configuration.
         *
         * @return the config
         */
        public CaffeineCacheConfig build() {
            return new CaffeineCacheConfig(this);
        }
    }
}
