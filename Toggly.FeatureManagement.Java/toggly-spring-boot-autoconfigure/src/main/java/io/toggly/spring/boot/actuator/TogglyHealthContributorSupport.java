package io.toggly.spring.boot.actuator;

import io.toggly.core.TogglyClient;

/**
 * Boot-major-neutral health snapshot logic shared by Boot 3 and Boot 4 starters.
 */
public final class TogglyHealthContributorSupport {

    private TogglyHealthContributorSupport() {
    }

    public record Snapshot(int featureCount, String environment, String errorMessage) {

        public boolean isUp() {
            return errorMessage == null;
        }

        public static Snapshot up(TogglyClient client) {
            int featureCount = client.getFeatureKeys().size();
            String environment = client.getConfig().getEnvironment();
            return new Snapshot(featureCount, environment, null);
        }

        public static Snapshot down(String errorMessage) {
            return new Snapshot(0, null, errorMessage);
        }
    }

    public static Snapshot snapshot(TogglyClient togglyClient) {
        try {
            return Snapshot.up(togglyClient);
        } catch (Exception e) {
            return Snapshot.down(e.getMessage());
        }
    }
}
