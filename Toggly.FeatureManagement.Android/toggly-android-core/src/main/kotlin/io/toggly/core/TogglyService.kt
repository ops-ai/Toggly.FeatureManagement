package io.toggly.core

import io.toggly.core.models.*
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.security.MessageDigest
import java.util.*
import java.util.concurrent.TimeUnit

/**
 * Core Toggly service for feature flag management.
 * Thread-safe service that handles feature flag evaluation, caching, and lifecycle management.
 *
 * @param config Configuration for the service
 */
class TogglyService(
    private val config: TogglyConfig = TogglyConfig()
) {
    private val storage: TogglyStorage = config.storage ?: MemoryStorage()
    private val mutex = Mutex()

    // State
    private var features: FeatureFlags? = null
    private var featuresLoading = false
    private var identity: String? = null
    private var refreshJob: Job? = null
    private var lastChecked: Date? = null
    private var lastSynced: Date? = null
    private var lastError: String? = null
    private var eTag: String? = null
    private var isInitialized = false
    private var networkState: NetworkState? = null
    private var appState: AppStateType = AppStateType.ACTIVE

    // WebSocket state
    private var webSocket: WebSocket? = null
    private var wsConnected = false
    private var lastFallbackRefresh = 0L

    // Event handling
    private val _events = MutableSharedFlow<TogglyEvent>(replay = 0, extraBufferCapacity = 64)
    private val stateChangeHandlers = mutableSetOf<FeatureStateChangeHandler>()

    // Feature flags as Flow
    private val _featureFlags = MutableStateFlow<FeatureFlags>(emptyMap())

    // HTTP client
    private val httpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(config.connectTimeout, TimeUnit.MILLISECONDS)
            .readTimeout(config.requestTimeout, TimeUnit.MILLISECONDS)
            .writeTimeout(config.requestTimeout, TimeUnit.MILLISECONDS)
            .addInterceptor { chain ->
                chain.proceed(
                    chain.request().newBuilder()
                        .header("User-Agent", SdkIdentity.userAgent())
                        .build()
                )
            }
            .build()
    }

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }

    /**
     * Flow of all Toggly events.
     */
    val events: SharedFlow<TogglyEvent> = _events.asSharedFlow()

    /**
     * Flow of current feature flags.
     */
    val featureFlags: StateFlow<FeatureFlags> = _featureFlags.asStateFlow()

    /**
     * Whether to show feature content during initial evaluation.
     */
    val shouldShowFeatureDuringEvaluation: Boolean
        get() = config.showFeatureDuringEvaluation

    /**
     * Whether the SDK has been initialized.
     */
    val initialized: Boolean
        get() = isInitialized

    /**
     * Current user identity.
     */
    val currentIdentity: String?
        get() = identity

    /**
     * Current feature flags (may be null if not loaded).
     */
    val currentFeatures: FeatureFlags?
        get() = features

    /**
     * Initialize Toggly and load feature flags.
     *
     * @return The initialization response
     */
    suspend fun init(): TogglyInitResponse = mutex.withLock {
        // Handle identity
        identity = config.identity ?: run {
            var storedId = storage.get(TogglyStorageKeys.DEVICE_ID)
            if (storedId == null) {
                storedId = UUID.randomUUID().toString()
                storage.set(TogglyStorageKeys.DEVICE_ID, storedId)
            }
            storedId
        }

        // Start refresh timer
        startRefreshTimer()

        // Perform initial refresh
        val response = refreshInternal()

        isInitialized = true
        emitEvent(TogglyEvent.Initialized(response))

        // Start WebSocket for live updates after successful initialization
        if (config.enableLiveUpdates) {
            startWebSocket()
        }

        response
    }

    /**
     * Refresh feature flags from the server or cache.
     *
     * @return The refresh response
     */
    suspend fun refresh(): TogglyInitResponse = mutex.withLock {
        refreshInternal()
    }

    private suspend fun refreshInternal(): TogglyInitResponse {
        // Skip refresh if app is not in foreground
        if (appState != AppStateType.ACTIVE) {
            return TogglyInitResponse(
                status = TogglyLoadStatus.CACHED,
                flags = features ?: config.featureDefaults
            )
        }

        // Skip refresh if offline
        if (networkState?.isConnected == false) {
            val cachedFlags = getCachedFeatureFlags()
            return TogglyInitResponse(status = TogglyLoadStatus.CACHED, flags = cachedFlags)
        }

        // If no app key, use defaults
        if (config.appKey == null) {
            features = config.featureDefaults
            _featureFlags.value = config.featureDefaults
            return TogglyInitResponse(status = TogglyLoadStatus.DEFAULTS, flags = features!!)
        }

        // Fetch from server
        return fetchFeatureFlags()
    }

    /**
     * Check if a feature is enabled.
     *
     * @param featureKey The feature key to check
     * @return Whether the feature is enabled
     */
    suspend fun isFeatureOn(featureKey: String): Boolean {
        return evaluateFeatureGate(listOf(featureKey), FeatureRequirement.ALL, false)
    }

    /**
     * Check if a feature is disabled.
     *
     * @param featureKey The feature key to check
     * @return Whether the feature is disabled
     */
    suspend fun isFeatureOff(featureKey: String): Boolean {
        return evaluateFeatureGate(listOf(featureKey), FeatureRequirement.ALL, true)
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
        ensureFeaturesLoaded()

        if (featureKeys.isEmpty()) {
            return true
        }

        val flags = features ?: config.featureDefaults

        // Fast path for single feature
        if (featureKeys.size == 1) {
            val isEnabled = flags[featureKeys[0]] == true
            return if (negate) !isEnabled else isEnabled
        }

        val isEnabled = when (requirement) {
            FeatureRequirement.ANY -> featureKeys.any { flags[it] == true }
            FeatureRequirement.ALL -> featureKeys.all { flags[it] == true }
        }

        return if (negate) !isEnabled else isEnabled
    }

    /**
     * Flow for observing a specific feature flag.
     *
     * @param featureKey The feature key to observe
     * @return Flow emitting the feature flag state
     */
    fun featureFlagFlow(featureKey: String): Flow<Boolean> {
        return featureFlags.map { flags ->
            flags[featureKey] ?: config.featureDefaults[featureKey] ?: false
        }.distinctUntilChanged()
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
        return featureFlags.map { flags ->
            if (featureKeys.isEmpty()) return@map true

            val defaults = config.featureDefaults
            val mergedFlags = defaults + flags

            val isEnabled = when (requirement) {
                FeatureRequirement.ANY -> featureKeys.any { mergedFlags[it] == true }
                FeatureRequirement.ALL -> featureKeys.all { mergedFlags[it] == true }
            }

            if (negate) !isEnabled else isEnabled
        }.distinctUntilChanged()
    }

    /**
     * Set user identity for targeting.
     *
     * @param identity The new identity, or null to use device ID
     * @return The refresh response after identity change
     */
    suspend fun setIdentity(identity: String?): TogglyInitResponse = mutex.withLock {
        val previousIdentity = this.identity

        this.identity = identity ?: run {
            var deviceId = storage.get(TogglyStorageKeys.DEVICE_ID)
            if (deviceId == null) {
                deviceId = UUID.randomUUID().toString()
                storage.set(TogglyStorageKeys.DEVICE_ID, deviceId)
            }
            deviceId
        }

        // Clear cache if identity changed
        if (previousIdentity != this.identity) {
            clearCacheInternal()
        }

        // Emit event
        emitEvent(TogglyEvent.IdentityChanged(previousIdentity, this.identity!!))

        refreshInternal()
    }

    /**
     * Clear cached feature flags.
     */
    suspend fun clearCache() = mutex.withLock {
        clearCacheInternal()
    }

    private suspend fun clearCacheInternal() {
        features = null
        eTag = null

        val hashedIdentity = hashIdentity(identity ?: "")
        val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashedIdentity
        storage.delete(cacheKey)
        storage.delete(TogglyStorageKeys.ETAG)
    }

    /**
     * Add a feature state change handler.
     *
     * @param handler The handler to add
     * @return A function to remove the handler
     */
    fun addStateChangeHandler(handler: FeatureStateChangeHandler): () -> Unit {
        stateChangeHandlers.add(handler)
        return { stateChangeHandlers.remove(handler) }
    }

    /**
     * Update the app state (call when app moves to foreground/background).
     *
     * @param state The new app state
     */
    suspend fun setAppState(state: AppStateType) = mutex.withLock {
        val wasBackground = appState == AppStateType.BACKGROUND
        appState = state
        emitEvent(TogglyEvent.AppStateChanged(state))

        // Refresh when coming to foreground
        if (wasBackground && state == AppStateType.ACTIVE) {
            refreshInternal()
        }
    }

    /**
     * Update the network state.
     *
     * @param state The new network state
     */
    suspend fun setNetworkState(state: NetworkState) = mutex.withLock {
        val wasOffline = networkState?.isConnected == false
        networkState = state
        emitEvent(TogglyEvent.NetworkChanged(state))

        // Refresh when coming back online
        if (wasOffline && state.isConnected) {
            refreshInternal()
        }
    }

    /**
     * Get debug information about the SDK state.
     *
     * @return Debug information
     */
    fun getDebugInfo(): TogglyDebugInfo {
        return TogglyDebugInfo(
            identity = identity,
            appKey = config.appKey,
            environment = config.environment,
            useSignedDefinitions = config.useSignedDefinitions,
            isAppInForeground = appState == AppStateType.ACTIVE,
            refreshInterval = config.refreshInterval,
            syncServiceRunning = refreshJob?.isActive == true,
            lastChecked = lastChecked,
            lastSynced = lastSynced,
            eTag = eTag,
            lastError = lastError,
            networkState = networkState,
            appState = appState
        )
    }

    /**
     * Dispose the service and clean up resources.
     */
    fun dispose() {
        stopWebSocket()
        stopRefreshTimer()
        stateChangeHandlers.clear()
        features = null
        isInitialized = false
    }

    // Private methods

    private suspend fun fetchFeatureFlags(): TogglyInitResponse {
        // Prevent duplicate fetches
        if (featuresLoading) {
            waitForFeaturesLoaded()
            return TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = features ?: emptyMap())
        }

        featuresLoading = true

        try {
            val url = buildApiUrl()
            val requestBuilder = Request.Builder()
                .url(url)
                .get()

            if (config.useSignedDefinitions && eTag != null) {
                requestBuilder.header("If-None-Match", eTag!!)
            }

            val response = withContext(Dispatchers.IO) {
                httpClient.newCall(requestBuilder.build()).execute()
            }

            response.use { resp ->
                if (resp.code == 304) {
                    // Not modified, use cached
                    lastChecked = Date()
                    val cachedFlags = getCachedFeatureFlags()
                    features = cachedFlags
                    _featureFlags.value = cachedFlags
                    return TogglyInitResponse(status = TogglyLoadStatus.CACHED, flags = cachedFlags)
                }

                if (!resp.isSuccessful) {
                    throw TogglyException.HttpError(resp.code, resp.message)
                }

                val body = resp.body?.string()
                    ?: throw TogglyException.InvalidResponse("Empty response body")

                val flags: FeatureFlags = runCatching {
                    val signedResponse = json.decodeFromString<SignedDefinitionsResponse>(body)
                    signedResponse.defs ?: signedResponse.data ?: emptyMap()
                }.getOrElse {
                    json.decodeFromString<Map<String, Boolean>>(body)
                }

                // Track changes
                val previousFlags = features
                features = flags
                _featureFlags.value = flags

                // Cache the flags
                cacheFeatureFlags(flags)

                // Store ETag
                resp.header("ETag")?.let { newEtag ->
                    eTag = newEtag
                    storage.set(TogglyStorageKeys.ETAG, newEtag)
                }

                lastChecked = Date()
                lastSynced = Date()
                lastError = null

                // Emit refreshed event
                emitEvent(TogglyEvent.Refreshed(flags))

                // Notify state change handlers
                previousFlags?.let { prev ->
                    notifyFeatureChanges(prev, flags)
                }

                return TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = flags)
            }
        } catch (e: Exception) {
            lastError = e.message
            emitEvent(TogglyEvent.Error(lastError ?: "Unknown error", e))

            // Fall back to cache or defaults
            val cachedFlags = getCachedFeatureFlags()
            features = cachedFlags
            _featureFlags.value = cachedFlags

            return TogglyInitResponse(
                status = TogglyLoadStatus.DEFAULTS,
                flags = cachedFlags,
                error = lastError
            )
        } finally {
            featuresLoading = false
        }
    }

    private fun buildApiUrl(): String {
        var url = "${config.baseUri}/evaluated-signed/${config.appKey}/${config.environment}"

        identity?.let { id ->
            url += "?u=${java.net.URLEncoder.encode(id, "UTF-8")}"
        }

        return url
    }

    private suspend fun waitForFeaturesLoaded() {
        while (featuresLoading) {
            delay(50)
        }
    }

    private suspend fun getCachedFeatureFlags(): FeatureFlags {
        features?.let { return it }

        try {
            val hashedIdentity = hashIdentity(identity ?: "")
            val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashedIdentity
            val cached = storage.get(cacheKey)

            if (cached != null) {
                val cacheData = json.decodeFromString<TogglyFeatureFlagsCache>(cached)
                if (cacheData.identity == identity) {
                    return json.decodeFromString<Map<String, Boolean>>(cacheData.flags)
                }
            }
        } catch (e: Exception) {
            // Cache read failed, use defaults
        }

        return config.featureDefaults
    }

    private suspend fun cacheFeatureFlags(flags: FeatureFlags) {
        try {
            val hashedIdentity = hashIdentity(identity ?: "")
            val cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashedIdentity
            val flagsString = json.encodeToString(
                kotlinx.serialization.serializer<Map<String, Boolean>>(),
                flags
            )
            val cacheData = TogglyFeatureFlagsCache(identity ?: "", flagsString)
            storage.set(cacheKey, json.encodeToString(TogglyFeatureFlagsCache.serializer(), cacheData))
        } catch (e: Exception) {
            // Cache write failed, continue without caching
        }
    }

    private suspend fun ensureFeaturesLoaded() {
        if (features != null) return

        if (featuresLoading) {
            waitForFeaturesLoaded()
            return
        }

        // Load from cache or defaults
        features = getCachedFeatureFlags()
        _featureFlags.value = features!!
    }

    private fun startRefreshTimer() {
        stopRefreshTimer()

        if (config.appKey != null && config.refreshInterval > 0) {
            refreshJob = CoroutineScope(Dispatchers.Default).launch {
                while (isActive) {
                    delay(config.refreshInterval)
                    if (appState == AppStateType.ACTIVE) {
                        // When WebSocket is connected, only refresh as a fallback every 20 minutes
                        if (wsConnected) {
                            val now = System.currentTimeMillis()
                            if (now - lastFallbackRefresh < FALLBACK_REFRESH_INTERVAL) {
                                continue
                            }
                            lastFallbackRefresh = now
                        }
                        refresh()
                    }
                }
            }
        }
    }

    private fun stopRefreshTimer() {
        refreshJob?.cancel()
        refreshJob = null
    }

    private fun emitEvent(event: TogglyEvent) {
        _events.tryEmit(event)
    }

    private fun notifyFeatureChanges(previousFlags: FeatureFlags, newFlags: FeatureFlags) {
        val allKeys = previousFlags.keys + newFlags.keys

        for (key in allKeys) {
            val previousValue = previousFlags[key]
            val newValue = newFlags[key]

            if (previousValue != newValue) {
                emitEvent(TogglyEvent.FeatureChanged(key, previousValue, newValue))

                stateChangeHandlers.forEach { handler ->
                    try {
                        handler(key, previousValue, newValue)
                    } catch (e: Exception) {
                        // Ignore handler errors
                    }
                }
            }
        }
    }

    private fun hashIdentity(identity: String): String {
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(identity.toByteArray())
            hash.joinToString("") { "%02x".format(it) }.take(16)
        } catch (e: Exception) {
            // Fallback to simple hash
            identity.hashCode().toString(16).takeLast(8)
        }
    }

    private fun startWebSocket() {
        if (!config.enableLiveUpdates || config.appKey == null) return

        stopWebSocket()

        val wsUrl = SdkIdentity.appendSdkQueryParams(
            config.baseUri
                .replace("https://", "wss://")
                .replace("http://", "ws://") + "/${config.appKey}/ws",
            eTag
        )

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                wsConnected = true
                lastFallbackRefresh = System.currentTimeMillis()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type", "")

                    if (type == "ping") return

                    if (type == "flags-updated" || type == "update") {
                        CoroutineScope(Dispatchers.Default).launch {
                            refresh()
                        }
                    }
                } catch (e: Exception) {
                    // Ignore malformed messages
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                wsConnected = false
                this@TogglyService.webSocket = null
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                wsConnected = false
                this@TogglyService.webSocket = null
                scheduleReconnect()
            }
        }

        webSocket = httpClient.newWebSocket(request, listener)
    }

    private fun stopWebSocket() {
        webSocket?.close(1000, "Client closing")
        webSocket = null
        wsConnected = false
    }

    private fun scheduleReconnect() {
        if (!config.enableLiveUpdates || config.appKey == null) return

        CoroutineScope(Dispatchers.Default).launch {
            delay(WS_RECONNECT_DELAY)
            if (!wsConnected && isInitialized && appState == AppStateType.ACTIVE) {
                startWebSocket()
            }
        }
    }

    companion object {
        private const val FALLBACK_REFRESH_INTERVAL = 20 * 60 * 1000L
        private const val WS_RECONNECT_DELAY = 5000L
    }
}

/**
 * Toggly-specific exceptions.
 */
sealed class TogglyException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class HttpError(val statusCode: Int, statusMessage: String) :
        TogglyException("HTTP $statusCode: $statusMessage")

    class InvalidResponse(message: String) : TogglyException(message)
}
