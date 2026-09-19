package io.toggly.core

import io.toggly.core.models.*
import io.toggly.core.storage.MemoryStorage
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrl
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
    private val lifecycleLock = Any()
    @Volatile private var retired = false
    private val ownerScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val activeCalls = mutableSetOf<okhttp3.Call>()
    private val delegateStorage: TogglyStorage = config.storage ?: MemoryStorage()
    private val storage = object : TogglyStorage {
        override suspend fun get(key: String): String? {
            ensureOwnerActive()
            return delegateStorage.get(key).also { ensureOwnerActive() }
        }
        override suspend fun set(key: String, value: String) {
            ensureOwnerActive()
            delegateStorage.set(key, value)
            ensureOwnerActive()
        }
        override suspend fun delete(key: String) {
            ensureOwnerActive()
            delegateStorage.delete(key)
            ensureOwnerActive()
        }
        override suspend fun clear() {
            ensureOwnerActive()
            delegateStorage.clear()
            ensureOwnerActive()
        }
    }

    private fun ensureOwnerActive() {
        if (retired) throw CancellationException("Toggly owner disposed")
    }

    // Never hold this lock across suspension, storage, or network I/O.
    private inline fun <T> whileActive(block: () -> T): T = synchronized(lifecycleLock) {
        ensureOwnerActive()
        block()
    }

    private suspend fun <T> owned(fallback: () -> T, block: suspend () -> T): T {
        if (retired) return fallback()
        // Preserve immediate cached evaluation while making suspension owner-cancellable.
        val work = ownerScope.async(
            currentCoroutineContext().minusKey(Job), start = CoroutineStart.UNDISPATCHED
        ) { ensureOwnerActive(); block() }
        return try { work.await() }
        catch (e: CancellationException) {
            currentCoroutineContext().ensureActive()
            if (retired) fallback() else throw e
        }
        finally { work.cancel() }
    }

    private fun retiredResponse() = TogglyInitResponse(
        status = TogglyLoadStatus.DEFAULTS, flags = config.featureDefaults
    )

    private suspend fun <T> withResponse(request: Request, block: suspend (Response) -> T): T {
        val call = whileActive { httpClient.newCall(request).also { activeCalls.add(it) } }
        return try {
            val response = suspendCancellableCoroutine<Response> { continuation ->
                continuation.invokeOnCancellation { call.cancel() }
                call.enqueue(object : okhttp3.Callback {
                    override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                        continuation.resumeWith(Result.failure(e))
                    }
                    override fun onResponse(call: okhttp3.Call, response: Response) {
                        continuation.resume(response) { _, value, _ -> value.close() }
                    }
                })
            }
            response.use { withContext(Dispatchers.IO) { block(it) } }
        } finally {
            synchronized(lifecycleLock) { activeCalls.remove(call) }
        }
    }

    private val mutex = Mutex()
    private val telemetry = if (config.enableTelemetry && !config.appKey.isNullOrBlank()) TelemetryReporter(
        appKey = config.appKey, environment = config.environment, metricsBaseUrl = config.metricsBaseUrl,
        telemetryFlushIntervalMs = config.telemetryFlushIntervalMs, onDiagnostic = config.onTelemetryDiagnostic
    ) else null
    // Snapshot caller-owned collections before storage reads or background work.
    private val groups = config.groups.map { it.trim() }.filter { it.isNotEmpty() }
    private val claims = config.claims.toMap().filter { (key, value) ->
        key.isNotEmpty() && value.isNotEmpty()
    }.toSortedMap().entries.take(20).associate { it.key to it.value }
    @Volatile private var snapshotContext: String? = null

    // State
    @Volatile private var definitions: EvaluatedDefinitions? = null
    @Volatile private var features: FeatureFlags? = null
    @Volatile private var featuresLoading = false
    @Volatile private var identity: String? = null
    private var refreshJob: Job? = null
    private var lastChecked: Date? = null
    private var lastSynced: Date? = null
    private var lastError: String? = null
    private var eTag: String? = null
    private var eTagContext: String? = null
    private var isInitialized = false
    @Volatile private var networkState: NetworkState? = null
    @Volatile private var appState: AppStateType = AppStateType.ACTIVE

    // WebSocket state
    private var webSocket: WebSocket? = null
    @Volatile private var wsConnected = false
    @Volatile private var lastFallbackRefresh = 0L

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
        get() = synchronized(lifecycleLock) { isInitialized }

    /**
     * Current user identity.
     */
    val currentIdentity: String?
        get() = synchronized(lifecycleLock) { identity }

    /**
     * Current feature flags (may be null if not loaded).
     */
    val currentFeatures: FeatureFlags?
        get() = synchronized(lifecycleLock) { features }

    /**
     * Initialize Toggly and load feature flags.
     *
     * @return The initialization response
     */
    suspend fun init(): TogglyInitResponse = owned(::retiredResponse) {
        mutex.withLock {
            // Handle identity
            val resolvedIdentity = config.identity ?: run {
                var storedId = storage.get(TogglyStorageKeys.DEVICE_ID)
                if (storedId == null) {
                    storedId = UUID.randomUUID().toString()
                    storage.set(TogglyStorageKeys.DEVICE_ID, storedId)
                }
                storedId
            }

            whileActive { identity = resolvedIdentity }

            // Start refresh timer
            startRefreshTimer()

            // Perform initial refresh
            val response = refreshInternal()

            whileActive { isInitialized = true }
            emitEvent(TogglyEvent.Initialized(response))

            // Start WebSocket for live updates after successful initialization
            if (config.enableLiveUpdates) {
                startWebSocket()
            }

            response
        }
    }

    /**
     * Refresh feature flags from the server or cache.
     *
     * @return The refresh response
     */
    suspend fun refresh(): TogglyInitResponse = owned(::retiredResponse) {
        mutex.withLock {
            refreshInternal()
        }
    }

    private suspend fun refreshInternal(): TogglyInitResponse {
        ensureOwnerActive()
        // Skip refresh if app is not in foreground
        if (appState != AppStateType.ACTIVE) {
            return TogglyInitResponse(
                status = TogglyLoadStatus.CACHED,
                flags = features ?: config.featureDefaults
            )
        }

        // Skip refresh if offline
        if (networkState?.isConnected == false) {
            val cached = loadCachedDefinitions()
            applyCachedSnapshot(cached)
            return TogglyInitResponse(status = TogglyLoadStatus.CACHED, flags = cached.flags)
        }

        // If no app key, use defaults
        if (config.appKey == null) {
            applySnapshot(fromBooleanDefaults(config.featureDefaults), config.featureDefaults)
            return TogglyInitResponse(status = TogglyLoadStatus.DEFAULTS, flags = config.featureDefaults)
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
        return isFeatureEnabled(featureKey)
    }

    /**
     * Check if a feature is enabled, optionally against a per-evaluation entity context.
     * Gated flags fail closed when [context] is missing.
     */
    suspend fun isFeatureEnabled(
        featureKey: String,
        context: Any? = null,
        kind: String? = null
    ): Boolean {
        return evaluateFeatureGate(
            listOf(featureKey),
            FeatureRequirement.ALL,
            false,
            context,
            kind
        )
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
        negate: Boolean = false,
        context: Any? = null,
        kind: String? = null
    ): Boolean {
        ensureFeaturesLoaded()
        val defs = definitions ?: fromBooleanDefaults(features ?: config.featureDefaults)
        return evaluateEvaluatedGateWithChecks(
            defs,
            featureKeys,
            requirement == FeatureRequirement.ALL,
            negate,
            normalizeEntityContext(context, kind),
            onCheck = ::recordCachedCheck
        )
    }

    /**
     * Flow for observing a specific feature flag.
     *
     * @param featureKey The feature key to observe
     * @return Flow emitting the feature flag state
     */
    fun featureFlagFlow(featureKey: String): Flow<Boolean> {
        return featureFlags.map { flags ->
            (flags[featureKey] ?: config.featureDefaults[featureKey] ?: false).also { recordCachedCheck(featureKey, it) }
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

            fun evaluate(key: String): Boolean = (mergedFlags[key] == true).also { recordCachedCheck(key, it) }
            val isEnabled = when (requirement) {
                FeatureRequirement.ANY -> featureKeys.any(::evaluate)
                FeatureRequirement.ALL -> featureKeys.all(::evaluate)
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
    suspend fun setIdentity(identity: String?): TogglyInitResponse = owned(::retiredResponse) {
        mutex.withLock {
            val previousIdentity = this.identity

            val resolvedIdentity = identity ?: run {
                var deviceId = storage.get(TogglyStorageKeys.DEVICE_ID)
                if (deviceId == null) {
                    deviceId = UUID.randomUUID().toString()
                    storage.set(TogglyStorageKeys.DEVICE_ID, deviceId)
                }
                deviceId
            }

            whileActive { this.identity = resolvedIdentity }

            // Clear cache if identity changed
            if (previousIdentity != this.identity) {
                clearCacheInternal()
            }

            // Emit event
            emitEvent(TogglyEvent.IdentityChanged(previousIdentity, this.identity!!))

            refreshInternal()
        }
    }

    /**
     * Clear cached feature flags.
     */
    suspend fun clearCache() = owned({ Unit }) {
        mutex.withLock {
            clearCacheInternal()

            Unit
        }
    }

    private suspend fun clearCacheInternal() {
        whileActive {
            features = null
            definitions = null
            eTag = null
            eTagContext = null
        }

        val cacheKey = contextCacheKey()
        storage.delete(cacheKey)
        storage.delete(TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(identity ?: ""))
        storage.delete(TogglyStorageKeys.ETAG)
    }

    /**
     * Add a feature state change handler.
     *
     * @param handler The handler to add
     * @return A function to remove the handler
     */
    fun registerContext(kind: String, mapper: EntityContextMapper) {
        io.toggly.core.registerContext(kind, mapper)
    }

    fun <T : Any> registerContext(kind: String, mapper: (T) -> TogglyEntityContext) {
        io.toggly.core.registerContext(kind, mapper)
    }

    fun addStateChangeHandler(handler: FeatureStateChangeHandler): () -> Unit {
        synchronized(lifecycleLock) { if (!retired) stateChangeHandlers.add(handler) }
        return { synchronized(lifecycleLock) { stateChangeHandlers.remove(handler) }; Unit }
    }

    /**
     * Update the app state (call when app moves to foreground/background).
     *
     * @param state The new app state
     */
    suspend fun setAppState(state: AppStateType) = owned({ Unit }) {
        mutex.withLock {
            val wasBackground = appState == AppStateType.BACKGROUND
            whileActive { appState = state }
            emitEvent(TogglyEvent.AppStateChanged(state))
            if (state == AppStateType.BACKGROUND) telemetry?.requestFlush()

            // Refresh when coming to foreground
            if (wasBackground && state == AppStateType.ACTIVE) {
                refreshInternal()
            }

            Unit
        }
    }

    /**
     * Update the network state.
     *
     * @param state The new network state
     */
    suspend fun setNetworkState(state: NetworkState) = owned({ Unit }) {
        mutex.withLock {
            val wasOffline = networkState?.isConnected == false
            whileActive { networkState = state }
            emitEvent(TogglyEvent.NetworkChanged(state))

            // Refresh when coming back online
            if (wasOffline && state.isConnected) {
                refreshInternal()
            }

            Unit
        }
    }

    /**
     * Get debug information about the SDK state.
     *
     * @return Debug information
     */
    fun getDebugInfo(): TogglyDebugInfo = synchronized(lifecycleLock) {
        TogglyDebugInfo(
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
        telemetry?.dispose()
        synchronized(lifecycleLock) {
            if (retired) return
            retired = true
            ownerScope.cancel()
            activeCalls.forEach { it.cancel() }
            activeCalls.clear()
            webSocket?.cancel()
            stopWebSocket()
            stopRefreshTimer()
            stateChangeHandlers.clear()
            features = null
            definitions = null
            isInitialized = false
            featuresLoading = false
        }
    }

    /** Record explicit use; this does not evaluate the flag again. */
    fun recordUsage(featureKey: String, variant: String = "enabled") { telemetry?.recordUsage(featureKey, variant) }
    /** Record an explicit feature view. */
    fun recordView(featureKey: String, variant: String = "enabled") { telemetry?.recordView(featureKey, variant) }
    /** Increment an app-level counter by an integer in 0..1,000,000. */
    fun incrementCounter(metricKey: String, value: Double = 1.0) { telemetry?.incrementCounter(metricKey, value) }
    /** Set the latest finite app-level gauge in 0..1,000,000. */
    fun setGauge(metricKey: String, value: Double) { telemetry?.setGauge(metricKey, value) }
    /** Await the current best-effort telemetry drain. */
    suspend fun flushTelemetry() { telemetry?.flushTelemetry() }
    /** Adapter hook for a cached value actually evaluated by the UI; excludes aggregate negation. */
    fun recordCachedCheck(featureKey: String, enabled: Boolean) {
        telemetry?.recordCheck(featureKey, if (enabled) "enabled" else "disabled")
    }

    // Private methods

    private suspend fun fetchFeatureFlags(): TogglyInitResponse {
        // Prevent duplicate fetches
        if (featuresLoading) {
            waitForFeaturesLoaded()
            return TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = features ?: emptyMap())
        }

        whileActive { featuresLoading = true }

        try {
            val url = buildApiUrl()
            val requestBuilder = Request.Builder()
                .url(url)
                .get()

            if (config.useSignedDefinitions && eTag != null && eTagContext == buildApiUrl()) {
                requestBuilder.header("If-None-Match", eTag!!)
            }

            return withResponse(requestBuilder.build()) { resp ->
                if (resp.code == 304) {
                    whileActive { lastChecked = Date() }
                    val cached = loadCachedDefinitions()
                    applyCachedSnapshot(cached)
                    return@withResponse TogglyInitResponse(status = TogglyLoadStatus.CACHED, flags = cached.flags)
                }

                if (!resp.isSuccessful) {
                    throw TogglyException.HttpError(resp.code, resp.message)
                }

                val body = resp.body?.string()
                    ?: throw TogglyException.InvalidResponse("Empty response body")

                val loaded: EvaluatedDefinitions
                var defsRaw: String? = null
                var signature: String? = null
                var timestamp: Long? = null
                var keyId: String? = null

                if (config.verifySignatures) {
                    val envelope = SignedDefsVerify.parseSignedEnvelope(body)
                    SignedDefsVerify.assertEnvelopeFreshness(
                        envelope.timestamp,
                        config.maxSignatureAgeSeconds
                    )
                    val jwks = fetchJwks()
                    SignedDefsVerify.verify(envelope, jwks)
                    loaded = SignedDefsVerify.parseEvaluatedDefinitions(envelope.defsRaw)
                    defsRaw = envelope.defsRaw
                    signature = envelope.signature
                    timestamp = envelope.timestamp
                    keyId = envelope.kid
                } else {
                    loaded = parseBodyDefinitions(body)
                    defsRaw = SignedDefsVerify.extractRawJsonProperty(body, "defs")
                        ?: SignedDefsVerify.extractRawJsonProperty(body, "data")
                        ?: body
                }

                val flags = toBooleanDefinitions(loaded)
                val previousFlags = features
                applySnapshot(loaded, flags)

                cacheFeatureFlags(
                    flags = flags,
                    defsRaw = defsRaw,
                    timestamp = timestamp,
                    signature = signature,
                    keyId = keyId
                )

                whileActive {
                    eTag = resp.header("ETag")
                    eTagContext = buildApiUrl()
                    lastChecked = Date()
                    lastSynced = Date()
                    lastError = null
                }

                // Emit refreshed event
                emitEvent(TogglyEvent.Refreshed(flags))

                // Notify state change handlers
                previousFlags?.let { prev ->
                    notifyFeatureChanges(prev, flags)
                }

                TogglyInitResponse(status = TogglyLoadStatus.FETCHED, flags = flags)
            }
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            whileActive { lastError = e.message }
            emitEvent(TogglyEvent.Error(lastError ?: "Unknown error", e))

            // Fall back to cache or defaults
            val cached = loadCachedDefinitions()
            applyCachedSnapshot(cached)

            return TogglyInitResponse(
                status = TogglyLoadStatus.DEFAULTS,
                flags = cached.flags,
                error = lastError
            )
        } finally {
            synchronized(lifecycleLock) { featuresLoading = false }
        }
    }

    private fun buildApiUrl(): String {
        val url = config.baseUri.toHttpUrl().newBuilder()
            .addPathSegment("evaluated-signed")
            .addPathSegment(config.appKey ?: "null")
            .addPathSegment(config.environment)
        identity?.let { url.addQueryParameter("u", it) }
        groups.forEach { url.addQueryParameter("g", it) }
        claims.forEach { (type, value) -> url.addQueryParameter("claim.$type", value) }
        return url.build().toString()
    }

    private fun contextCacheKey(context: String = buildApiUrl()): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(context.toByteArray(Charsets.UTF_8))
        return TogglyStorageKeys.FEATURE_FLAGS_CACHE + "v2:" + digest.joinToString("") { "%02x".format(it) }
    }

    private suspend fun fetchJwks(): String {
        val request = Request.Builder()
            .url("${config.baseUri.trimEnd('/')}/.well-known/jwks")
            .get()
            .build()

        val body = withResponse(request) { SignedDefsVerify.fetchJwks(it) }
        storage.set(TogglyStorageKeys.JWKS, body)
        return body
    }

    /**
     * Prefer the last persisted JWKS for offline cold-start re-verification;
     * fall back to a network fetch when none is stored (Flutter soft-fail parity).
     */
    private suspend fun resolveJwksForCacheVerify(): String? {
        storage.get(TogglyStorageKeys.JWKS)?.let { return it }
        return try {
            fetchJwks()
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun waitForFeaturesLoaded() {
        while (featuresLoading) {
            delay(50)
        }
    }

    private data class CachedDefinitions(
        val definitions: EvaluatedDefinitions,
        val flags: FeatureFlags,
        val ownerContext: String
    )

    // Call under mutex: accepting a cache and publishing it is atomic with identity changes.
    private fun applyCachedSnapshot(cached: CachedDefinitions) {
        if (cached.ownerContext == buildApiUrl()) {
            applySnapshot(cached.definitions, cached.flags)
        }
    }

    private fun applySnapshot(defs: EvaluatedDefinitions, flags: FeatureFlags) = whileActive {
        definitions = defs
        snapshotContext = buildApiUrl()
        features = flags
        _featureFlags.value = flags
    }

    private fun parseBodyDefinitions(body: String): EvaluatedDefinitions {
        val element = json.parseToJsonElement(body)
        val obj = element as? kotlinx.serialization.json.JsonObject
        val defs = obj?.get("defs") ?: obj?.get("data") ?: element
        return parseEvaluatedDefinitions(defs)
    }

    private suspend fun loadCachedDefinitions(): CachedDefinitions {
        // Capture before any storage or JWKS suspension; never relabel a restored payload.
        val ownerContext = buildApiUrl()
        val ownerIdentity = identity
        features?.let { snapshot ->
            if (snapshotContext == ownerContext) {
                return CachedDefinitions(definitions ?: fromBooleanDefaults(snapshot), snapshot, ownerContext)
            }
        }

        try {
            var cacheKey = contextCacheKey(ownerContext)
            var cached = storage.get(cacheKey)
            // Legacy identity-only payloads are eligible only for empty targeting.
            if (cached == null && groups.isEmpty() && claims.isEmpty()) {
                cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(ownerIdentity ?: "")
                cached = storage.get(cacheKey)
            }

            if (cached != null) {
                val cacheData = json.decodeFromString<TogglyFeatureFlagsCache>(cached)
                if (cacheData.identity == ownerIdentity &&
                    (cacheData.evaluationContext == ownerContext ||
                        (cacheData.evaluationContext == null && groups.isEmpty() && claims.isEmpty()))) {
                    return trustOrReverifyCachedFlags(cacheData, cacheKey, ownerContext)
                }
            }
        } catch (_: Exception) {
            // Cache read failed, use defaults
        }

        val defaults = fromBooleanDefaults(config.featureDefaults)
        return CachedDefinitions(defaults, config.featureDefaults, ownerContext)
    }

    /**
     * When [TogglyConfig.verifySignatures] is enabled, re-verify persisted
     * envelope metadata before trusting the cache. Invalid signatures fail
     * closed (clear cache). Transient JWKS/network failures keep last-known-good.
     */
    private suspend fun trustOrReverifyCachedFlags(
        cacheData: TogglyFeatureFlagsCache,
        cacheKey: String,
        ownerContext: String
    ): CachedDefinitions {
        val parsed = runCatching {
            parseEvaluatedDefinitions(cacheData.flags)
        }.getOrElse {
            storage.delete(cacheKey)
            return CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, ownerContext)
        }
        val flags = toBooleanDefinitions(parsed)

        if (!config.verifySignatures) {
            return CachedDefinitions(parsed, flags, ownerContext)
        }

        if (cacheData.timestamp == null ||
            cacheData.signature.isNullOrEmpty() ||
            cacheData.keyId.isNullOrEmpty()
        ) {
            storage.delete(cacheKey)
            return CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, ownerContext)
        }

        try {
            SignedDefsVerify.assertEnvelopeFreshness(
                cacheData.timestamp,
                config.maxSignatureAgeSeconds
            )
        } catch (_: Exception) {
            storage.delete(cacheKey)
            return CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, ownerContext)
        }

        val jwks = resolveJwksForCacheVerify()
        if (jwks == null) {
            return CachedDefinitions(parsed, flags, ownerContext)
        }

        return try {
            val envelope = SignedDefsVerify.SignedEnvelope(
                defsRaw = cacheData.flags,
                signature = cacheData.signature,
                timestamp = cacheData.timestamp,
                kid = cacheData.keyId
            )
            SignedDefsVerify.verify(envelope, jwks)
            CachedDefinitions(parsed, flags, ownerContext)
        } catch (_: Exception) {
            storage.delete(cacheKey)
            CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, ownerContext)
        }
    }

    private suspend fun cacheFeatureFlags(
        flags: FeatureFlags,
        defsRaw: String? = null,
        timestamp: Long? = null,
        signature: String? = null,
        keyId: String? = null
    ) {
        try {
            val cacheKey = contextCacheKey()
            val flagsString = defsRaw ?: json.encodeToString(
                kotlinx.serialization.serializer<Map<String, Boolean>>(),
                flags
            )
            val cacheData = TogglyFeatureFlagsCache(
                identity = identity ?: "",
                flags = flagsString,
                timestamp = timestamp,
                signature = signature,
                keyId = keyId,
                evaluationContext = buildApiUrl()
            )
            storage.set(cacheKey, json.encodeToString(TogglyFeatureFlagsCache.serializer(), cacheData))
        } catch (_: Exception) {
            // Cache write failed, continue without caching
        }
    }

    private suspend fun ensureFeaturesLoaded() {
        if (features != null || retired) return
        owned({ Unit }) { ensureFeaturesLoadedInternal() }
    }

    private suspend fun ensureFeaturesLoadedInternal() {
        if (features != null) return

        if (featuresLoading) {
            waitForFeaturesLoaded()
            return
        }

        val cached = loadCachedDefinitions()
        mutex.withLock {
            applyCachedSnapshot(cached)
        }
    }

    private fun startRefreshTimer() = whileActive {
        stopRefreshTimer()

        if (config.appKey != null && config.refreshInterval > 0) {
            refreshJob = ownerScope.launch {
                while (isActive) {
                    delay(config.refreshInterval)
                    if (appState == AppStateType.ACTIVE) {
                        // When WebSocket is connected, only refresh as a fallback every 20 minutes
                        if (wsConnected) {
                            val now = System.currentTimeMillis()
                            if (now - lastFallbackRefresh < FALLBACK_REFRESH_INTERVAL) {
                                continue
                            }
                            whileActive { lastFallbackRefresh = now }
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

    private fun emitEvent(event: TogglyEvent) = synchronized(lifecycleLock) {
        if (!retired) _events.tryEmit(event)
    }

    private fun notifyFeatureChanges(previousFlags: FeatureFlags, newFlags: FeatureFlags) {
        if (retired) return
        val handlers = synchronized(lifecycleLock) { stateChangeHandlers.toList() }
        val allKeys = previousFlags.keys + newFlags.keys

        for (key in allKeys) {
            val previousValue = previousFlags[key]
            val newValue = newFlags[key]

            if (previousValue != newValue) {
                emitEvent(TogglyEvent.FeatureChanged(key, previousValue, newValue))

                handlers.forEach { handler ->
                    if (retired) return
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

    private fun startWebSocket() = whileActive {
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
                synchronized(lifecycleLock) {
                    if (retired || this@TogglyService.webSocket !== webSocket) { webSocket.cancel(); return }
                    wsConnected = true
                    lastFallbackRefresh = System.currentTimeMillis()
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type", "")

                    if (type == "ping") return

                    if (type == "signing-key-updated" || type == "flags-updated" || type == "update") {
                        ownerScope.launch {
                            if (type == "signing-key-updated") {
                                storage.delete(TogglyStorageKeys.JWKS)
                            }
                            refresh()
                        }
                    }
                } catch (e: Exception) {
                    // Ignore malformed messages
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                synchronized(lifecycleLock) {
                    if (retired || this@TogglyService.webSocket !== webSocket) return
                    wsConnected = false
                    this@TogglyService.webSocket = null
                    scheduleReconnect()
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                synchronized(lifecycleLock) {
                    if (retired || this@TogglyService.webSocket !== webSocket) return
                    wsConnected = false
                    this@TogglyService.webSocket = null
                    scheduleReconnect()
                }
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
        if (retired || !config.enableLiveUpdates || config.appKey == null) return

        ownerScope.launch {
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
