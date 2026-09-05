package io.toggly.core.context;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Context for evaluating feature flags.
 *
 * <p>Contains user identity, group memberships, claims, request fields, and
 * custom traits for targeting and segment rules.</p>
 *
 * <p>Example usage:</p>
 * <pre>{@code
 * EvaluationContext context = EvaluationContext.builder()
 *     .identity("user-123")
 *     .addGroup("premium")
 *     .claim("role", "admin")
 *     .request(RequestContext.builder()
 *         .userAgent("Mozilla/5.0 ...")
 *         .country("US")
 *         .build())
 *     .build();
 *
 * boolean enabled = client.isEnabled("new-feature", context);
 * }</pre>
 */
public final class EvaluationContext {

    private static final EvaluationContext EMPTY = new EvaluationContext(
            null,
            Collections.emptySet(),
            Collections.emptyMap(),
            Collections.emptyMap(),
            null,
            null);

    private final String identity;
    private final Set<String> groups;
    private final Map<String, Object> traits;
    private final Map<String, String> claims;
    private final RequestContext request;
    private final TogglyEntityContext entity;

    private EvaluationContext(
            String identity,
            Set<String> groups,
            Map<String, Object> traits,
            Map<String, String> claims,
            RequestContext request,
            TogglyEntityContext entity) {
        this.identity = identity;
        this.groups = Collections.unmodifiableSet(new HashSet<>(groups));
        this.traits = Collections.unmodifiableMap(new HashMap<>(traits));
        this.claims = Collections.unmodifiableMap(new HashMap<>(claims));
        this.request = request;
        this.entity = entity;
    }

    /**
     * Returns an empty context with no identity, groups, or traits.
     *
     * @return an empty context
     */
    public static EvaluationContext empty() {
        return EMPTY;
    }

    /**
     * Creates a context with just an identity.
     *
     * @param identity the user identity
     * @return a new context
     */
    public static EvaluationContext forIdentity(String identity) {
        return new EvaluationContext(
                identity,
                Collections.emptySet(),
                Collections.emptyMap(),
                Collections.emptyMap(),
                null,
                null);
    }

    /**
     * Creates a new builder for EvaluationContext.
     *
     * @return a new builder
     */
    public static Builder builder() {
        return new Builder();
    }

    /**
     * Returns the user identity.
     *
     * @return the identity or null if not set
     */
    public String getIdentity() {
        return identity;
    }

    /**
     * Returns the user's group memberships.
     *
     * @return an unmodifiable set of groups
     */
    public Set<String> getGroups() {
        return groups;
    }

    /**
     * Returns the custom traits.
     *
     * @return an unmodifiable map of traits
     */
    public Map<String, Object> getTraits() {
        return traits;
    }

    /**
     * Returns principal / JWT-style claims for UserClaims filters.
     *
     * @return an unmodifiable map of claims
     */
    public Map<String, String> getClaims() {
        return claims;
    }

    /**
     * Returns HTTP request fields for segment filters.
     *
     * @return the request context or null
     */
    public RequestContext getRequest() {
        return request;
    }

    /**
     * Returns the entity context used by ContextProperty filters.
     *
     * @return the entity or null
     */
    public TogglyEntityContext getEntity() {
        return entity;
    }

    /**
     * Checks if the user belongs to a specific group.
     *
     * @param group the group name
     * @return true if the user is in the group
     */
    public boolean hasGroup(String group) {
        return groups.contains(group);
    }

