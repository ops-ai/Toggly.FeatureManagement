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
        TogglyHealthContributorSupport.Snapshot snapshot =
                TogglyHealthContributorSupport.snapshot(togglyClient);
        if (snapshot.isUp()) {
            return Health.up()
                    .withDetail("featureCount", snapshot.featureCount())
                    .withDetail("environment", snapshot.environment())
                    .build();
        }
        return Health.down()
                .withException(snapshot.error())
                .build();
    }
}
