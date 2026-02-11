package io.toggly.views

import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import androidx.lifecycle.asLiveData
import androidx.lifecycle.viewModelScope
import io.toggly.core.Toggly
import io.toggly.core.TogglyService
import io.toggly.core.models.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * ViewModel for managing Toggly feature flags.
 * Provides LiveData and Flow-based access to feature flags.
 */
open class FeatureFlagViewModel(
    private val service: TogglyService = Toggly.shared
) : ViewModel() {

    private val _isInitialized = MutableLiveData(false)

    /**
     * LiveData indicating if the SDK is initialized.
     */
    val isInitialized: LiveData<Boolean> = _isInitialized

    /**
     * Flow of current feature flags.
     */
    val featureFlags: StateFlow<FeatureFlags>
        get() = service.featureFlags

    /**
     * LiveData of current feature flags.
     */
    val featureFlagsLiveData: LiveData<FeatureFlags>
        get() = service.featureFlags.asLiveData()

    /**
     * Current user identity.
     */
    val currentIdentity: String?
        get() = service.currentIdentity

    init {
        viewModelScope.launch {
            // Collect events to track initialization
            service.events.collect { event ->
                if (event is TogglyEvent.Initialized) {
                    _isInitialized.value = true
                }
            }
        }
    }

    /**
     * Initialize the SDK.
     */
    fun initialize() {
        viewModelScope.launch {
            service.init()
        }
    }

    /**
     * Refresh feature flags from the server.
     */
    fun refresh() {
        viewModelScope.launch {
            service.refresh()
        }
    }

    /**
     * Get LiveData for a specific feature flag.
     *
     * @param featureKey The feature key to observe
     * @param defaultValue Default value while loading
     * @return LiveData emitting the feature flag state
     */
    fun featureFlagLiveData(
        featureKey: String,
        defaultValue: Boolean = false
    ): LiveData<Boolean> {
        return service.featureFlagFlow(featureKey).asLiveData()
    }

    /**
     * Get Flow for a specific feature flag.
     *
     * @param featureKey The feature key to observe
     * @return Flow emitting the feature flag state
     */
    fun featureFlagFlow(featureKey: String): Flow<Boolean> {
        return service.featureFlagFlow(featureKey)
    }

    /**
     * Get LiveData for a feature gate.
     *
     * @param featureKeys The feature keys to evaluate
     * @param requirement Whether all or any features must be enabled
     * @param negate Whether to negate the result
     * @return LiveData emitting the gate evaluation result
     */
    fun featureGateLiveData(
        featureKeys: List<String>,
        requirement: FeatureRequirement = FeatureRequirement.ALL,
        negate: Boolean = false
    ): LiveData<Boolean> {
        return service.featureGateFlow(featureKeys, requirement, negate).asLiveData()
    }

    /**
     * Get Flow for a feature gate.
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
        return service.featureGateFlow(featureKeys, requirement, negate)
    }

    /**
     * Check if a feature is enabled (suspend function).
     *
     * @param featureKey The feature key to check
     * @return Whether the feature is enabled
     */
    suspend fun isFeatureOn(featureKey: String): Boolean {
        return service.isFeatureOn(featureKey)
    }

    /**
     * Check if a feature is disabled (suspend function).
     *
     * @param featureKey The feature key to check
     * @return Whether the feature is disabled
     */
    suspend fun isFeatureOff(featureKey: String): Boolean {
        return service.isFeatureOff(featureKey)
    }

    /**
     * Set user identity for targeting.
     *
     * @param identity The new identity, or null to use device ID
     */
    fun setIdentity(identity: String?) {
        viewModelScope.launch {
            service.setIdentity(identity)
        }
    }

    /**
     * Clear cached feature flags.
     */
    fun clearCache() {
        viewModelScope.launch {
            service.clearCache()
        }
    }

    /**
     * Get debug information about the SDK state.
     *
     * @return Debug information
     */
    fun getDebugInfo(): TogglyDebugInfo {
        return service.getDebugInfo()
    }
}
