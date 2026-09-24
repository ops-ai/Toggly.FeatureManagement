package io.toggly.core.util;

import io.toggly.core.model.VariantAllocation;
import io.toggly.core.model.VariantDefinition;
import io.toggly.core.model.VariantStatusOverride;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Shared parse/serialize helpers for the catalog-local {@code variants} and
 * {@code allocation} fields on a feature definition, built on top of
 * {@link SimpleJson}.
 *
 * <p>Used by every snapshot provider that reads or round-trips feature
 * definitions as JSON text ({@code HttpSnapshotProvider} parsing the wire
 * payload, {@code RedisCachingSnapshotProvider} round-tripping its cache
 * entries) so the schema is decoded identically everywhere rather than
 * duplicated per provider.</p>
 */
public final class VariantJson {

    private VariantJson() {}

    /**
     * Parses the {@code variants} array on a feature definition JSON object,
     * e.g. {@code [{"name":"A","configurationValue":{...},"statusOverride":"None"}]}.
     *
     * @param featureJson the feature definition's JSON object text
     * @return the parsed variants, or an empty list if absent/malformed
     */
    public static List<VariantDefinition> parseVariants(String featureJson) {
        List<VariantDefinition> result = new ArrayList<>();
        Object raw = SimpleJson.extractValue(featureJson, "variants");
        if (!(raw instanceof List)) {
            return result;
        }
        for (Object item : (List<?>) raw) {
            if (!(item instanceof Map)) continue;
            Map<?, ?> map = (Map<?, ?>) item;
            Object nameValue = map.get("name");
            if (!(nameValue instanceof String) || ((String) nameValue).isEmpty()) continue;
            Object configurationValue = map.get("configurationValue");
            VariantStatusOverride statusOverride =
                    VariantStatusOverride.fromString(asString(map.get("statusOverride")));
            result.add(new VariantDefinition((String) nameValue, configurationValue, statusOverride));
        }
        return result;
    }

    /**
     * Parses the {@code allocation} object on a feature definition JSON
     * object (user/group/percentile targeting + defaults), matching
     * {@code Microsoft.FeatureManagement}'s {@code Allocation} schema.
     *
     * @param featureJson the feature definition's JSON object text
     * @return the parsed allocation, or {@code null} if absent/malformed
     */
    public static VariantAllocation parseAllocation(String featureJson) {
        Object raw = SimpleJson.extractValue(featureJson, "allocation");
        if (!(raw instanceof Map)) {
            return null;
        }
        Map<?, ?> map = (Map<?, ?>) raw;
        return VariantAllocation.builder()
                .defaultWhenEnabled(asString(map.get("defaultWhenEnabled")))
                .defaultWhenDisabled(asString(map.get("defaultWhenDisabled")))
                .seed(asString(map.get("seed")))
                .userAllocations(parseUserAllocations(map.get("user")))
                .groupAllocations(parseGroupAllocations(map.get("group")))
                .percentileAllocations(parsePercentileAllocations(map.get("percentile")))
                .build();
    }

    /**
     * Serializes a feature's variants to a JSON-serializable value tree
     * (list of maps), suitable for {@link SimpleJson#serialize(Object)}.
     */
    public static List<Map<String, Object>> serializeVariants(List<VariantDefinition> variants) {
        List<Map<String, Object>> result = new ArrayList<>();
        if (variants == null) return result;
        for (VariantDefinition variant : variants) {
            Map<String, Object> map = new HashMap<>();
            map.put("name", variant.getName());
            map.put("configurationValue", variant.getConfigurationValue());
            map.put("statusOverride", variant.getStatusOverride().name());
            result.add(map);
        }
        return result;
    }

    /**
     * Serializes a feature's allocation to a JSON-serializable value tree
     * (map), suitable for {@link SimpleJson#serialize(Object)}.
     */
    public static Map<String, Object> serializeAllocation(VariantAllocation allocation) {
        Map<String, Object> map = new HashMap<>();
        map.put("defaultWhenEnabled", allocation.getDefaultWhenEnabled());
        map.put("defaultWhenDisabled", allocation.getDefaultWhenDisabled());
        map.put("seed", allocation.getSeed());

        List<Map<String, Object>> user = new ArrayList<>();
        for (VariantAllocation.UserAllocation ua : allocation.getUserAllocations()) {
            Map<String, Object> m = new HashMap<>();
            m.put("variant", ua.getVariant());
            m.put("users", ua.getUsers());
            user.add(m);
        }
        map.put("user", user);

        List<Map<String, Object>> group = new ArrayList<>();
        for (VariantAllocation.GroupAllocation ga : allocation.getGroupAllocations()) {
            Map<String, Object> m = new HashMap<>();
            m.put("variant", ga.getVariant());
            m.put("groups", ga.getGroups());
            group.add(m);
        }
        map.put("group", group);

        List<Map<String, Object>> percentile = new ArrayList<>();
        for (VariantAllocation.PercentileAllocation pa : allocation.getPercentileAllocations()) {
            Map<String, Object> m = new HashMap<>();
            m.put("variant", pa.getVariant());
            m.put("from", pa.getFrom());
            m.put("to", pa.getTo());
            percentile.add(m);
        }
        map.put("percentile", percentile);

        return map;
    }

    private static List<VariantAllocation.UserAllocation> parseUserAllocations(Object raw) {
        List<VariantAllocation.UserAllocation> result = new ArrayList<>();
        if (!(raw instanceof List)) return result;
        for (Object item : (List<?>) raw) {
            if (!(item instanceof Map)) continue;
            Map<?, ?> map = (Map<?, ?>) item;
            String variant = asString(map.get("variant"));
            if (variant == null) continue;
            result.add(new VariantAllocation.UserAllocation(variant, asStringList(map.get("users"))));
        }
        return result;
    }

    private static List<VariantAllocation.GroupAllocation> parseGroupAllocations(Object raw) {
        List<VariantAllocation.GroupAllocation> result = new ArrayList<>();
        if (!(raw instanceof List)) return result;
        for (Object item : (List<?>) raw) {
            if (!(item instanceof Map)) continue;
            Map<?, ?> map = (Map<?, ?>) item;
            String variant = asString(map.get("variant"));
            if (variant == null) continue;
            result.add(new VariantAllocation.GroupAllocation(variant, asStringList(map.get("groups"))));
        }
        return result;
    }

    private static List<VariantAllocation.PercentileAllocation> parsePercentileAllocations(Object raw) {
        List<VariantAllocation.PercentileAllocation> result = new ArrayList<>();
        if (!(raw instanceof List)) return result;
        for (Object item : (List<?>) raw) {
            if (!(item instanceof Map)) continue;
            Map<?, ?> map = (Map<?, ?>) item;
            String variant = asString(map.get("variant"));
            if (variant == null) continue;
            double from = asDouble(map.get("from"), 0);
            double to = asDouble(map.get("to"), 0);
            result.add(new VariantAllocation.PercentileAllocation(variant, from, to));
        }
        return result;
    }

    private static String asString(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private static List<String> asStringList(Object raw) {
        List<String> result = new ArrayList<>();
        if (!(raw instanceof List)) return result;
        for (Object item : (List<?>) raw) {
            if (item instanceof String) {
                result.add((String) item);
            }
        }
        return result;
    }

    private static double asDouble(Object value, double defaultValue) {
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        if (value instanceof String) {
            try {
                return Double.parseDouble((String) value);
            } catch (NumberFormatException ignored) {
                // fall through to default
            }
        }
        return defaultValue;
    }
}
