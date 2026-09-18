package io.toggly.views

import io.toggly.core.TogglyService
import io.toggly.core.models.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
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
}
