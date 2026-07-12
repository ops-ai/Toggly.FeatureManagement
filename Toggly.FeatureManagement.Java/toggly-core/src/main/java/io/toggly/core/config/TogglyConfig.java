package io.toggly.core.config;

import java.time.Duration;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BiConsumer;

/**
 * Configuration for the Toggly client.
 *
 * <p>Use the {@link Builder} to create instances:</p>
 * <pre>{@code
 * TogglyConfig config = TogglyConfig.builder()
 *     .appKey("your-app-key")
 *     .environment("Production")
 *     .build();
 * }</pre>
 */
public final class TogglyConfig {

    private final String appKey;
    private final String environment;
    private final String baseUrl;
    private final Duration refreshInterval;
    private final Duration connectTimeout;
    private final Duration readTimeout;
    private final boolean enableAutoRefresh;
    private final boolean enableUsageTracking;
    private final boolean useSignedDefinitions;
    private final boolean debug;
    private final boolean enableLiveUpdates;
    private final Map<String, Boolean> featureDefaults;
    private final String identity;
    private final boolean defaultFeatureState;
    private final Set<String> allowedKeyIds;
    private final BiConsumer<String, Throwable> onError;

    private TogglyConfig(Builder builder) {
        this.appKey = builder.appKey;
        this.environment = builder.environment;
        this.baseUrl = builder.baseUrl;
        this.refreshInterval = builder.refreshInterval;
        this.connectTimeout = builder.connectTimeout;
        this.readTimeout = builder.readTimeout;
        this.enableAutoRefresh = builder.enableAutoRefresh;
        this.enableUsageTracking = builder.enableUsageTracking;
        this.useSignedDefinitions = builder.useSignedDefinitions;
        this.debug = builder.debug;
        this.enableLiveUpdates = builder.enableLiveUpdates;
        this.featureDefaults = Collections.unmodifiableMap(new HashMap<>(builder.featureDefaults));
        this.identity = builder.identity;
        this.defaultFeatureState = builder.defaultFeatureState;
        this.allowedKeyIds = builder.allowedKeyIds == null
                ? Collections.emptySet()
                : Collections.unmodifiableSet(new HashSet<>(builder.allowedKeyIds));
        this.onError = builder.onError;
    }

    /**
     * Creates a new builder for TogglyConfig.
     *
     * @return a new builder instance
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Creates a config with just an app key.
     *
     * @param appKey the Toggly application key
     * @return a new TogglyConfig instance
     */
    public static TogglyConfig withAppKey(String appKey) {
        return builder().appKey(appKey).build();
    }

    /**
     * Creates a config for local-only mode with default features.
     *
     * @param featureDefaults default feature flag values
     * @return a new TogglyConfig instance
     */
    public static TogglyConfig localOnly(Map<String, Boolean> featureDefaults) {
        return builder().featureDefaults(featureDefaults).build();
    }

    public String getAppKey() {
        return appKey;
    }

