package io.toggly.spring.boot;

import io.toggly.core.TogglyClient;
import io.toggly.core.config.TogglyConfig;
import io.toggly.core.snapshot.SnapshotProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Auto-configuration for Toggly.
 */
@AutoConfiguration
@ConditionalOnClass(TogglyClient.class)
@ConditionalOnProperty(prefix = "toggly", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(TogglyProperties.class)
public class TogglyAutoConfiguration {

    /**
     * Creates the TogglyConfig from properties.
     *
     * @param properties the configuration properties
     * @return the config
     */
    @Bean
    @ConditionalOnMissingBean
    public TogglyConfig togglyConfig(TogglyProperties properties) {
        TogglyConfig.Builder builder = TogglyConfig.builder()
                .appKey(properties.getAppKey())
                .environment(properties.getEnvironment())
                .baseUrl(properties.getBaseUrl())
                .refreshIntervalSeconds(properties.getRefreshIntervalSeconds())
                .defaultFeatureState(properties.isDefaultFeatureState());

        if (properties.getDefaultIdentity() != null) {
            builder.defaultIdentity(properties.getDefaultIdentity());
        }

        if (properties.getFeatureDefaults() != null) {
            properties.getFeatureDefaults().forEach(builder::featureDefault);
        }

        return builder.build();
    }

    /**
     * Creates the TogglyClient bean.
     *
     * @param config the configuration
     * @param snapshotProvider optional custom snapshot provider
     * @return the client
     */
    @Bean
    @ConditionalOnMissingBean
    public TogglyClient togglyClient(TogglyConfig config,
                                     @SuppressWarnings("SpringJavaInjectionPointsAutowiringInspection")
                                     SnapshotProvider snapshotProvider) {
        return new TogglyClient(config, snapshotProvider);
    }

    /**
     * Creates a default snapshot provider bean (placeholder for extension).
     * Can be overridden by custom implementations.
     */
    @Bean
    @ConditionalOnMissingBean
    public SnapshotProvider snapshotProvider() {
        // Return null to use the default HTTP provider in TogglyClient
        return null;
    }
}
