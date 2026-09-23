package io.toggly.acceptance

import android.view.View
import android.widget.TextView
import android.os.SystemClock
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.activity.compose.setContent
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.viewinterop.AndroidView
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.toggly.compose.Feature
import io.toggly.compose.FeatureGate
import io.toggly.compose.TogglyProvider
import io.toggly.core.TogglyEntityContext
import io.toggly.core.TogglyService
import io.toggly.core.models.FeatureRequirement
import io.toggly.core.models.TogglyConfig
import io.toggly.datastore.createDataStoreStorage
import io.toggly.room.createRoomStorage
import io.toggly.views.FeatureFlagViewModel
import io.toggly.views.bindToFeatureFlag
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayInputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.zip.GZIPInputStream

@RunWith(AndroidJUnit4::class)
class PublicTelemetryTest {
    @get:Rule val compose = createAndroidComposeRule<AcceptanceActivity>()

    @Test fun explicitRetryCodesAndAmbiguousTransport() = runBlocking {
        val packets = CopyOnWriteArrayList<Pair<RecordedRequest, JSONObject>>()
        val times = CopyOnWriteArrayList<Long>()
        val server = MockWebServer()
        server.dispatcher = fixtureDispatcher(packets, onTelemetry = { times.add(SystemClock.elapsedRealtime()) }) { attempt ->
            when (attempt) {
                1 -> MockResponse().setResponseCode(429).addHeader("Retry-After", "0")
                2 -> MockResponse().setResponseCode(503).addHeader("Retry-After", "0")
                else -> MockResponse().setResponseCode(202)
            }
        }
        server.start()
        val core = TogglyService(TogglyConfig(
            appKey = "retry-test", baseUri = server.url("/").toString(),
            metricsBaseUrl = server.url("/").toString(),
            enableLiveUpdates = false, refreshInterval = 0
        ))
        try {
            core.recordUsage("retry")
            core.flushTelemetry()
            assertEquals(3, packets.size)
            assertTrue(times[1] - times[0] >= 29_000)
            assertTrue(times[2] - times[1] >= 59_000)
            assertEquals(packets[0].second.toString(), packets[1].second.toString())
            assertEquals(packets[1].second.toString(), packets[2].second.toString())
        } finally { core.dispose(); server.shutdown() }

        val ambiguous = CopyOnWriteArrayList<Pair<RecordedRequest, JSONObject>>()
        val ambiguousServer = MockWebServer()
        ambiguousServer.dispatcher = fixtureDispatcher(ambiguous) {
            MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
        }
        ambiguousServer.start()
        val uncertain = TogglyService(TogglyConfig(
            appKey = "ambiguous-test", metricsBaseUrl = ambiguousServer.url("/").toString(),
            enableLiveUpdates = false, refreshInterval = 0
        ))
        try {
            uncertain.recordUsage("once")
            uncertain.flushTelemetry()
            Thread.sleep(750)
            assertEquals(1, ambiguous.size)
        } finally { uncertain.dispose(); ambiguousServer.shutdown() }
    }

    @Test fun immediatePostReplacementFlushKeepsExplicitUsage() = runBlocking {
        val packets = CopyOnWriteArrayList<Pair<RecordedRequest, JSONObject>>()
        val server = MockWebServer()
        server.dispatcher = fixtureDispatcher(packets)
        server.start()
        val core = TogglyService(TogglyConfig(
            appKey = "public-test", environment = "Acceptance", baseUri = server.url("/").toString(),
            identity = "user-a", enableLiveUpdates = false, refreshInterval = 0,
            useSignedDefinitions = true, verifySignatures = false,
            metricsBaseUrl = server.url("/").toString(),
            storage = createRoomStorage(compose.activity.applicationContext, "ops1388-immediate.db")
        ))
        try {
            assertNull(core.init().error)
            core.recordUsage("before")
            core.flushTelemetry()
            assertNull(core.setIdentity("user-b", "local-minted-fixture").error)
            core.recordUsage("after-replacement")
            core.flushTelemetry()
            assertEquals(2, packets.size)
            assertTrue(packets.last().second.getJSONObject("f").has("after-replacement"))
        } finally { core.dispose(); server.shutdown() }
    }

