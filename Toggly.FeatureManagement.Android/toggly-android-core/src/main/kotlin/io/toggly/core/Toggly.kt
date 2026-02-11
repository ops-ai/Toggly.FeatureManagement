package io.toggly.core

import io.toggly.core.models.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Global singleton instance of Toggly.
 * Use this for simple access throughout your application.
 *
 * Example:
 * ```kotlin
 * // Configure once at app startup
 * Toggly.configure(TogglyConfig(
 *     appKey = "your-app-key",
 *     environment = "Production"
 * ))
 *
 * // Initialize
 * lifecycleScope.launch {
 *     Toggly.init()
 * }
 *
 * // Use anywhere
 * if (Toggly.isFeatureOn("my-feature")) {
 *     // Feature is enabled
 * }
 * ```
 */
object Toggly {
    private var service: TogglyService? = null
    private var config: TogglyConfig? = null

    /**
     * The shared Toggly service instance.
     * @throws IllegalStateException if not configured
     */
    val shared: TogglyService
        get() = service ?: throw IllegalStateException(
            "Toggly has not been configured. Call Toggly.configure() first."
        )

    /**
     * Flow of all Toggly events.
     */
    val events: SharedFlow<TogglyEvent>
        get() = shared.events

    /**
     * Flow of current feature flags.
     */
    val featureFlags: StateFlow<FeatureFlags>
        get() = shared.featureFlags

    /**
     * Whether the SDK has been initialized.
     */
    val initialized: Boolean
        get() = service?.initialized == true

    /**
     * Current user identity.
     */
    val currentIdentity: String?
        get() = service?.currentIdentity

    /**
     * Current feature flags (may be null if not loaded).
     */
    val currentFeatures: FeatureFlags?
        get() = service?.currentFeatures

    /**
     * Configure the global Toggly instance.
     * Must be called before any other Toggly operations.
     *
     * @param config The Toggly configuration
     */
    fun configure(config: TogglyConfig) {
        this.config = config
        this.service = TogglyService(config)
    }

    /**
     * Initialize Toggly and load feature flags.
     *
     * @return The initialization response
     */
    suspend fun init(): TogglyInitResponse {
        return shared.init()
    }

    /**
     * Refresh feature flags from the server or cache.
     *
     * @return The refresh response
     */
    suspend fun refresh(): TogglyInitResponse {
        return shared.refresh()
    }

    /**
     * Check if a feature is enabled.
     *
     * @param featureKey The feature key to check
     * @return Whether the feature is enabled
     */
    suspend fun isFeatureOn(featureKey: String): Boolean {
        return shared.isFeatureOn(featureKey)
    }

    /**
     * Check if a feature is disabled.
     *
     * @param featureKey The feature key to check
     * @return Whether the feature is disabled
     */
    suspend fun isFeatureOff(featureKey: String): Boolean {
        return shared.isFeatureOff(featureKey)
    }

    /**
     * Evaluate a feature gate with multiple feature keys.
     *
     * @param featureKeys The feature keys to evaluate
     * @param requirement Whether all or any features must be enabled
     * @param negate Whether to negate the result
     * @return The evaluation result
     */
    suspend fun evaluateFeatureGate(
        featureKeys: List<String>,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        negate: Boolean = false
    ): Boolean {
        return shared.evaluateFeatureGate(featureKeys, requirement, negate)
    }

    /**
     * Flow for observing a specific feature flag.
     *
     * @param featureKey The feature key to observe
     * @return Flow emitting the feature flag state
     */
    fun featureFlagFlow(featureKey: String): Flow<Boolean> {
        return shared.featureFlagFlow(featureKey)
    }

    /**
     * Flow for observing a feature gate with multiple keys.
     *
     * @param featureKeys The feature keys to evaluate
     * @param requirement Whether all or any features must be enabled
     * @param negate Whether to negate the result
     * @return Flow emitting the gate evaluation result
     */
    fun featureGateFlow(
        featureKeys: List<String>,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        negate: Boolean = false
    ): Flow<Boolean> {
        return shared.featureGateFlow(featureKeys, requirement, negate)
    }

    /**
     * Set user identity for targeting.
     *
     * @param identity The new identity, or null to use device ID
     * @return The refresh response after identity change
     */
    suspend fun setIdentity(identity: String?): TogglyInitResponse {
        return shared.setIdentity(identity)
    }

    /**
     * Clear cached feature flags.
     */
    suspend fun clearCache() {
        shared.clearCache()
    }

    /**
     * Add a feature state change handler.
     *
     * @param handler The handler to add
     * @return A function to remove the handler
     */
    fun addStateChangeHandler(handler: FeatureStateChangeHandler): () -> Unit {
        return shared.addStateChangeHandler(handler)
    }

    /**
     * Update the app state (call when app moves to foreground/background).
     *
     * @param state The new app state
     */
    suspend fun setAppState(state: AppStateType) {
        shared.setAppState(state)
    }

    /**
     * Update the network state.
     *
     * @param state The new network state
     */
    suspend fun setNetworkState(state: NetworkState) {
        shared.setNetworkState(state)
    }

    /**
     * Get debug information about the SDK state.
     *
     * @return Debug information
     */
    fun getDebugInfo(): TogglyDebugInfo {
        return shared.getDebugInfo()
    }

    /**
     * Dispose and reset the global instance.
     */
    fun reset() {
        service?.dispose()
        service = null
        config = null
    }
}