    /**
     * Checks if the user belongs to any of the specified groups.
     *
     * @param groupNames the group names to check
     * @return true if the user is in any of the groups
     */
    public boolean hasAnyGroup(Set<String> groupNames) {
        for (String group : groupNames) {
            if (groups.contains(group)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Gets a trait value.
     *
     * @param key the trait key
     * @return the trait value or null
     */
    public Object getTrait(String key) {
        return traits.get(key);
    }

    /**
     * Gets a trait value as a String.
     *
     * @param key the trait key
     * @return the trait value as string or null
     */
    public String getTraitAsString(String key) {
        Object value = traits.get(key);
        return value != null ? value.toString() : null;
    }

    /**
     * Creates a new context with the specified identity added.
     *
     * @param identity the identity to add
     * @return a new context with the identity
     */
    public EvaluationContext withIdentity(String identity) {
        return new EvaluationContext(identity, this.groups, this.traits, this.claims, this.request, this.entity);
    }

    /**
     * Creates a new context with an additional group.
     *
     * @param group the group to add
     * @return a new context with the group
     */
    public EvaluationContext withGroup(String group) {
        Set<String> newGroups = new HashSet<>(this.groups);
        newGroups.add(group);
        return new EvaluationContext(this.identity, newGroups, this.traits, this.claims, this.request, this.entity);
    }

    /**
     * Creates a new context with an additional trait.
     *
     * @param key the trait key
     * @param value the trait value
     * @return a new context with the trait
     */
    public EvaluationContext withTrait(String key, Object value) {
        Map<String, Object> newTraits = new HashMap<>(this.traits);
        newTraits.put(key, value);
        return new EvaluationContext(this.identity, this.groups, newTraits, this.claims, this.request, this.entity);
    }

    /**
     * Creates a new context with the specified claims map.
     *
     * @param claims claim type → value
     * @return a new context
     */
    public EvaluationContext withClaims(Map<String, String> claims) {
        Map<String, String> copy = claims != null ? claims : Collections.emptyMap();
        return new EvaluationContext(this.identity, this.groups, this.traits, copy, this.request, this.entity);
    }

    /**
     * Creates a new context with the specified request fields.
     *
     * @param request the request context
     * @return a new context
     */
    public EvaluationContext withRequest(RequestContext request) {
        return new EvaluationContext(this.identity, this.groups, this.traits, this.claims, request, this.entity);
    }

    /**
     * Creates a new context with the specified entity.
     *
     * @param entity the entity context
     * @return a new context
     */
    public EvaluationContext withEntity(TogglyEntityContext entity) {
        return new EvaluationContext(this.identity, this.groups, this.traits, this.claims, this.request, entity);
    }

    /**
     * Builder for {@link EvaluationContext}.
     */
    public static final class Builder {
        private String identity;
        private final Set<String> groups = new HashSet<>();
        private final Map<String, Object> traits = new HashMap<>();
        private final Map<String, String> claims = new HashMap<>();
        private RequestContext request;
        private TogglyEntityContext entity;

        private Builder() {}

        /**
         * Sets the user identity.
         *
         * @param identity the user identity
         * @return this builder
         */
        public Builder identity(String identity) {
            this.identity = identity;
            return this;
        }

        /**
         * Adds a group membership.
         *
         * @param group the group name
         * @return this builder
         */
        public Builder addGroup(String group) {
            if (group != null) {
                this.groups.add(group);
            }
            return this;
        }

        /**
         * Sets all group memberships.
         *
         * @param groups the groups
         * @return this builder
         */
        public Builder groups(Set<String> groups) {
            this.groups.clear();
            if (groups != null) {
                this.groups.addAll(groups);
            }
            return this;
        }

        /**
         * Sets group memberships from a list (fixture / JSON friendly).
         *
         * @param groups the groups
         * @return this builder
         */
        public Builder groups(Iterable<String> groups) {
            this.groups.clear();
            if (groups != null) {
                for (String group : groups) {
                    if (group != null) {
                        this.groups.add(group);
                    }
                }
            }
            return this;
        }

        /**
         * Adds a custom trait.
         *
         * @param key the trait key
         * @param value the trait value
         * @return this builder
         */
        public Builder trait(String key, Object value) {
            this.traits.put(key, value);
            return this;
        }

        /**
         * Sets all custom traits.
         *
         * @param traits the traits map
         * @return this builder
         */
        public Builder traits(Map<String, Object> traits) {
            this.traits.clear();
            if (traits != null) {
                this.traits.putAll(traits);
            }
            return this;
        }

        /**
         * Adds a principal claim.
         *
         * @param type claim type
         * @param value claim value
         * @return this builder
         */
        public Builder claim(String type, String value) {
            if (type != null) {
                this.claims.put(type, value);
            }
            return this;
        }

        /**
         * Sets all principal claims.
         *
         * @param claims claim type → value
         * @return this builder
         */
        public Builder claims(Map<String, String> claims) {
            this.claims.clear();
            if (claims != null) {
                this.claims.putAll(claims);
            }
            return this;
        }

        /**
         * Sets HTTP request fields for segment filters.
         *
         * @param request the request context
         * @return this builder
         */
        public Builder request(RequestContext request) {
            this.request = request;
            return this;
        }

        /**
         * Sets the entity context for ContextProperty filters.
         *
         * @param entity the entity
         * @return this builder
         */
        public Builder entity(TogglyEntityContext entity) {
            this.entity = entity;
            return this;
        }

        /**
         * Builds the EvaluationContext.
         *
         * @return a new EvaluationContext
         */
        public EvaluationContext build() {
            return new EvaluationContext(identity, groups, traits, claims, request, entity);
        }
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        EvaluationContext that = (EvaluationContext) o;
        return Objects.equals(identity, that.identity) &&
                Objects.equals(groups, that.groups) &&
                Objects.equals(traits, that.traits) &&
                Objects.equals(claims, that.claims) &&
                Objects.equals(request, that.request) &&
                Objects.equals(entity, that.entity);
    }

    @Override
    public int hashCode() {
        return Objects.hash(identity, groups, traits, claims, request, entity);
    }

    @Override
    public String toString() {
        return "EvaluationContext{" +
                "identity='" + identity + '\'' +
                ", groups=" + groups +
                ", claims=" + claims +
                ", request=" + request +
                ", traits=" + traits +
                '}';
    }
}
