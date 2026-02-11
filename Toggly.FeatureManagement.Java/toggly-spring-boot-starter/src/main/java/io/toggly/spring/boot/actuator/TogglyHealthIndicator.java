package io.toggly.spring.boot.actuator;

import io.toggly.core.TogglyClient;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;

/**
 * Health indicator for Toggly integration.
 *
 * <p>Reports the status of the Toggly client and feature definitions.</p>
 */
public class TogglyHealthIndicator implements HealthIndicator {

    private final TogglyClient togglyClient;

    public TogglyHealthIndicator(TogglyClient togglyClient) {
        this.togglyClient = togglyClient;
    }

    @Override
    public Health health() {
        try {
            int featureCount = togglyClient.getFeatureKeys().size();
            return Health.up()
                    .withDetail("featureCount", featureCount)
                    .withDetail("environment", togglyClient.getConfig().getEnvironment())
                    .build();
        } catch (Exception e) {
            return Health.down()
                    .withException(e)
                    .build();
        }
    }
}