    @Test fun publicCoreUiStorageAndAttribution() = runBlocking {
        val packets = CopyOnWriteArrayList<Pair<RecordedRequest, JSONObject>>()
        val server = MockWebServer()
        server.dispatcher = fixtureDispatcher(packets)
        server.start()
        val base = server.url("/").toString()
        val context = compose.activity.applicationContext
        val room = createRoomStorage(context, "ops1388-test.db")
        val datastore = createDataStoreStorage(context)
        val config = TogglyConfig(
            appKey = "public-test", environment = "Acceptance", baseUri = base,
            identity = "user-a", enableLiveUpdates = false, refreshInterval = 0,
            metricsBaseUrl = base, storage = room
        )
        val core = TogglyService(config)
        val variants = TogglyService(config.copy(
            enableVariants = true, enableTelemetry = false, storage = datastore
        ))
        try {
            compose.activity.runOnUiThread { compose.activity.setContent {
                TogglyProvider(core) {
                    Column {
                        Feature("checkout") { Text("Compose checkout") }
                        Feature("disabled", negate = true) { Text("Compose negation") }
                        FeatureGate(listOf("checkout", "disabled"), FeatureRequirement.ANY) {
                            Text("Compose any gate")
                        }
                        AndroidView(factory = { viewContext ->
                            TextView(viewContext).apply {
                                text = "Views checkout"
                                visibility = View.GONE
                                bindToFeatureFlag("checkout", compose.activity, core)
                            }
                        })
                    }
                }
            } }
            assertNull(core.init().error)
            assertTrue(core.isFeatureOn("checkout"))
            assertFalse(core.isFeatureOn("disabled"))
            assertTrue(core.evaluateFeatureGate(listOf("checkout", "disabled"), FeatureRequirement.ANY))
            assertFalse(core.evaluateFeatureGate(listOf("checkout", "disabled"), FeatureRequirement.ALL))
            assertTrue(core.evaluateFeatureGate(listOf("disabled"), negate = true))
            assertTrue(core.isFeatureEnabled("ExpressCheckout", TogglyEntityContext("Order", "vip", mapOf("Vip" to true))))
            assertFalse(core.isFeatureEnabled("ExpressCheckout", TogglyEntityContext("Order", "standard", mapOf("Vip" to false))))
            assertFalse(core.isFeatureEnabled("ExpressCheckout"))
            compose.waitUntil(5_000) {
                try {
                    compose.onNodeWithText("Compose checkout").assertExists()
                    compose.onNodeWithText("Compose negation").assertExists()
                    compose.onNodeWithText("Compose any gate").assertExists()
                    true
                } catch (_: AssertionError) { false }
            }
            val views = FeatureFlagViewModel(core)
            assertTrue(views.isFeatureOn("checkout"))
            views.recordUsage("checkout", "preview-a")
            views.recordView("checkout", "preview-a")
            views.incrementCounter("orders", 2.0)
            views.setGauge("queue", 3.5)
            views.flushTelemetry()
            assertEquals(1, packets.size)
            val (firstRequest, first) = packets.first()
            assertEquals("/api/frontend/telemetry", firstRequest.path)
            assertEquals("gzip", firstRequest.getHeader("Content-Encoding"))
            assertNull(firstRequest.getHeader("Origin"))
            assertNull(firstRequest.getHeader("Cookie"))
            assertNull(firstRequest.getHeader("Authorization"))
            assertEquals("public-test", first.getString("k"))
            assertEquals("Acceptance", first.getString("e"))
            assertEquals("user-a", first.optString("u"))
            assertFalse(first.has("i"))
            val labeled = first.getJSONObject("f").getJSONObject("checkout").getJSONArray("preview-a")
            assertEquals(1, labeled.getInt(1))
            assertEquals(1, labeled.getInt(2))
            assertEquals(2.0, first.getJSONObject("m").getDouble("orders"), 0.0)
            assertEquals(3.5, first.getJSONObject("m").getDouble("queue"), 0.0)

            assertNull(variants.init().error)
            assertEquals("blue", variants.getVariant("checkout")?.name)
            assertEquals(7L, variants.getVariantValue("checkout"))
            assertNull(core.setIdentity("user-b", "local-minted-fixture").error)
            core.recordUsage("session-b")
            core.flushTelemetry()
            assertEquals(2, packets.size)
            assertEquals("local-minted-fixture", packets.last().second.getString("i"))
            assertFalse(packets.last().second.has("u"))
            // Compose/Views may evaluate checkout again after replacement; the old
            // explicitly labeled usage/view counts must not cross identities.
            assertFalse(packets.last().second.getJSONObject("f")
                .optJSONObject("checkout")?.has("preview-a") == true)
            assertTrue(packets.last().second.getJSONObject("f").has("session-b"))
            assertTrue(room.keys().none { it.contains("telemetry", ignoreCase = true) })
            assertTrue(datastore.keys().none { it.contains("telemetry", ignoreCase = true) })

            val before = packets.size
            val keyless = TogglyService(config.copy(appKey = null, featureDefaults = mapOf("checkout" to true)))
            try {
                keyless.init(); assertTrue(keyless.isFeatureOn("checkout"))
                keyless.recordUsage("silent"); keyless.flushTelemetry()
            } finally { keyless.dispose() }
            val optout = TogglyService(config.copy(enableTelemetry = false))
            try {
                optout.recordUsage("silent"); optout.flushTelemetry()
            } finally { optout.dispose() }
            assertEquals(before, packets.size)
        } finally {
            variants.dispose(); core.dispose(); server.shutdown()
        }
    }

    private fun fixtureDispatcher(
        packets: CopyOnWriteArrayList<Pair<RecordedRequest, JSONObject>>,
        onTelemetry: () -> Unit = {},
        telemetryReply: (Int) -> MockResponse = { MockResponse().setResponseCode(202) }
    ) = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse = when {
            request.path?.startsWith("/evaluated-variants-signed/") == true -> MockResponse().setBody(
                """{"defs":{"checkout":{"enabled":true,"variant":"blue","configurationValue":7},"disabled":{"enabled":false}}}"""
            )
            request.path?.startsWith("/evaluated-signed/") == true -> MockResponse().setBody(
                """{"defs":{"checkout":true,"disabled":false,"ExpressCheckout":{"requirement":"all","rules":[{"property":"Vip","op":"eq","type":"boolean","value":"true"}]}}}"""
            )
            request.path == "/api/frontend/telemetry" -> {
                val bytes = request.body.readByteArray()
                val decoded = if (request.getHeader("Content-Encoding") == "gzip")
                    GZIPInputStream(ByteArrayInputStream(bytes)).readBytes() else bytes
                packets.add(request to JSONObject(String(decoded)))
                onTelemetry()
                telemetryReply(packets.size)
            }
            else -> MockResponse().setResponseCode(404)
        }
    }
}
