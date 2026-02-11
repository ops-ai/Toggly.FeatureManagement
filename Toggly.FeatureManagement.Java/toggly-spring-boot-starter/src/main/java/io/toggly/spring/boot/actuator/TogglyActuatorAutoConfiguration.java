package io.toggly.spring.boot.actuator;

import io.toggly.core.TogglyClient;
import org.springframework.boot.actuate.autoconfigure.endpoint.condition.ConditionalOnAvailableEndpoint;
import org.springframework.boot.actuate.autoconfigure.health.ConditionalOnEnabledHealthIndicator;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;

/**
 * Auto-configuration for Toggly Actuator integration.
 */
@AutoConfiguration
@ConditionalOnClass(name = "org.springframework.boot.actuate.endpoint.annotation.Endpoint")
@ConditionalOnBean(TogglyClient.class)
public class TogglyActuatorAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnEnabledHealthIndicator("toggly")
    public TogglyHealthIndicator togglyHealthIndicator(TogglyClient togglyClient) {
        return new TogglyHealthIndicator(togglyClient);
    }

    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnAvailableEndpoint
    public TogglyEndpoint togglyEndpoint(TogglyClient togglyClient) {
        return new TogglyEndpoint(togglyClient);
    }
}
