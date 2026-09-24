package io.toggly.core.eval;

import io.toggly.core.context.EvaluationContext;
import io.toggly.core.model.FeatureDefinition;
import io.toggly.core.model.VariantAllocation;
import io.toggly.core.model.VariantDefinition;
import io.toggly.core.model.VariantStatusOverride;

import java.util.List;
import java.util.Set;

/**
 * Catalog-local, MF-parity variant allocator.
 *
 * <p>Matches {@code Microsoft.FeatureManagement}'s {@code IVariantFeatureManager}
 * assignment pipeline bit-for-bit (see
 * {@code variant-allocator-corpus/README.md} for the gold corpus this
 * algorithm is verified against):</p>
 *
 * <ol>
 *   <li>If the feature has no {@link VariantDefinition}s at all, the pipeline
 *       never runs: reason stays {@link VariantAssignmentReason#NONE}, no
 *       variant assigned.</li>
 *   <li>If the feature is <strong>disabled</strong>, only
 *       {@code Allocation.defaultWhenDisabled} may be assigned (reason
 *       {@link VariantAssignmentReason#DEFAULT_WHEN_DISABLED}); user/group/
 *       percentile allocations never run.</li>
 *   <li>If the feature is <strong>enabled</strong>, allocations are tried in
 *       order — user, then group, then percentile — and the first match
 *       wins; if none match, {@code Allocation.defaultWhenEnabled} is
 *       assigned (reason {@link VariantAssignmentReason#DEFAULT_WHEN_ENABLED}).</li>
 *   <li>After a name is resolved, if the matching {@link VariantDefinition}
 *       has a {@link VariantStatusOverride} other than {@code NONE}, that
 *       overrides the effective enabled state carried on
 *       {@link VariantAssignment#isEnabled()} — independent of whether a
 *       variant is returned. A variant can be assigned even when the
 *       override flips the feature to appear disabled (and vice versa).</li>
 * </ol>
 */
public final class VariantAllocator {

    private VariantAllocator() {}

    /**
     * Assigns a variant for a feature, using case-sensitive user/group
     * matching (MF's default, {@code TargetingEvaluationOptions.IgnoreCase == false}).
     *
     * @param definition the feature definition (variants + allocation)
     * @param enabled the feature's filter-based enabled state (before any
     *     variant {@code StatusOverride})
     * @param context the evaluation context (identity + groups)
     * @return the variant assignment
     */
    public static VariantAssignment assign(FeatureDefinition definition, boolean enabled, EvaluationContext context) {
        return assign(definition, enabled, context, false);
    }

    /**
     * Assigns a variant for a feature.
     *
     * @param definition the feature definition (variants + allocation)
     * @param enabled the feature's filter-based enabled state (before any
     *     variant {@code StatusOverride})
     * @param context the evaluation context (identity + groups)
     * @param ignoreCase whether user/group targeting and percentile hashing
     *     should be case-insensitive ({@code TargetingEvaluationOptions.IgnoreCase});
     *     MF's default is {@code false}
     * @return the variant assignment
     */
    public static VariantAssignment assign(
            FeatureDefinition definition, boolean enabled, EvaluationContext context, boolean ignoreCase) {
        if (definition == null || definition.getVariants() == null || definition.getVariants().isEmpty()) {
            return VariantAssignment.none(enabled, VariantAssignmentReason.NONE);
        }

        VariantAllocation allocation = definition.getAllocation();
        String assignedName;
        VariantAssignmentReason reason;

        if (!enabled) {
            reason = VariantAssignmentReason.DEFAULT_WHEN_DISABLED;
            assignedName = allocation != null ? allocation.getDefaultWhenDisabled() : null;
        } else {
            String userMatch = allocation != null ? matchUser(allocation.getUserAllocations(), context, ignoreCase) : null;
            if (userMatch != null) {
                assignedName = userMatch;
                reason = VariantAssignmentReason.USER;
            } else {
                String groupMatch = allocation != null ? matchGroup(allocation.getGroupAllocations(), context, ignoreCase) : null;
                if (groupMatch != null) {
                    assignedName = groupMatch;
                    reason = VariantAssignmentReason.GROUP;
                } else {
                    String percentileMatch = allocation != null
                            ? matchPercentile(allocation, definition.getFeatureKey(), context, ignoreCase)
                            : null;
                    if (percentileMatch != null) {
                        assignedName = percentileMatch;
                        reason = VariantAssignmentReason.PERCENTILE;
                    } else {
                        assignedName = allocation != null ? allocation.getDefaultWhenEnabled() : null;
                        reason = VariantAssignmentReason.DEFAULT_WHEN_ENABLED;
                    }
                }
            }
        }

        VariantDefinition variantDefinition = findVariant(definition.getVariants(), assignedName);
        // Defensive: a name that doesn't resolve to a configured variant is not assigned.
        if (assignedName != null && variantDefinition == null) {
            assignedName = null;
        }

        boolean effectiveEnabled = enabled;
        if (variantDefinition != null && variantDefinition.getStatusOverride() != VariantStatusOverride.NONE) {
            effectiveEnabled = variantDefinition.getStatusOverride() == VariantStatusOverride.ENABLED;
        }

        return new VariantAssignment(assignedName, variantDefinition, effectiveEnabled, reason);
    }

