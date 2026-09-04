package io.toggly.compose

import io.toggly.core.models.FeatureFlags
import io.toggly.core.models.FeatureRequirement

/**
 * Snapshot (non-entity) gate evaluation used by [rememberFeatureGate] when no
 * per-call context is supplied.
 *
 * Empty gates pass (return true) regardless of [negate], matching the previous
 * Compose behavior and .NET empty-gate defaults for on-path checks.
 */
internal fun evaluateSnapshotFeatureGate(
    featureFlags: FeatureFlags,
    featureKeys: List<String>,
    requirement: FeatureRequirement,
    negate: Boolean,
): Boolean {
    if (featureKeys.isEmpty()) {
        return true
    }

    val isEnabled = when (requirement) {
        FeatureRequirement.ANY -> featureKeys.any { featureFlags[it] == true }
        FeatureRequirement.ALL -> featureKeys.all { featureFlags[it] == true }
    }

    return if (negate) !isEnabled else isEnabled
}
