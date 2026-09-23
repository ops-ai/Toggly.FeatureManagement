package io.toggly.core.util;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal recursive-descent JSON value parser and serializer (no external
 * dependencies), shared by snapshot providers that need to round-trip
 * arbitrary JSON payloads (variant {@code configurationValue}, allocation
 * rules, etc.) without pulling in a JSON library into flag evaluation's
 * dependency-free core.
 *
 * <p>Parsed values are one of {@link String}, {@link Long}, {@link Double},
 * {@link Boolean}, {@link Map}{@code <String, Object>}, {@link List}
 * {@code <Object>}, or {@code null}.</p>
 */
public final class SimpleJson {

    private SimpleJson() {}

    /**
     * Extracts and parses the JSON value for a <em>top-level</em> object key
     * (string, number, boolean, null, object, or array).
     *
     * <p>The root must be a JSON object. Nested keys with the same name (for
     * example a filter parameter named {@code "variants"} or
     * {@code "allocation"}) are ignored — only the root object's property is
     * returned.</p>
     *
     * @param json the JSON object text to parse
     * @param key the top-level key whose value should be extracted
     * @return the parsed value, or null if the root is not an object, the key
     *     is absent, or its value is JSON {@code null}
     */
    public static Object extractValue(String json, String key) {
        if (json == null || key == null) {
            return null;
        }
        int[] pos = {0};
        Object root = parseValue(json, pos);
        if (!(root instanceof Map)) {
            return null;
        }
        return ((Map<?, ?>) root).get(key);
    }

    /**
     * Parses a single JSON value starting at {@code pos[0]}, advancing
     * {@code pos[0]} past the consumed value.
     *
     * @param json the JSON text
     * @param pos single-element cursor, updated in place
     * @return the parsed value
     */
    public static Object parseValue(String json, int[] pos) {
        skipWhitespace(json, pos);
        if (pos[0] >= json.length()) {
            return null;
        }
        char c = json.charAt(pos[0]);
        if (c == '{') {
            return parseObject(json, pos);
        }
        if (c == '[') {
            return parseArray(json, pos);
        }
        if (c == '"') {
            return parseString(json, pos);
        }
        if (json.startsWith("true", pos[0])) {
            pos[0] += 4;
            return Boolean.TRUE;
        }
        if (json.startsWith("false", pos[0])) {
            pos[0] += 5;
            return Boolean.FALSE;
        }
        if (json.startsWith("null", pos[0])) {
            pos[0] += 4;
            return null;
        }
        return parseNumber(json, pos);
    }

    private static Map<String, Object> parseObject(String json, int[] pos) {
        Map<String, Object> map = new HashMap<>();
        pos[0]++; // consume '{'
        skipWhitespace(json, pos);
        if (pos[0] < json.length() && json.charAt(pos[0]) == '}') {
            pos[0]++;
            return map;
        }
        while (pos[0] < json.length()) {
            skipWhitespace(json, pos);
            if (pos[0] >= json.length() || json.charAt(pos[0]) != '"') {
                break;
            }
            String key = parseString(json, pos);
            skipWhitespace(json, pos);
            if (pos[0] < json.length() && json.charAt(pos[0]) == ':') {
                pos[0]++;
            }
            Object value = parseValue(json, pos);
            map.put(key, value);
            skipWhitespace(json, pos);
            if (pos[0] < json.length() && json.charAt(pos[0]) == ',') {
                pos[0]++;
                continue;
            }
            if (pos[0] < json.length() && json.charAt(pos[0]) == '}') {
                pos[0]++;
            }
            break;
        }
        return map;
    }

    private static List<Object> parseArray(String json, int[] pos) {
        List<Object> list = new ArrayList<>();
        pos[0]++; // consume '['
        skipWhitespace(json, pos);
        if (pos[0] < json.length() && json.charAt(pos[0]) == ']') {
            pos[0]++;
            return list;
        }
        while (pos[0] < json.length()) {
            list.add(parseValue(json, pos));
            skipWhitespace(json, pos);
            if (pos[0] < json.length() && json.charAt(pos[0]) == ',') {
                pos[0]++;
                continue;
            }
            if (pos[0] < json.length() && json.charAt(pos[0]) == ']') {
                pos[0]++;
            }
            break;
        }
        return list;
    }

