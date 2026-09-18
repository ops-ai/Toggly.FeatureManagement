package io.toggly.core

import io.toggly.core.models.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class TelemetryServiceTest {
    @Test fun actualChecksAndExplicitEventsUsePrivateIndependentTransport() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(202))
            val service = TogglyService(TogglyConfig(appKey = "test-app", identity = "private-user", groups = listOf("private-group"),
                claims = mapOf("private-claim" to "private-value"), featureDefaults = mapOf("off" to false, "on" to true, "skipped" to true),
                refreshInterval = 0, enableLiveUpdates = false, metricsBaseUrl = server.url("/metrics/").toString()))
            service.setNetworkState(NetworkState(false)); service.init()
            assertTrue(service.evaluateFeatureGate(listOf("off", "skipped"), negate = true))
            assertTrue(service.evaluateFeatureGate(listOf("on", "skipped"), FeatureRequirement.ANY))
            assertTrue(service.featureFlagFlow("on").first())
            service.recordUsage("on"); service.recordView("off", "disabled")
            service.incrementCounter("orders", 2.0); service.setGauge("cart", 12.5)
            service.flushTelemetry()
            val request = server.takeRequest(2, TimeUnit.SECONDS)!!
            val data = request.body.readByteArray()
            val text = GZIPInputStream(data.inputStream()).readBytes().decodeToString()
            val body = JSONObject(text)
            assertEquals("/metrics/api/frontend/telemetry", request.path)
            assertFalse(text.contains("private"))
            assertNull(request.getHeader("Authorization")); assertNull(request.getHeader("Origin"))
            val features = body.getJSONObject("f")
            assertEquals("[2,1]", features.getJSONObject("on").getJSONArray("enabled").toString())
            assertEquals("[1,0,1]", features.getJSONObject("off").getJSONArray("disabled").toString())
            assertFalse(features.has("skipped"))
            service.dispose()
        }
    }

    @Test fun backgroundAndReconfigurationPreserveOwnerAndProjectionDoesNotCount() = runBlocking {
        MockWebServer().use { server ->
            repeat(3) { server.enqueue(MockResponse().setResponseCode(202)) }
            val config = TogglyConfig(appKey = "old-app", featureDefaults = mapOf("on" to true), refreshInterval = 0,
                enableLiveUpdates = false, metricsBaseUrl = server.url("/").toString())
            Toggly.configure(config)
            Toggly.shared.setNetworkState(NetworkState(false)); Toggly.init()
            Toggly.featureFlags.value
            Toggly.shared.currentFeatures
            Toggly.flushTelemetry()
            assertEquals(0, server.requestCount)
            Toggly.recordUsage("old")
            Toggly.configure(config.copy(appKey = "new-app"))
            val old = server.takeRequest(2, TimeUnit.SECONDS)!!
            assertEquals("old-app", JSONObject(old.body.readUtf8()).getString("k"))
            Toggly.recordUsage("new")
            Toggly.setAppState(AppStateType.BACKGROUND)
            Toggly.flushTelemetry()
            val new = server.takeRequest(2, TimeUnit.SECONDS)!!
            val raw = new.body.readByteArray()
            assertEquals("new-app", JSONObject(GZIPInputStream(raw.inputStream()).readBytes().decodeToString()).getString("k"))
            Toggly.reset()
        }
    }
    @Test fun okhttpDoesNotReplayExplicit503OutsideReporterPolicy() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(503).setHeader("Retry-After", "0"))
            server.enqueue(MockResponse().setResponseCode(202))
            val waits = mutableListOf<Long>()
            val reporter = TelemetryReporter("test-app", metricsBaseUrl = server.url("/").toString(), sleep = { waits += it })
            reporter.recordUsage("flag"); reporter.flushTelemetry()
            assertEquals(listOf(30_000L), waits)
            assertEquals(2, server.requestCount)
            reporter.dispose()
        }
    }

}
