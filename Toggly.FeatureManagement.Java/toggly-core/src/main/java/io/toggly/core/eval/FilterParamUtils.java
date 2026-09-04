package io.toggly.core.eval;

import io.toggly.core.model.FeatureFilter;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Shared parameter helpers for filter evaluators.
 */
public final class FilterParamUtils {

    private FilterParamUtils() {}

    /**
     * Reads an optional float parameter; returns null when missing/invalid.
     */
    public static Double asFloat(FeatureFilter filter, String key) {
        if (filter == null || key == null) {
            return null;
        }
        Object value = filter.getParameters().get(key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number) {
            return ((Number) value).doubleValue();
        }
        try {
            return Double.parseDouble(value.toString());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Reads a string parameter; returns null when missing or not a string/convertible empty.
     */
    public static String asString(FeatureFilter filter, String key) {
        if (filter == null || key == null) {
            return null;
        }
        Object value = filter.getParameters().get(key);
        if (value == null) {
            return null;
        }
        String s = value.toString();
        return s.isEmpty() ? null : s;
    }

    /**
     * Collects indexed RavenDB / legacy colon-prefixed parameter values
     * (e.g. {@code BrowserFamily:0}, {@code Audience.Groups:1}).
     */
    public static List<String> collectIndexedValues(Map<String, Object> params, String... prefixes) {
        List<String> out = new ArrayList<>();
        if (params == null || prefixes == null) {
            return out;
        }
        for (Map.Entry<String, Object> entry : params.entrySet()) {
            String key = entry.getKey();
            if (key == null || entry.getValue() == null) {
                continue;
            }
            for (String prefix : prefixes) {
                if (key.startsWith(prefix + ":")) {
                    String s = entry.getValue().toString();
                    if (!s.isEmpty()) {
                        out.add(s);
                    }
                    break;
                }
            }
        }
        return out;
    }

    public static boolean containsIgnoreCase(String haystack, String needle) {
        if (haystack == null || needle == null) {
            return false;
        }
        return haystack.toLowerCase(Locale.ROOT).contains(needle.toLowerCase(Locale.ROOT));
    }

    public static boolean equalsIgnoreCase(String a, String b) {
        if (a == null || b == null) {
            return false;
        }
        return a.equalsIgnoreCase(b);
    }
}
