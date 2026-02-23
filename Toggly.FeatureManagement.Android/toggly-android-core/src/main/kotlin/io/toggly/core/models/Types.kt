package io.toggly.core.models

import kotlinx.serialization.Serializable
import java.util.Date

/**
 * Type alias for feature flags map.
 */
typealias FeatureFlags = Map<String, Boolean>

/**
 * Requirement type for multiple feature evaluation.
 */
enum class FeatureRequirement {
    /** All features must be enabled */
    ALL,
    /** At least one feature must be enabled */
    ANY
}

/**
 * Load status for feature flags.
 */
enum class TogglyLoadStatus {
    /** Flags were fetched from server */
    FETCHED,
    /** Flags were loaded from cache */
    CACHED,
    /** Using default values */
    DEFAULTS
}

/**
 * Application state type.
 */
enum class AppStateType {
    ACTIVE,
    INACTIVE,
    BACKGROUND
}

/**
 * Network connection state.
 */
data class NetworkState(
    val isConnected: Boolean,
    val connectionType: String? = null
)

/**
 * Configuration for the Toggly SDK.
 */
data class TogglyConfig(
    /** Your Toggly.io application key */
    val appKey: String? = null,
    /** Environment name (e.g., "Production", "Staging") */
    val environment: String = "Production",
    /** Base URI for the Toggly definitions API */
    val baseUri: String = "https://definitions.toggly.io",
    /** User identity for targeting */
    val identity: String? = null,
    /** Default feature flag values */
    val featureDefaults: FeatureFlags = emptyMap(),
    /** Whether to show feature content during initial evaluation */
    val showFeatureDuringEvaluation: Boolean = false,
    /** Automatic refresh interval in milliseconds (0 to disable) */
    val refreshInterval: Long = 180_000L,
    /** Whether to use signed definitions for enhanced security */
    val useSignedDefinitions: Boolean = false,
    /** Whether signatures should be verified on signed responses */
    val verifySignatures: Boolean = false,
    /** Connection timeout in milliseconds */
    val connectTimeout: Long = 10_000L,
    /** Request timeout in milliseconds */
    val requestTimeout: Long = 30_000L,
    /** Custom storage implementation */
    val storage: TogglyStorage? = null
)

/**
 * Response from SDK initialization or refresh.
 */
data class TogglyInitResponse(
    val status: TogglyLoadStatus,
    val flags: FeatureFlags,
    val error: String? = null
)

/**
 * Debug information about the SDK state.
 */
data class TogglyDebugInfo(
    val identity: String?,
    val appKey: String?,
    val environment: String,
    val useSignedDefinitions: Boolean,
    val isAppInForeground: Boolean,
    val refreshInterval: Long,
    val syncServiceRunning: Boolean,
    val lastChecked: Date?,
    val lastSynced: Date?,
    val eTag: String?,
    val lastError: String?,
    val networkState: NetworkState?,
    val appState: AppStateType
)

/**
 * Storage interface for persisting feature flags and device ID.
 */
interface TogglyStorage {
    /** Get a value from storage */
    suspend fun get(key: String): String?

    /** Set a value in storage */
    suspend fun set(key: String, value: String)

    /** Delete a value from storage */
    suspend fun delete(key: String)

    /** Clear all Toggly-related data */
    suspend fun clear()
}

/**
 * Cache data for feature flags.
 */
@Serializable
internal data class TogglyFeatureFlagsCache(
    val identity: String,
    val flags: String
)

/**
 * Signed definitions response from API.
 */
@Serializable
internal data class SignedDefinitionsResponse(
    val defs: Map<String, Boolean>? = null,
    val data: Map<String, Boolean>? = null
)

/**
 * Storage keys used by Toggly.
 */
internal object TogglyStorageKeys {
    const val DEVICE_ID = "@toggly:deviceId"
    const val FEATURE_FLAGS_CACHE = "@toggly:featureFlagsCache:"
    const val ETAG = "@toggly:etag"
    const val JWKS = "@toggly:jwks"
}
