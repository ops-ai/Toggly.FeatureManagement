package io.toggly.compose

import androidx.compose.runtime.*
import io.toggly.core.TogglyService
import io.toggly.core.models.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * Result of the useToggly hook.
 */
@Stable
class UseTogglyResult internal constructor(
    private val service: TogglyService,
    private val _featureFlags: StateFlow<FeatureFlags>
) {
    /**
     * Current feature flags.
     */
    val featureFlags: FeatureFlags
        @Composable get() = _featureFlags.collectAsState().value

    /**
     * Whether the SDK has been initialized.
     */
    val initialized: Boolean
        get() = service.initialized

    /**
     * Current user identity.
     */
    val currentIdentity: String?
        get() = service.currentIdentity

    /**
     * Check if a feature is enabled.
     */
    suspend fun isFeatureOn(featureKey: String): Boolean {
        return service.isFeatureOn(featureKey)
    }

    /**
     * Check if a feature is disabled.
     */
    suspend fun isFeatureOff(featureKey: String): Boolean {
        return service.isFeatureOff(featureKey)
    }

    /**
     * Evaluate a feature gate with multiple feature keys.
     */
    suspend fun evaluateFeatureGate(
        featureKeys: List<String>,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        negate: Boolean = false
    ): Boolean {
        return service.evaluateFeatureGate(featureKeys, requirement, negate)
    }

    /**
     * Flow for observing a specific feature flag.
     */
    fun featureFlagFlow(featureKey: String): Flow<Boolean> {
        return service.featureFlagFlow(featureKey)
    }

    /**
     * Flow for observing a feature gate with multiple keys.
     */
    fun featureGateFlow(
        featureKeys: List<String>,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        negate: Boolean = false
    ): Flow<Boolean> {
        return service.featureGateFlow(featureKeys, requirement, negate)
    }

    /**
     * Set user identity for targeting.
     */
    suspend fun setIdentity(identity: String?): TogglyInitResponse {
        return service.setIdentity(identity)
    }

    /**
     * Refresh feature flags from the server.
     */
    suspend fun refresh(): TogglyInitResponse {
        return service.refresh()
    }

    /**
     * Clear cached feature flags.
     */
    suspend fun clearCache() {
        service.clearCache()
    }

    /**
     * Get debug information about the SDK state.
     */
    fun getDebugInfo(): TogglyDebugInfo {
        return service.getDebugInfo()
    }
}

/**
 * Composable hook that provides access to Toggly functionality.
 *
 * @return UseTogglyResult with Toggly operations and state
 */
@Composable
fun useToggly(): UseTogglyResult {
    val service = LocalTogglyService.current

    return remember(service) {
        UseTogglyResult(service, service.featureFlags)
    }
}

/**
 * Composable hook that provides the TogglyService directly.
 *
 * @return The TogglyService instance
 */
@Composable
fun useTogglyService(): TogglyService {
    return LocalTogglyService.current
}
