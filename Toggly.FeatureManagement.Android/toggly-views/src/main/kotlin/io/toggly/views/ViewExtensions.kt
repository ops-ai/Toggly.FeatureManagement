package io.toggly.views

import android.view.View
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import io.toggly.core.Toggly
import io.toggly.core.TogglyService
import io.toggly.core.models.FeatureRequirement
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * Bind a View's visibility to a feature flag.
 *
 * @param featureKey The feature key to check
 * @param service The TogglyService to use (defaults to global Toggly)
 * @param visibleWhenEnabled Visibility when feature is enabled (default: VISIBLE)
 * @param visibleWhenDisabled Visibility when feature is disabled (default: GONE)
 * @return Job for cancellation
 */
fun View.bindToFeatureFlag(
    featureKey: String,
    lifecycleOwner: LifecycleOwner,
    service: TogglyService = Toggly.shared,
    visibleWhenEnabled: Int = View.VISIBLE,
    visibleWhenDisabled: Int = View.GONE
): Job {
    return service.featureFlagFlow(featureKey)
        .onEach { isEnabled ->
            visibility = if (isEnabled) visibleWhenEnabled else visibleWhenDisabled
        }
        .launchIn(lifecycleOwner.lifecycleScope)
}

/**
 * Bind a View's enabled state to a feature flag.
 *
 * @param featureKey The feature key to check
 * @param service The TogglyService to use (defaults to global Toggly)
 * @return Job for cancellation
 */
fun View.bindEnabledToFeatureFlag(
    featureKey: String,
    lifecycleOwner: LifecycleOwner,
    service: TogglyService = Toggly.shared
): Job {
    return service.featureFlagFlow(featureKey)
        .onEach { isFeatureEnabled ->
            isEnabled = isFeatureEnabled
        }
        .launchIn(lifecycleOwner.lifecycleScope)
}

/**
 * Bind a View's alpha to a feature flag (disabled appears faded).
 *
 * @param featureKey The feature key to check
 * @param service The TogglyService to use (defaults to global Toggly)
 * @param enabledAlpha Alpha when enabled (default: 1.0)
 * @param disabledAlpha Alpha when disabled (default: 0.5)
 * @return Job for cancellation
 */
fun View.bindAlphaToFeatureFlag(
    featureKey: String,
    lifecycleOwner: LifecycleOwner,
    service: TogglyService = Toggly.shared,
    enabledAlpha: Float = 1.0f,
    disabledAlpha: Float = 0.5f
): Job {
    return service.featureFlagFlow(featureKey)
        .onEach { isEnabled ->
            alpha = if (isEnabled) enabledAlpha else disabledAlpha
        }
        .launchIn(lifecycleOwner.lifecycleScope)
}

/**
 * Bind a View's visibility to a feature gate.
 *
 * Prefer `negate = true` for the off path instead of [showWhenFeatureDisabled]:
 * ```
 * view.bindToFeatureGate(listOf("new-checkout"), this, negate = true)
 * ```
 *
 * @param featureKeys The feature keys to evaluate
 * @param requirement Whether all or any features must be enabled
 * @param negate Whether to negate the result (show when the gate fails)
 * @param service The TogglyService to use (defaults to global Toggly)
 * @param visibleWhenEnabled Visibility when gate passes (default: VISIBLE)
 * @param visibleWhenDisabled Visibility when gate fails (default: GONE)
 * @return Job for cancellation
 */
fun View.bindToFeatureGate(
    featureKeys: List<String>,
    lifecycleOwner: LifecycleOwner,
    requirement: FeatureRequirement = FeatureRequirement.ALL,
    negate: Boolean = false,
    service: TogglyService = Toggly.shared,
    visibleWhenEnabled: Int = View.VISIBLE,
    visibleWhenDisabled: Int = View.GONE
): Job {
    return service.featureGateFlow(featureKeys, requirement, negate)
        .onEach { isEnabled ->
            visibility = if (isEnabled) visibleWhenEnabled else visibleWhenDisabled
        }
        .launchIn(lifecycleOwner.lifecycleScope)
}

/**
 * Show a View only when a feature is enabled.
 *
 * Equivalent to [bindToFeatureGate] with a single key.
 */
fun View.showWhenFeatureEnabled(
    featureKey: String,
    lifecycleOwner: LifecycleOwner,
    service: TogglyService = Toggly.shared
): Job = bindToFeatureGate(
    featureKeys = listOf(featureKey),
    lifecycleOwner = lifecycleOwner,
    service = service
)

/**
 * Show a View only when a feature is disabled.
 *
 * Prefer [bindToFeatureGate] with `negate = true` as the primary off-path API.
 * This helper remains for convenience.
 */
fun View.showWhenFeatureDisabled(
    featureKey: String,
    lifecycleOwner: LifecycleOwner,
    service: TogglyService = Toggly.shared
): Job = bindToFeatureGate(
    featureKeys = listOf(featureKey),
    lifecycleOwner = lifecycleOwner,
    negate = true,
    service = service
)

/**
 * Toggle between two views based on a feature flag.
 *
 * @param featureKey The feature key to check
 * @param enabledView View to show when feature is enabled
 * @param disabledView View to show when feature is disabled
 * @return Job for cancellation
 */
fun toggleViews(
    featureKey: String,
    lifecycleOwner: LifecycleOwner,
    enabledView: View,
    disabledView: View,
    service: TogglyService = Toggly.shared
): Job {
    return service.featureFlagFlow(featureKey)
        .onEach { isEnabled ->
            enabledView.visibility = if (isEnabled) View.VISIBLE else View.GONE
            disabledView.visibility = if (isEnabled) View.GONE else View.VISIBLE
        }
        .launchIn(lifecycleOwner.lifecycleScope)
}