    public String getEnvironment() {
        return environment;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public Duration getRefreshInterval() {
        return refreshInterval;
    }

    public Duration getConnectTimeout() {
        return connectTimeout;
    }

    public Duration getReadTimeout() {
        return readTimeout;
    }

    public boolean isEnableAutoRefresh() {
        return enableAutoRefresh;
    }

    public boolean isEnableUsageTracking() {
        return enableUsageTracking;
    }

    public boolean isUseSignedDefinitions() {
        return useSignedDefinitions;
    }

    public boolean isDebug() {
        return debug;
    }

    /**
     * Returns whether WebSocket live updates are enabled.
     *
     * @return true if live updates are enabled
     */
    public boolean isEnableLiveUpdates() {
        return enableLiveUpdates;
    }

    public Map<String, Boolean> getFeatureDefaults() {
        return featureDefaults;
    }

    public String getIdentity() {
        return identity;
    }

    /**
     * Alias for getIdentity() for compatibility.
     *
     * @return the default identity
     */
    public String getDefaultIdentity() {
        return identity;
    }

    /**
     * Returns the default feature state for undefined features.
     *
     * @return the default feature state
     */
    public boolean getDefaultFeatureState() {
        return defaultFeatureState;
    }

    /**
     * Optional allow-list of signing key ids. Empty means all kids are allowed.
     *
     * @return allowed key ids
     */
    public Set<String> getAllowedKeyIds() {
        return allowedKeyIds;
    }

    /**
     * Optional error callback invoked for transient and signature failures.
     *
     * @return error callback or null
     */
    public BiConsumer<String, Throwable> getOnError() {
        return onError;
    }

    /**
     * Returns the refresh interval in seconds.
     *
     * @return refresh interval in seconds
     */
    public long getRefreshIntervalSeconds() {
        return refreshInterval.toSeconds();
    }

    /**
     * Returns a new builder initialized with this config's values.
     *
     * @return a new builder
     */
    public Builder toBuilder() {
        return new Builder()
                .appKey(appKey)
                .environment(environment)
                .baseUrl(baseUrl)
                .refreshInterval(refreshInterval)
                .connectTimeout(connectTimeout)
                .readTimeout(readTimeout)
                .enableAutoRefresh(enableAutoRefresh)
                .enableUsageTracking(enableUsageTracking)
                .useSignedDefinitions(useSignedDefinitions)
                .debug(debug)
                .enableLiveUpdates(enableLiveUpdates)
                .featureDefaults(featureDefaults)
                .identity(identity)
                .defaultFeatureState(defaultFeatureState)
                .allowedKeyIds(allowedKeyIds)
                .onError(onError);
    }

    /**
     * Builder for {@link TogglyConfig}.
     */
    public static final class Builder {
        private String appKey = "";
        private String environment = "Production";
        private String baseUrl = "https://definitions.toggly.io";
        private Duration refreshInterval = Duration.ofMinutes(3);
        private Duration connectTimeout = Duration.ofSeconds(10);
        private Duration readTimeout = Duration.ofSeconds(30);
        private boolean enableAutoRefresh = false;
        private boolean enableUsageTracking = true;
        private boolean useSignedDefinitions = false;
        private boolean debug = false;
        private boolean enableLiveUpdates = true;
        private Map<String, Boolean> featureDefaults = new HashMap<>();
        private String identity;
        private boolean defaultFeatureState = false;
        private Set<String> allowedKeyIds = new HashSet<>();
        private BiConsumer<String, Throwable> onError;

        private Builder() {}

        /**
         * Sets the Toggly application key.
         *
         * @param appKey the application key
         * @return this builder
         */
        public Builder appKey(String appKey) {
            this.appKey = appKey != null ? appKey : "";
            return this;
        }

        /**
         * Sets the environment name.
         *
         * @param environment the environment (e.g., "Production", "Staging")
         * @return this builder
         */
        public Builder environment(String environment) {
            this.environment = environment != null ? environment : "Production";
            return this;
        }

        /**
         * Sets the base URL for the Toggly API.
         *
         * @param baseUrl the base URL
         * @return this builder
         */
        public Builder baseUrl(String baseUrl) {
            this.baseUrl = baseUrl != null ? baseUrl : "https://definitions.toggly.io";
            return this;
        }

        /**
         * Sets the refresh interval for auto-refresh.
         *
         * @param refreshInterval the refresh interval
         * @return this builder
         */
        public Builder refreshInterval(Duration refreshInterval) {
            this.refreshInterval = refreshInterval != null ? refreshInterval : Duration.ofMinutes(3);
            return this;
        }

        /**
         * Sets the refresh interval in seconds for auto-refresh.
         *
         * @param seconds the refresh interval in seconds
         * @return this builder
         */
        public Builder refreshIntervalSeconds(long seconds) {
            this.refreshInterval = Duration.ofSeconds(seconds);
            return this;
        }

        /**
         * Sets the connection timeout.
         *
         * @param connectTimeout the connection timeout
         * @return this builder
         */
        public Builder connectTimeout(Duration connectTimeout) {
            this.connectTimeout = connectTimeout != null ? connectTimeout : Duration.ofSeconds(10);
            return this;
        }

        /**
         * Sets the read timeout.
         *
         * @param readTimeout the read timeout
         * @return this builder
         */
        public Builder readTimeout(Duration readTimeout) {
            this.readTimeout = readTimeout != null ? readTimeout : Duration.ofSeconds(30);
            return this;
        }

        /**
         * Enables or disables automatic background refresh.
         *
         * @param enableAutoRefresh true to enable auto-refresh
         * @return this builder
         */
        public Builder enableAutoRefresh(boolean enableAutoRefresh) {
            this.enableAutoRefresh = enableAutoRefresh;
            return this;
        }

        /**
         * Enables or disables usage tracking.
         *
         * @param enableUsageTracking true to enable usage tracking
         * @return this builder
         */
        public Builder enableUsageTracking(boolean enableUsageTracking) {
            this.enableUsageTracking = enableUsageTracking;
            return this;
        }

        /**
         * Enables or disables signed definitions verification.
         *
         * @param useSignedDefinitions true to use signed definitions
         * @return this builder
         */
        public Builder useSignedDefinitions(boolean useSignedDefinitions) {
            this.useSignedDefinitions = useSignedDefinitions;
            return this;
        }

        /**
         * Enables or disables debug mode.
         *
         * @param debug true to enable debug logging
         * @return this builder
         */
        public Builder debug(boolean debug) {
            this.debug = debug;
            return this;
        }

        /**
         * Enables or disables WebSocket live updates.
         *
         * <p>When enabled, the SDK maintains a WebSocket connection to receive
         * real-time feature flag updates instead of relying solely on polling.</p>
         *
         * @param enableLiveUpdates true to enable live updates (default: true)
         * @return this builder
         */
        public Builder enableLiveUpdates(boolean enableLiveUpdates) {
            this.enableLiveUpdates = enableLiveUpdates;
            return this;
        }

        /**
         * Sets the default feature flag values.
         *
         * @param featureDefaults map of feature key to default value
         * @return this builder
         */
        public Builder featureDefaults(Map<String, Boolean> featureDefaults) {
            this.featureDefaults = featureDefaults != null ? new HashMap<>(featureDefaults) : new HashMap<>();
            return this;
        }

        /**
         * Adds a single feature default.
         *
         * @param featureKey the feature key
         * @param defaultValue the default value
         * @return this builder
         */
        public Builder featureDefault(String featureKey, boolean defaultValue) {
            this.featureDefaults.put(featureKey, defaultValue);
            return this;
        }

        /**
         * Sets the initial user identity.
         *
         * @param identity the user identity
         * @return this builder
         */
        public Builder identity(String identity) {
            this.identity = identity;
            return this;
        }

        /**
         * Alias for identity() - sets the default user identity.
         *
         * @param identity the user identity
         * @return this builder
         */
        public Builder defaultIdentity(String identity) {
            this.identity = identity;
            return this;
        }

        /**
         * Sets the default feature state for undefined features.
         *
         * @param defaultFeatureState the default state
         * @return this builder
         */
        public Builder defaultFeatureState(boolean defaultFeatureState) {
            this.defaultFeatureState = defaultFeatureState;
            return this;
        }

        /**
         * Restricts accepted signing key ids. Empty/null allows all keys.
         *
         * @param allowedKeyIds allowed kids
         * @return this builder
         */
        public Builder allowedKeyIds(Set<String> allowedKeyIds) {
            this.allowedKeyIds = allowedKeyIds != null ? new HashSet<>(allowedKeyIds) : new HashSet<>();
            return this;
        }

        /**
         * Registers a callback for transient refresh / signature failures.
         *
         * @param onError callback receiving message and optional cause
         * @return this builder
         */
        public Builder onError(BiConsumer<String, Throwable> onError) {
            this.onError = onError;
            return this;
        }

        /**
         * Builds the TogglyConfig instance.
         *
         * @return a new TogglyConfig
         */
        public TogglyConfig build() {
            return new TogglyConfig(this);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TogglyConfig that = (TogglyConfig) o;
        return enableAutoRefresh == that.enableAutoRefresh &&
                enableUsageTracking == that.enableUsageTracking &&
                useSignedDefinitions == that.useSignedDefinitions &&
                debug == that.debug &&
                enableLiveUpdates == that.enableLiveUpdates &&
                Objects.equals(appKey, that.appKey) &&
                Objects.equals(environment, that.environment) &&
                Objects.equals(baseUrl, that.baseUrl) &&
                Objects.equals(refreshInterval, that.refreshInterval) &&
                Objects.equals(featureDefaults, that.featureDefaults) &&
                Objects.equals(identity, that.identity);
    }

    @Override
    public int hashCode() {
        return Objects.hash(appKey, environment, baseUrl, refreshInterval,
                enableAutoRefresh, enableUsageTracking, useSignedDefinitions,
                debug, enableLiveUpdates, featureDefaults, identity);
    }

    @Override
    public String toString() {
        return "TogglyConfig{" +
                "appKey='" + (appKey.isEmpty() ? "(empty)" : "***") + '\'' +
                ", environment='" + environment + '\'' +
                ", baseUrl='" + baseUrl + '\'' +
                ", refreshInterval=" + refreshInterval +
                ", enableAutoRefresh=" + enableAutoRefresh +
                ", enableUsageTracking=" + enableUsageTracking +
                ", useSignedDefinitions=" + useSignedDefinitions +
                ", debug=" + debug +
                ", enableLiveUpdates=" + enableLiveUpdates +
                ", featureDefaults=" + featureDefaults.size() + " entries" +
                ", identity='" + (identity != null ? "***" : "null") + '\'' +
                '}';
    }
}
