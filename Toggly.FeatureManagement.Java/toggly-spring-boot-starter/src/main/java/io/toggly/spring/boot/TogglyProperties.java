package io.toggly.spring.boot;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

/**
 * Configuration properties for Toggly.
 *
 * <p>Configure via application.yml or application.properties:</p>
 * <pre>
 * toggly:
 *   app-key: your-app-key
 *   environment: Production
 *   base-url: https://app.toggly.io
 *   refresh-interval-seconds: 30
 *   default-feature-state: false
 *   feature-defaults:
 *     my-feature: true
 *   enable-usage-tracking: true
 *   enable-metrics: true
 *   metrics-base-url: https://app.toggly.io/
 *   usage-flush-interval: 1m
 *   metrics-flush-interval: 1m
 *   instance-name: api-1
 *   app-version: 1.0.0
 * </pre>
 */
@ConfigurationProperties(prefix = "toggly")
public class TogglyProperties {

    /**
     * Application key from Toggly dashboard.
     */
    private String appKey;

    /**
     * Environment name (e.g., Production, Staging).
     */
    private String environment = "Production";

    /**
     * Base URL for Toggly API.
     */
    private String baseUrl = "https://definitions.toggly.io";

    /**
     * Refresh interval in seconds. 0 or negative disables auto-refresh.
     */
    private long refreshIntervalSeconds = 30;

    /**
     * Default state for undefined features.
     */
    private boolean defaultFeatureState = false;

    /**
     * Default values for specific features.
     */
    private Map<String, Boolean> featureDefaults = new HashMap<>();

    /**
     * Default user identity.
     */
    private String defaultIdentity;

    /**
     * Enable or disable Toggly integration.
     */
    private boolean enabled = true;

    /**
     * PUT entity context schemas to the dashboard catalog on client start.
     */
    private boolean registerContextsOnStartup = true;

    /**
     * Enable feature usage telemetry ({@code Usage.SendStats}).
     */
    private boolean enableUsageTracking = true;

    /**
     * Enable business metrics telemetry ({@code Metrics.SendMetrics}).
     */
    private boolean enableMetrics = true;

    /**
     * Base URL for usage/metrics gRPC (default {@code https://app.toggly.io/}).
     */
    private String metricsBaseUrl = "https://app.toggly.io/";

    /**
     * How often usage stats are flushed (default 1 minute). Bind as {@code 1m}, {@code 60s}, etc.
     */
    private Duration usageFlushInterval = Duration.ofMinutes(1);

    /**
     * How often business metrics are flushed (default 1 minute).
     */
    private Duration metricsFlushInterval = Duration.ofMinutes(1);

    /**
     * Optional instance name reported on usage/metrics payloads.
     */
    private String instanceName;

    /**
     * Optional application version reported on usage payloads.
     */
    private String appVersion;

    // Getters and Setters

    public String getAppKey() {
        return appKey;
    }

    public void setAppKey(String appKey) {
        this.appKey = appKey;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public long getRefreshIntervalSeconds() {
        return refreshIntervalSeconds;
    }

    public void setRefreshIntervalSeconds(long refreshIntervalSeconds) {
        this.refreshIntervalSeconds = refreshIntervalSeconds;
    }

    public boolean isDefaultFeatureState() {
        return defaultFeatureState;
    }

    public void setDefaultFeatureState(boolean defaultFeatureState) {
        this.defaultFeatureState = defaultFeatureState;
    }

    public Map<String, Boolean> getFeatureDefaults() {
        return featureDefaults;
    }

    public void setFeatureDefaults(Map<String, Boolean> featureDefaults) {
        this.featureDefaults = featureDefaults;
    }

    public String getDefaultIdentity() {
        return defaultIdentity;
    }

    public void setDefaultIdentity(String defaultIdentity) {
        this.defaultIdentity = defaultIdentity;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public boolean isRegisterContextsOnStartup() {
        return registerContextsOnStartup;
    }

    public void setRegisterContextsOnStartup(boolean registerContextsOnStartup) {
        this.registerContextsOnStartup = registerContextsOnStartup;
    }

    public boolean isEnableUsageTracking() {
        return enableUsageTracking;
    }

    public void setEnableUsageTracking(boolean enableUsageTracking) {
        this.enableUsageTracking = enableUsageTracking;
    }

    public boolean isEnableMetrics() {
        return enableMetrics;
    }

    public void setEnableMetrics(boolean enableMetrics) {
        this.enableMetrics = enableMetrics;
    }

    public String getMetricsBaseUrl() {
        return metricsBaseUrl;
    }

    public void setMetricsBaseUrl(String metricsBaseUrl) {
        this.metricsBaseUrl = metricsBaseUrl;
    }

    public Duration getUsageFlushInterval() {
        return usageFlushInterval;
    }

    public void setUsageFlushInterval(Duration usageFlushInterval) {
        this.usageFlushInterval = usageFlushInterval;
    }

    public Duration getMetricsFlushInterval() {
        return metricsFlushInterval;
    }

    public void setMetricsFlushInterval(Duration metricsFlushInterval) {
        this.metricsFlushInterval = metricsFlushInterval;
    }

    public String getInstanceName() {
        return instanceName;
    }

    public void setInstanceName(String instanceName) {
        this.instanceName = instanceName;
    }

    public String getAppVersion() {
        return appVersion;
    }

    public void setAppVersion(String appVersion) {
        this.appVersion = appVersion;
    }
}
