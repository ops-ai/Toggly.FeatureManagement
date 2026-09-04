package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureFilter;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Evaluator for user/group targeting rules.
 */
public final class TargetingEvaluator implements FilterEvaluator {

    public static final TargetingEvaluator INSTANCE = new TargetingEvaluator();

    private TargetingEvaluator() {}

    @Override
    public boolean evaluate(FeatureFilter filter, String featureKey, EvaluationContext context) {
        Map<String, Object> params = filter.getParameters();

        // Check specific users
        Set<String> users = getUsers(params);
        String identity = context.getIdentity();
        if (!users.isEmpty() && identity != null && users.contains(identity)) {
            return true;
        }

        // Check groups
        Set<String> groups = getGroups(params);
        if (!groups.isEmpty() && context.hasAnyGroup(groups)) {
            return true;
        }

        // Check default rollout percentage
        double defaultPercentage = getDefaultPercentage(params);
        if (defaultPercentage > 0 && identity != null && !identity.isEmpty()) {
            double bucket = PercentageEvaluator.INSTANCE.calculateBucket(identity, featureKey);
            return bucket < defaultPercentage;
        }

        return false;
    }

    private Set<String> getUsers(Map<String, Object> params) {
        Set<String> users = new HashSet<>();

        // Try 'users' or 'Users' parameter (comma-separated)
        Object usersValue = params.get("users");
        if (usersValue == null) usersValue = params.get("Users");

        if (usersValue != null) {
            String usersStr = usersValue.toString();
            Arrays.stream(usersStr.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .forEach(users::add);
        }

        // Try indexed 'Audience.Users:N' format
        for (Map.Entry<String, Object> entry : params.entrySet()) {
            if (entry.getKey().startsWith("Audience.Users:") && entry.getValue() != null) {
                String value = entry.getValue().toString().trim();
                if (!value.isEmpty()) {
                    users.add(value);
                }
            }
        }

        return users;
    }

    private Set<String> getGroups(Map<String, Object> params) {
        Set<String> groups = new HashSet<>();

        // Try 'groups' or 'Groups' parameter (comma-separated)
        Object groupsValue = params.get("groups");
        if (groupsValue == null) groupsValue = params.get("Groups");

        if (groupsValue != null) {
            String groupsStr = groupsValue.toString();
            Arrays.stream(groupsStr.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .forEach(groups::add);
        }

        // Try indexed 'Audience.Groups:N' format
        for (Map.Entry<String, Object> entry : params.entrySet()) {
            if (entry.getKey().startsWith("Audience.Groups:") && entry.getValue() != null) {
                String value = entry.getValue().toString().trim();
                if (!value.isEmpty()) {
                    groups.add(value);
                }
            }
        }

        return groups;
    }

    private double getDefaultPercentage(Map<String, Object> params) {
        Object value = params.get("Audience.DefaultRolloutPercentage");
        if (value == null) value = params.get("DefaultRolloutPercentage");
        if (value == null) value = params.get("defaultRolloutPercentage");
        if (value == null) value = params.get("default_percentage");
        if (value == null) value = params.get("Percentage");

        if (value == null) return 0;

        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }

        try {
            return Double.parseDouble(value.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
