package io.toggly.core.crypto;

import java.util.Collections;
import java.util.List;

/**
 * JSON Web Key Set containing ES256 public keys.
 */
public final class JsonWebKeySet {

    private final List<JsonWebKey> keys;

    public JsonWebKeySet(List<JsonWebKey> keys) {
        this.keys = keys != null
                ? Collections.unmodifiableList(keys)
                : Collections.emptyList();
    }

    public List<JsonWebKey> getKeys() {
        return keys;
    }

    public JsonWebKey findByKid(String kid) {
        if (kid == null) {
            return null;
        }
        for (JsonWebKey key : keys) {
            if (kid.equals(key.getKid())) {
                return key;
            }
        }
        return null;
    }

    public static JsonWebKeySet empty() {
        return new JsonWebKeySet(null);
    }
}
