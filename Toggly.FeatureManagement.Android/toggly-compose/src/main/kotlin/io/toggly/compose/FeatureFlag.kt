package io.toggly.compose

import androidx.compose.runtime.*
import io.toggly.core.models.FeatureRequirement
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

/**
 * Remember whether a feature flag is enabled.
 *
 * @param featureKey The feature key to check
 * @param defaultValue Default value while loading
 * @return Whether the feature is enabled
 */
@Composable
fun rememberFeatureFlag(
    featureKey: String,
    defaultValue: Boolean = false
): Boolean {
    val service = LocalTogglyService.current
    val featureFlags = LocalFeatureFlags.current

    return remember(featureFlags, featureKey) {
        featureFlags[featureKey] ?: defaultValue
    }
}

/**
 * Remember whether a feature flag is enabled, returning a State.
 *
 * @param featureKey The feature key to check
 * @param defaultValue Default value while loading
 * @return State containing whether the feature is enabled
 */
@Composable
fun rememberFeatureFlagAsState(
    featureKey: String,
    defaultValue: Boolean = false
): State<Boolean> {
    val service = LocalTogglyService.current

    return service.featureFlagFlow(featureKey)
        .collectAsState(initial = defaultValue)
}

/**
 * Remember the result of a feature gate evaluation.
 *
 * @param featureKeys The feature keys to evaluate
 * @param requirement Whether all or any features must be enabled
 * @param negate Whether to negate the result
 * @param defaultValue Default value while loading
 * @return Whether the gate passes
 */
@Composable
fun rememberFeatureGate(
    featureKeys: List<String>,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: Boolean = false,
    defaultValue: Boolean = false
): Boolean {
    val featureFlags = LocalFeatureFlags.current

    return remember(featureFlags, featureKeys, requirement, negate) {
        if (featureKeys.isEmpty()) return@remember true

        val isEnabled = when (requirement) {
            FeatureRequirement.ANY -> featureKeys.any { featureFlags[it] == true }
            FeatureRequirement.ALL -> featureKeys.all { featureFlags[it] == true }
        }

        if (negate) !isEnabled else isEnabled
    }
}

/**
 * Remember the result of a feature gate evaluation as State.
 *
 * @param featureKeys The feature keys to evaluate
 * @param requirement Whether all or any features must be enabled
 * @param negate Whether to negate the result
 * @param defaultValue Default value while loading
 * @return State containing whether the gate passes
 */
@Composable
fun rememberFeatureGateAsState(
    featureKeys: List<String>,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: Boolean = false,
    defaultValue: Boolean = false
): State<Boolean> {
    val service = LocalTogglyService.current

    return service.featureGateFlow(featureKeys, requirement, negate)
        .collectAsState(initial = defaultValue)
}

/**
 * Composable that only renders content if a feature is enabled.
 *
 * @param featureKey The feature key to check
 * @param fallback Optional fallback content when feature is disabled
 * @param content Content to show when feature is enabled
 */
@Composable
fun FeatureFlag(
    featureKey: String,
    fallback: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val isEnabled = rememberFeatureFlag(featureKey)

    if (isEnabled) {
        content()
    } else {
        fallback?.invoke()
    }
}

/**
 * Composable that only renders content if a feature is disabled.
 *
 * @param featureKey The feature key to check
 * @param fallback Optional fallback content when feature is enabled
 * @param content Content to show when feature is disabled
 */
@Composable
fun FeatureFlagOff(
    featureKey: String,
    fallback: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val isEnabled = rememberFeatureFlag(featureKey)

    if (!isEnabled) {
        content()
    } else {
        fallback?.invoke()
    }
}

/**
 * Composable that renders content based on a feature gate evaluation.
 *
 * @param featureKeys The feature keys to evaluate
 * @param requirement Whether all or any features must be enabled
 * @param negate Whether to negate the result
 * @param fallback Optional fallback content when gate fails
 * @param content Content to show when gate passes
 */
@Composable
fun FeatureGate(
    featureKeys: List<String>,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: Boolean = false,
    fallback: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val isEnabled = rememberFeatureGate(featureKeys, requirement, negate)

    if (isEnabled) {
        content()
    } else {
        fallback?.invoke()
    }
}

/**
 * Composable that chooses between two content variants based on a feature flag.
 *
 * @param featureKey The feature key to check
 * @param enabled Content to show when feature is enabled
 * @param disabled Content to show when feature is disabled
 */
@Composable
fun FeatureSwitch(
    featureKey: String,
    enabled: @Composable () -> Unit,
    disabled: @Composable () -> Unit
) {
    val isEnabled = rememberFeatureFlag(featureKey)

    if (isEnabled) {
        enabled()
    } else {
        disabled()
    }
}
