package io.toggly.core.context;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Canonical entity instance passed into feature evaluation (Order, Puppy, etc.).
 */
public final class TogglyEntityContext {

    private final String kind;
    private final String key;
    private final Map<String, Object> attributes;

    public TogglyEntityContext(String kind, String key, Map<String, ?> attributes) {
        this.kind = kind != null ? kind : "";
        this.key = key != null ? key : "";
        Map<String, Object> map = new LinkedHashMap<>();
        if (attributes != null) {
            for (Map.Entry<String, ?> entry : attributes.entrySet()) {
                if (entry.getKey() != null) {
                    map.put(entry.getKey(), entry.getValue());
                }
            }
        }
        this.attributes = Collections.unmodifiableMap(map);
    }

    public String getKind() {
        return kind;
    }

    public String getKey() {
        return key;
    }

    public Map<String, Object> getAttributes() {
        return attributes;
    }

    public Object getAttribute(String name) {
        if (name == null) {
            return null;
        }
        if (attributes.containsKey(name)) {
            return attributes.get(name);
        }
        for (Map.Entry<String, Object> entry : attributes.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) {
                return entry.getValue();
            }
        }
        return null;
    }

    public boolean containsAttribute(String name) {
        return containsKeyIgnoreCase(name);
    }

    public boolean hasAttribute(String name) {
        return getAttribute(name) != null || containsKeyIgnoreCase(name);
    }

    private boolean containsKeyIgnoreCase(String name) {
        if (name == null) {
            return false;
        }
        for (String keyName : attributes.keySet()) {
            if (name.equalsIgnoreCase(keyName)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        TogglyEntityContext that = (TogglyEntityContext) o;
        return Objects.equals(kind, that.kind) &&
                Objects.equals(key, that.key) &&
                Objects.equals(attributes, that.attributes);
    }

    @Override
    public int hashCode() {
        return Objects.hash(kind, key, attributes);
    }

    @Override
    public String toString() {
        return "TogglyEntityContext{kind='" + kind.toLowerCase(Locale.ROOT) + "', key='" + key + "'}";
    }
}
