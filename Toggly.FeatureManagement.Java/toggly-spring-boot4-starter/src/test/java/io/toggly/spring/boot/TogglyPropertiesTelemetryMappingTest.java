package io.toggly.spring.boot;

import io.toggly.core.config.TogglyConfig;
import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

class TogglyPropertiesTelemetryMappingTest {

    @Test
    void mirrorsCoreTelemetryKnobsOntoTogglyConfig() {
        TogglyProperties properties = new TogglyProperties();
        properties.setAppKey("app-key");
        properties.setEnvironment("Staging");
        properties.setEnableUsageTracking(false);
        properties.setEnableMetrics(true);
        properties.setMetricsBaseUrl("https://metrics.example/");
        properties.setUsageFlushInterval(Duration.ofSeconds(45));
        properties.setMetricsFlushInterval(Duration.ofMinutes(2));
        properties.setInstanceName("api-west-1");
        properties.setAppVersion("2.3.4");

        TogglyConfig config = TogglyAutoConfiguration.buildConfig(properties);

        assertThat(config.getAppKey()).isEqualTo("app-key");
        assertThat(config.getEnvironment()).isEqualTo("Staging");
        assertThat(config.isEnableUsageTracking()).isFalse();
        assertThat(config.isEnableMetrics()).isTrue();
        assertThat(config.getMetricsBaseUrl()).isEqualTo("https://metrics.example/");
        assertThat(config.getUsageFlushInterval()).isEqualTo(Duration.ofSeconds(45));
        assertThat(config.getMetricsFlushInterval()).isEqualTo(Duration.ofMinutes(2));
        assertThat(config.getInstanceName()).isEqualTo("api-west-1");
        assertThat(config.getAppVersion()).isEqualTo("2.3.4");
    }

    @Test
    void defaultsMatchCoreFlushIntervals() {
        TogglyProperties properties = new TogglyProperties();
        properties.setAppKey("app-key");

        TogglyConfig config = TogglyAutoConfiguration.buildConfig(properties);

        assertThat(config.getUsageFlushInterval()).isEqualTo(Duration.ofMinutes(1));
        assertThat(config.getMetricsFlushInterval()).isEqualTo(Duration.ofMinutes(1));
        assertThat(config.getInstanceName()).isNull();
        assertThat(config.getAppVersion()).isNull();
    }
}
