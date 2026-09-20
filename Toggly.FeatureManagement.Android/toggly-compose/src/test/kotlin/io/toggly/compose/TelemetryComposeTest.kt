package io.toggly.compose

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.*
import androidx.compose.ui.test.junit4.createComposeRule
import io.toggly.core.TogglyService
import io.toggly.core.models.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class TelemetryComposeTest {
    @get:Rule val composeRule = createComposeRule()
    @Test fun snapshotReevaluationCountsOnlyVisitedLeavesBeforeNegation() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(202))
            val service = TogglyService(TogglyConfig(appKey = "test-app", refreshInterval = 0,
                enableLiveUpdates = false, metricsBaseUrl = server.url("/").toString()))
            var flags by mutableStateOf(mapOf("off" to false, "skipped" to true))
            var unrelated by mutableStateOf(0)
            composeRule.setContent {
                CompositionLocalProvider(LocalTogglyService provides service, LocalFeatureFlags provides flags) {
                    val result = rememberFeatureGate(listOf("off", "skipped"), negate = true)
                    BasicText("$result-$unrelated")
                }
            }
            composeRule.runOnIdle { unrelated++ }
            composeRule.runOnIdle { flags = mapOf("off" to true, "skipped" to true) }
            composeRule.waitForIdle()
            runBlocking { service.flushTelemetry() }
            val request = server.takeRequest(2, TimeUnit.SECONDS)
            assertNotNull("Snapshot evaluations must reach the owner reporter", request)
            val body = JSONObject(GZIPInputStream(request!!.body.readByteArray().inputStream()).readBytes().decodeToString())
            val features = body.getJSONObject("f")
            assertEquals("[1]", features.getJSONObject("off").getJSONArray("disabled").toString())
            assertEquals("[1]", features.getJSONObject("off").getJSONArray("enabled").toString())
            assertEquals("[1]", features.getJSONObject("skipped").getJSONArray("enabled").toString())
            service.dispose()
        }
    }
    @Test fun providerConfigChangeDisposesOldTelemetryOwner() {
        MockWebServer().use { server ->
            server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
                override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): MockResponse =
                    if (request.method == "GET") MockResponse().setResponseCode(200).setBody("{\"on\":true}")
                    else MockResponse().setResponseCode(202)
            }
            var config by mutableStateOf(TogglyConfig(appKey = "old-app", baseUri = server.url("/defs").toString(),
                refreshInterval = 0, enableLiveUpdates = false, metricsBaseUrl = server.url("/").toString()))
            val initialized = java.util.concurrent.CopyOnWriteArrayList<TogglyService>()
            composeRule.setContent {
                TogglyProvider(config, onInitialized = { initialized += it }) { BasicText("provider") }
            }
            composeRule.waitUntil(5_000) { initialized.size == 1 }
            initialized[0].recordUsage("old")
            composeRule.runOnIdle { config = config.copy(appKey = "new-app") }
            composeRule.waitForIdle()
            composeRule.waitUntil(5_000) { initialized.size == 2 }
            initialized[1].recordUsage("new")
            runBlocking { initialized[1].flushTelemetry() }
            val posts = mutableListOf<okhttp3.mockwebserver.RecordedRequest>()
            repeat(4) { server.takeRequest(2, TimeUnit.SECONDS)?.let { if (it.method == "POST") posts += it } }
            assertEquals(2, posts.size)
            val keys = posts.map { request ->
                val raw = request.body.readByteArray()
                val bytes = if (request.getHeader("Content-Encoding") == "gzip") GZIPInputStream(raw.inputStream()).readBytes() else raw
                JSONObject(bytes.decodeToString()).getString("k")
            }
            assertEquals(setOf("old-app", "new-app"), keys.toSet())
            initialized.forEach { it.dispose() }
        }
    }

    @Test fun sameFlagValuesAfterIdentityChangeUseNewContextForLaterReevaluation() {
        MockWebServer().use { server ->
            repeat(4) { server.enqueue(MockResponse().setResponseCode(202)) }
            val service = TogglyService(TogglyConfig(appKey = "test-app", identity = "alice",
                featureDefaults = mapOf("off" to false), refreshInterval = 0, enableLiveUpdates = false,
                metricsBaseUrl = server.url("/").toString()))
            runBlocking { service.setNetworkState(NetworkState(false)); service.init() }
            var key by mutableStateOf("off")
            composeRule.setContent {
                TogglyProvider(service) { BasicText(rememberFeature(key).toString()) }
            }
            composeRule.waitForIdle()
            runBlocking { service.flushTelemetry(); service.setIdentity("bob", "bob-token") }
            composeRule.waitForIdle()
            composeRule.runOnIdle { key = "new-key" }
            composeRule.waitForIdle()
            runBlocking { service.flushTelemetry() }
            val packets = mutableListOf<JSONObject>()
            repeat(server.requestCount) {
                val request = server.takeRequest(2, TimeUnit.SECONDS)!!
                packets += JSONObject(GZIPInputStream(request.body.readByteArray().inputStream()).readBytes().decodeToString())
            }
            val later = packets.single { it.getJSONObject("f").has("new-key") }
            assertEquals("bob-token", later.getString("i")); assertFalse(later.has("u"))
            assertEquals("[1]", later.getJSONObject("f").getJSONObject("new-key").getJSONArray("disabled").toString())
            service.dispose()
        }
    }

    @Test fun hooksForwardTokenReplacementToOneCoreQueue() = runBlocking {
        MockWebServer().use { server ->
            repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
            val service = TogglyService(TogglyConfig(appKey = "test-app", identity = "alice", refreshInterval = 0,
                enableLiveUpdates = false, metricsBaseUrl = server.url("/").toString()))
            try {
                service.setNetworkState(NetworkState(false)); service.init()
                val hook = UseTogglyResult(service, service.featureFlags)
                val state = TogglyState(service)
                hook.setIdentity("bob", "first-token"); state.setInstanceId("rotated-token")
                hook.recordUsage("minted")
                state.setIdentity("carol", "carol-token"); hook.setInstanceId(null)
                state.recordUsage("fallback"); hook.flushTelemetry()
                val packets = (0..1).map {
                    val request = server.takeRequest(2, TimeUnit.SECONDS)!!
                    JSONObject(GZIPInputStream(request.body.readByteArray().inputStream()).readBytes().decodeToString())
                }
                assertEquals("rotated-token", packets[0].getString("i"))
                assertEquals("carol", packets[1].getString("u"))
            } finally { service.dispose() }
        }
    }

}
