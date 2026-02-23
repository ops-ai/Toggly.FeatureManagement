package io.toggly.spring.boot;

import org.springframework.boot.context.properties.ConfigurationProperties;

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
}
