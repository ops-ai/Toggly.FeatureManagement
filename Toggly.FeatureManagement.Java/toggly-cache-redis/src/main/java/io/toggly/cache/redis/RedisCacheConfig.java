package io.toggly.cache.redis;

import java.time.Duration;

/**
 * Configuration for Redis-based caching.
 */
public final class RedisCacheConfig {

    private final String host;
    private final int port;
    private final String password;
    private final int database;
    private final String keyPrefix;
    private final Duration ttl;
    private final int timeout;
    private final boolean ssl;

    private RedisCacheConfig(Builder builder) {
        this.host = builder.host;
        this.port = builder.port;
        this.password = builder.password;
        this.database = builder.database;
        this.keyPrefix = builder.keyPrefix;
        this.ttl = builder.ttl;
        this.timeout = builder.timeout;
        this.ssl = builder.ssl;
    }

    public String getHost() {
        return host;
    }

    public int getPort() {
        return port;
    }

    public String getPassword() {
        return password;
    }

    public int getDatabase() {
        return database;
    }

    public String getKeyPrefix() {
        return keyPrefix;
    }

    public Duration getTtl() {
        return ttl;
    }

    public int getTimeout() {
        return timeout;
    }

    public boolean isSsl() {
        return ssl;
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
     * Creates a default configuration for localhost.
     *
     * @return default config
     */
    public static RedisCacheConfig defaults() {
        return builder().build();
    }

    /**
     * Builder for RedisCacheConfig.
     */
    public static class Builder {
        private String host = "localhost";
        private int port = 6379;
        private String password = null;
        private int database = 0;
        private String keyPrefix = "toggly:";
        private Duration ttl = Duration.ofMinutes(5);
        private int timeout = 2000;
        private boolean ssl = false;

        private Builder() {}

        /**
         * Sets the Redis host.
         *
         * @param host the host
         * @return this builder
         */
        public Builder host(String host) {
            this.host = host;
            return this;
        }

        /**
         * Sets the Redis port.
         *
         * @param port the port
         * @return this builder
         */
        public Builder port(int port) {
            this.port = port;
            return this;
        }

        /**
         * Sets the Redis password.
         *
         * @param password the password
         * @return this builder
         */
        public Builder password(String password) {
            this.password = password;
            return this;
        }

        /**
         * Sets the Redis database.
         *
         * @param database the database number
         * @return this builder
         */
        public Builder database(int database) {
            this.database = database;
            return this;
        }

        /**
         * Sets the key prefix.
         *
         * @param keyPrefix the prefix
         * @return this builder
         */
        public Builder keyPrefix(String keyPrefix) {
            this.keyPrefix = keyPrefix;
            return this;
        }

        /**
         * Sets the TTL for cached entries.
         *
         * @param ttl the TTL
         * @return this builder
         */
        public Builder ttl(Duration ttl) {
            this.ttl = ttl;
            return this;
        }

        /**
         * Sets the connection timeout in milliseconds.
         *
         * @param timeout the timeout
         * @return this builder
         */
        public Builder timeout(int timeout) {
            this.timeout = timeout;
            return this;
        }

        /**
         * Enables SSL/TLS.
         *
         * @return this builder
         */
        public Builder ssl() {
            this.ssl = true;
            return this;
        }

        /**
         * Builds the configuration.
         *
         * @return the config
         */
        public RedisCacheConfig build() {
            return new RedisCacheConfig(this);
        }
    }
}
