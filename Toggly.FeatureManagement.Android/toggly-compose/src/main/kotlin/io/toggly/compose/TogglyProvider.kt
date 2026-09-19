package io.toggly.compose

import androidx.compose.runtime.*
import io.toggly.core.TogglyService
import io.toggly.core.models.FeatureFlags
import io.toggly.core.models.TogglyConfig
import kotlinx.coroutines.flow.StateFlow

/**
 * CompositionLocal for accessing the TogglyService.
 */
val LocalTogglyService = staticCompositionLocalOf<TogglyService> {
    error("No TogglyService provided. Wrap your app with TogglyProvider.")
}

/**
 * CompositionLocal for accessing the current feature flags.
 */
val LocalFeatureFlags = compositionLocalOf<FeatureFlags> { emptyMap() }

/**
 * Provider composable that sets up Toggly for the composable tree.
 *
 * @param service The TogglyService to provide
 * @param content The composable content
 */
@Composable
fun TogglyProvider(
    service: TogglyService,
    content: @Composable () -> Unit
) {
    // Collected values and every remembered adapter state belong to this owner.
    // Effect keys alone restart collection but retain the previous State value.
    key(service) {
        val featureFlags by service.featureFlags.collectAsState()
        CompositionLocalProvider(
            LocalTogglyService provides service,
            LocalFeatureFlags provides featureFlags,
            content = content
        )
    }
}

/**
 * Provider composable that creates and manages a TogglyService.
 *
 * @param config The Toggly configuration
 * @param onInitialized Callback when the service is initialized
 * @param content The composable content
 */
@Composable
fun TogglyProvider(
    config: TogglyConfig,
    onInitialized: ((TogglyService) -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val service = remember(config) { TogglyService(config) }

    LaunchedEffect(service) {
        service.init()
        onInitialized?.invoke(service)
    }

    DisposableEffect(service) {
        onDispose {
            service.dispose()
        }
    }

    TogglyProvider(service = service, content = content)
}

/**
 * State holder for Toggly in Compose.
 */
@Stable
class TogglyState(
    private val service: TogglyService
) {
    /**
     * Flow of current feature flags.
     */
    val featureFlags: StateFlow<FeatureFlags>
        get() = service.featureFlags

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

    /** Record explicit feature use without evaluating it. */
    fun recordUsage(featureKey: String, variant: String = "enabled") = service.recordUsage(featureKey, variant)
    /** Record an explicit feature view. */
    fun recordView(featureKey: String, variant: String = "enabled") = service.recordView(featureKey, variant)
    /** Increment an app-level counter. */
    fun incrementCounter(metricKey: String, value: Double = 1.0) = service.incrementCounter(metricKey, value)
    /** Set the latest app-level gauge. */
    fun setGauge(metricKey: String, value: Double) = service.setGauge(metricKey, value)
    /** Await the current best-effort telemetry drain. */
    suspend fun flushTelemetry() = service.flushTelemetry()

    /**
     * Set user identity for targeting.
     */
    suspend fun setIdentity(identity: String?) {
        service.setIdentity(identity)
    }

    /**
     * Refresh feature flags from the server.
     */
    suspend fun refresh() {
        service.refresh()
    }

    /**
     * Clear cached feature flags.
     */
    suspend fun clearCache() {
        service.clearCache()
    }
}

/**
 * Remember a TogglyState for the current composition.
 */
@Composable
fun rememberTogglyState(): TogglyState {
    val service = LocalTogglyService.current
    return remember(service) { TogglyState(service) }
}
