package io.toggly.core.model;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Allocation rules assigning variants to users for a feature, matching
 * {@code Microsoft.FeatureManagement}'s {@code Allocation} schema
 * (user/group/percentile targeting, with defaults for the enabled and
 * disabled cases).
 *
 * <p>Catalog-local: parsed directly from {@link FeatureDefinition#getAllocation()}
 * and evaluated locally by the MF-parity allocator
 * ({@code io.toggly.core.eval.VariantAllocator}) — never fetched separately.</p>
 */
public final class VariantAllocation {

    private final String defaultWhenEnabled;
    private final String defaultWhenDisabled;
    private final String seed;
    private final List<UserAllocation> userAllocations;
    private final List<GroupAllocation> groupAllocations;
    private final List<PercentileAllocation> percentileAllocations;

    public VariantAllocation(
            String defaultWhenEnabled,
            String defaultWhenDisabled,
            String seed,
            List<UserAllocation> userAllocations,
            List<GroupAllocation> groupAllocations,
            List<PercentileAllocation> percentileAllocations) {
        this.defaultWhenEnabled = defaultWhenEnabled;
        this.defaultWhenDisabled = defaultWhenDisabled;
        this.seed = seed;
        this.userAllocations = userAllocations != null
                ? Collections.unmodifiableList(new ArrayList<>(userAllocations))
                : Collections.emptyList();
        this.groupAllocations = groupAllocations != null
                ? Collections.unmodifiableList(new ArrayList<>(groupAllocations))
                : Collections.emptyList();
        this.percentileAllocations = percentileAllocations != null
                ? Collections.unmodifiableList(new ArrayList<>(percentileAllocations))
                : Collections.emptyList();
    }

    public static Builder builder() {
        return new Builder();
    }

    /**
     * Variant to assign when the feature is enabled and no other allocation matches.
     */
    public String getDefaultWhenEnabled() {
        return defaultWhenEnabled;
    }

    /**
     * Variant to assign when the feature is disabled.
     */
    public String getDefaultWhenDisabled() {
        return defaultWhenDisabled;
    }

    /**
     * Seed for percentile hashing. When null, the allocator uses
     * {@code "allocation\n{featureKey}"} (MF's implicit default hint).
     */
    public String getSeed() {
        return seed;
    }

    /**
     * User allocations, in priority order (first match wins).
     */
    public List<UserAllocation> getUserAllocations() {
        return userAllocations;
    }

    /**
     * Group allocations, in priority order (first match wins).
     */
    public List<GroupAllocation> getGroupAllocations() {
        return groupAllocations;
    }

    /**
     * Percentile allocations, in priority order (first matching bucket wins).
     */
    public List<PercentileAllocation> getPercentileAllocations() {
        return percentileAllocations;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        VariantAllocation that = (VariantAllocation) o;
        return Objects.equals(defaultWhenEnabled, that.defaultWhenEnabled)
                && Objects.equals(defaultWhenDisabled, that.defaultWhenDisabled)
                && Objects.equals(seed, that.seed)
                && Objects.equals(userAllocations, that.userAllocations)
                && Objects.equals(groupAllocations, that.groupAllocations)
                && Objects.equals(percentileAllocations, that.percentileAllocations);
    }

    @Override
    public int hashCode() {
        return Objects.hash(defaultWhenEnabled, defaultWhenDisabled, seed,
                userAllocations, groupAllocations, percentileAllocations);
    }

    @Override
    public String toString() {
        return "VariantAllocation{" +
                "defaultWhenEnabled='" + defaultWhenEnabled + '\'' +
                ", defaultWhenDisabled='" + defaultWhenDisabled + '\'' +
                ", seed='" + seed + '\'' +
                ", userAllocations=" + userAllocations.size() +
                ", groupAllocations=" + groupAllocations.size() +
                ", percentileAllocations=" + percentileAllocations.size() +
                '}';
    }

    /**
     * Builder for {@link VariantAllocation}.
     */
    public static final class Builder {
        private String defaultWhenEnabled;
        private String defaultWhenDisabled;
        private String seed;
        private List<UserAllocation> userAllocations = new ArrayList<>();
        private List<GroupAllocation> groupAllocations = new ArrayList<>();
        private List<PercentileAllocation> percentileAllocations = new ArrayList<>();

        private Builder() {}

        public Builder defaultWhenEnabled(String defaultWhenEnabled) {
            this.defaultWhenEnabled = defaultWhenEnabled;
            return this;
        }

        public Builder defaultWhenDisabled(String defaultWhenDisabled) {
            this.defaultWhenDisabled = defaultWhenDisabled;
            return this;
        }

        public Builder seed(String seed) {
            this.seed = seed;
            return this;
        }

        public Builder userAllocations(List<UserAllocation> userAllocations) {
            this.userAllocations = userAllocations != null ? new ArrayList<>(userAllocations) : new ArrayList<>();
            return this;
        }

        public Builder groupAllocations(List<GroupAllocation> groupAllocations) {
            this.groupAllocations = groupAllocations != null ? new ArrayList<>(groupAllocations) : new ArrayList<>();
            return this;
        }

        public Builder percentileAllocations(List<PercentileAllocation> percentileAllocations) {
            this.percentileAllocations = percentileAllocations != null
                    ? new ArrayList<>(percentileAllocations)
                    : new ArrayList<>();
            return this;
        }

        public VariantAllocation build() {
            return new VariantAllocation(
                    defaultWhenEnabled, defaultWhenDisabled, seed,
                    userAllocations, groupAllocations, percentileAllocations);
        }
    }

    /**
     * Assigns a variant to a specific list of users by identity.
     */
    public static final class UserAllocation {
        private final String variant;
        private final List<String> users;

        public UserAllocation(String variant, List<String> users) {
            this.variant = Objects.requireNonNull(variant, "variant is required");
            this.users = users != null ? Collections.unmodifiableList(new ArrayList<>(users)) : Collections.emptyList();
        }

        public String getVariant() {
            return variant;
        }

        public List<String> getUsers() {
            return users;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            UserAllocation that = (UserAllocation) o;
            return Objects.equals(variant, that.variant) && Objects.equals(users, that.users);
        }

        @Override
        public int hashCode() {
            return Objects.hash(variant, users);
        }
    }

    /**
     * Assigns a variant to users belonging to specific groups.
     */
    public static final class GroupAllocation {
        private final String variant;
        private final List<String> groups;

        public GroupAllocation(String variant, List<String> groups) {
            this.variant = Objects.requireNonNull(variant, "variant is required");
            this.groups = groups != null ? Collections.unmodifiableList(new ArrayList<>(groups)) : Collections.emptyList();
        }

        public String getVariant() {
            return variant;
        }

        public List<String> getGroups() {
            return groups;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            GroupAllocation that = (GroupAllocation) o;
            return Objects.equals(variant, that.variant) && Objects.equals(groups, that.groups);
        }

        @Override
        public int hashCode() {
            return Objects.hash(variant, groups);
        }
    }

    /**
     * Assigns a variant to users whose computed percentile bucket falls
     * within {@code [from, to)} ({@code to == 100} is inclusive of 100, per
     * MF's {@code TargetingEvaluator}).
     */
    public static final class PercentileAllocation {
        private final String variant;
        private final double from;
        private final double to;

        public PercentileAllocation(String variant, double from, double to) {
            this.variant = Objects.requireNonNull(variant, "variant is required");
            this.from = from;
            this.to = to;
        }

        public String getVariant() {
            return variant;
        }

        /** Start of the percentile range (inclusive, 0-100). */
        public double getFrom() {
            return from;
        }

        /** End of the percentile range (exclusive, unless 100). */
        public double getTo() {
            return to;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            PercentileAllocation that = (PercentileAllocation) o;
            return Double.compare(from, that.from) == 0
                    && Double.compare(to, that.to) == 0
                    && Objects.equals(variant, that.variant);
        }

        @Override
        public int hashCode() {
            return Objects.hash(variant, from, to);
        }
    }
}
