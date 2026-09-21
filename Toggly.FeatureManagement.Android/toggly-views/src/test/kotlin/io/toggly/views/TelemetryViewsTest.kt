package io.toggly.views

import io.toggly.core.TogglyService
import io.toggly.core.models.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
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
class TelemetryViewsTest {
    @Test fun viewModelFlowUsesOneCoreEvaluation() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(202))
            val service = TogglyService(TogglyConfig(appKey = "test-app", refreshInterval = 0,
                featureDefaults = mapOf("off" to false, "skip" to true), enableLiveUpdates = false,
                metricsBaseUrl = server.url("/").toString()))
            service.setNetworkState(NetworkState(false)); service.init()
            val model = FeatureFlagViewModel(service)
            assertTrue(model.featureGateFlow(listOf("off", "skip"), negate = true).first())
            service.flushTelemetry()
            val request = server.takeRequest(2, TimeUnit.SECONDS)!!
            val body = JSONObject(GZIPInputStream(request.body.readByteArray().inputStream()).readBytes().decodeToString())
            assertEquals("[1]", body.getJSONObject("f").getJSONObject("off").getJSONArray("disabled").toString())
            assertFalse(body.getJSONObject("f").has("skip"))
            service.dispose()
        }
    }
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    @Test fun viewModelForwardsIdentityAndTokenChangesWithoutAnotherReporter() = runBlocking {
        kotlinx.coroutines.Dispatchers.setMain(kotlinx.coroutines.test.UnconfinedTestDispatcher())
        val store = androidx.lifecycle.ViewModelStore()
        try {
            MockWebServer().use { server ->
                repeat(2) { server.enqueue(MockResponse().setResponseCode(202)) }
                val service = TogglyService(TogglyConfig(appKey = "test-app", identity = "alice", refreshInterval = 0,
                    enableLiveUpdates = false, metricsBaseUrl = server.url("/").toString()))
                try {
                    service.setNetworkState(NetworkState(false)); service.init()
                    val model = FeatureFlagViewModel(service)
                    store.put("test", model)
                    model.setIdentity("bob", "token")
                    assertEquals("token", service.currentInstanceId)
                    model.recordUsage("minted")
                    model.setInstanceId(null)
                    assertNull(service.currentInstanceId)
                    model.recordUsage("fallback"); model.flushTelemetry()
                    val packets = (0..1).map {
                        val request = server.takeRequest(2, TimeUnit.SECONDS)!!
                        JSONObject(GZIPInputStream(request.body.readByteArray().inputStream()).readBytes().decodeToString())
                    }
                    assertEquals("token", packets[0].getString("i")); assertEquals("bob", packets[1].getString("u"))
                } finally { service.dispose() }
            }
        } finally { store.clear(); kotlinx.coroutines.Dispatchers.resetMain() }
    }

}
