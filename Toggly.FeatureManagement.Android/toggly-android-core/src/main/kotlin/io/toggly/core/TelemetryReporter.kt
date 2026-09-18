package io.toggly.core

import android.os.SystemClock
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okio.BufferedSink
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.ceil
import kotlin.random.Random

internal data class TelemetryResponse(val status: Int, val retryAfter: String? = null)

/** One bounded, memory-only reporter per client; targeting and definitions transport never enter it. */
internal class TelemetryReporter(
    private val appKey: String,
    private val environment: String = "Production",
    enableTelemetry: Boolean = true,
    metricsBaseUrl: String = "https://metrics.toggly.io",
    telemetryFlushIntervalMs: Long = 45_000,
    private val onDiagnostic: ((String) -> Unit)? = null,
    scope: CoroutineScope = CoroutineScope(Dispatchers.IO),
    private val now: () -> Long = { SystemClock.elapsedRealtime() },
    private val wallNow: () -> Long = { System.currentTimeMillis() },
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val compressor: (ByteArray) -> ByteArray? = ::gzip,
    private val transport: (suspend (Request) -> TelemetryResponse)? = null
) {
    private data class FeatureKey(val name: String, val variant: String)
    private data class Feature(val checks: Long = 0, val used: Long = 0, val viewed: Long = 0) {
        val pieces get() = ((maxOf(checks, used, viewed) - 1) / VALUE_LIMIT + 1).toInt()
        fun first() = Feature(minOf(checks, VALUE_LIMIT), minOf(used, VALUE_LIMIT), minOf(viewed, VALUE_LIMIT))
        fun json() = JsonArray(when {
            viewed > 0 -> listOf(checks, used, viewed)
            used > 0 -> listOf(checks, used)
            else -> listOf(checks)
        }.map(::JsonPrimitive))
    }
    private data class Metric(val value: Double, val counter: Boolean) {
        val pieces get() = if (counter) maxOf(1, ceil(value / VALUE_LIMIT).toInt()) else 1
        fun first() = if (counter) minOf(value, VALUE_LIMIT.toDouble()) else value
    }
    private data class Stored<T>(val value: T, val entries: Int, val upperBytes: Long)
    private data class Batch(val bytes: ByteArray, val entries: Int, val createdAt: Long)
    private data class Item(val feature: FeatureKey? = null, val delta: Feature? = null, val metric: String? = null, val value: Double = 0.0)
    private val lock = Any()
    private val owner = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))
    private val endpoint = endpoint(metricsBaseUrl)
    private val enabled = enableTelemetry && appKey.isNotBlank() && endpoint != null
    private val interval = telemetryFlushIntervalMs.takeIf { it in 30_000..60_000 } ?: 45_000
    private var disposed = false
    private var finalAttempted = false
    private val features = linkedMapOf<FeatureKey, Stored<Feature>>()
    private val metrics = linkedMapOf<String, Stored<Metric>>()
    private val queued = ArrayDeque<Batch>()
    private var queuedKinds: Map<String, Boolean> = emptyMap()
    private var pendingEntries = 0
    private var pendingUpperBytes = 0L
    private var queuedEntries = 0
    private var queuedBytes = 0L
    private var periodic: Job? = null
    private var retry: Job? = null
    private var flight: Deferred<Unit>? = null
    private val client = lazy {
        OkHttpClient.Builder().retryOnConnectionFailure(false)
            .followRedirects(false).followSslRedirects(false)
            .cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE)
            .proxyAuthenticator(Authenticator.NONE)
            .callTimeout(5, TimeUnit.SECONDS).connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.SECONDS).writeTimeout(5, TimeUnit.SECONDS).build()
    }

    init {
        if (enableTelemetry && appKey.isNotBlank()) {
            if (endpoint == null) diagnose("invalid-option")
            if (interval != telemetryFlushIntervalMs) diagnose("invalid-option")
        }
    }

    fun recordCheck(key: String, variant: String) = recordFeature(key, variant, 0)
    fun recordUsage(key: String, variant: String = "enabled") = recordFeature(key, variant, 1)
    fun recordView(key: String, variant: String = "enabled") = recordFeature(key, variant, 2)

    private fun recordFeature(key: String, variant: String, index: Int) = synchronized(lock) {
        if (!enabled || disposed) return@synchronized
        if (key.isBlank() || variant.length !in 1..64 || !variant.all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '_' || it == '-' }) {
            diagnose("invalid-event"); return@synchronized
        }
        val name = FeatureKey(key, variant)
        val old = features[name]
        val before = old?.value ?: Feature()
        val value = when (index) {
            0 -> before.copy(checks = before.checks + 1)
            1 -> before.copy(used = before.used + 1)
            else -> before.copy(viewed = before.viewed + 1)
        }
        val size = encode(mapOf(key to mapOf(variant to value.first().json())), emptyMap()).size
        if (size > ENVELOPE_LIMIT) { diagnose("oversized-entry"); return@synchronized }
        val next = Stored(value, value.pieces, size.toLong() * value.pieces)
        features[name] = next
        admit(old?.entries ?: 0, old?.upperBytes ?: 0, next.entries, next.upperBytes) {
            if (old == null) features.remove(name) else features[name] = old
        }
    }

    fun incrementCounter(key: String, value: Double = 1.0) = recordMetric(key, value, true)
    fun setGauge(key: String, value: Double) = recordMetric(key, value, false)
    private fun recordMetric(key: String, amount: Double, counter: Boolean) = synchronized(lock) {
        if (!enabled || disposed) return@synchronized
        if (key.isBlank() || !amount.isFinite() || amount < 0 || amount > VALUE_LIMIT || (counter && amount % 1.0 != 0.0)) {
            diagnose("invalid-event"); return@synchronized
        }
        val old = metrics[key]
        if (old != null && old.value.counter != counter || queuedKinds[key]?.let { it != counter } == true) {
            diagnose("metric-kind-conflict"); return@synchronized
        }
        val value = Metric(if (counter) (old?.value?.value ?: 0.0) + amount else amount, counter)
        // No accepted accumulator can exceed 2,000 one-million chunks.
        if (value.value > VALUE_LIMIT.toDouble() * ENTRY_LIMIT) { diagnose("buffer-limit"); return@synchronized }
        val size = encode(emptyMap(), mapOf(key to value.first())).size
        if (size > ENVELOPE_LIMIT) { diagnose("oversized-entry"); return@synchronized }
        val next = Stored(value, value.pieces, size.toLong() * value.pieces)
        metrics[key] = next
        admit(old?.entries ?: 0, old?.upperBytes ?: 0, next.entries, next.upperBytes) {
            if (old == null) metrics.remove(key) else metrics[key] = old
        }
    }

    /** Called only under lock; metadata belongs to accepted entries, with no lifetime name cache. */
    private fun admit(oldEntries: Int, oldBytes: Long, newEntries: Int, newBytes: Long, undo: () -> Unit) {
        val entries = pendingEntries - oldEntries + newEntries
        val upperBytes = pendingUpperBytes - oldBytes + newBytes
        val fits = entries + queuedEntries <= ENTRY_LIMIT &&
            (upperBytes + queuedBytes <= BUFFER_LIMIT || batches().sumOf { it.bytes.size.toLong() } + queuedBytes <= BUFFER_LIMIT)
        if (!fits) { undo(); diagnose("buffer-limit"); return }
        pendingEntries = entries
        pendingUpperBytes = upperBytes
        if (periodic == null) periodic = owner.launch {
            while (isActive) {
                delay((interval * Random.nextDouble(0.8, 1.2)).toLong())
                flushTelemetry()
            }
        }
    }

    private fun encode(f: Map<String, Map<String, JsonArray>>, m: Map<String, Double>): ByteArray = buildJsonObject {
        put("k", appKey); put("e", environment)
        if (f.isNotEmpty()) put("f", JsonObject(f.mapValues { JsonObject(it.value) }))
        if (m.isNotEmpty()) put("m", JsonObject(m.mapValues { (_, value) ->
            if (value % 1.0 == 0.0) JsonPrimitive(value.toLong()) else JsonPrimitive(value)
        }))
    }.toString().toByteArray(Charsets.UTF_8)

    /** At most ENTRY_LIMIT eventual chunks are admitted, so arrays and splitting are bounded. */
    private fun batches(): List<Batch> {
        val items = mutableListOf<Item>()
        features.entries.sortedWith(compareBy({ it.key.name }, { it.key.variant })).forEach { (key, stored) ->
            var remaining = stored.value
            repeat(stored.entries) {
                val piece = remaining.first()
                items += Item(feature = key, delta = piece)
                remaining = Feature(remaining.checks - piece.checks, remaining.used - piece.used, remaining.viewed - piece.viewed)
            }
        }
        metrics.toSortedMap().forEach { (key, stored) ->
            var remaining = stored.value.value
            repeat(stored.entries) {
                val piece = if (stored.value.counter) minOf(remaining, VALUE_LIMIT.toDouble()) else remaining
                items += Item(metric = key, value = piece)
                remaining -= piece
            }
        }
        val result = mutableListOf<Batch>()
        var f = linkedMapOf<String, MutableMap<String, JsonArray>>()
        var m = linkedMapOf<String, Double>()
        var count = 0
        val createdAt = now()
        fun finish() {
            if (count > 0) result += Batch(encode(f, m), count, createdAt)
            f = linkedMapOf(); m = linkedMapOf(); count = 0
        }
        for (item in items) {
            val key = item.feature
            if (key != null && (f[key.name]?.containsKey(key.variant) == true || (f[key.name]?.size ?: 0) >= 16) || item.metric?.let(m::containsKey) == true) finish()
            fun insert() {
                if (key != null) f.getOrPut(key.name) { linkedMapOf() }[key.variant] = item.delta!!.json()
                else m[item.metric!!] = item.value
                count++
            }
            insert()
            if (encode(f, m).size > ENVELOPE_LIMIT) {
                if (key != null) { f[key.name]!!.remove(key.variant); if (f[key.name]!!.isEmpty()) f.remove(key.name) }
                else m.remove(item.metric)
                count--; finish(); insert()
            }
        }
        finish()
        return result
    }

    fun requestFlush() { startFlush() }

    suspend fun flushTelemetry() { startFlush()?.await() }

    private fun startFlush(): Deferred<Unit>? = synchronized(lock) {
            if (!enabled || !owner.isActive) return@synchronized null
            flight ?: owner.async(start = CoroutineStart.LAZY) {
                try { drain() } finally { synchronized(lock) { flight = null } }
            }.also { flight = it; it.start() }
    }

    private suspend fun drain() {
        while (currentCoroutineContext().isActive) {
            val batch = synchronized(lock) {
                if (disposed && finalAttempted) return
                if (queued.isEmpty()) {
                    if (pendingEntries == 0) return
                    queued.addAll(batches())
                    queuedEntries = pendingEntries
                    queuedBytes = queued.sumOf { it.bytes.size.toLong() }
                    queuedKinds = metrics.mapValues { it.value.value.counter }
                    features.clear(); metrics.clear(); pendingEntries = 0; pendingUpperBytes = 0
                }
                queued.first()
            }
            if (!expired(batch)) send(batch)
            synchronized(lock) {
                if (queued.firstOrNull() !== batch) return
                queued.removeFirst(); queuedEntries -= batch.entries; queuedBytes -= batch.bytes.size
                if (queued.isEmpty()) queuedKinds = emptyMap()
            }
        }
    }

    private fun expired(batch: Batch): Boolean = now() - batch.createdAt >= 300_000

    private suspend fun send(batch: Batch) {
        val finalSend = synchronized(lock) {
            if (disposed && finalAttempted) return
            disposed.also { if (it) finalAttempted = true }
        }
        val compressed = if (finalSend) null else runCatching { compressor(batch.bytes) }.getOrNull()
        val bytes = compressed ?: batch.bytes
        // OkHttp must not automatically replay POSTs (including 503/Retry-After: 0 follow-ups).
        val body = object : RequestBody() {
            override fun contentType() = "application/json".toMediaType()
            override fun contentLength() = bytes.size.toLong()
            override fun isOneShot() = true
            override fun writeTo(sink: BufferedSink) { sink.write(bytes) }
        }
        val request = Request.Builder().url(endpoint!!).post(body).apply {
            if (compressed != null) header("Content-Encoding", "gzip")
        }.build()
        var attempt = 0
        while (!expired(batch)) {
            val response = try {
                withTimeout(5_000) { transport?.invoke(request) ?: execute(request) }
            } catch (_: TimeoutCancellationException) {
                diagnose("transport-failure"); return
            } catch (cancelled: CancellationException) { throw cancelled
            } catch (_: Exception) { diagnose("transport-failure"); return }
            if (response.status == 202) return
            if (response.status !in listOf(429, 503) || attempt == 2 || synchronized(lock) { disposed }) {
                diagnose("http-failure"); return
            }
            val wait = maxOf(if (attempt == 0) 30_000L else 60_000L, retryAfter(response.retryAfter))
            if (wait >= 300_000 - (now() - batch.createdAt)) return
            val sleeping = synchronized(lock) {
                if (disposed) return
                owner.launch(start = CoroutineStart.LAZY) { sleep(wait) }.also { retry = it; it.start() }
            }
            sleeping.join()
            synchronized(lock) { retry = null; if (disposed) return }
            attempt++
        }
    }

    private suspend fun execute(request: Request): TelemetryResponse = suspendCancellableCoroutine { continuation ->
        val call = client.value.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWithException(e)
            }
            override fun onResponse(call: Call, response: Response) {
                response.use { if (continuation.isActive) continuation.resume(TelemetryResponse(it.code, it.header("Retry-After"))) }
            }
        })
    }

    private fun retryAfter(raw: String?): Long {
        if (raw == null) return 0
        raw.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }?.let { return (it * 1000).coerceAtMost(Long.MAX_VALUE.toDouble()).toLong() }
        return runCatching {
            SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply { timeZone = TimeZone.getTimeZone("GMT") }
                .parse(raw)?.time?.minus(wallNow())?.coerceAtLeast(0) ?: 0
        }.getOrDefault(0)
    }

    /** Synchronous teardown; at most one final envelope within five seconds globally. */
    fun dispose() {
        synchronized(lock) {
            if (disposed) return
            disposed = true
            periodic?.cancel(); periodic = null
            retry?.cancel()
            if (!enabled) { owner.cancel(); return }
        }
        owner.launch {
            try { withTimeoutOrNull(5_000) { flushTelemetry() } }
            finally {
                owner.cancel()
                synchronized(lock) {
                    features.clear(); metrics.clear(); queued.clear(); queuedKinds = emptyMap()
                    pendingEntries = 0; pendingUpperBytes = 0; queuedEntries = 0; queuedBytes = 0
                }
                if (client.isInitialized()) {
                    client.value.dispatcher.cancelAll()
                    client.value.connectionPool.evictAll()
                    client.value.dispatcher.executorService.shutdown()
                }
            }
        }
    }

    private fun diagnose(code: String) { runCatching { onDiagnostic?.invoke(code) } }

    companion object {
        private const val VALUE_LIMIT = 1_000_000L
        private const val ENTRY_LIMIT = 2_000
        private const val ENVELOPE_LIMIT = 49_152
        private const val BUFFER_LIMIT = 262_144L
        private fun endpoint(base: String): HttpUrl? {
            if ('?' in base || '#' in base) return null
            // Reject empty authorities before OkHttp's permissive slash normalization.
            val authority = base.substringAfter("://", "").substringBefore('/').substringBefore('\\')
            if (authority.isBlank()) return null
            val url = base.toHttpUrlOrNull() ?: return null
            if (url.username.isNotEmpty() || url.password.isNotEmpty() || '@' in base.substringAfter("://").substringBefore('/')) return null
            return url.newBuilder().encodedPath(url.encodedPath.trimEnd('/') + "/api/frontend/telemetry").build()
        }
        private fun gzip(bytes: ByteArray): ByteArray = ByteArrayOutputStream().use { output ->
            GZIPOutputStream(output).use { it.write(bytes) }
            output.toByteArray()
        }
    }
}
