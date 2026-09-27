package io.toggly.core.config;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TogglyConfigTest {

    @Test
    void builderCopiesMutableDefaultsAndSigningAllowList() {
        Map<String, Boolean> defaults = new HashMap<>(Map.of("fallback", true));
        Set<String> keys = new HashSet<>(Set.of("kid"));
        TogglyConfig config = TogglyConfig.builder()
                .appKey("secret-app-key")
                .environment("Staging")
                .baseUrl("https://definitions.example")
                .metricsBaseUrl("https://metrics.example")
                .refreshIntervalSeconds(45)
                .connectTimeout(Duration.ofSeconds(2))
                .readTimeout(Duration.ofSeconds(4))
                .usageFlushInterval(Duration.ofSeconds(5))
                .metricsFlushInterval(Duration.ofSeconds(6))
                .enableAutoRefresh(true)
                .enableUsageTracking(false)
                .enableMetrics(false)
                .enableLiveUpdates(false)
                .useSignedDefinitions(true)
                .debug(true)
                .featureDefaults(defaults)
                .featureDefault("another", false)
                .defaultIdentity("sensitive-user")
                .defaultFeatureState(true)
                .allowedKeyIds(keys)
                .instanceName("worker-1")
                .appVersion("1.0")
                .registerContextsOnStartup(false)
                .build();
        defaults.clear();
        keys.clear();

        assertThat(config.getFeatureDefaults()).containsEntry("fallback", true)
                .containsEntry("another", false);
        assertThat(config.getAllowedKeyIds()).containsExactly("kid");
        assertThatThrownBy(() -> config.getFeatureDefaults().clear())
                .isInstanceOf(UnsupportedOperationException.class);
        assertThat(config.getRefreshIntervalSeconds()).isEqualTo(45);
        assertThat(config.getConnectTimeout()).isEqualTo(Duration.ofSeconds(2));
        assertThat(config.getReadTimeout()).isEqualTo(Duration.ofSeconds(4));
        assertThat(config.getUsageFlushInterval()).isEqualTo(Duration.ofSeconds(5));
        assertThat(config.getMetricsFlushInterval()).isEqualTo(Duration.ofSeconds(6));
        assertThat(config.getMetricsBaseUrl()).isEqualTo("https://metrics.example");
        assertThat(config.getInstanceName()).isEqualTo("worker-1");
        assertThat(config.getAppVersion()).isEqualTo("1.0");
        assertThat(config.getIdentity()).isEqualTo("sensitive-user");
        assertThat(config.getDefaultIdentity()).isEqualTo("sensitive-user");
        assertThat(config.getDefaultFeatureState()).isTrue();
        assertThat(config.isEnableAutoRefresh()).isTrue();
        assertThat(config.isEnableUsageTracking()).isFalse();
        assertThat(config.isEnableMetrics()).isFalse();
        assertThat(config.isEnableLiveUpdates()).isFalse();
        assertThat(config.isUseSignedDefinitions()).isTrue();
        assertThat(config.isDebug()).isTrue();
        assertThat(config.isRegisterContextsOnStartup()).isFalse();
        assertThat(config.toString()).doesNotContain("secret-app-key", "sensitive-user");
        assertThat(config.toBuilder().build()).isEqualTo(config).hasSameHashCodeAs(config);
    }

    @Test
    void convenienceFactoriesAndNullFallbacksKeepUsableDefaults() {
        TogglyConfig local = TogglyConfig.localOnly(Map.of("local", true));
        TogglyConfig byKey = TogglyConfig.withAppKey("app");
        TogglyConfig fallback = TogglyConfig.builder()
                .appKey(null).environment(null).baseUrl(null).metricsBaseUrl(null)
                .refreshInterval(null).connectTimeout(null).readTimeout(null)
                .usageFlushInterval(null).metricsFlushInterval(null)
                .featureDefaults(null).allowedKeyIds(null).build();

        assertThat(local.getFeatureDefaults()).containsEntry("local", true);
        assertThat(byKey.getAppKey()).isEqualTo("app");
        assertThat(fallback.getAppKey()).isEmpty();
        assertThat(fallback.getEnvironment()).isEqualTo("Production");
        assertThat(fallback.getBaseUrl()).isEqualTo("https://definitions.toggly.io");
        assertThat(fallback.getMetricsBaseUrl()).isEqualTo("https://metrics.toggly.io/");
        assertThat(fallback.getRefreshIntervalSeconds()).isEqualTo(180);
        assertThat(fallback.getFeatureDefaults()).isEmpty();
        assertThat(fallback.getAllowedKeyIds()).isEmpty();
        assertThat(fallback.toString()).contains("(empty)");
    }
}