    private static VariantDefinition findVariant(List<VariantDefinition> variants, String name) {
        if (name == null) {
            return null;
        }
        for (VariantDefinition variant : variants) {
            if (name.equals(variant.getName())) {
                return variant;
            }
        }
        return null;
    }

    private static String matchUser(
            List<VariantAllocation.UserAllocation> userAllocations, EvaluationContext context, boolean ignoreCase) {
        if (userAllocations == null || userAllocations.isEmpty()) {
            return null;
        }
        String identity = context != null ? context.getIdentity() : null;
        if (identity == null) {
            return null;
        }
        for (VariantAllocation.UserAllocation allocation : userAllocations) {
            for (String user : allocation.getUsers()) {
                if (equalsWithCase(identity, user, ignoreCase)) {
                    return allocation.getVariant();
                }
            }
        }
        return null;
    }

    private static String matchGroup(
            List<VariantAllocation.GroupAllocation> groupAllocations, EvaluationContext context, boolean ignoreCase) {
        if (groupAllocations == null || groupAllocations.isEmpty()) {
            return null;
        }
        Set<String> contextGroups = context != null ? context.getGroups() : null;
        if (contextGroups == null || contextGroups.isEmpty()) {
            return null;
        }
        for (VariantAllocation.GroupAllocation allocation : groupAllocations) {
            for (String group : allocation.getGroups()) {
                for (String contextGroup : contextGroups) {
                    if (equalsWithCase(contextGroup, group, ignoreCase)) {
                        return allocation.getVariant();
                    }
                }
            }
        }
        return null;
    }

    private static String matchPercentile(
            VariantAllocation allocation, String featureKey, EvaluationContext context, boolean ignoreCase) {
        List<VariantAllocation.PercentileAllocation> percentileAllocations = allocation.getPercentileAllocations();
        if (percentileAllocations == null || percentileAllocations.isEmpty()) {
            return null;
        }
        String userId = context != null ? context.getIdentity() : null;
        String hint = allocation.getSeed() != null ? allocation.getSeed() : "allocation\n" + featureKey;
        double contextPercentage = VariantPercentileHasher.computeContextPercentage(userId, hint, ignoreCase);

        for (VariantAllocation.PercentileAllocation range : percentileAllocations) {
            double from = range.getFrom();
            double to = range.getTo();
            boolean matches = to >= 100.0
                    ? contextPercentage >= from
                    : contextPercentage >= from && contextPercentage < to;
            if (matches) {
                return range.getVariant();
            }
        }
        return null;
    }

    private static boolean equalsWithCase(String a, String b, boolean ignoreCase) {
        if (a == null || b == null) {
            return false;
        }
        return ignoreCase ? a.equalsIgnoreCase(b) : a.equals(b);
    }
}
