package io.toggly.compose

import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.*
import androidx.compose.ui.test.junit4.createComposeRule
import io.toggly.core.TogglyEntityContext
import io.toggly.core.TogglyService
import io.toggly.core.models.*
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class OwnerReplacementTest {
    @get:Rule val rule = createComposeRule()

    @Test fun suppliedProviderResetsEveryCollectedAndRememberedOwnerValue() = checkReplacement(false)
    @Test fun configuredProviderResetsEveryCollectedAndRememberedOwnerValue() = checkReplacement(true)

    private fun checkReplacement(configured: Boolean) {
        MockWebServer().use { server ->
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    if (request.method != "GET") return MockResponse().setResponseCode(202)
                    val enabled = request.path!!.contains("old-app")
                    return MockResponse().setBody("{\"flag\":$enabled,\"flow\":$enabled,\"gate\":$enabled,\"entity\":$enabled}")
                }
            }
            fun config(key: String, env: String, value: Boolean) = TogglyConfig(
                appKey = key, environment = env, identity = "local-test", refreshInterval = 0,
                enableLiveUpdates = false, baseUri = server.url("/defs").toString(),
                metricsBaseUrl = server.url("/").toString(),
                featureDefaults = listOf("flag", "flow", "gate", "entity").associateWith { value })
            val oldConfig = config("old-app", "Old", true)
            val newConfig = config("new-app", "New", false)
            val old = TogglyService(oldConfig)
            val new = TogglyService(newConfig)
            if (!configured) runBlocking {
                old.setNetworkState(NetworkState(false)); old.init()
                new.setNetworkState(NetworkState(false)); new.init()
            }
            var current by mutableStateOf(old)
            var settings by mutableStateOf(oldConfig)
            val owners = CopyOnWriteArrayList<TogglyService>()
            val observations = CopyOnWriteArrayList<Pair<String, List<Boolean>>>()
            val entity = TogglyEntityContext("Order", "local", emptyMap())
            val content: @Composable () -> Unit = {
                val service = LocalTogglyService.current
                val snapshot = rememberFeature("flag")
                val flow by rememberFeatureFlagAsState("flow")
                val gate by rememberFeatureGateAsState(listOf("gate"))
                val evaluated = rememberFeature("entity", context = entity)
                val hook = useToggly().featureFlags["flag"] == true
                val rememberedFlags by rememberTogglyState().featureFlags.collectAsState()
                val state = rememberedFlags["flag"] == true
                observations += service.getDebugInfo().appKey!! to listOf(snapshot, flow, gate, evaluated, hook, state)
                BasicText("$snapshot $flow $gate $evaluated $hook $state")
            }
            rule.setContent {
                if (configured) TogglyProvider(settings, { owners += it }, content)
                else TogglyProvider(current, content)
            }
            rule.waitUntil(5_000) { observations.any { it.first == "old-app" && it.second.all { value -> value } } }
            rule.runOnIdle { if (configured) settings = newConfig else current = new }
            rule.waitForIdle()
            if (configured) rule.waitUntil(5_000) { owners.size == 2 }
            rule.waitUntil(5_000) { observations.any { it.first == "new-app" } }
            rule.waitForIdle()
            val wrong = observations.filter { it.first == "new-app" && it.second.any { value -> value } }
            assertTrue("Replacement owner rendered retained old values: $wrong", wrong.isEmpty())
            val newOwner = if (configured) owners.last() else new
            runBlocking { newOwner.flushTelemetry() }
            val packets = mutableListOf<JSONObject>()
            while (true) {
                val request = server.takeRequest(100, TimeUnit.MILLISECONDS) ?: break
                if (request.method != "POST") continue
                val raw = request.body.readByteArray()
                val bytes = if (request.getHeader("Content-Encoding") == "gzip") GZIPInputStream(raw.inputStream()).readBytes() else raw
                packets += JSONObject(bytes.decodeToString())
            }
            val newPackets = packets.filter { it.getString("k") == "new-app" }
            assertTrue(newPackets.isNotEmpty())
            newPackets.forEach { packet ->
                assertEquals("New", packet.getString("e"))
                val features = packet.getJSONObject("f")
                features.keys().forEach { feature ->
                    assertFalse("Cross-owner telemetry: $packet", features.getJSONObject(feature).has("enabled"))
                }
            }
            old.dispose(); new.dispose(); owners.forEach { it.dispose() }
        }
    }
}