    private static String parseString(String json, int[] pos) {
        // Assumes json.charAt(pos[0]) == '"'.
        pos[0]++; // consume opening quote
        StringBuilder sb = new StringBuilder();
        while (pos[0] < json.length()) {
            char c = json.charAt(pos[0]);
            if (c == '"') {
                pos[0]++;
                break;
            }
            if (c == '\\' && pos[0] + 1 < json.length()) {
                char next = json.charAt(pos[0] + 1);
                switch (next) {
                    case '"': sb.append('"'); break;
                    case '\\': sb.append('\\'); break;
                    case '/': sb.append('/'); break;
                    case 'n': sb.append('\n'); break;
                    case 'r': sb.append('\r'); break;
                    case 't': sb.append('\t'); break;
                    case 'b': sb.append('\b'); break;
                    case 'f': sb.append('\f'); break;
                    case 'u':
                        if (pos[0] + 5 < json.length()) {
                            String hex = json.substring(pos[0] + 2, pos[0] + 6);
                            try {
                                sb.append((char) Integer.parseInt(hex, 16));
                            } catch (NumberFormatException ignored) {
                                // Malformed escape — skip rather than throw.
                            }
                            pos[0] += 4;
                        }
                        break;
                    default:
                        sb.append(next);
                }
                pos[0] += 2;
            } else {
                sb.append(c);
                pos[0]++;
            }
        }
        return sb.toString();
    }

    private static Object parseNumber(String json, int[] pos) {
        int start = pos[0];
        while (pos[0] < json.length() && "-+.eE0123456789".indexOf(json.charAt(pos[0])) >= 0) {
            pos[0]++;
        }
        String numStr = json.substring(start, pos[0]);
        if (numStr.isEmpty()) {
            // Unrecognized token — advance one char to avoid an infinite loop.
            pos[0]++;
            return null;
        }
        try {
            if (numStr.indexOf('.') >= 0 || numStr.indexOf('e') >= 0 || numStr.indexOf('E') >= 0) {
                return Double.parseDouble(numStr);
            }
            return Long.parseLong(numStr);
        } catch (NumberFormatException e) {
            return numStr;
        }
    }

    private static void skipWhitespace(String json, int[] pos) {
        while (pos[0] < json.length() && Character.isWhitespace(json.charAt(pos[0]))) {
            pos[0]++;
        }
    }

    /**
     * Serializes an arbitrary value tree ({@link String}, {@link Number},
     * {@link Boolean}, {@link Map}, {@link List}, or {@code null}) to compact
     * JSON text.
     *
     * @param value the value to serialize
     * @return compact JSON text
     */
    public static String serialize(Object value) {
        StringBuilder sb = new StringBuilder();
        serializeInto(value, sb);
        return sb.toString();
    }

    private static void serializeInto(Object value, StringBuilder sb) {
        if (value == null) {
            sb.append("null");
        } else if (value instanceof String) {
            sb.append('"').append(escape((String) value)).append('"');
        } else if (value instanceof Boolean || value instanceof Number) {
            sb.append(value);
        } else if (value instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                if (!first) sb.append(',');
                sb.append('"').append(escape(String.valueOf(entry.getKey()))).append("\":");
                serializeInto(entry.getValue(), sb);
                first = false;
            }
            sb.append('}');
        } else if (value instanceof Iterable) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Iterable<?>) value) {
                if (!first) sb.append(',');
                serializeInto(item, sb);
                first = false;
            }
            sb.append(']');
        } else {
            sb.append('"').append(escape(value.toString())).append('"');
        }
    }

    private static String escape(String value) {
        StringBuilder sb = new StringBuilder(value.length());
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c <= 0x1F) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }
}
