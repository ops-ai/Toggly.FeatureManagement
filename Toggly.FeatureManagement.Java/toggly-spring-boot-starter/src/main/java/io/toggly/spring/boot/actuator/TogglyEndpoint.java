package io.toggly.spring.boot.actuator;

import io.toggly.core.TogglyClient;
import io.toggly.core.model.FeatureDefinition;
import org.springframework.boot.actuate.endpoint.annotation.Endpoint;
import org.springframework.boot.actuate.endpoint.annotation.ReadOperation;
import org.springframework.boot.actuate.endpoint.annotation.Selector;
import org.springframework.boot.actuate.endpoint.annotation.WriteOperation;

import java.util.HashMap;
import java.util.Map;

/**
 * Actuator endpoint for Toggly feature flags.
 *
 * <p>Exposes feature flag information at {@code /actuator/toggly}.</p>
 */
@Endpoint(id = "toggly")
public class TogglyEndpoint {

    private final TogglyClient togglyClient;

    public TogglyEndpoint(TogglyClient togglyClient) {
        this.togglyClient = togglyClient;
    }

    /**
     * Returns information about all features.
     *
     * @return feature information
     */
    @ReadOperation
    public Map<String, Object> features() {
        Map<String, Object> result = new HashMap<>();
        result.put("environment", togglyClient.getConfig().getEnvironment());
        result.put("features", togglyClient.evaluateAll());
        result.put("featureCount", togglyClient.getFeatureKeys().size());
        return result;
    }

    /**
     * Returns information about a specific feature.
     *
     * @param featureKey the feature key
     * @return feature information
     */
    @ReadOperation
    public Map<String, Object> feature(@Selector String featureKey) {
        Map<String, Object> result = new HashMap<>();
        result.put("key", featureKey);
        result.put("enabled", togglyClient.isEnabled(featureKey));

        FeatureDefinition definition = togglyClient.getFeatureDefinition(featureKey);
        if (definition != null) {
            result.put("exists", true);
            result.put("filterCount", definition.getFilters() != null ? definition.getFilters().size() : 0);
            result.put("requirementType", definition.getRequirementType());
        } else {
            result.put("exists", false);
        }

        return result;
    }

    /**
     * Refreshes the feature definitions.
     *
     * @return refresh result
     */
    @WriteOperation
    public Map<String, Object> refresh() {
        Map<String, Object> result = new HashMap<>();
        try {
            togglyClient.refresh();
            result.put("status", "refreshed");
            result.put("featureCount", togglyClient.getFeatureKeys().size());
        } catch (Exception e) {
            result.put("status", "error");
            result.put("error", e.getMessage());
        }
        return result;
    }
}
