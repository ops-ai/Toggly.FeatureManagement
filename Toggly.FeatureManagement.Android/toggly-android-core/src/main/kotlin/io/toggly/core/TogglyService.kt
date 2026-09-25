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
        telemetryFlushIntervalMs = config.telemetryFlushIntervalMs, onDiagnostic = config.onTelemetryDiagnostic,
        instanceId = config.instanceId, identity = config.identity
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
    /** Variant assignments from the last accepted `evaluated-variants-signed` snapshot. */
    @Volatile private var variantDefs: Map<String, EvaluatedVariantDef>? = null
    @Volatile private var featuresLoading = false
    @Volatile private var identity: String? = config.identity
    @Volatile private var instanceId: String? = config.instanceId?.trim()?.takeIf { it.isNotEmpty() }
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

    // Attribution travels with externally retained snapshots, not an unbounded internal history.
    private class AttributedFlags(
        private val flags: FeatureFlags, val owner: Any, val instanceId: String?, val identity: String?
    ) : Map<String, Boolean> by flags {
        override fun equals(other: Any?): Boolean = other is Map<*, *> && flags == other
        override fun hashCode(): Int = flags.hashCode()
        override fun toString(): String = flags.toString()
    }

    private data class FlagSnapshot(val flags: FeatureFlags, val generation: Long)
    private var contextGeneration = 0L
    private val contextRevision = MutableStateFlow(0L)
    /** Adapter invalidation signal; contains no identity or token values. */
    val evaluationContextRevision: StateFlow<Long> = contextRevision.asStateFlow()
    private val snapshotOwner = Any()
    private fun attributedFlags(flags: FeatureFlags): FeatureFlags = AttributedFlags(flags, snapshotOwner, instanceId, identity)
    private val flagSnapshots = MutableStateFlow(FlagSnapshot(attributedFlags(emptyMap()), contextGeneration))
    private fun publishFeatureFlags(flags: FeatureFlags) {
        flagSnapshots.value = FlagSnapshot(attributedFlags(flags), contextGeneration)
    }

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
    val featureFlags: StateFlow<FeatureFlags> = object : StateFlow<FeatureFlags> {
        override val value: FeatureFlags get() = flagSnapshots.value.flags
        override val replayCache: List<FeatureFlags> get() = listOf(value)
        override suspend fun collect(collector: FlowCollector<FeatureFlags>): Nothing =
            flagSnapshots.collect { collector.emit(it.flags) }
    }

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

    /** Current host-minted instance token, or null for client targeting. */
    val currentInstanceId: String?
        get() = synchronized(lifecycleLock) { instanceId }

    /** Current feature flags (may be null if not loaded). */
    val currentFeatures: FeatureFlags?
        get() = synchronized(lifecycleLock) { features }

    /** Current variant assignments (may be null if not loaded or [TogglyConfig.enableVariants] is false). */
    val currentVariants: Map<String, VariantResult>?
        get() = synchronized(lifecycleLock) {
            val defs = variantDefs ?: return@synchronized null
            val result = mutableMapOf<String, VariantResult>()
            for ((key, entry) in defs) {
                val name = entry.variant
                if (name != null && entry.enabled) {
                    result[key] = VariantResult(name, entry.configurationValue)
                }
            }
            result
        }

    /**
     * Initialize Toggly and load feature flags.
     *
     * @return The initialization response
     */
    suspend fun init(): TogglyInitResponse = owned(::retiredResponse) {
        mutex.withLock {
            if (isInitialized) return@withLock refreshInternal()
            // Handle identity; explicit changes made before init remain authoritative.
            val resolvedIdentity = identity ?: run {
                var storedId = storage.get(TogglyStorageKeys.DEVICE_ID)
                if (storedId == null) {
                    storedId = UUID.randomUUID().toString()
                    storage.set(TogglyStorageKeys.DEVICE_ID, storedId)
                }
                storedId
            }

            whileActive {
                telemetry?.updateAttribution(instanceId, resolvedIdentity)
                if (identity != resolvedIdentity) {
                    identity = resolvedIdentity
                    contextGeneration++
                    publishFeatureFlags(features ?: emptyMap())
                    contextRevision.value = contextGeneration
                }
            }

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
        val (defs, token, user) = synchronized(lifecycleLock) {
            Triple(definitions ?: fromBooleanDefaults(features ?: config.featureDefaults), instanceId, identity)
        }
        // Host mappers may reenter the service. Capture ownership before invoking them,
        // without holding a lifecycle lock across arbitrary host code.
        return evaluateEvaluatedGateWithChecks(
            defs, featureKeys, requirement == FeatureRequirement.ALL, negate,
            normalizeEntityContext(context, kind)
        ) { key, enabled ->
            telemetry?.recordCheck(key, if (enabled) "enabled" else "disabled", token, user)
        }
    }

    /**
     * Returns the assigned variant for [featureKey], or null when the feature is
     * disabled, has no variant assignment, or [TogglyConfig.enableVariants] is
     * false. Fetches from `evaluated-variants-signed` (switched automatically by
     * [buildApiUrl] when [TogglyConfig.enableVariants] is true).
     */
    suspend fun getVariant(featureKey: String): VariantResult? {
        if (!config.enableVariants) return null
        ensureFeaturesLoaded()
        val (entry, enabled, token, user) = synchronized(lifecycleLock) {
            VariantSnapshot(
                entry = variantDefs?.get(featureKey),
                enabled = features?.get(featureKey) ?: config.featureDefaults[featureKey] ?: false,
                token = instanceId,
                user = identity
            )
        }
        val result = if (entry != null && entry.variant != null && entry.enabled && enabled) {
            VariantResult(name = entry.variant, configurationValue = entry.configurationValue)
        } else {
            null
        }
        telemetry?.recordCheck(featureKey, result?.name ?: "disabled", token, user)
        return result
    }

    /**
     * Returns [VariantResult.configurationValue] for [featureKey], or null when
     * no variant is assigned. See [getVariant].
     */
    suspend fun getVariantValue(featureKey: String): Any? = getVariant(featureKey)?.configurationValue

    /**
     * Soft-decodes the assigned variant configuration as [clazz].
     * Prefer the reified [getVariantValue] extension from Kotlin.
     * Missing assignment or decode failure returns null (never throws for shape alone).
     */
    suspend fun <T : Any> getVariantValue(featureKey: String, clazz: Class<T>): T? =
        decodeVariantValue(getVariant(featureKey)?.configurationValue, clazz)

    private data class VariantSnapshot(
        val entry: EvaluatedVariantDef?,
        val enabled: Boolean,
        val token: String?,
        val user: String?
    )

    /**
     * Flow for observing a specific feature flag.
     *
     * @param featureKey The feature key to observe
     * @return Flow emitting the feature flag state
     */
    fun featureFlagFlow(featureKey: String): Flow<Boolean> {
        return featureFlags.map { flags ->
            (flags[featureKey] ?: config.featureDefaults[featureKey] ?: false).also { recordCachedCheck(featureKey, it, flags) }
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

            fun evaluate(key: String): Boolean = (mergedFlags[key] == true).also { recordCachedCheck(key, it, flags) }
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
    suspend fun setIdentity(identity: String?): TogglyInitResponse = changeIdentity(identity, null)

    /** Atomically replace identity and a host-minted token. Null/blank tokens restore client targeting. */
    suspend fun setIdentity(identity: String?, instanceId: String?): TogglyInitResponse =
        changeIdentity(identity, instanceId)

    /** Rotate or clear the host-minted token while retaining the current client identity. */
    suspend fun setInstanceId(instanceId: String?): TogglyInitResponse =
        changeIdentity(null, instanceId, retainIdentity = true)

    private suspend fun changeIdentity(
        identity: String?, token: String?, retainIdentity: Boolean = false
    ): TogglyInitResponse = owned(::retiredResponse) {
        mutex.withLock {
            val previousIdentity = this.identity
            val previousToken = instanceId
            val resolvedIdentity = (if (retainIdentity) this.identity else identity) ?: run {
                storage.get(TogglyStorageKeys.DEVICE_ID) ?: UUID.randomUUID().toString().also {
                    storage.set(TogglyStorageKeys.DEVICE_ID, it)
                }
            }
            val resolvedToken = token?.trim()?.takeIf { it.isNotEmpty() }
            whileActive {
                telemetry?.updateAttribution(resolvedToken, resolvedIdentity)
                this.identity = resolvedIdentity
                instanceId = resolvedToken
                if (previousIdentity != resolvedIdentity || previousToken != resolvedToken) {
                    definitions = null; features = null; variantDefs = null; snapshotContext = null
                    eTag = null; eTagContext = null
                    // Withdraw the old user's snapshot before any storage/network suspension.
                    contextGeneration++
                    publishFeatureFlags(config.featureDefaults)
                    contextRevision.value = contextGeneration
                }
            }
            emitEvent(TogglyEvent.IdentityChanged(previousIdentity, resolvedIdentity))
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
            variantDefs = null
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
            appState = appState,
            enableVariants = config.enableVariants
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
            variantDefs = null
            isInitialized = false
            featuresLoading = false
        }
    }

    /** Record explicit use; this does not evaluate the flag again. */
    fun recordUsage(featureKey: String, variant: String = "enabled") { synchronized(lifecycleLock) { telemetry?.recordUsage(featureKey, variant) } }
    /** Record an explicit feature view. */
    fun recordView(featureKey: String, variant: String = "enabled") { synchronized(lifecycleLock) { telemetry?.recordView(featureKey, variant) } }
    /** Increment an app-level counter by an integer in 0..1,000,000. */
    fun incrementCounter(metricKey: String, value: Double = 1.0) { synchronized(lifecycleLock) { telemetry?.incrementCounter(metricKey, value) } }
    /** Set the latest finite app-level gauge in 0..1,000,000. */
    fun setGauge(metricKey: String, value: Double) { synchronized(lifecycleLock) { telemetry?.setGauge(metricKey, value) } }
    /** Await the current best-effort telemetry drain. */
    suspend fun flushTelemetry() { telemetry?.flushTelemetry() }
    /** Adapter hook for a cached value actually evaluated by the UI; excludes aggregate negation. */
    fun recordCachedCheck(featureKey: String, enabled: Boolean) {
        synchronized(lifecycleLock) {
            telemetry?.recordCheck(featureKey, if (enabled) "enabled" else "disabled")
        }
    }

    /** Adapter hook for a retained SDK snapshot; preserves the snapshot's original attribution. */
    fun recordCachedCheck(featureKey: String, enabled: Boolean, snapshot: FeatureFlags) {
        synchronized(lifecycleLock) {
            if (snapshot is AttributedFlags && snapshot.owner === snapshotOwner) {
                telemetry?.recordCheck(featureKey, if (enabled) "enabled" else "disabled", snapshot.instanceId, snapshot.identity)
            } else {
                recordCachedCheck(featureKey, enabled)
            }
        }
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
                var variants: Map<String, EvaluatedVariantDef>? = null
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
                    if (config.enableVariants) {
                        val parsedVariants = parseVariantDefinitions(json.parseToJsonElement(envelope.defsRaw))
                        variants = parsedVariants
                        loaded = variantDefinitionsToEvaluated(parsedVariants)
                    } else {
                        loaded = SignedDefsVerify.parseEvaluatedDefinitions(envelope.defsRaw)
                    }
                    defsRaw = envelope.defsRaw
                    signature = envelope.signature
                    timestamp = envelope.timestamp
                    keyId = envelope.kid
                } else {
                    defsRaw = SignedDefsVerify.extractRawJsonProperty(body, "defs")
                        ?: SignedDefsVerify.extractRawJsonProperty(body, "data")
                        ?: body
                    if (config.enableVariants) {
                        val parsedVariants = parseVariantDefinitions(json.parseToJsonElement(defsRaw))
                        variants = parsedVariants
                        loaded = variantDefinitionsToEvaluated(parsedVariants)
                    } else {
                        loaded = parseBodyDefinitions(body)
                    }
                }

                val flags = toBooleanDefinitions(loaded)
                val previousFlags = features
                applySnapshot(loaded, flags, variants)

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
            .addPathSegment(if (config.enableVariants) "evaluated-variants-signed" else "evaluated-signed")
            .addPathSegment(config.appKey ?: "null")
            .addPathSegment(config.environment)
        val token = instanceId
        url.removeAllQueryParameters("i")
        if (token != null) {
            val configured = url.build()
            url.query(null)
            for (index in 0 until configured.querySize) {
                val name = configured.queryParameterName(index)
                if (name != "i" && name != "u" && name != "userId" && name != "g" && !name.startsWith("claim.")) {
                    url.addQueryParameter(name, configured.queryParameterValue(index))
                }
            }
            url.addQueryParameter("i", token)
        } else {
            identity?.let { url.addQueryParameter("u", it) }
            groups.forEach { url.addQueryParameter("g", it) }
            claims.forEach { (type, value) -> url.addQueryParameter("claim.$type", value) }
        }
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

    private data class CacheOwner(val url: String, val identity: String?, val instanceId: String?, val generation: Long)
    private fun cacheOwner() = CacheOwner(buildApiUrl(), identity, instanceId, contextGeneration)
    private fun persistedContext(owner: CacheOwner): String =
        if (owner.instanceId == null) owner.url else contextCacheKey(owner.url)

    private data class CachedDefinitions(
        val definitions: EvaluatedDefinitions,
        val flags: FeatureFlags,
        val owner: CacheOwner,
        val invalidCacheKey: String? = null,
        val variants: Map<String, EvaluatedVariantDef>? = null
    )

    // Call under mutex: accepting a cache and publishing it is atomic with identity changes.
    private suspend fun applyCachedSnapshot(cached: CachedDefinitions) {
        val current = synchronized(lifecycleLock) {
            cached.owner.url == buildApiUrl() && cached.owner.generation == contextGeneration
        }
        if (current) {
            // The context mutex protects this cleanup too: an old verification must
            // not delete a newer cache after a token has rotated away and back.
            try {
                cached.invalidCacheKey?.let { storage.delete(it) }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // Cleanup is best-effort; never use the invalid payload if storage is unavailable.
            }
            applySnapshot(cached.definitions, cached.flags, cached.variants)
        }
    }

    private fun applySnapshot(
        defs: EvaluatedDefinitions,
        flags: FeatureFlags,
        variants: Map<String, EvaluatedVariantDef>? = null
    ) = whileActive {
        definitions = defs
        snapshotContext = buildApiUrl()
        features = flags
        variantDefs = variants
        publishFeatureFlags(flags)
    }

    private fun parseBodyDefinitions(body: String): EvaluatedDefinitions {
        val element = json.parseToJsonElement(body)
        val obj = element as? kotlinx.serialization.json.JsonObject
        val defs = obj?.get("defs") ?: obj?.get("data") ?: element
        return parseEvaluatedDefinitions(defs)
    }

    private suspend fun loadCachedDefinitions(): CachedDefinitions {
        // Capture before any storage or JWKS suspension; never relabel a restored payload.
        val owner = synchronized(lifecycleLock) {
            val captured = cacheOwner()
            features?.let { snapshot ->
                if (snapshotContext == captured.url) {
                    return CachedDefinitions(
                        definitions ?: fromBooleanDefaults(snapshot), snapshot, captured,
                        variants = variantDefs
                    )
                }
            }
            captured
        }

        try {
            var cacheKey = contextCacheKey(owner.url)
            var cached = storage.get(cacheKey)
            // Legacy identity-only payloads are eligible only for empty targeting.
            if (cached == null && owner.instanceId == null && groups.isEmpty() && claims.isEmpty()) {
                cacheKey = TogglyStorageKeys.FEATURE_FLAGS_CACHE + hashIdentity(owner.identity ?: "")
                cached = storage.get(cacheKey)
            }

            if (cached != null) {
                val cacheData = json.decodeFromString<TogglyFeatureFlagsCache>(cached)
                if (cacheData.identity == owner.identity &&
                    (cacheData.evaluationContext == persistedContext(owner) ||
                        (cacheData.evaluationContext == null && owner.instanceId == null && groups.isEmpty() && claims.isEmpty()))) {
                    return trustOrReverifyCachedFlags(cacheData, cacheKey, owner)
                }
            }
        } catch (_: Exception) {
            // Cache read failed, use defaults
        }

        val defaults = fromBooleanDefaults(config.featureDefaults)
        return CachedDefinitions(defaults, config.featureDefaults, owner)
    }

    /**
     * When [TogglyConfig.verifySignatures] is enabled, re-verify persisted
     * envelope metadata before trusting the cache. Invalid signatures fail
     * closed (clear cache). Transient JWKS/network failures keep last-known-good.
     */
    private suspend fun trustOrReverifyCachedFlags(
        cacheData: TogglyFeatureFlagsCache,
        cacheKey: String,
        owner: CacheOwner
    ): CachedDefinitions {
        var variants: Map<String, EvaluatedVariantDef>? = null
        val parsed = runCatching {
            if (config.enableVariants) {
                val parsedVariants = parseVariantDefinitions(cacheData.flags)
                variants = parsedVariants
                variantDefinitionsToEvaluated(parsedVariants)
            } else {
                parseEvaluatedDefinitions(cacheData.flags)
            }
        }.getOrElse {
            return CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, owner, cacheKey)
        }
        val flags = toBooleanDefinitions(parsed)

        if (!config.verifySignatures) {
            return CachedDefinitions(parsed, flags, owner, variants = variants)
        }

        if (cacheData.timestamp == null ||
            cacheData.signature.isNullOrEmpty() ||
            cacheData.keyId.isNullOrEmpty()
        ) {
            return CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, owner, cacheKey)
        }

        try {
            SignedDefsVerify.assertEnvelopeFreshness(
                cacheData.timestamp,
                config.maxSignatureAgeSeconds
            )
        } catch (_: Exception) {
            return CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, owner, cacheKey)
        }

        val jwks = resolveJwksForCacheVerify()
        if (jwks == null) {
            return CachedDefinitions(parsed, flags, owner, variants = variants)
        }

        return try {
            val envelope = SignedDefsVerify.SignedEnvelope(
                defsRaw = cacheData.flags,
                signature = cacheData.signature,
                timestamp = cacheData.timestamp,
                kid = cacheData.keyId
            )
            SignedDefsVerify.verify(envelope, jwks)
            CachedDefinitions(parsed, flags, owner, variants = variants)
        } catch (_: Exception) {
            CachedDefinitions(fromBooleanDefaults(config.featureDefaults), config.featureDefaults, owner, cacheKey)
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
                // Scope the cache by the token without persisting the capability itself.
                evaluationContext = persistedContext(cacheOwner())
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
