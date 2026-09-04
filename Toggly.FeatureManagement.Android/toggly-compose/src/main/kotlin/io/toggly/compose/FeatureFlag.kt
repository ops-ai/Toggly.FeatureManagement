package io.toggly.compose

import androidx.compose.runtime.*
import io.toggly.core.models.FeatureRequirement

/**
 * Remember whether a feature is enabled (optionally negated / entity-scoped).
 *
 * Prefer [Feature] with `negate = true` for the off path instead of a separate Off API.
 *
 * @param featureKey The feature key to check
 * @param negate Whether to invert the result (show when the feature is off)
 * @param context Optional per-evaluation entity context
 * @param contextKind Optional kind for [io.toggly.core.registerContext] mapper lookup
 * @param defaultValue Default value while loading / before first evaluation
 * @return Whether content should show for this feature check
 */
@Composable
fun rememberFeature(
    featureKey: String,
    negate: Boolean = false,
    context: Any? = null,
    contextKind: String? = null,
    defaultValue: Boolean = false
): Boolean {
    return rememberFeatureGate(
        featureKeys = listOf(featureKey),
        requirement = FeatureRequirement.ALL,
        negate = negate,
        context = context,
        contextKind = contextKind,
        defaultValue = defaultValue
    )
}

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
): Boolean = rememberFeature(featureKey = featureKey, defaultValue = defaultValue)

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
 * When [context] is null, evaluates against the boolean snapshot (entity gates → false).
 * When [context] is provided, uses the service's entity-aware evaluation.
 *
 * @param featureKeys The feature keys to evaluate
 * @param requirement Whether all or any features must be enabled
 * @param negate Whether to negate the result
 * @param context Optional per-evaluation entity context
 * @param contextKind Optional kind for registerContext mapper lookup
 * @param defaultValue Default value while loading
 * @return Whether the gate passes
 */
@Composable
fun rememberFeatureGate(
    featureKeys: List<String>,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: Boolean = false,
    context: Any? = null,
    contextKind: String? = null,
    defaultValue: Boolean = false
): Boolean {
    val service = LocalTogglyService.current
    val featureFlags = LocalFeatureFlags.current

    if (context == null && contextKind == null) {
        return remember(featureFlags, featureKeys, requirement, negate) {
            evaluateSnapshotFeatureGate(featureFlags, featureKeys, requirement, negate)
        }
    }

    return produceState(
        initialValue = defaultValue,
        service,
        featureFlags,
        featureKeys,
        requirement,
        negate,
        context,
        contextKind
    ) {
        value = service.evaluateFeatureGate(
            featureKeys,
            requirement,
            negate,
            context,
            contextKind
        )
    }.value
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
 * Composable that renders [content] when a feature check passes.
 *
 * Use `negate = true` for the off path (preferred over [FeatureFlagOff]).
 *
 * @param featureKey The feature key to check
 * @param negate Invert the check (show content when the feature is off)
 * @param context Optional per-evaluation entity context
 * @param contextKind Optional kind for registerContext mapper lookup
 * @param fallback Optional fallback when the check fails
 * @param content Content to show when the check passes
 */
@Composable
fun Feature(
    featureKey: String,
    negate: Boolean = false,
    context: Any? = null,
    contextKind: String? = null,
    fallback: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val shouldShow = rememberFeature(
        featureKey = featureKey,
        negate = negate,
        context = context,
        contextKind = contextKind
    )

    if (shouldShow) {
        content()
    } else {
        fallback?.invoke()
    }
}

/**
 * Composable that only renders content if a feature is enabled.
 *
 * Prefer [Feature]. Kept for source compatibility.
 *
 * @param featureKey The feature key to check
 * @param fallback Optional fallback content when feature is disabled
 * @param content Content to show when feature is enabled
 */
@Deprecated(
    message = "Use Feature(featureKey, ...) instead",
    replaceWith = ReplaceWith(
        "Feature(featureKey = featureKey, fallback = fallback, content = content)",
        "io.toggly.compose.Feature"
    )
)
@Composable
fun FeatureFlag(
    featureKey: String,
    fallback: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    Feature(
        featureKey = featureKey,
        fallback = fallback,
        content = content
    )
}

/**
 * Composable that only renders content if a feature is disabled.
 *
 * Prefer [Feature] with `negate = true`.
 *
 * @param featureKey The feature key to check
 * @param fallback Optional fallback content when feature is enabled
 * @param content Content to show when feature is disabled
 */
@Deprecated(
    message = "Use Feature(featureKey, negate = true) instead",
    replaceWith = ReplaceWith(
        "Feature(featureKey = featureKey, negate = true, fallback = fallback, content = content)",
        "io.toggly.compose.Feature"
    )
)
@Composable
fun FeatureFlagOff(
    featureKey: String,
    fallback: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    Feature(
        featureKey = featureKey,
        negate = true,
        fallback = fallback,
        content = content
    )
}

/**
 * Composable that renders content based on a feature gate evaluation.
 *
 * @param featureKeys The feature keys to evaluate
 * @param requirement Whether all or any features must be enabled
 * @param negate Whether to negate the result
 * @param context Optional per-evaluation entity context
 * @param contextKind Optional kind for registerContext mapper lookup
 * @param fallback Optional fallback content when gate fails
 * @param content Content to show when gate passes
 */
@Composable
fun FeatureGate(
    featureKeys: List<String>,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: Boolean = false,
    context: Any? = null,
    contextKind: String? = null,
    fallback: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val isEnabled = rememberFeatureGate(
        featureKeys = featureKeys,
        requirement = requirement,
        negate = negate,
        context = context,
        contextKind = contextKind
    )

    if (isEnabled) {
        content()
    } else {
        fallback?.invoke()
    }
}

/**
 * Variant-style dual-slot composable (on vs off content in one call).
 *
 * Not the primary off API — prefer two [Feature] calls or [Feature] with `negate = true`
 * for the off path. Kept for dual-slot layouts.
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
    val isEnabled = rememberFeature(featureKey)

    if (isEnabled) {
        enabled()
    } else {
        disabled()
    }
}
