package io.toggly.core.model;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Represents a filter condition for a feature flag.
 */
public final class FeatureFilter {

    private final String name;
    private final Map<String, Object> parameters;

    private FeatureFilter(String name, Map<String, Object> parameters) {
        this.name = name;
        this.parameters = Collections.unmodifiableMap(new HashMap<>(parameters));
    }

    /**
     * Creates a new FeatureFilter with the given name and parameters.
     *
     * @param name the filter name (e.g., "AlwaysOn", "Percentage", "Targeting")
     * @param parameters the filter parameters
     * @return a new FeatureFilter
     */
    public static FeatureFilter of(String name, Map<String, Object> parameters) {
        Objects.requireNonNull(name, "name is required");
        return new FeatureFilter(name, parameters != null ? parameters : Collections.emptyMap());
    }

    /**
     * Creates an AlwaysOn filter.
     *
     * @return an AlwaysOn filter
     */
    public static FeatureFilter alwaysOn() {
        return new FeatureFilter("AlwaysOn", Collections.emptyMap());
    }

    /**
     * Creates a Percentage filter.
     *
     * @param percentage the rollout percentage (0-100)
     * @return a Percentage filter
     */
    public static FeatureFilter percentage(double percentage) {
        Map<String, Object> params = new HashMap<>();
        params.put("Value", percentage);
        return new FeatureFilter("Percentage", params);
    }

    /**
     * Creates a Targeting filter for specific users.
     *
     * @param users comma-separated list of user identities
     * @return a Targeting filter
     */
    public static FeatureFilter targetingUsers(String users) {
        Map<String, Object> params = new HashMap<>();
        params.put("users", users);
        return new FeatureFilter("Targeting", params);
    }

    /**
     * Creates a Targeting filter for specific groups.
     *
     * @param groups comma-separated list of group names
     * @return a Targeting filter
     */
    public static FeatureFilter targetingGroups(String groups) {
        Map<String, Object> params = new HashMap<>();
        params.put("groups", groups);
        return new FeatureFilter("Targeting", params);
    }

    /**
     * Creates a TimeWindow filter.
     *
     * @param start start time in ISO-8601 format
     * @param end end time in ISO-8601 format
     * @return a TimeWindow filter
     */
    public static FeatureFilter timeWindow(String start, String end) {
        Map<String, Object> params = new HashMap<>();
        if (start != null) params.put("Start", start);
        if (end != null) params.put("End", end);
        return new FeatureFilter("TimeWindow", params);
    }

    public String getName() {
        return name;
    }

    public Map<String, Object> getParameters() {
        return parameters;
    }

    /**
     * Gets a parameter value as a String.
     *
     * @param key the parameter key
     * @return the parameter value or null
     */
    public String getStringParameter(String key) {
        Object value = parameters.get(key);
        return value != null ? value.toString() : null;
    }

    /**
     * Gets a parameter value as a Double.
     *
     * @param key the parameter key
     * @param defaultValue the default value if not found or invalid
     * @return the parameter value
     */
    public double getDoubleParameter(String key, double defaultValue) {
        Object value = parameters.get(key);
        if (value == null) return defaultValue;
        if (value instanceof Number) return ((Number) value).doubleValue();
        try {
            return Double.parseDouble(value.toString());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    /**
     * Gets a parameter value as an Integer.
     *
     * @param key the parameter key
     * @param defaultValue the default value if not found or invalid
     * @return the parameter value
     */
    public int getIntParameter(String key, int defaultValue) {
        Object value = parameters.get(key);
        if (value == null) return defaultValue;
        if (value instanceof Number) return ((Number) value).intValue();
        try {
            return Integer.parseInt(value.toString());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        FeatureFilter that = (FeatureFilter) o;
        return Objects.equals(name, that.name) &&
                Objects.equals(parameters, that.parameters);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, parameters);
    }

    @Override
    public String toString() {
        return "FeatureFilter{" +
                "name='" + name + '\'' +
                ", parameters=" + parameters +
                '}';
    }
}
