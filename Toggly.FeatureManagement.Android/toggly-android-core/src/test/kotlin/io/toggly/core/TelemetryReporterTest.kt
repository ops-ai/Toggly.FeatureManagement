package io.toggly.core

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import okhttp3.Request
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.zip.GZIPInputStream

@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryReporterTest {
    private val contract = Json.parseToJsonElement(File("../../tests/frontend-telemetry/contract.json").readText()).jsonObject
    private fun body(request: Request): JsonElement {
        val buffer = okio.Buffer()
        request.body!!.writeTo(buffer)
        val bytes = buffer.readByteArray()
        val raw = if (request.header("Content-Encoding") == "gzip") GZIPInputStream(bytes.inputStream()).readBytes() else bytes
        return Json.parseToJsonElement(raw.decodeToString())
    }
    private fun bytes(request: Request): Int = body(request).toString().toByteArray().size

    @Test fun sharedSerializationAndEndpointFixtures() = runTest {
        for (scenario in contract.getValue("scenarios").jsonArray) {
            val row = scenario.jsonObject
            val options = row["options"]?.jsonObject ?: JsonObject(emptyMap())
            val requests = mutableListOf<Request>()
            val reporter = TelemetryReporter(
                appKey = options["appKey"]?.jsonPrimitive?.content ?: "test-app",
                enableTelemetry = options["enableTelemetry"]?.jsonPrimitive?.boolean ?: true,
                scope = backgroundScope, now = { testScheduler.currentTime }, compressor = { null },
                transport = { requests += it; TelemetryResponse(202) }
            )
            for (event in row.getValue("events").jsonArray) {
                val args = event.jsonArray
                val key = args[1].jsonPrimitive.content
                val variant = args.getOrNull(2)?.jsonPrimitive?.content ?: "enabled"
                when (args[0].jsonPrimitive.content) {
                    "recordCheck" -> reporter.recordCheck(key, variant)
                    "recordUsage" -> reporter.recordUsage(key, variant)
                    "recordView" -> reporter.recordView(key, variant)
                    "incrementCounter" -> reporter.incrementCounter(key, args[2].jsonPrimitive.double)
                    "setGauge" -> reporter.setGauge(key, args[2].jsonPrimitive.double)
                    else -> error("Unknown fixture event")
                }
            }
            reporter.flushTelemetry()
            assertEquals(row["name"].toString(), row["envelopes"], JsonArray(requests.map(::body)))
            reporter.dispose()
        }
        for (scenario in contract.getValue("endpointScenarios").jsonArray) {
            val row = scenario.jsonObject
            val requests = mutableListOf<Request>()
            val reporter = TelemetryReporter("test-app", metricsBaseUrl = row.getValue("metricsBaseUrl").jsonPrimitive.content,
                scope = backgroundScope, now = { testScheduler.currentTime }, transport = { requests += it; TelemetryResponse(202) })
            reporter.recordUsage("flag")
            reporter.flushTelemetry()
            val expected = row["expectedUrl"]?.jsonPrimitive?.contentOrNull
            assertEquals(row["name"].toString(), expected, requests.singleOrNull()?.url?.toString())
            reporter.dispose()
        }
    }

    @Test fun sharedTransportFixtures() = runTest {
        for (scenario in contract.getValue("transportScenarios").jsonArray) {
            val row = scenario.jsonObject
            val start = testScheduler.currentTime
            val attempts = mutableListOf<Long>()
            val statuses = row["statuses"]?.jsonArray?.map { it.jsonPrimitive.int }.orEmpty()
            val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime }, transport = {
                attempts += testScheduler.currentTime - start
                when (row["failure"]?.jsonPrimitive?.content) {
                    "network" -> throw IOException("ambiguous")
                    "timeout" -> awaitCancellation()
                    else -> TelemetryResponse(statuses[attempts.lastIndex], row["retryAfter"]?.jsonPrimitive?.content)
                }
            })
            reporter.incrementCounter("orders")
            reporter.flushTelemetry()
            advanceTimeBy(310_000)
            assertEquals(row["name"].toString(), row.getValue("attemptTimesMs").jsonArray.map { it.jsonPrimitive.long }, attempts)
            reporter.dispose()
        }
    }

    @Test fun atomicGaugeOrderAndInflightBudget() = runTest {
        val started = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        val requests = mutableListOf<Request>()
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime }, transport = {
            requests += it
            if (requests.size == 1) { started.complete(Unit); release.await() }
            TelemetryResponse(202)
        })
        reporter.setGauge("cart", 1.0)
        val flush = async { reporter.flushTelemetry() }
        started.await()
        reporter.setGauge("cart", 2.0)
        reporter.incrementCounter("cart", 2.0) // Conflicting kind cannot replace the accepted gauge.
        val concurrent = async { reporter.flushTelemetry() }
        assertEquals(1, requests.size)
        release.complete(Unit)
        flush.await(); concurrent.await()
        assertEquals(listOf(1.0, 2.0), requests.map { body(it).jsonObject.getValue("m").jsonObject.getValue("cart").jsonPrimitive.double })
        reporter.dispose()
    }

    @Test fun boundsIncludeEscapingNumericChunksAndRejectedNames() = runTest {
        for ((environment, key) in listOf("\"".repeat(10_000) to "orders", "Production" to "m".repeat(20_000))) {
            val requests = mutableListOf<Request>()
            val reporter = TelemetryReporter("test-app", environment = environment, scope = backgroundScope,
                now = { testScheduler.currentTime }, transport = { requests += it; TelemetryResponse(202) })
            repeat(20) { reporter.incrementCounter(key, 1_000_000.0) }
            reporter.flushTelemetry()
            assertTrue(requests.sumOf(::bytes) <= 262_144)
            assertTrue(requests.all { bytes(it) <= 49_152 })
            assertTrue(requests.isNotEmpty())
            reporter.dispose()
        }
        val requests = mutableListOf<Request>()
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            transport = { requests += it; TelemetryResponse(202) })
        repeat(2_001) { reporter.recordCheck("feature-$it", "enabled") }
        reporter.recordUsage("x".repeat(49_152))
        reporter.flushTelemetry()
        assertEquals(2_000, requests.sumOf { body(it).jsonObject.getValue("f").jsonObject.size })
        assertTrue(requests.all { bytes(it) <= 49_152 })
        requests.clear()
        repeat(17) { reporter.recordCheck("experiment", "v$it") }
        reporter.flushTelemetry()
        assertEquals(2, requests.size)
        assertTrue(requests.all { body(it).jsonObject.getValue("f").jsonObject.getValue("experiment").jsonObject.size <= 16 })
        reporter.dispose()
    }

    @Test fun packetOverflowPreservesExistingVariantMap() = runTest {
        val requests = mutableListOf<Request>()
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            transport = { requests += it; TelemetryResponse(202) })
        val key = "f".repeat(48_400)
        val variants = (0 until 12).map { "v$it".padEnd(64, 'x') }
        variants.forEach { reporter.recordCheck(key, it) }
        reporter.flushTelemetry()
        assertEquals(2, requests.size)
        assertTrue(requests.all { bytes(it) <= 49_152 })
        val received = requests.flatMap { body(it).jsonObject.getValue("f").jsonObject.getValue(key).jsonObject.entries }
        assertEquals(variants.toSet(), received.map { it.key }.toSet())
        assertEquals(12, received.size)
        assertTrue(received.all { it.value == Json.parseToJsonElement("[1]") })
        reporter.dispose()
    }

    @Test fun actualEntryBoundaryNeverDropsAcceptedData() = runTest {
        val requests = mutableListOf<Request>()
        val overhead = """{"k":"test-app","e":"Production","f":{"":{"enabled":[1]}}}""".toByteArray().size
        val key = "x".repeat(49_152 - overhead)
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            transport = { requests += it; TelemetryResponse(202) })
        reporter.recordCheck("safe", "enabled")
        reporter.recordUsage(key)
        reporter.recordView(key)
        reporter.flushTelemetry()
        assertEquals(1, requests.size)
        assertEquals(setOf("safe"), body(requests.single()).jsonObject.getValue("f").jsonObject.keys)
        reporter.dispose()
    }

    @Test fun expiryAfterOversleepAndDisposeCancelRetry() = runTest {
        var offset = 0L
        val requests = mutableListOf<Request>()
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime + offset },
            sleep = { offset += 301_000 }, transport = { requests += it; TelemetryResponse(503) })
        repeat(17) { reporter.recordCheck("flag", "v$it") }
        reporter.flushTelemetry()
        assertEquals(1, requests.size)
        reporter.dispose()
        requests.clear()
        val second = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            transport = { requests += it; TelemetryResponse(if (requests.size == 1) 503 else 202) })
        second.recordUsage("old")
        val flush = async { second.flushTelemetry() }
        runCurrent()
        second.recordUsage("new")
        val disposedAt = testScheduler.currentTime
        second.dispose()
        flush.await()
        runCurrent()
        assertEquals(disposedAt, testScheduler.currentTime)
        assertEquals(2, requests.size)
        assertNull(requests.last().header("Content-Encoding"))
    }

    @Test fun gzipFallbackAmbiguousFailureAndDiagnosticsAreIsolated() = runTest {
        val requests = mutableListOf<Request>()
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            onDiagnostic = { error("host callback") }, transport = { requests += it; throw IOException("lost") })
        reporter.recordView("flag")
        reporter.recordUsage("flag", "invalid\n")
        reporter.flushTelemetry()
        assertEquals(1, requests.size)
        assertEquals("gzip", requests.single().header("Content-Encoding"))
        assertEquals(Json.parseToJsonElement("[0,0,1]"), body(requests.single()).jsonObject.getValue("f").jsonObject.getValue("flag").jsonObject["enabled"])
        reporter.dispose()
        requests.clear()
        val fallback = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            compressor = { error("compression failed before send") }, transport = { requests += it; TelemetryResponse(202) })
        fallback.recordUsage("flag"); fallback.flushTelemetry()
        assertNull(requests.single().header("Content-Encoding"))
        assertEquals(setOf("k", "e", "f"), body(requests.single()).jsonObject.keys)
        assertNull(requests.single().header("Authorization")); assertNull(requests.single().header("Origin"))
        fallback.dispose()
    }
    @Test fun disabledInvalidConfigAndJitterAreSilentOrBounded() = runTest {
        val requests = mutableListOf<Request>()
        for ((key, enabled, endpoint) in listOf(Triple("", true, "https://collector.test"),
            Triple("test-app", false, "https://collector.test"), Triple("test-app", true, "/relative"))) {
            val reporter = TelemetryReporter(key, enableTelemetry = enabled, metricsBaseUrl = endpoint,
                scope = backgroundScope, now = { testScheduler.currentTime }, transport = { requests += it; TelemetryResponse(202) })
            reporter.recordUsage("flag"); reporter.setGauge("gauge", 2.0)
            advanceTimeBy(100_000); reporter.flushTelemetry(); reporter.dispose()
        }
        assertTrue(requests.isEmpty())
        val reporter = TelemetryReporter("test-app", telemetryFlushIntervalMs = 1, scope = backgroundScope,
            now = { testScheduler.currentTime }, transport = { requests += it; TelemetryResponse(202) })
        reporter.recordUsage("flag")
        runCurrent(); advanceTimeBy(35_999); runCurrent()
        assertTrue(requests.isEmpty())
        advanceTimeBy(18_002); runCurrent()
        assertEquals(1, requests.size)
        reporter.dispose()
    }

    @Test fun nonRetryStatusesAndHttpDateRetryAfter() = runTest {
        val requests = mutableListOf<Request>()
        for (status in contract.getValue("policy").jsonObject.getValue("dropStatuses").jsonArray) {
            val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
                transport = { requests += it; TelemetryResponse(status.jsonPrimitive.int) })
            reporter.recordUsage("flag"); reporter.flushTelemetry(); reporter.dispose()
        }
        assertEquals(contract.getValue("policy").jsonObject.getValue("dropStatuses").jsonArray.size, requests.size)
        val times = mutableListOf<Long>()
        val start = testScheduler.currentTime
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            wallNow = { testScheduler.currentTime - start }, transport = {
                times += testScheduler.currentTime - start
                TelemetryResponse(if (times.size == 1) 429 else 202, "Thu, 01 Jan 1970 00:02:00 GMT")
            })
        reporter.recordUsage("flag"); reporter.flushTelemetry()
        assertEquals(listOf(0L, 120_000L), times)
        reporter.dispose()
    }

    @Test fun finalDisposeCancelsStalledTransportWithinFiveSeconds() = runTest {
        var canceled = false
        var attempts = 0
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime }, transport = {
            attempts++
            try { awaitCancellation() } finally { canceled = true }
        })
        reporter.recordUsage("flag")
        reporter.dispose()
        runCurrent(); advanceTimeBy(5_001); runCurrent()
        assertTrue(canceled)
        assertEquals(1, attempts)
        reporter.recordUsage("after-disposal")
        reporter.flushTelemetry()
        advanceTimeBy(310_000)
        assertEquals(1, attempts)
    }

    @Test fun inflightEntriesShareAdmissionAndEntityLeavesAreEffective() = runTest {
        val requests = mutableListOf<Request>()
        val release = CompletableDeferred<Unit>()
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime }, transport = {
            requests += it
            if (requests.size == 1) release.await()
            TelemetryResponse(202)
        })
        val definitions = mapOf("gated" to EvaluatedDefinition.Gate(EntityGate("all", listOf(EntityGateRule("Color", "eq", "red")))),
            "skip" to EvaluatedDefinition.BooleanValue(true))
        val onCheck: (String, Boolean) -> Unit = { key, value -> reporter.recordCheck(key, if (value) "enabled" else "disabled") }
        assertTrue(evaluateEvaluatedGateWithChecks(definitions, listOf("gated", "skip"), negate = true, onCheck = onCheck))
        val flush = async { reporter.flushTelemetry() }; runCurrent()
        repeat(2_000) { reporter.recordCheck("feature-$it", "enabled") }
        release.complete(Unit); flush.await()
        val count = requests.sumOf { body(it).jsonObject.getValue("f").jsonObject.values.sumOf { variants -> variants.jsonObject.size } }
        assertEquals(2_000, count)
        assertFalse(requests.any { body(it).jsonObject.getValue("f").jsonObject.containsKey("skip") })
        reporter.dispose()
    }

    @Test fun disposeSendsAtMostOneFinalEnvelope() = runTest {
        val requests = mutableListOf<Request>()
        val reporter = TelemetryReporter("test-app", scope = backgroundScope, now = { testScheduler.currentTime },
            transport = { requests += it; TelemetryResponse(202) })
        repeat(17) { reporter.recordCheck("flag", "v$it") }
        reporter.dispose()
        runCurrent()
        assertEquals(1, requests.size)
        assertNull(requests.single().header("Content-Encoding"))
        advanceTimeBy(310_000); runCurrent()
        assertEquals(1, requests.size)
    }

    @Test fun emptyAuthorityCannotBecomeAHostThroughUrlNormalization() = runTest {
        val requests = mutableListOf<Request>()
        for (endpoint in listOf("https://", "http://", "https:///path", "http:////path")) {
            val reporter = TelemetryReporter("test-app", metricsBaseUrl = endpoint, scope = backgroundScope,
                now = { testScheduler.currentTime }, transport = { requests += it; TelemetryResponse(202) })
            reporter.recordUsage("flag"); reporter.flushTelemetry(); reporter.dispose()
        }
        assertTrue(requests.isEmpty())
    }

}
