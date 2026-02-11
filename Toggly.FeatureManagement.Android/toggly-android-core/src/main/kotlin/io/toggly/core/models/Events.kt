package io.toggly.core.models

/**
 * Event types emitted by the Toggly SDK.
 */
sealed class TogglyEvent {
    /** SDK has been initialized */
    data class Initialized(val response: TogglyInitResponse) : TogglyEvent()

    /** Feature flags have been refreshed */
    data class Refreshed(val flags: FeatureFlags) : TogglyEvent()

    /** An error occurred */
    data class Error(val message: String, val cause: Throwable? = null) : TogglyEvent()

    /** User identity has changed */
    data class IdentityChanged(
        val previousIdentity: String?,
        val newIdentity: String
    ) : TogglyEvent()

    /** A specific feature flag has changed */
    data class FeatureChanged(
        val featureKey: String,
        val previousValue: Boolean?,
        val newValue: Boolean?
    ) : TogglyEvent()

    /** Network state has changed */
    data class NetworkChanged(val state: NetworkState) : TogglyEvent()

    /** App state has changed */
    data class AppStateChanged(val state: AppStateType) : TogglyEvent()
}

/**
 * Listener for Toggly events.
 */
typealias TogglyEventListener = (TogglyEvent) -> Unit

/**
 * Handler for feature state changes.
 */
typealias FeatureStateChangeHandler = (featureKey: String, previousValue: Boolean?, newValue: Boolean?) -> Unit
